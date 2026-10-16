using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Reviews;

public sealed partial class ReviewService
{
    // ── An outside approval, and holds ────────────────────────────────────────

    /// <summary>
    /// An issue request asked an outside party to approve the revision first. Their
    /// approval is a review of one step, theirs, carried like any party's step. A
    /// revision awaiting release is not released until they answer; one already
    /// released is put on hold, not for use, and whoever received it is told.
    /// Returns the problem, or null.
    /// </summary>
    public async Task<IResult?> OpenApprovalAsync(ProjectAccess access, IssueRequest request, CancellationToken cancellationToken)
    {
        if (request.ApproverPartyId is not { } partyId) return null;
        var party = await db.Parties.AsNoTracking().SingleAsync(p => p.Id == partyId, cancellationToken);
        var revision = await db.Revisions.SingleAsync(r => r.Id == request.RevisionId, cancellationToken);
        var document = await db.Documents.SingleAsync(d => d.Id == request.DocumentId, cancellationToken);
        if ((await SeatsAsync(access.Project, null, party, party.Participation, cancellationToken)).Count == 0)
        {
            return Problems.Invalid("APPROVER_HAS_NOBODY", party.Participation == Participations.InApp
                ? $"Nobody from {party.Name} is on this project, so their approval could not be asked."
                : $"Nobody on this project carries the exchange with {party.Name}, so their approval could not be asked.");
        }
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var now = clock.GetCurrentInstant();
        var review = new Review
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            DocumentId = document.Id,
            RevisionId = revision.Id,
            Number = await numbering.RecordAsync(access.Project.TenantId, access.Project.Id, RecordKinds.Review,
                NumberFields.ForRecord(access.Project.Code), "RV", cancellationToken),
            RouteName = $"Approval by {party.Name}",
            StartedById = access.UserId,
            StartedByName = access.UserName,
            StartedAt = now,
            IssueRequestId = request.Id,
            Steps =
            [
                new ReviewStep
                {
                    TenantId = access.Project.TenantId,
                    Index = 0,
                    Title = $"Approval by {party.Name}",
                    PartyId = party.Id,
                    PartyName = party.Name,
                    Participation = party.Participation,
                    Reason = catalog.IsActive(TransmittalSets.Reasons, "APPROVAL") ? "APPROVAL" : request.Reason,
                    Mode = StepModes.Any,
                    Deciding = true,
                },
            ],
        };
        db.Reviews.Add(review);
        await OpenStepAsync(access, review, 0, cancellationToken);
        var label = TransmittalService.Label(document, revision);
        await audit.WriteAsync(Actor(access), "OUTSIDE_APPROVAL_ASKED", "Revision", revision.Id, label,
            $"{party.Name} approves it before it is used, on review {review.Number}.", access.Project.Id, cancellationToken);
        if (revision.State == RevisionStates.Released && revision.HeldAt is null)
        {
            revision.HeldAt = now;
            revision.HeldReason = $"Awaiting approval by {party.Name}.";
            revision.HeldByName = access.UserName;
            db.Enqueue(RevisionMarked.RoutingKey, new RevisionMarked(revision.TenantId, revision.Id, FileKinds.Held, revision.HeldReason));
            await audit.WriteAsync(Actor(access), "REVISION_HELD", "Revision", revision.Id, label,
                $"On hold, not for use: {revision.HeldReason}", access.Project.Id, cancellationToken);
            await notifier.NotifyAsync(document.TenantId, document.ProjectId, await ReceivedByAsync(revision.Id, cancellationToken),
                Notifications.NotificationKinds.General, $"{label} is on hold: not for use",
                $"{revision.HeldReason} Do not work from the copy you were sent until you are told the hold is lifted.",
                $"/documents/{document.Id}", cancellationToken);
        }
        await db.SaveChangesAsync(cancellationToken);
        return null;
    }

    /// <summary>
    /// The party answered. Approved: what was asked is an ordinary request again, and
    /// The control function releases (or lifts the hold); where nobody holds that function,
    /// that happens now. Not approved: release stays blocked until it is sent back.
    /// </summary>
    private async Task SettleApprovalAsync(ProjectAccess access, Review review, Catalog catalog, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var request = await db.IssueRequests.SingleAsync(r => r.Id == review.IssueRequestId, cancellationToken);
        var party = review.Steps[0].PartyName ?? "The outside party";
        var approved = Proceeds(catalog, review.VerdictSet, review.Verdict!);
        review.DecidedAt = now;
        review.ClosedAt = now;
        review.ClosedByName = "System";
        review.State = approved ? ReviewStates.Released : ReviewStates.Returned;
        if (!approved) review.ReturnNote = $"{party} did not approve it ({review.Verdict}).";
        request.ApprovalState = approved ? ApprovalStates.Approved : ApprovalStates.Refused;
        if (approved && !request.Delegated && request.UserIds.Length + request.PartyIds.Length == 0)
        {
            // Asked only for the approval: answered.
            request.Status = IssueRequestStatuses.Done;
            request.ClosedAt = now;
            request.ClosedByName = "System";
        }
        var (document, revision) = await SubjectAsync(review, cancellationToken);
        var label = TransmittalService.Label(document, revision);
        var next = approved ? revision.HeldAt is null ? "release and issue it" : "lift the hold" : "send it back";
        await audit.WriteAsync(Audit.Actor.System, approved ? "OUTSIDE_APPROVED" : "OUTSIDE_REFUSED", "Revision", revision.Id, label,
            $"{party} {(approved ? "approved it" : "did not approve it")} ({review.Verdict}), with the control function to {next}.",
            review.ProjectId, cancellationToken);
        var controllers = await notifier.ControlHoldersAsync(review.ProjectId, cancellationToken);
        await TellAsync(review, controllers, Notifications.NotificationKinds.ReviewDecided,
            $"{party} {(approved ? "approved" : "did not approve")} {label}", $"Yours to {next}.", cancellationToken, $"/documents/{document.Id}");
        await db.SaveChangesAsync(cancellationToken);
        if (controllers.Count > 0 || !approved) return;

        if (revision.HeldAt is not null)
        {
            if (await ApprovalOwedAsync(revision.Id, cancellationToken) is null) await LiftCoreAsync(access, revision, document, "System", cancellationToken);
            return;
        }
        var main = await db.Reviews.Include(r => r.Comments)
            .SingleOrDefaultAsync(r => r.RevisionId == revision.Id && r.State == ReviewStates.Decided && r.IssueRequestId == null, cancellationToken);
        if (main is not null && (main.Verdict is null || Proceeds(catalog, main.VerdictSet, main.Verdict))
            && !main.Comments.Any(c => c.Blocking && c.Status == CommentStatuses.Open)
            && await ApprovalOwedAsync(revision.Id, cancellationToken) is null)
        {
            await ReleaseCoreAsync(access, main, main.GrantedStatus!, "System", cancellationToken);
        }
    }

    /// <summary>Why the revision may not be released (or its hold lifted) yet for want of an outside approval; null when none is owed.</summary>
    private async Task<IResult?> ApprovalOwedAsync(Guid revisionId, CancellationToken cancellationToken)
    {
        var owed = await (from r in db.IssueRequests
                          join p in db.Parties on r.ApproverPartyId equals p.Id
                          where r.RevisionId == revisionId && r.Status == IssueRequestStatuses.Open
                              && (r.ApprovalState == ApprovalStates.Waiting || r.ApprovalState == ApprovalStates.Refused)
                          orderby r.RaisedAt
                          select new { r.ApprovalState, p.Name }).FirstOrDefaultAsync(cancellationToken);
        if (owed is null) return null;
        return owed.ApprovalState == ApprovalStates.Refused
            ? Problems.Conflict("OUTSIDE_REFUSED", $"{owed.Name} did not approve this revision. Send it back.")
            : Problems.Conflict("AWAITING_OUTSIDE_APPROVAL",
                $"{owed.Name} has to approve this revision first. The control function releases and issues it when their answer comes back.");
    }

    /// <summary>The revision is going back: an outside approval still being asked for it ends.</summary>
    private async Task CloseApprovalsAsync(Guid revisionId, Guid except, string by, CancellationToken cancellationToken)
    {
        var open = await db.Reviews.Include(r => r.Steps)
            .Where(r => r.RevisionId == revisionId && r.IssueRequestId != null && r.Id != except && r.State == ReviewStates.InProgress)
            .ToListAsync(cancellationToken);
        foreach (var approval in open)
        {
            approval.State = ReviewStates.Returned;
            approval.ClosedAt = clock.GetCurrentInstant();
            approval.ClosedByName = by;
            approval.ReturnNote = "Closed: the revision went back.";
            foreach (var step in approval.Steps.Where(s => s.State == StepStates.Open)) step.State = StepStates.Done;
        }
    }

    /// <summary>
    /// The outside approval came back yes: The control function lifts the hold, the
    /// revision is in use again, and whatever was asked for it is sent.
    /// </summary>
    public async Task<IResult?> LiftHoldAsync(ProjectAccess access, Guid revisionId, CancellationToken cancellationToken)
    {
        var (revision, document, problem) = await HeldAsync(access, revisionId, "lifts a hold", cancellationToken);
        if (problem is not null) return problem;
        if (await ApprovalOwedAsync(revision!.Id, cancellationToken) is { } owed) return owed;
        if (await db.IssueRequests.AnyAsync(r => r.RevisionId == revision.Id && r.ApprovalState == ApprovalStates.Refused
            && r.Status == IssueRequestStatuses.Cancelled, cancellationToken))
        {
            return Problems.Conflict("HELD_FOR_GOOD", "It was not approved and was sent back: it stays on hold, not for use. The next revision replaces it.");
        }
        await LiftCoreAsync(access, revision, document!, access.UserName, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return null;
    }

    /// <summary>
    /// The outside approval came back no: it stays on hold, not for use, for good —
    /// people hold copies, and the record says why they may not use them — and
    /// whoever it goes back to starts the next revision.
    /// </summary>
    public async Task<IResult?> ReturnHeldAsync(ProjectAccess access, Guid revisionId, string? reason, CancellationToken cancellationToken)
    {
        var (revision, document, problem) = await HeldAsync(access, revisionId, "sends a held revision back", cancellationToken);
        if (problem is not null) return problem;
        var why = reason?.Trim() ?? "";
        if (why.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it is going back: whoever gets it has to know what to do.");
        var now = clock.GetCurrentInstant();
        revision!.HeldReason = $"Not approved outside: {why}";
        foreach (var request in await db.IssueRequests.Where(r => r.RevisionId == revision.Id && r.Status == IssueRequestStatuses.Open)
            .ToListAsync(cancellationToken))
        {
            if (request.ApprovalState is not null) request.ApprovalState = ApprovalStates.Refused;
            request.Status = IssueRequestStatuses.Cancelled;
            request.ClosedAt = now;
            request.ClosedByName = access.UserName;
        }
        // Marks it held for good even where no approval request was ever refused.
        if (!await db.IssueRequests.AnyAsync(r => r.RevisionId == revision.Id && r.ApprovalState == ApprovalStates.Refused, cancellationToken))
        {
            var marker = await db.IssueRequests.Where(r => r.RevisionId == revision.Id && r.ApproverPartyId != null)
                .OrderByDescending(r => r.RaisedAt).FirstOrDefaultAsync(cancellationToken);
            if (marker is not null) marker.ApprovalState = ApprovalStates.Refused;
        }
        await CloseApprovalsAsync(revision.Id, Guid.Empty, access.UserName, cancellationToken);
        var label = TransmittalService.Label(document!, revision);
        await audit.WriteAsync(Actor(access), "HELD_RETURNED", "Revision", revision.Id, label,
            $"Not approved outside, sent back: {why} It stays on hold, not for use.", access.Project.Id, cancellationToken);
        await notifier.NotifyAsync(document!.TenantId, document.ProjectId, await ReceivedByAsync(revision.Id, cancellationToken),
            Notifications.NotificationKinds.General, $"{label} was not approved: still not for use",
            $"{why} It stays on hold, not for use; the next revision will replace it.", $"/documents/{document.Id}", cancellationToken);
        await notifier.NotifyAsync(document.TenantId, document.ProjectId, [revision.AuthoredById], Notifications.NotificationKinds.ReviewReturned,
            $"{label} was not approved outside: a new revision is needed", why, $"/documents/{document.Id}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return null;
    }

    private async Task<(Revision? Revision, Document? Document, IResult? Problem)> HeldAsync(
        ProjectAccess access, Guid revisionId, string act, CancellationToken cancellationToken)
    {
        var revision = await db.Revisions.SingleOrDefaultAsync(r => r.Id == revisionId && r.ProjectId == access.Project.Id, cancellationToken);
        var document = revision is null ? null : await VisibleDocumentAsync(access, revision.DocumentId, cancellationToken);
        if (revision is null || document is null) return (null, null, Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        var control = access.Allows(Verbs.Control, document.Facts)
            || (await ControlHoldersAsync(access.Project.Id, cancellationToken) == 0 && revision.AuthoredById == access.UserId);
        if (!control) return (null, null, Problems.Forbidden("CONTROL_ONLY", $"The control function {act}."));
        if (revision.HeldAt is null) return (null, null, Problems.Conflict("NOT_HELD", "This revision is not on hold."));
        return (revision, document, null);
    }

    private async Task LiftCoreAsync(ProjectAccess access, Revision revision, Document document, string by, CancellationToken cancellationToken)
    {
        revision.HeldAt = null;
        revision.HeldReason = null;
        revision.HeldByName = null;
        var actor = by == "System" ? Audit.Actor.System : Actor(access);
        var label = TransmittalService.Label(document, revision);
        await audit.WriteAsync(actor, "REVISION_HOLD_LIFTED", "Revision", revision.Id, label,
            "Approved outside: the hold is lifted and it is in use again.", document.ProjectId, cancellationToken);
        await notifier.NotifyAsync(document.TenantId, document.ProjectId, await ReceivedByAsync(revision.Id, cancellationToken),
            Notifications.NotificationKinds.General, $"{label} is back in use",
            "The outside approval came back. The hold is lifted; the copy you were sent may be used again.", $"/documents/{document.Id}", cancellationToken);
        await transmittals.CarryOutOpenAsync(access.Project, actor, revision, document, cancellationToken);
    }

    /// <summary>Everybody of ours who was sent this revision on a transmittal.</summary>
    private Task<List<Guid>> ReceivedByAsync(Guid revisionId, CancellationToken cancellationToken) =>
        (from i in db.TransmittalItems
         join r in db.TransmittalRecipients on i.TransmittalId equals r.TransmittalId
         where i.RevisionId == revisionId && r.UserId != null
         select r.UserId!.Value).Distinct().ToListAsync(cancellationToken);
}
