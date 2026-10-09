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

/// <summary>Who a revision should go to, and why. Asked by people, carried out by Document Control.</summary>
/// <param name="Delegated">Leave it to the revision's author to say who receives it: they are told, and ask themselves.</param>
/// <param name="ApproverPartyId">An outside party that must approve it first: release waits for them, or a released revision is held.</param>
public sealed record IssueAsk(
    string? Reason, Guid[]? UserIds = null, Guid[]? PartyIds = null, string? Note = null, string? OffDistributionReason = null,
    bool Delegated = false, Guid? ApproverPartyId = null);

/// <summary>That something went to an organization outside the system: when, how, their reference, the proof.</summary>
/// <param name="DispatchedOn">The day it went, when not today: not before the transmittal, not to come.</param>
public sealed record DispatchRequest(string? Channel, string? Reference = null, Guid? ProofFileId = null, DateOnly? DispatchedOn = null);

/// <summary>
/// Issuing: asking for a released revision to be sent, carrying the request out
/// as numbered transmittals, and the record of each recipient opening,
/// acknowledging, or being sent it by hand. Nothing here sends email: an
/// exchange outside the system is recorded, with its proof, by whoever carried it.
/// </summary>
public sealed class TransmittalService(
    DeliosDbContext db, Numbering numbering, AuditLog audit, FileStorage storage, IClock clock,
    IOptions<StorageOptions> storageOptions, Notifications.Notifier notifier)
{
    // ── Distribution ──────────────────────────────────────────────────────────

    /// <summary>
    /// Who receives this class of document is the permission matrix read through
    /// RECEIVE, not a second list to keep. Everyone else on the project may still be
    /// chosen, with a reason.
    /// </summary>
    public async Task<DistributionView> DistributionAsync(Project project, Document document, CancellationToken cancellationToken)
    {
        var members = await MembersAsync(project, cancellationToken);
        var proposed = members.Where(m => m.Internal && ProjectAccess.OfFunction(project, m.Function).Allows(Verbs.Receive, document.Facts))
            .ToList();
        var parties = await db.Parties.AsNoTracking().Where(p => p.Active && !p.IsInternal).OrderBy(p => p.Name)
            .Select(p => new PartyChoice(p.Id, p.Code, p.Name, p.Participation)).ToListAsync(cancellationToken);
        return new DistributionView(
            proposed.Select(m => m.View()).ToList(),
            members.Except(proposed).Select(m => m.View()).ToList(),
            parties);
    }

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
                "Whoever wrote the revision, started its review or sat on it asks for it to be issued, or Document Control."));
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
            await notifier.NotifyAsync(document.TenantId, document.ProjectId, [revision.AuthoredById], Notifications.NotificationKinds.IssueRequested,
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
            // Not sent at once: Document Control sends it, so they are told what was asked for.
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
    /// Carries out an open issue request on Document Control's say-so: checks the request is still open and the
    /// revision released, then raises its transmittals. Called by the carry-out endpoint.
    /// </summary>
    public async Task<(IssueRequest? Request, IReadOnlyList<Transmittal> Sent, IResult? Problem)> CarryOutAsync(
        ProjectAccess access, Guid requestId, CancellationToken cancellationToken)
    {
        var (request, document, revision) = await LoadRequestAsync(access, requestId, cancellationToken);
        if (request is null) return (null, [], RequestNotFound());
        if (!await MayCarryOutAsync(access, document!, request, cancellationToken))
            return (null, [], Problems.Forbidden("CONTROL_ONLY", "Document Control sends what was asked for."));
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
            return (null, Problems.Forbidden("CANCEL_NOT_ALLOWED", "Whoever asked, or Document Control, withdraws a request."));
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
    /// Document Control or, where nobody holds that, as the system.
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

    // ── Composing ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Body of a transmittal Document Control composes itself: released revisions, the people and outside parties
    /// it goes to, why (a reason for issue), a subject, a message, and when an answer is due if one is wanted.
    /// </summary>
    public sealed record ComposeRequest(
        Guid[]? RevisionIds, Guid[]? UserIds, Guid[]? PartyIds, string? Reason, string? Subject = null, string? Message = null,
        DateOnly? ResponseDue = null, Guid[]? CopyUserIds = null, bool Draft = false, Guid? InReplyToId = null, Guid? FollowsId = null,
        string? FollowKind = null, DateOnly? IssuedOn = null, Dictionary<string, string?>? Extras = null);

    /// <summary>A compose request checked: what it carries, to whom, and when it is dated.</summary>
    private sealed record Prepared(
        string Reason, string Subject, string? Message, LocalDate? Due, List<(Document Document, Revision Revision)> Items,
        List<Addressee> People, List<Party> Parties, List<Addressee> Copies, Instant IssuedAt, Guid? InReplyToId, Guid? FollowsId,
        string? FollowKind, string? Extras, List<Member> Members);

    /// <summary>
    /// Issues released revisions directly, without an issue request: one transmittal to the project's own people
    /// chosen, and one to each outside party; those copied in are on each. Only those who may control or transmit
    /// every document do this. A letter may carry no documents when it has a subject and a message.
    /// </summary>
    public async Task<(IReadOnlyList<Transmittal> Sent, IResult? Problem)> ComposeAsync(
        ProjectAccess access, ComposeRequest request, CancellationToken cancellationToken)
    {
        var (prepared, problem) = await PrepareAsync(access, request, cancellationToken);
        if (problem is not null) return ([], problem);
        var p = prepared!;
        var actor = new Actor(access.UserId, access.UserName);
        var sent = new List<Transmittal>();
        Raise Of(Party? to, string toName, IReadOnlyList<Addressee> recipients) => new(access.Project, actor, p.Reason, p.Subject, p.Message,
            to, toName, p.Items, recipients, ResponseDue: p.Due, Copies: p.Copies, IssuedAt: p.IssuedAt, InReplyToId: p.InReplyToId,
            FollowsId: p.FollowsId, FollowKind: p.FollowKind, Extras: p.Extras);
        if (p.People.Count > 0 || p.Parties.Count == 0) sent.Add(await RaiseAsync(Of(null, "Internal distribution", p.People), cancellationToken));
        foreach (var party in p.Parties) sent.Add(await RaiseAsync(Of(party, party.Name, AddresseesOf(party, p.Members)), cancellationToken));
        foreach (var (document, revision) in p.Items)
        {
            await audit.WriteAsync(actor, "ISSUED", "Revision", revision.Id, Label(document, revision),
                $"Issued {p.Reason}: {string.Join(", ", sent.Select(t => t.Number))}.", access.Project.Id, cancellationToken);
        }
        await db.SaveChangesAsync(cancellationToken);
        return (sent, null);
    }

    private async Task<(Prepared? Prepared, IResult? Problem)> PrepareAsync(ProjectAccess access, ComposeRequest request, CancellationToken cancellationToken)
    {
        static (Prepared?, IResult?) Fail(IResult problem) => (null, problem);
        var revisionIds = request.RevisionIds?.Distinct().ToList() ?? [];
        var subjectGiven = request.Subject?.Trim() is { Length: > 0 };
        var messageGiven = request.Message?.Trim() is { Length: > 0 };
        if (revisionIds.Count > 500) return Fail(Problems.Invalid("ITEMS_REQUIRED", "Choose at most 500 released revisions."));
        if (revisionIds.Count == 0 && !(subjectGiven && messageGiven))
            return Fail(Problems.Invalid("ITEMS_REQUIRED", "Enclose at least one released revision, or write a subject and a message: a letter says something."));
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var reason = request.Reason?.Trim() ?? "";
        if (!catalog.IsActive(TransmittalSets.Reasons, reason))
            return Fail(Problems.Invalid("VALUE_NOT_PUBLISHED", $"{reason} is not a published reason for issue.", new { field = "reason", value = reason }));
        var revisions = await db.Revisions.Where(r => revisionIds.Contains(r.Id) && r.ProjectId == access.Project.Id).ToListAsync(cancellationToken);
        var documentIds = revisions.Select(r => r.DocumentId).ToList();
        var documents = await DocumentQueries.Visible(db, access, catalog.RestrictedLevels())
            .Where(d => documentIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id, cancellationToken);
        if (revisions.Count != revisionIds.Count || revisions.Any(r => !documents.ContainsKey(r.DocumentId)))
            return Fail(Problems.NotFound("REVISION_NOT_FOUND", "A revision chosen does not exist or is not yours to see."));
        if (revisions.FirstOrDefault(r => r.State != RevisionStates.Released) is { } unreleased)
            return Fail(Problems.Conflict("NOT_RELEASED", $"{Label(documents[unreleased.DocumentId], unreleased)} is not released: only released revisions are issued."));
        if (revisions.FirstOrDefault(r => r.HeldAt is not null) is { } held)
            return Fail(Problems.Conflict("ON_HOLD", $"{Label(documents[held.DocumentId], held)} is on hold, not for use."));
        if (documents.Values.FirstOrDefault(d => !access.Allows(Verbs.Control, d.Facts) && !access.Allows(Verbs.Transmit, d.Facts)) is { } refused)
            return Fail(Problems.Forbidden("TRANSMIT_NOT_ALLOWED", $"Your function does not issue {refused.Number}."));
        if (revisionIds.Count == 0 && !access.IsInternal)
            return Fail(Problems.Forbidden("TRANSMIT_NOT_ALLOWED", "Only the project's own people write letters here."));

        var members = await MembersAsync(access.Project, cancellationToken);
        var userIds = request.UserIds?.Distinct().ToList() ?? [];
        var people = members.Where(m => userIds.Contains(m.UserId)).Select(m => new Addressee(m.UserId, null, m.Name, m.PartyName)).ToList();
        if (people.Count != userIds.Count) return Fail(Problems.Invalid("RECIPIENT_UNKNOWN", "Someone chosen is not active on this project."));
        var partyIds = request.PartyIds?.Distinct().ToList() ?? [];
        var parties = await db.Parties.AsNoTracking().Where(p => partyIds.Contains(p.Id) && p.Active).OrderBy(p => p.Name).ToListAsync(cancellationToken);
        if (parties.Count != partyIds.Count) return Fail(Problems.Invalid("PARTY_UNKNOWN", "An organization chosen is not an active party."));
        if (people.Count == 0 && parties.Count == 0) return Fail(Problems.Invalid("RECIPIENTS_REQUIRED", "Choose who it goes to."));
        var copyIds = request.CopyUserIds?.Distinct().Where(id => !userIds.Contains(id)).ToList() ?? [];
        var copies = members.Where(m => copyIds.Contains(m.UserId)).Select(m => new Addressee(m.UserId, null, m.Name, m.PartyName, RecipientKinds.Cc)).ToList();
        if (copies.Count != copyIds.Count) return Fail(Problems.Invalid("RECIPIENT_UNKNOWN", "Someone copied in is not active on this project."));

        var (issuedAt, notYet) = WorkingCalendar.Moment(clock, access.Project.TimeZone, request.IssuedOn);
        if (notYet is not null) return Fail(Problems.Invalid("DATE_IN_FUTURE", $"The date of issue cannot be later than today. {notYet}"));
        if (revisions.FirstOrDefault(r => r.ReleasedAt > issuedAt!.Value.Plus(Duration.FromHours(12))) is { } later)
            return Fail(Problems.Invalid("DATE_BEFORE_RELEASE", $"{Label(documents[later.DocumentId], later)} was released after that day."));
        Transmittal? answered = null, followed = null;
        if (request.InReplyToId is { } replyTo)
        {
            answered = await Visible(access).AsNoTracking().SingleOrDefaultAsync(t => t.Id == replyTo, cancellationToken);
            if (answered is null) return Fail(Problems.NotFound("TRANSMITTAL_NOT_FOUND", "The transmittal it answers does not exist or is not yours to see."));
            if (answered.IssuedAt > issuedAt!.Value.Plus(Duration.FromHours(12)))
                return Fail(Problems.Invalid("DATE_BEFORE_ANSWERED", $"It cannot be dated before {answered.Number}, which it answers."));
        }
        string? followKind = null;
        if (request.FollowsId is { } follows)
        {
            followed = await Visible(access).AsNoTracking().SingleOrDefaultAsync(t => t.Id == follows, cancellationToken);
            if (followed is null) return Fail(Problems.NotFound("TRANSMITTAL_NOT_FOUND", "The transmittal it follows does not exist or is not yours to see."));
            followKind = (request.FollowKind ?? "SUPPLEMENT").Trim().ToUpperInvariant();
            if (followKind is not ("SUPPLEMENT" or "REPLACES"))
                return Fail(Problems.Invalid("FOLLOW_KIND_INVALID", "A follow-up either supplements the transmittal (SUPPLEMENT) or replaces it (REPLACES)."));
        }

        var items = revisions.Select(r => (documents[r.DocumentId], r)).OrderBy(i => i.Item1.Number).ToList();
        var subject = subjectGiven ? request.Subject!.Trim()
            : items.Count == 1 ? $"{Label(items[0].Item1, items[0].r)}, {items[0].r.StatusCode}" : $"{items.Count} documents";
        var message = messageGiven ? request.Message!.Trim() : null;
        var due = request.ResponseDue is { } d ? LocalDate.FromDateOnly(d) : (LocalDate?)null;
        return (new Prepared(reason, subject, message, due, items, people, parties, copies, issuedAt!.Value, answered?.Id, followed?.Id,
            followKind, Documents.OwnFields.Write(null, request.Extras), members), null);
    }

    // ── Drafts ────────────────────────────────────────────────────────────────

    /// <summary>Keeps a transmittal as a draft: checked as if it were issued now, sent to nobody, numbered when issued.</summary>
    public async Task<(TransmittalDraft? Draft, IResult? Problem)> SaveDraftAsync(ProjectAccess access, ComposeRequest request, CancellationToken cancellationToken)
    {
        var (prepared, problem) = await PrepareAsync(access, request with { Draft = false }, cancellationToken);
        if (problem is not null) return (null, problem);
        var draft = new TransmittalDraft
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            CreatedById = access.UserId,
            CreatedByName = access.UserName,
            CreatedAt = clock.GetCurrentInstant(),
            Subject = prepared!.Subject,
            Body = JsonSerializer.Serialize(request with { Draft = false }),
        };
        db.Add(draft);
        await db.SaveChangesAsync(cancellationToken);
        return (draft, null);
    }

    /// <summary>A draft the caller may see: their own, or any for Document Control. Null otherwise.</summary>
    public Task<TransmittalDraft?> DraftAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken) =>
        db.Set<TransmittalDraft>().SingleOrDefaultAsync(d => d.Id == id && d.ProjectId == access.Project.Id
            && (d.CreatedById == access.UserId || access.Holds(Verbs.Control)), cancellationToken);

    /// <summary>The drafts not yet issued that the caller may see, newest first.</summary>
    public Task<List<TransmittalDraft>> DraftsAsync(ProjectAccess access, CancellationToken cancellationToken) =>
        db.Set<TransmittalDraft>().AsNoTracking()
            .Where(d => d.ProjectId == access.Project.Id && d.IssuedAt == null && (d.CreatedById == access.UserId || access.Holds(Verbs.Control)))
            .OrderByDescending(d => d.CreatedAt).ToListAsync(cancellationToken);

    /// <summary>Issues a draft as it stands, checked again today: it becomes numbered transmittals, and the draft records which.</summary>
    public async Task<(IReadOnlyList<Transmittal> Sent, IResult? Problem)> IssueDraftAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var draft = await DraftAsync(access, id, cancellationToken);
        if (draft is null) return ([], NotFound());
        if (draft.IssuedAt is not null) return ([], Problems.Conflict("ALREADY_ISSUED", $"This draft was issued as {draft.IssuedAs}."));
        var body = JsonSerializer.Deserialize<ComposeRequest>(draft.Body)!;
        // Dated the day it goes, unless the draft named a day.
        var (sent, problem) = await ComposeAsync(access, body, cancellationToken);
        if (problem is not null) return ([], problem);
        draft.IssuedAt = clock.GetCurrentInstant();
        draft.IssuedAs = string.Join(", ", sent.Select(t => t.Number));
        await db.SaveChangesAsync(cancellationToken);
        return (sent, null);
    }

    /// <summary>A draft shown as the transmittal it will be: no number, nobody told yet.</summary>
    public async Task<TransmittalView> DraftViewAsync(ProjectAccess access, TransmittalDraft draft, CancellationToken cancellationToken)
    {
        var body = JsonSerializer.Deserialize<ComposeRequest>(draft.Body)!;
        var revisionIds = body.RevisionIds ?? [];
        var items = await (from r in db.Revisions
                           join d in db.Documents on r.DocumentId equals d.Id
                           where revisionIds.Contains(r.Id)
                           orderby d.Number
                           select new TransmittalItemView(r.Id, TransmittalItemKinds.Revision, d.Id, r.Id, d.Number, d.Title, r.Value, r.StatusCode,
                               null, null, null, null, null, new List<ItemFileView>())).ToListAsync(cancellationToken);
        var members = await MembersAsync(access.Project, cancellationToken);
        var partyIds = body.PartyIds ?? [];
        var parties = await db.Parties.AsNoTracking().Where(p => partyIds.Contains(p.Id)).ToListAsync(cancellationToken);
        var recipients = members.Where(m => (body.UserIds ?? []).Contains(m.UserId))
            .Select(m => new RecipientView(m.UserId, m.Name, m.PartyName, true, null, null, null, null, null, null, null, RecipientKinds.To, m.UserId))
            .Concat(parties.Select(p => new RecipientView(p.Id, p.Name, p.Name, false, null, null, null, null, null, null, null, RecipientKinds.To, null, p.Id)))
            .Concat(members.Where(m => (body.CopyUserIds ?? []).Contains(m.UserId))
                .Select(m => new RecipientView(m.UserId, m.Name, m.PartyName, true, null, null, null, null, null, null, null, RecipientKinds.Cc, m.UserId)))
            .ToList();
        return new TransmittalView(draft.Id, "Draft", TransmittalDirections.Outgoing, body.Reason ?? "", draft.Subject, body.Message,
            parties.Count == 0 ? "Internal distribution" : string.Join(", ", parties.Select(p => p.Name)), false, body.ResponseDue,
            draft.CreatedAt.ToDateTimeOffset(), draft.CreatedByName, null, null, items, recipients, State: "DRAFT", IssuedById: draft.CreatedById,
            Extras: body.Extras is null ? null : JsonSerializer.SerializeToElement(body.Extras));
    }

    // ── Threads, chasing ──────────────────────────────────────────────────────

    /// <summary>What a transmittal answers and follows, and what answered and followed it, among those the caller may see.</summary>
    public async Task<TransmittalThread> ThreadAsync(ProjectAccess access, Transmittal t, CancellationToken cancellationToken)
    {
        var related = await Visible(access).AsNoTracking()
            .Where(x => x.Id == t.InReplyToId || x.Id == t.FollowsId || x.InReplyToId == t.Id || x.FollowsId == t.Id)
            .Select(x => new ThreadRow(x.Id, x.Number, x.Subject, x.IssuedAt, x.Direction, x.FollowKind, x.InReplyToId, x.FollowsId, x.IssuedByName,
                x.FromName, x.Items.Count, x.Recipients.Count))
            .ToListAsync(cancellationToken);
        static TransmittalRef Ref(ThreadRow x) => new(x.Id, x.Number, x.Subject, x.IssuedAt.ToDateTimeOffset(), x.Direction, x.FollowKind,
            x.Items, x.Recipients, x.IssuedByName, x.FromName);
        return new TransmittalThread(
            related.Where(x => x.Id == t.InReplyToId).Select(Ref).FirstOrDefault(),
            related.Where(x => x.InReplyToId == t.Id).OrderBy(x => x.IssuedAt).Select(Ref).ToList(),
            related.Where(x => x.Id == t.FollowsId).Select(Ref).FirstOrDefault(),
            related.Where(x => x.FollowsId == t.Id).OrderBy(x => x.IssuedAt).Select(Ref).ToList());
    }

    private sealed record ThreadRow(Guid Id, string Number, string Subject, Instant IssuedAt, string Direction, string? FollowKind,
        Guid? InReplyToId, Guid? FollowsId, string IssuedByName, string? FromName, int Items, int Recipients);

    /// <summary>
    /// Tells the people it is for again, those who have not acknowledged it (or the ones named). Whoever issued it,
    /// or Document Control.
    /// </summary>
    public async Task<(Transmittal? Transmittal, IResult? Problem)> NotifyAgainAsync(
        ProjectAccess access, Guid id, Guid[]? recipientIds, CancellationToken cancellationToken)
    {
        var transmittal = await Visible(access).Include(t => t.Items).Include(t => t.Recipients).AsSplitQuery()
            .SingleOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (transmittal is null) return (null, NotFound());
        if (transmittal.IssuedById != access.UserId && !access.Holds(Verbs.Control))
            return (null, Problems.Forbidden("NOT_YOURS", "Whoever issued it, or Document Control, tells people again."));
        var chosen = transmittal.Recipients.Where(r => r.UserId is not null && r.Kind == RecipientKinds.To && r.AcknowledgedAt is null
            && (recipientIds is not { Length: > 0 } || recipientIds.Contains(r.Id))).ToList();
        if (chosen.Count == 0) return (null, Problems.Conflict("NOBODY_TO_TELL", "Everybody it is for has acknowledged it."));
        var now = clock.GetCurrentInstant();
        foreach (var r in chosen) r.NotifiedAt = now;
        await notifier.NotifyAsync(transmittal.TenantId, transmittal.ProjectId, chosen.Select(r => r.UserId!.Value),
            Notifications.NotificationKinds.TransmittalReceived, $"Reminder — {transmittal.Number}: {transmittal.Subject}",
            $"{transmittal.Reason} from {transmittal.IssuedByName}, waiting for you to acknowledge it"
            + (transmittal.ResponseDue is { } due ? $"; answer by {due:yyyy-MM-dd}." : "."),
            $"/transmittals/{transmittal.Id}", cancellationToken, Notifications.EmailKinds.Transmittal);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "TRANSMITTAL_CHASED", "Transmittal", transmittal.Id, transmittal.Number,
            $"Told again: {string.Join(", ", chosen.Select(r => r.Name))}.", transmittal.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (transmittal, null);
    }

    // ── Raising ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Someone a transmittal is addressed to: a user (<c>UserId</c> set) or an organization with nobody here
    /// (<c>UserId</c> empty, <c>PartyId</c> set).
    /// </summary>
    public sealed record Addressee(Guid? UserId, Guid? PartyId, string Name, string? Organization, string Kind = RecipientKinds.To);

    /// <summary>
    /// Everything needed to raise one transmittal. Built by issue requests, review steps sent to a party, and package
    /// delivery, then passed to <c>RaiseAsync</c>. <c>Dispatched</c> is set when it was already sent outside the
    /// system.
    /// </summary>
    public sealed record Raise(
        Project Project, Actor Actor, string Reason, string Subject, string? Message, Party? To, string ToName,
        IReadOnlyList<(Document Document, Revision Revision)> Items, IReadOnlyList<Addressee> Recipients,
        Guid? IssueRequestId = null, Guid? ReviewStepId = null, LocalDate? ResponseDue = null, Guid? PackageId = null,
        DispatchRequest? Dispatched = null, IReadOnlyList<(Document Document, LocalDate? Due)>? Placeholders = null,
        IReadOnlyList<Addressee>? Copies = null, Instant? IssuedAt = null, Guid? InReplyToId = null, Guid? FollowsId = null,
        string? FollowKind = null, string? Extras = null);

    /// <summary>A numbered transmittal. What it records is never changed afterwards.</summary>
    public async Task<Transmittal> RaiseAsync(Raise raise, CancellationToken cancellationToken)
    {
        var project = raise.Project;
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var ours = await db.Parties.AsNoTracking().Where(p => p.IsInternal && p.Active).OrderBy(p => p.Code)
            .Select(p => p.Code).FirstOrDefaultAsync(cancellationToken);
        var number = await numbering.RecordAsync(project.TenantId, project.Id, RecordKinds.Transmittal,
            NumberFields.ForRecord(project.Code, ours, raise.To?.Code ?? ours), "TR", cancellationToken);

        var now = clock.GetCurrentInstant();
        var responseRequired = catalog.Prop(TransmittalSets.Reasons, raise.Reason, "response") is { ValueKind: JsonValueKind.True };
        var due = raise.ResponseDue;
        if (due is null && responseRequired
            && catalog.Prop(TransmittalSets.Reasons, raise.Reason, "responseDays") is { ValueKind: JsonValueKind.Number } days)
        {
            due = WorkingCalendar.AddWorkingDays(WorkingCalendar.Today(clock, project.TimeZone), days.GetInt32(), project.WeekendDays);
        }

        var transmittal = new Transmittal
        {
            TenantId = project.TenantId,
            ProjectId = project.Id,
            Number = number,
            Reason = raise.Reason,
            Subject = raise.Subject,
            Message = raise.Message,
            ToPartyId = raise.To?.Id,
            ToName = raise.ToName,
            ResponseRequired = responseRequired || raise.ResponseDue is not null,
            ResponseDue = due,
            IssuedAt = raise.IssuedAt ?? now,
            InReplyToId = raise.InReplyToId,
            FollowsId = raise.FollowsId,
            FollowKind = raise.FollowKind,
            Extras = raise.Extras,
            IssuedById = raise.Actor.Id,
            IssuedByName = raise.Actor.Name,
            IssueRequestId = raise.IssueRequestId,
            ReviewStepId = raise.ReviewStepId,
            PackageId = raise.PackageId,
        };
        transmittal.Items = raise.Items.Select(x => new TransmittalItem
        {
            TenantId = project.TenantId,
            TransmittalId = transmittal.Id,
            DocumentId = x.Document.Id,
            RevisionId = x.Revision.Id,
            DocumentNumber = x.Document.Number,
            Title = x.Document.Title,
            RevisionValue = x.Revision.Value,
            StatusCode = x.Revision.StatusCode,
        }).ToList();
        // Placeholders a supplier is asked to fill: no revision yet, a date each is due.
        transmittal.Items.AddRange((raise.Placeholders ?? []).Select(x => new TransmittalItem
        {
            TenantId = project.TenantId,
            TransmittalId = transmittal.Id,
            Kind = TransmittalItemKinds.Placeholder,
            DocumentId = x.Document.Id,
            DocumentNumber = x.Document.Number,
            Title = x.Document.Title,
            RevisionValue = "",
            DueDate = x.Due,
        }));
        var addressed = raise.Recipients
            .Concat((raise.Copies ?? []).Where(c => !raise.Recipients.Any(r => r.UserId == c.UserId))).ToList();
        transmittal.Recipients = addressed.Select(a => new TransmittalRecipient
        {
            TenantId = project.TenantId,
            TransmittalId = transmittal.Id,
            Kind = a.Kind,
            NotifiedAt = a.UserId is null ? null : now,
            UserId = a.UserId,
            PartyId = a.PartyId,
            Name = a.Name,
            Organization = a.Organization,
            DispatchedAt = a.UserId is null && raise.Dispatched is not null ? now : null,
            DispatchChannel = a.UserId is null ? raise.Dispatched?.Channel : null,
            DispatchRef = a.UserId is null ? raise.Dispatched?.Reference : null,
            DispatchedByName = a.UserId is null && raise.Dispatched is not null ? raise.Actor.Name : null,
            ProofFileId = a.UserId is null ? raise.Dispatched?.ProofFileId : null,
        }).ToList();
        db.Transmittals.Add(transmittal);
        await audit.WriteAsync(raise.Actor, "TRANSMITTAL_ISSUED", "Transmittal", transmittal.Id, number,
            $"{raise.Reason} to {raise.ToName}: {string.Join(", ", transmittal.Items.Select(i => i.Kind == TransmittalItemKinds.Placeholder
                ? $"{i.DocumentNumber} (to send by {i.DueDate?.ToString("yyyy-MM-dd", null) ?? "no date"})" : $"{i.DocumentNumber} rev {i.RevisionValue}"))}.",
            project.Id, cancellationToken);
        // The people it goes to who hold accounts are told, and emailed under the transmittal switch; an
        // organization answering through one of ours is sent it by that person, as the dispatch records.
        var listed = string.Join("\n", transmittal.Items.Select(i => i.Kind == TransmittalItemKinds.Placeholder
            ? $"- {i.DocumentNumber} {i.Title} (to send by {i.DueDate?.ToString("yyyy-MM-dd", null) ?? "no date"})"
            : $"- {i.DocumentNumber} rev {i.RevisionValue} {i.Title}{(i.StatusCode is null ? "" : $" ({i.StatusCode})")}"));
        await notifier.NotifyAsync(project.TenantId, project.Id, addressed.Where(a => a.UserId is not null).Select(a => a.UserId!.Value),
            Notifications.NotificationKinds.TransmittalReceived, $"{number}: {raise.Subject}",
            $"{raise.Reason} from {raise.Actor.Name}{(due is null ? "" : $", answer by {due:yyyy-MM-dd}")}.\n{listed}{(raise.Message is null ? "" : $"\n\n{raise.Message}")}",
            $"/transmittals/{transmittal.Id}", cancellationToken, Notifications.EmailKinds.Transmittal);
        return transmittal;
    }

    // ── Reading, acknowledging, dispatching ───────────────────────────────────

    /// <summary>
    /// The transmittals the caller may see, newest first, at most 200, with counts for the list page.
    /// </summary>
    public async Task<IReadOnlyList<TransmittalSummary>> ListAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        var rows = await Visible(access).OrderByDescending(t => t.IssuedAt).Take(200)
            .Select(t => new
            {
                t.Id,
                t.Number,
                t.Reason,
                t.Subject,
                t.ToName,
                t.IssuedAt,
                t.IssuedByName,
                t.ResponseDue,
                Items = t.Items.Count,
                Recipients = t.Recipients.Count,
                Acknowledged = t.Recipients.Count(r => r.AcknowledgedAt != null),
                Awaiting = t.Recipients.Count(r => r.UserId == null && r.DispatchedAt == null),
            })
            .ToListAsync(cancellationToken);
        return rows.Select(t => new TransmittalSummary(t.Id, t.Number, t.Reason, t.Subject, t.ToName,
            t.IssuedAt.ToDateTimeOffset(), t.IssuedByName, t.ResponseDue?.ToDateOnly(), t.Items, t.Recipients, t.Acknowledged,
            t.Awaiting)).ToList();
    }

    /// <summary>Opening it is recorded for a recipient: the first time is read evidence.</summary>
    public async Task<Transmittal?> ReadAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var transmittal = await Visible(access).Include(t => t.Items).Include(t => t.Recipients).AsSplitQuery()
            .SingleOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (transmittal?.Recipients.SingleOrDefault(r => r.UserId == access.UserId) is { } mine)
        {
            var now = clock.GetCurrentInstant();
            mine.OpenedAt ??= now;
            mine.LastViewedAt = now;
            mine.ViewCount++;
            await db.SaveChangesAsync(cancellationToken);
        }
        return transmittal;
    }

    /// <summary>
    /// Records that the caller, a recipient, acknowledged the transmittal. Doing it twice changes nothing. Called by
    /// the acknowledge endpoint.
    /// </summary>
    public async Task<(Transmittal? Transmittal, IResult? Problem)> AcknowledgeAsync(
        ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var transmittal = await ReadAsync(access, id, cancellationToken);
        if (transmittal is null) return (null, NotFound());
        var mine = transmittal.Recipients.SingleOrDefault(r => r.UserId == access.UserId);
        if (mine is null) return (null, Problems.Forbidden("NOT_A_RECIPIENT", "Only the people it went to acknowledge it."));
        if (mine.AcknowledgedAt is null)
        {
            mine.AcknowledgedAt = clock.GetCurrentInstant();
            await audit.WriteAsync(new Actor(access.UserId, access.UserName), "TRANSMITTAL_ACKNOWLEDGED", "Transmittal",
                transmittal.Id, transmittal.Number, null, transmittal.ProjectId, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
        }
        return (transmittal, null);
    }

    /// <summary>One of ours records that it went to an organization with nobody here, by whatever channel they use.</summary>
    public async Task<(Transmittal? Transmittal, IResult? Problem)> DispatchAsync(
        ProjectAccess access, Guid id, Guid recipientId, DispatchRequest request, CancellationToken cancellationToken)
    {
        var transmittal = await ReadAsync(access, id, cancellationToken);
        var recipient = transmittal?.Recipients.SingleOrDefault(r => r.Id == recipientId);
        if (transmittal is null || recipient is null) return (null, NotFound());
        if (recipient.PartyId is not { } partyId || !await CarriesAsync(access, partyId, cancellationToken))
            return (null, Problems.Forbidden("NOT_CUSTODIAN", "Whoever carries the exchange with that organization records that it went."));
        if (!recipient.AwaitsDispatch)
            return (null, Problems.Conflict("ALREADY_DISPATCHED", "It is already recorded as sent."));
        var channel = request.Channel?.Trim() ?? "";
        if (channel.Length == 0)
            return (null, Problems.Invalid("CHANNEL_REQUIRED", "Say how it went: email, their portal, by hand."));
        var item = transmittal.Items[0];
        if (request.ProofFileId is { } proof
            && await BindEvidenceAsync(access, proof, item.RevisionId, cancellationToken) is { } bad) return (null, bad);

        var (went, notYet) = WorkingCalendar.Moment(clock, access.Project.TimeZone, request.DispatchedOn);
        if (notYet is not null) return (null, Problems.Invalid("DATE_IN_FUTURE", $"The day it went cannot be later than today. {notYet}"));
        if (went!.Value.Plus(Duration.FromHours(12)) < transmittal.IssuedAt)
            return (null, Problems.Invalid("DATE_BEFORE_ISSUE", "It cannot have gone before the transmittal was issued."));
        recipient.DispatchedAt = went;
        recipient.DispatchChannel = channel;
        recipient.DispatchRef = request.Reference?.Trim();
        recipient.DispatchedByName = access.UserName;
        recipient.ProofFileId = request.ProofFileId;
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "TRANSMITTAL_DISPATCHED", "Transmittal", transmittal.Id,
            transmittal.Number, $"Sent to {recipient.Name} by {channel}{(recipient.DispatchRef is null ? "" : $", their reference {recipient.DispatchRef}")}.",
            transmittal.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (transmittal, null);
    }

    /// <summary>
    /// Gives an upload link for proof that a transmittal was sent to an outside organization. Only someone who carries
    /// the exchange with one of its organizations may upload. The proof is filed against the first item's revision.
    /// </summary>
    public async Task<(UploadTicket? Ticket, IResult? Problem)> TransmittalEvidenceAsync(
        ProjectAccess access, Guid id, UploadRequest request, CancellationToken cancellationToken)
    {
        var transmittal = await ReadAsync(access, id, cancellationToken);
        if (transmittal is null) return (null, NotFound());
        var carried = transmittal.Recipients.Where(r => r.PartyId is not null).Select(r => r.PartyId!.Value).Distinct().ToList();
        var mayFile = false;
        foreach (var party in carried) mayFile |= await CarriesAsync(access, party, cancellationToken);
        if (!mayFile)
            return (null, Problems.Forbidden("NOT_CUSTODIAN", "Whoever carries the exchange with that organization files its proof."));
        var item = transmittal.Items[0];
        return await EvidenceTicketAsync(access, item.DocumentId, item.RevisionId, request, cancellationToken);
    }

    // ── Files carried ─────────────────────────────────────────────────────────

    /// <summary>
    /// The files a transmittal's items carried: for a revision or a submission, the files of that revision as sent
    /// (originals, not stamped copies); for an unplanned item, its own files.
    /// </summary>
    public async Task<List<StoredFile>> ItemFilesAsync(Transmittal transmittal, CancellationToken cancellationToken)
    {
        var revisions = transmittal.Items.Where(i => i.RevisionId != null).Select(i => i.RevisionId!.Value).ToList();
        var items = transmittal.Items.Where(i => i.Kind == TransmittalItemKinds.Unplanned).Select(i => i.Id).ToList();
        if (revisions.Count == 0 && items.Count == 0) return [];
        return await db.StoredFiles.AsNoTracking()
            .Where(f => (f.RevisionId != null && revisions.Contains(f.RevisionId.Value) && f.Kind != FileKinds.Evidence && f.DerivedFromId == null)
                || (f.TransmittalItemId != null && items.Contains(f.TransmittalItemId.Value)))
            .OrderBy(f => f.Name).ToListAsync(cancellationToken);
    }

    /// <summary>
    /// Which of <paramref name="files"/> one item carried. A submission carried the files of its own submission; a
    /// revision sent out carried the files of its latest submission at the time, which are those of its last one.
    /// </summary>
    public static IEnumerable<StoredFile> FilesOf(TransmittalItem item, IReadOnlyList<StoredFile> files)
    {
        if (item.Kind == TransmittalItemKinds.Unplanned) return files.Where(f => f.TransmittalItemId == item.Id);
        if (item.RevisionId is not { } revision) return [];
        var mine = files.Where(f => f.RevisionId == revision).ToList();
        var submission = item.Submission ?? (mine.Count == 0 ? 0 : mine.Max(f => f.Submission));
        return mine.Where(f => f.Submission == submission);
    }

    // ── Evidence ──────────────────────────────────────────────────────────────

    /// <summary>Somewhere to upload proof filed against a revision. It is scanned like any other file.</summary>
    public async Task<(UploadTicket? Ticket, IResult? Problem)> EvidenceTicketAsync(
        ProjectAccess access, Guid? documentId, Guid? revisionId, UploadRequest request, CancellationToken cancellationToken)
    {
        var (declared, invalid) = Uploads.Check(request, storageOptions.Value.MaxFileBytes);
        if (invalid is not null) return (null, invalid);
        var file = new StoredFile
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            DocumentId = documentId,
            RevisionId = revisionId,
            ObjectKey = "",
            Name = declared!.Name,
            ContentType = declared.ContentType,
            Size = request.Size,
            Sha256 = declared.Sha256,
            Kind = FileKinds.Evidence,
            UploadedById = access.UserId,
            UploadedByName = access.UserName,
            CreatedAt = clock.GetCurrentInstant(),
        };
        file.ObjectKey = FileStorage.KeyFor(file.TenantId, file.ProjectId, file.Id);
        db.StoredFiles.Add(file);
        await db.SaveChangesAsync(cancellationToken);
        var link = storage.PresignUpload(file.ObjectKey, file.ContentType);
        return (new UploadTicket(file.Id, "PUT", link.Url, link.Headers, link.ExpiresAt.ToDateTimeOffset()), null);
    }

    /// <summary>Puts uploaded proof to use and sends it for scanning. Null when it is fine.</summary>
    public async Task<IResult?> BindEvidenceAsync(ProjectAccess access, Guid fileId, Guid? revisionId, CancellationToken cancellationToken)
    {
        var file = await db.StoredFiles.SingleOrDefaultAsync(f => f.Id == fileId && f.RevisionId == revisionId
            && f.Kind == FileKinds.Evidence && f.UploadedById == access.UserId && f.Status == FileStatuses.AwaitingUpload,
            cancellationToken);
        if (file is null)
        {
            return Problems.Invalid("FILE_NOT_AVAILABLE", "That proof was not requested by you for this revision, or is already used.",
                new { fileId });
        }
        if (await Uploads.ArrivedAsync(storage, file, cancellationToken) is { } missing) return missing;
        file.Status = FileStatuses.Processing;
        db.Enqueue(FileUploaded.RoutingKey, new FileUploaded(file.TenantId, file.Id));
        return null;
    }

    // ── Queues ────────────────────────────────────────────────────────────────

    /// <summary>
    /// One released revision that has never been sent to anyone, with how many issue requests are still open for it.
    /// </summary>
    public sealed record NotIssued(Guid DocumentId, string DocumentNumber, string Title, Guid RevisionId, string Revision,
        string? Status, DateTimeOffset? ReleasedAt, int OpenRequests);

    /// <summary>
    /// Released, never sent: in use, and nobody has been told. The responsibility
    /// for that sits with whoever did not ask, and this is where it shows.
    /// </summary>
    public async Task<IReadOnlyList<NotIssued>> NotIssuedAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        var restricted = (await Catalog.LoadAsync(db, cancellationToken)).RestrictedLevels();
        var rows = await (
            from d in DocumentQueries.Visible(db, access, restricted)
            join r in db.Revisions on d.Id equals r.DocumentId
            where r.State == RevisionStates.Released
                && !db.TransmittalItems.Any(i => i.RevisionId == r.Id
                    && db.Transmittals.Any(t => t.Id == i.TransmittalId && t.ReviewStepId == null))
            orderby r.ReleasedAt
            select new
            {
                d.Id,
                d.Number,
                d.Title,
                RevisionId = r.Id,
                r.Value,
                r.StatusCode,
                r.ReleasedAt,
                Open = db.IssueRequests.Count(q => q.RevisionId == r.Id && q.Status == IssueRequestStatuses.Open),
            }).Take(500).ToListAsync(cancellationToken);
        return rows.Select(x => new NotIssued(x.Id, x.Number, x.Title, x.RevisionId, x.Value, x.StatusCode,
            x.ReleasedAt?.ToDateTimeOffset(), x.Open)).ToList();
    }

    /// <summary>
    /// One task waiting for a person in issuing. <c>Kind</c> is CARRY_OUT_REQUEST, DISPATCH_TRANSMITTAL or
    /// ACKNOWLEDGE_TRANSMITTAL; the ids say which record it points to.
    /// </summary>
    public sealed record IssueWork(string Kind, Guid? RequestId, Guid? TransmittalId, Guid? RecipientId, string Label,
        string Reason, string? Who, DateOnly? DueDate, DateTimeOffset Since, Guid? DocumentId = null);

    /// <summary>
    /// What waits on this person in issuing: requests to carry out, organizations
    /// to send things to by hand, and transmittals to acknowledge.
    /// </summary>
    public async Task<IReadOnlyList<IssueWork>> WorkAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        var work = new List<IssueWork>();
        var projectId = access.Project.Id;
        if (access.IsInternal && (access.Holds(Verbs.Control) || access.Holds(Verbs.Transmit)))
        {
            var requests = await (
                from q in db.IssueRequests
                join d in db.Documents on q.DocumentId equals d.Id
                join r in db.Revisions on q.RevisionId equals r.Id
                where q.ProjectId == projectId && q.Status == IssueRequestStatuses.Open && r.State == RevisionStates.Released
                orderby q.RaisedAt
                select new { q.Id, d.Number, r.Value, q.Reason, q.RaisedByName, q.RaisedAt }).ToListAsync(cancellationToken);
            work.AddRange(requests.Select(q => new IssueWork("CARRY_OUT_REQUEST", q.Id, null, null, $"{q.Number} rev {q.Value}",
                q.Reason, q.RaisedByName, null, q.RaisedAt.ToDateTimeOffset())));
        }

        var carried = await CarriedPartiesAsync(access, cancellationToken);
        if (carried.Count > 0)
        {
            var dispatch = await (
                from x in db.TransmittalRecipients
                join t in db.Transmittals on x.TransmittalId equals t.Id
                where t.ProjectId == projectId && t.ReviewStepId == null && x.UserId == null && x.DispatchedAt == null
                    && x.PartyId != null && carried.Contains(x.PartyId.Value)
                orderby t.IssuedAt
                select new { t.Id, RecipientId = x.Id, t.Number, t.Reason, x.Name, t.ResponseDue, t.IssuedAt })
                .ToListAsync(cancellationToken);
            work.AddRange(dispatch.Select(x => new IssueWork("DISPATCH_TRANSMITTAL", null, x.Id, x.RecipientId, x.Number,
                x.Reason, x.Name, x.ResponseDue?.ToDateOnly(), x.IssuedAt.ToDateTimeOffset())));
        }

        // What came in unplanned waits for Document Control to put it in the register.
        if (access.IsInternal && access.Holds(Verbs.Control))
        {
            var unplanned = await (
                from i in db.TransmittalItems
                join t in db.Transmittals on i.TransmittalId equals t.Id
                where t.ProjectId == projectId && i.Kind == TransmittalItemKinds.Unplanned && i.RegisteredAt == null
                orderby t.IssuedAt
                select new { t.Id, i.DocumentNumber, i.Title, t.Number, t.FromName, t.IssuedAt }).ToListAsync(cancellationToken);
            work.AddRange(unplanned.Select(x => new IssueWork("REGISTER_UNPLANNED", null, x.Id, null,
                x.DocumentNumber.Length > 0 ? $"{x.DocumentNumber} {x.Title}" : x.Title, x.Number, x.FromName, null,
                x.IssuedAt.ToDateTimeOffset())));
        }

        // Another organization: the placeholders it was asked for and has not sent yet, with when each is due.
        if (!access.IsInternal && access.PartyCode is { } code)
        {
            var asked = await (
                from i in db.TransmittalItems
                join t in db.Transmittals on i.TransmittalId equals t.Id
                join d in db.Documents on i.DocumentId equals d.Id
                where t.ProjectId == projectId && i.Kind == TransmittalItemKinds.Placeholder && d.Originator == code
                    && d.IsPlaceholder && (d.State == DocumentStates.Planned || d.State == DocumentStates.Active)
                select new { t.Id, DocumentId = d.Id, d.Number, d.Title, Number_ = t.Number, i.DueDate, t.IssuedAt }).ToListAsync(cancellationToken);
            work.AddRange(asked.GroupBy(x => x.DocumentId).Select(g => g.OrderByDescending(x => x.IssuedAt).First())
                .OrderBy(x => x.DueDate ?? LocalDate.MaxIsoValue).ThenBy(x => x.Number)
                .Select(x => new IssueWork("SEND_PLACEHOLDER", null, x.Id, null, $"{x.Number} {x.Title}", x.Number_, null,
                    x.DueDate?.ToDateOnly(), x.IssuedAt.ToDateTimeOffset(), x.DocumentId)));
        }

        var me = access.UserId;
        var unacknowledged = await (
            from x in db.TransmittalRecipients
            join t in db.Transmittals on x.TransmittalId equals t.Id
            where t.ProjectId == projectId && x.UserId == me && x.AcknowledgedAt == null && x.Kind == RecipientKinds.To
            orderby t.IssuedAt
            select new { t.Id, t.Number, t.Reason, t.IssuedByName, t.ResponseDue, t.IssuedAt }).ToListAsync(cancellationToken);
        work.AddRange(unacknowledged.Select(x => new IssueWork("ACKNOWLEDGE_TRANSMITTAL", null, x.Id, null, x.Number,
            x.Reason, x.IssuedByName, x.ResponseDue?.ToDateOnly(), x.IssuedAt.ToDateTimeOffset())));
        return work;
    }

    // ── Who may ───────────────────────────────────────────────────────────────

    /// <summary>
    /// The people close enough to a revision to know who needs it: whoever wrote
    /// it or registered the document, whoever started its review or sat on it,
    /// and anyone who may transmit it.
    /// </summary>
    private async Task<bool> HasStandingAsync(ProjectAccess access, Document document, Revision revision, CancellationToken cancellationToken)
    {
        if (access.Allows(Verbs.Transmit, document.Facts) || access.Allows(Verbs.Control, document.Facts)) return true;
        var me = access.UserId;
        if (revision.AuthoredById == me || document.CreatedById == me) return true;
        return await db.Reviews.AnyAsync(r => r.RevisionId == revision.Id && (r.StartedById == me
            || db.ReviewSteps.Any(s => s.ReviewId == r.Id && s.Participants.Any(p => p.UserId == me))), cancellationToken);
    }

    /// <summary>What a screen asks before offering to ask for a revision to be sent.</summary>
    public sealed record Standing(bool MayRequest, bool LetsItOut, string? Author, Guid? AuthorId);

    /// <summary>
    /// Whether the caller has standing to ask for this revision to be sent, whether its decision lets it out at all,
    /// and who wrote it. Null when the revision is not the caller's to see.
    /// </summary>
    public async Task<Standing?> StandingAsync(ProjectAccess access, Guid revisionId, CancellationToken cancellationToken)
    {
        var revision = await db.Revisions.AsNoTracking().SingleOrDefaultAsync(r => r.Id == revisionId, cancellationToken);
        var document = revision is null ? null : await VisibleDocumentAsync(access, revision.DocumentId, cancellationToken);
        if (revision is null || document is null) return null;
        var decided = await db.Reviews.AsNoTracking().Where(r => r.RevisionId == revisionId && r.Verdict != null)
            .OrderByDescending(r => r.DecidedAt).Select(r => r.Verdict).FirstOrDefaultAsync(cancellationToken);
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var letsItOut = decided is null || catalog.Prop(ReviewSets.Verdicts, decided, "proceed") is { ValueKind: JsonValueKind.True };
        var running = await db.Reviews.AnyAsync(r => r.RevisionId == revisionId && r.State == ReviewStates.InProgress, cancellationToken);
        var settled = revision.State is RevisionStates.Released or RevisionStates.InReview or RevisionStates.InPreparation;
        var may = settled && letsItOut && !running && await HasStandingAsync(access, document, revision, cancellationToken);
        return new Standing(may, letsItOut, revision.AuthoredByName, revision.AuthoredById);
    }

    /// <summary>
    /// Document Control sends. Where nobody on the project holds it, whoever asked
    /// sends it themselves.
    /// </summary>
    private async Task<bool> MayCarryOutAsync(ProjectAccess access, Document document, IssueRequest request, CancellationToken cancellationToken)
    {
        if (access.Allows(Verbs.Control, document.Facts) || access.Allows(Verbs.Transmit, document.Facts)) return true;
        return request.RaisedById == access.UserId && !await AnyControlHolderAsync(access.Project.Id, cancellationToken);
    }

    /// <summary>Whether this person carries the exchange with a party that answers by proxy.</summary>
    public async Task<bool> CarriesAsync(ProjectAccess access, Guid partyId, CancellationToken cancellationToken) =>
        (await CarriedPartiesAsync(access, cancellationToken)).Contains(partyId);

    /// <summary>
    /// The outside parties this person carries the exchange with: those whose custodian function is theirs, plus those
    /// with no custodian when they hold Control. Empty for people outside our organization.
    /// </summary>
    private async Task<List<Guid>> CarriedPartiesAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        if (!access.IsInternal) return [];
        var code = access.Function.Code;
        var control = access.Holds(Verbs.Control);
        return await db.Parties.AsNoTracking()
            .Where(p => !p.IsInternal && (p.CustodianFunction == code || (p.CustodianFunction == null && control)))
            .Select(p => p.Id).ToListAsync(cancellationToken);
    }

    /// <summary>The people who carry the exchange with a party: its custodian function, else Document Control.</summary>
    public async Task<List<User>> CustodiansAsync(Guid projectId, Party party, CancellationToken cancellationToken)
    {
        var ours = from m in db.Memberships
                   join u in db.Users on m.UserId equals u.Id
                   where m.ProjectId == projectId && m.Active && m.Function!.Active && u.Active
                       && (u.PartyId == null || u.Party!.IsInternal)
                   select new { m, u };
        ours = party.CustodianFunction is { } code
            ? ours.Where(x => x.m.Function!.Code == code)
            : ours.Where(x => x.m.Function!.Rules.Any(r => r.Verbs.Contains(Verbs.Control)));
        return await ours.OrderBy(x => x.u.Name).Select(x => x.u).ToListAsync(cancellationToken);
    }

    /// <summary>Whether anyone active on the project holds the Control permission (Document Control).</summary>
    private Task<bool> AnyControlHolderAsync(Guid projectId, CancellationToken cancellationToken) =>
        db.Memberships.AnyAsync(m => m.ProjectId == projectId && m.Active && m.Function!.Active
            && m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control))
            && db.Users.Any(u => u.Id == m.UserId && u.Active), cancellationToken);

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// One active project member with their function (role) and whether they belong to our own organization
    /// (<c>Internal</c>). Built by <c>MembersAsync</c>.
    /// </summary>
    public sealed record Member(Guid UserId, string Name, Guid? PartyId, string? PartyName, bool Internal, Function Function)
    {
        /// <summary>The member as shown in the distribution picker.</summary>
        public Person View() => new(UserId, Name, Function.Name, PartyName);
    }

    /// <summary>Everyone active on the project, with what their function may do.</summary>
    public async Task<List<Member>> MembersAsync(Project project, CancellationToken cancellationToken)
    {
        var memberships = await db.Memberships.AsNoTracking().Include(m => m.Function!).ThenInclude(f => f.Rules)
            .Where(m => m.ProjectId == project.Id && m.Active && m.Function!.Active).ToListAsync(cancellationToken);
        var ids = memberships.Select(m => m.UserId).ToList();
        var users = await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id) && u.Active)
            .Select(u => new
            {
                u.Id,
                u.Name,
                u.PartyId,
                PartyName = u.Party == null ? null : u.Party.Name,
                Internal = u.Party == null || u.Party.IsInternal
            })
            .ToDictionaryAsync(u => u.Id, cancellationToken);
        return memberships.Where(m => users.ContainsKey(m.UserId))
            .Select(m => (Membership: m, User: users[m.UserId]))
            .Select(x => new Member(x.User.Id, x.User.Name, x.User.PartyId, x.User.PartyName, x.User.Internal, x.Membership.Function!))
            .OrderBy(m => m.Name).ToList();
    }

    /// <summary>
    /// The transmittals this person may see: all of them for Document Control and senders; otherwise those they issued,
    /// those sent to them, and those to parties whose custodian function is theirs.
    /// </summary>
    public IQueryable<Transmittal> Visible(ProjectAccess access)
    {
        var query = db.Transmittals.Where(t => t.ProjectId == access.Project.Id);
        if (access.IsInternal && (access.Holds(Verbs.Control) || access.Holds(Verbs.Transmit))) return query;
        var me = access.UserId;
        var code = access.Function.Code;
        var party = access.IsInternal ? null : access.PartyCode;
        return query.Where(t => t.IssuedById == me || t.Recipients.Any(r => r.UserId == me)
            // What an organization sent us, its own people see.
            || (party != null && t.FromPartyId != null && db.Parties.Any(p => p.Id == t.FromPartyId && p.Code == party))
            || (access.IsInternal && t.Recipients.Any(r => r.PartyId != null
                && db.Parties.Any(p => p.Id == r.PartyId && p.CustodianFunction == code)))
            || (access.IsInternal && t.FromPartyId != null && db.Parties.Any(p => p.Id == t.FromPartyId && p.CustodianFunction == code)));
    }

    /// <summary>
    /// Loads an issue request with its document and revision. All three are null when the request is missing, in
    /// another project, or its document is not visible to the caller.
    /// </summary>
    private async Task<(IssueRequest?, Document?, Revision?)> LoadRequestAsync(
        ProjectAccess access, Guid requestId, CancellationToken cancellationToken)
    {
        var request = await db.IssueRequests.SingleOrDefaultAsync(r => r.Id == requestId && r.ProjectId == access.Project.Id,
            cancellationToken);
        var document = request is null ? null : await VisibleDocumentAsync(access, request.DocumentId, cancellationToken);
        if (request is null || document is null) return (null, null, null);
        var revision = await db.Revisions.SingleAsync(r => r.Id == request.RevisionId, cancellationToken);
        return (request, document, revision);
    }

    /// <summary>The document when the caller may see it (respecting confidentiality levels), otherwise null.</summary>
    private async Task<Document?> VisibleDocumentAsync(ProjectAccess access, Guid documentId, CancellationToken cancellationToken)
    {
        var restricted = (await Catalog.LoadAsync(db, cancellationToken)).RestrictedLevels();
        return await DocumentQueries.Visible(db, access, restricted).SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
    }

    /// <summary>
    /// Whether the revision's review is decided with a verdict that lets it proceed to release. Such a revision may
    /// already be asked for.
    /// </summary>
    private async Task<bool> DecidedToProceedAsync(Guid revisionId, CancellationToken cancellationToken)
    {
        var verdict = await db.Reviews.Where(r => r.RevisionId == revisionId && r.State == ReviewStates.Decided)
            .Select(r => r.Verdict).FirstOrDefaultAsync(cancellationToken);
        if (verdict is null) return false;
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        return catalog.Prop(ReviewSets.Verdicts, verdict, "proceed") is { ValueKind: JsonValueKind.True };
    }

    /// <summary>
    /// Marks an issue request as done or cancelled, with the time and who closed it. The caller saves the change.
    /// </summary>
    private void Close(IssueRequest request, string status, string by)
    {
        request.Status = status;
        request.ClosedAt = clock.GetCurrentInstant();
        request.ClosedByName = by;
    }

    /// <summary>
    /// Short label for a revision used in audit entries and subjects, for example P1001-ME-001 rev A.
    /// </summary>
    public static string Label(Document document, Revision revision) => $"{document.Number} rev {revision.Value}";

    /// <summary>Turns an <c>IssueRequest</c> entity into the shape returned to the browser.</summary>
    public static IssueRequestView View(IssueRequest r, IReadOnlyList<string> transmittals, IReadOnlyList<Guid>? transmittalIds = null) => new(
        r.Id, r.RevisionId, r.Reason, r.UserIds, r.PartyIds, r.Note, r.OffDistributionReason, r.RaisedByName,
        r.RaisedAt.ToDateTimeOffset(), r.Status, r.ClosedAt?.ToDateTimeOffset(), r.ClosedByName, transmittals, r.RaisedById,
        transmittalIds ?? [], r.Delegated, r.ApproverPartyId, r.ApprovalState);

    /// <summary>
    /// Whether a request can become transmittals now: it names somebody, no outside
    /// approval is still owed, and its revision is not on hold.
    /// </summary>
    public static bool Ready(IssueRequest r, Revision revision) =>
        !r.Delegated && r.ApprovalState is null or ApprovalStates.Approved && revision.HeldAt is null
        && r.UserIds.Length + r.PartyIds.Length > 0;

    /// <summary>The 404 answer for a transmittal that does not exist or is not visible.</summary>
    private static IResult NotFound() => Problems.NotFound("TRANSMITTAL_NOT_FOUND", "No such transmittal.");
    /// <summary>The 404 answer for an issue request that does not exist or is not visible.</summary>
    private static IResult RequestNotFound() => Problems.NotFound("ISSUE_REQUEST_NOT_FOUND", "No such request.");
}
