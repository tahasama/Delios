using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Transmittals;

public sealed partial class TransmittalService
{
    // ── Requests ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Ask for a revision to go somewhere. A released revision is carried out at
    /// once when the asker may send it; otherwise the request waits for Document
    /// Control. A revision decided and waiting for its release may be asked for
    /// too: the release carries the request out.
    /// </summary>
    public async Task<(IssueRequest? Request, IReadOnlyList<Transmittal> Sent, IResult? Problem)> RequestAsync(
        ProjectAccess access, Guid revisionId, IssueAsk ask, CancellationToken cancellationToken)
    {
        var revision = await db.Revisions.SingleOrDefaultAsync(r => r.Id == revisionId, cancellationToken);
        var document = revision is null ? null : await VisibleDocumentAsync(access, revision.DocumentId, cancellationToken);
        if (revision is null || document is null)
            return (null, [], Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        if (!await HasStandingAsync(access, document, revision, cancellationToken))
        {
            return (null, [], Problems.Forbidden("ISSUE_NOT_ALLOWED",
                "Whoever wrote the revision, started its review or sat on it asks for it to be issued, or the control function."));
        }
        var awaitingRelease = revision.State == RevisionStates.InReview && await DecidedToProceedAsync(revision.Id, cancellationToken);
        if (revision.State != RevisionStates.Released && !awaitingRelease)
        {
            return (null, [], Problems.Conflict("NOT_ISSUABLE",
                "Only a released revision is issued, or one whose decision lets it out and is waiting for its release.",
                new { state = revision.State }));
        }

        var (request, problem) = await NewRequestAsync(access, document, revision, ask, cancellationToken);
        if (problem is not null) return (null, [], problem);
        db.IssueRequests.Add(request!);
        // The author said who: what was left to them is answered.
        if (!request!.Delegated)
        {
            foreach (var left in await db.IssueRequests.Where(r => r.RevisionId == revision.Id && r.Status == IssueRequestStatuses.Open && r.Delegated)
                .ToListAsync(cancellationToken))
            {
                Close(left, IssueRequestStatuses.Done, access.UserName);
            }
        }
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "ISSUE_REQUESTED", "Revision", revision.Id,
            Label(document, revision), $"Asked for {request!.Reason}.", document.ProjectId, cancellationToken);

        IReadOnlyList<Transmittal> sent = [];
        if (request.Delegated)
        {
            // Left to whoever started the revision's review; the author only when it was never reviewed.
            var initiator = await db.Reviews.AsNoTracking().Where(r => r.RevisionId == revision.Id)
                .OrderByDescending(r => r.StartedAt).Select(r => (Guid?)r.StartedById).FirstOrDefaultAsync(cancellationToken) ?? revision.AuthoredById;
            await notifier.NotifyAsync(document.TenantId, document.ProjectId, [initiator], Notifications.NotificationKinds.IssueRequested,
                $"Who should get {Label(document, revision)}?",
                "It was left to you to say who this revision goes to. Ask for it when you know.", $"/documents/{document.Id}", cancellationToken);
        }
        else if (Ready(request, revision) && revision.State == RevisionStates.Released && await MayCarryOutAsync(access, document, request, cancellationToken))
        {
            sent = await CarryOutAsync(access.Project, new Actor(access.UserId, access.UserName), request, revision, document,
                cancellationToken);
        }
        else
        {
            // Not sent at once: The control function sends it, so they are told what was asked for.
            await notifier.NotifyAsync(document.TenantId, document.ProjectId, await notifier.ControlHoldersAsync(document.ProjectId, cancellationToken),
                Notifications.NotificationKinds.IssueRequested, $"{Label(document, revision)}: asked to send it {request.Reason.ToLowerInvariant()}",
                $"{access.UserName} asked.{(request.Note is null ? "" : $" {request.Note}")}", $"/documents/{document.Id}", cancellationToken);
        }
        await db.SaveChangesAsync(cancellationToken);
        return (request, sent, null);
    }

    /// <summary>A request checked and ready to add, or why not. Used by the deciding step too.</summary>
    public async Task<(IssueRequest? Request, IResult? Problem)> NewRequestAsync(
        ProjectAccess access, Document document, Revision revision, IssueAsk ask, CancellationToken cancellationToken)
    {
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var reason = ask.Reason ?? "";
        if (!catalog.IsActive(TransmittalSets.Reasons, reason))
        {
            return (null, Problems.Invalid("VALUE_NOT_PUBLISHED", $"{reason} is not a published reason for issue.",
                new { field = "reason", value = reason }));
        }
        var userIds = ask.UserIds?.Distinct().ToArray() ?? [];
        var partyIds = ask.PartyIds?.Distinct().ToArray() ?? [];
        if (ask.Delegated && userIds.Length + partyIds.Length > 0)
            return (null, Problems.Invalid("DELEGATED_NAMES_NOBODY", "Either say who receives it, or leave it to the author: not both."));
        if (userIds.Length + partyIds.Length == 0 && !ask.Delegated && ask.ApproverPartyId is null)
            return (null, Problems.Invalid("RECIPIENTS_REQUIRED", "Say who receives it: our own people, an outside party, or both."));
        if (ask.ApproverPartyId is { } approver
            && !await db.Parties.AnyAsync(p => p.Id == approver && p.Active && !p.IsInternal, cancellationToken))
            return (null, Problems.Invalid("APPROVER_UNKNOWN", "Whoever approves it from outside must be an active outside party."));

        var members = await MembersAsync(access.Project, cancellationToken);
        var strangers = userIds.Except(members.Select(m => m.UserId)).ToList();
        if (strangers.Count > 0)
            return (null, Problems.Invalid("RECIPIENT_NOT_ON_PROJECT", "Some people chosen are not on this project.", new { userIds = strangers }));
        var parties = await db.Parties.AsNoTracking().Where(p => partyIds.Contains(p.Id) && p.Active && !p.IsInternal)
            .Select(p => p.Id).ToListAsync(cancellationToken);
        if (parties.Count != partyIds.Length)
            return (null, Problems.Invalid("PARTY_UNKNOWN", "Some organizations chosen are not active outside parties.",
                new { partyIds = partyIds.Except(parties) }));

        // Issuing outside the defined distribution is allowed, with the reason on the record.
        var off = members.Where(m => userIds.Contains(m.UserId)
            && !(m.Internal && ProjectAccess.OfFunction(access.Project, m.Function).Allows(Verbs.Receive, document.Facts)))
            .Select(m => m.Name).ToList();
        var offReason = ask.OffDistributionReason?.Trim();
        if (off.Count > 0 && string.IsNullOrEmpty(offReason))
        {
            return (null, Problems.Invalid("OFF_DISTRIBUTION_REASON_REQUIRED",
                $"{string.Join(", ", off)} {(off.Count == 1 ? "is" : "are")} not on the distribution for this document. Say why they receive it.",
                new { people = off }));
        }

        return (new IssueRequest
        {
            TenantId = document.TenantId,
            ProjectId = document.ProjectId,
            DocumentId = document.Id,
            RevisionId = revision.Id,
            Reason = reason,
            UserIds = userIds,
            PartyIds = partyIds,
            Note = ask.Note?.Trim() is { Length: > 0 } note ? note : null,
            OffDistributionReason = off.Count > 0 ? offReason : null,
            Delegated = ask.Delegated,
            ApproverPartyId = ask.ApproverPartyId,
            ApprovalState = ask.ApproverPartyId is null ? null : ApprovalStates.Waiting,
            RaisedById = access.UserId,
            RaisedByName = access.UserName,
            RaisedAt = clock.GetCurrentInstant(),
        }, null);
    }

    /// <summary>
    /// Carries out an open issue request on the control function's say-so: checks the request is still open and the
    /// revision released, then raises its transmittals. Called by the carry-out endpoint.
    /// </summary>
    public async Task<(IssueRequest? Request, IReadOnlyList<Transmittal> Sent, IResult? Problem)> CarryOutAsync(
        ProjectAccess access, Guid requestId, CancellationToken cancellationToken)
    {
        var (request, document, revision) = await LoadRequestAsync(access, requestId, cancellationToken);
        if (request is null) return (null, [], RequestNotFound());
        if (!await MayCarryOutAsync(access, document!, request, cancellationToken))
            return (null, [], Problems.Forbidden("CONTROL_ONLY", "The control function sends what was asked for."));
        if (request.Status != IssueRequestStatuses.Open)
            return (null, [], Problems.Conflict("REQUEST_CLOSED", "That request has already been dealt with.", new { status = request.Status }));
        if (revision!.State != RevisionStates.Released)
        {
            return (null, [], Problems.Conflict("NOT_RELEASED", "Only a released revision is issued; this one is not, or no longer.",
                new { state = revision.State }));
        }
        if (request.Delegated) return (null, [], Problems.Conflict("LEFT_TO_AUTHOR", "This one names nobody: it waits for the author to say who."));
        if (request.ApprovalState is ApprovalStates.Waiting or ApprovalStates.Refused)
            return (null, [], Problems.Conflict("AWAITING_APPROVAL", "It waits for the outside approval first."));
        if (revision.HeldAt is not null) return (null, [], Problems.Conflict("ON_HOLD", "It is on hold, not for use."));
        var sent = await CarryOutAsync(access.Project, new Actor(access.UserId, access.UserName), request, revision, document!,
            cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (request, sent, null);
    }

    /// <summary>
    /// Withdraws an open issue request. Allowed to whoever raised it or anyone with the Control permission. Called by
    /// the cancel endpoint.
    /// </summary>
    public async Task<(IssueRequest? Request, IResult? Problem)> CancelAsync(
        ProjectAccess access, Guid requestId, CancellationToken cancellationToken)
    {
        var (request, document, _) = await LoadRequestAsync(access, requestId, cancellationToken);
        if (request is null) return (null, RequestNotFound());
        if (request.RaisedById != access.UserId && !access.Allows(Verbs.Control, document!.Facts))
            return (null, Problems.Forbidden("CANCEL_NOT_ALLOWED", "Whoever asked, or the control function, withdraws a request."));
        if (request.Status != IssueRequestStatuses.Open)
            return (null, Problems.Conflict("REQUEST_CLOSED", "That request has already been dealt with.", new { status = request.Status }));
        Close(request, IssueRequestStatuses.Cancelled, access.UserName);
        await db.SaveChangesAsync(cancellationToken);
        return (request, null);
    }

    /// <summary>
    /// Lists the issue requests for a revision, oldest first, each with the numbers of its transmittals. Returns null
    /// when the revision is not visible to the caller.
    /// </summary>
    public async Task<IReadOnlyList<IssueRequestView>?> RequestsForAsync(
        ProjectAccess access, Guid revisionId, CancellationToken cancellationToken)
    {
        var revision = await db.Revisions.AsNoTracking().SingleOrDefaultAsync(r => r.Id == revisionId, cancellationToken);
        if (revision is null || await VisibleDocumentAsync(access, revision.DocumentId, cancellationToken) is null) return null;
        var requests = await db.IssueRequests.AsNoTracking().Where(r => r.RevisionId == revisionId).OrderBy(r => r.RaisedAt)
            .ToListAsync(cancellationToken);
        var ids = requests.Select(r => r.Id).ToList();
        var numbers = await db.Transmittals.AsNoTracking().Where(t => t.IssueRequestId != null && ids.Contains(t.IssueRequestId.Value))
            .OrderBy(t => t.Id)
            .Select(t => new { t.IssueRequestId, t.Number, t.Id }).ToListAsync(cancellationToken);
        return requests.Select(r => View(r, numbers.Where(n => n.IssueRequestId == r.Id).Select(n => n.Number).ToList(),
            numbers.Where(n => n.IssueRequestId == r.Id).Select(n => n.Id).ToList())).ToList();
    }

    /// <summary>
    /// Release carries out what was asked before it. Called by the release, as
    /// The control function or, where nobody holds that, as the system.
    /// </summary>
    public async Task<IReadOnlyList<Transmittal>> CarryOutOpenAsync(
        Project project, Actor actor, Revision revision, Document document, CancellationToken cancellationToken)
    {
        var open = await db.IssueRequests.Where(r => r.RevisionId == revision.Id && r.Status == IssueRequestStatuses.Open)
            .OrderBy(r => r.RaisedAt).ToListAsync(cancellationToken);
        var sent = new List<Transmittal>();
        foreach (var request in open.Where(r => Ready(r, revision)))
        {
            sent.AddRange(await CarryOutAsync(project, actor, request, revision, document, cancellationToken));
        }
        return sent;
    }

    /// <summary>A revision going back to its author goes nowhere: what was asked for it lapses.</summary>
    public async Task LapseOpenAsync(Guid revisionId, string by, CancellationToken cancellationToken)
    {
        var open = await db.IssueRequests.Where(r => r.RevisionId == revisionId && r.Status == IssueRequestStatuses.Open)
            .ToListAsync(cancellationToken);
        foreach (var request in open) Close(request, IssueRequestStatuses.Cancelled, by);
    }

    /// <summary>One transmittal per destination, because that is what a recipient receives and acknowledges.</summary>
    private async Task<IReadOnlyList<Transmittal>> CarryOutAsync(
        Project project, Actor actor, IssueRequest request, Revision revision, Document document,
        CancellationToken cancellationToken)
    {
        var members = await MembersAsync(project, cancellationToken);
        var sent = new List<Transmittal>();
        var subject = $"{Label(document, revision)}, {revision.StatusCode}";
        if (request.UserIds.Length > 0)
        {
            var people = members.Where(m => request.UserIds.Contains(m.UserId))
                .Select(m => new Addressee(m.UserId, null, m.Name, m.PartyName)).ToList();
            sent.Add(await RaiseAsync(new Raise(project, actor, request.Reason, subject, request.Note, null, "Internal distribution",
                [(document, revision)], people, IssueRequestId: request.Id), cancellationToken));
        }
        var parties = await db.Parties.AsNoTracking().Where(p => request.PartyIds.Contains(p.Id)).OrderBy(p => p.Name)
            .ToListAsync(cancellationToken);
        foreach (var party in parties)
        {
            sent.Add(await RaiseAsync(new Raise(project, actor, request.Reason, subject, request.Note, party, party.Name,
                [(document, revision)], AddresseesOf(party, members), IssueRequestId: request.Id), cancellationToken));
        }
        Close(request, IssueRequestStatuses.Done, actor.Name);
        await audit.WriteAsync(actor, "ISSUED", "Revision", revision.Id, Label(document, revision),
            $"Issued as {request.RaisedByName} asked, {request.Reason}: {string.Join(", ", sent.Select(t => t.Number))}.",
            project.Id, cancellationToken);
        return sent;
    }

    /// <summary>
    /// The people of a party who answer here, or, where nobody does, the party
    /// itself: then one of ours sends it outside the system and records that it went.
    /// </summary>
    public static List<Addressee> AddresseesOf(Party party, IEnumerable<Member> members)
    {
        var theirs = party.Participation == Participations.InApp
            ? members.Where(m => m.PartyId == party.Id).Select(m => new Addressee(m.UserId, party.Id, m.Name, party.Name)).ToList()
            : [];
        return theirs.Count > 0 ? theirs : [new Addressee(null, party.Id, party.Name, party.Name)];
    }
}
