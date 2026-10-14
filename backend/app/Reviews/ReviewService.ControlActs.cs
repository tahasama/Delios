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
    // ── Document Control's acts ───────────────────────────────────────────────

    /// <summary>
    /// Document Control releases a decided review whose verdict lets the revision proceed, when no blocking comment is open, at the status the deciding step granted.
    /// Records Document Control's outcome on the revision. Called by the release endpoint.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> ReleaseAsync(
        ProjectAccess access, Guid reviewId, ReleaseRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        if (!await MayActForControlAsync(access, review, cancellationToken))
        {
            return (null, Problems.Forbidden("CONTROL_ONLY", "Releasing is Document Control's act."));
        }
        if (review.State != ReviewStates.Decided)
        {
            return (null, Problems.Conflict("REVIEW_NOT_DECIDED", "Only a decided review is released.", new { state = review.State }));
        }
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        if (review.Verdict is not null && !Proceeds(catalog, review.VerdictSet, review.Verdict))
        {
            return (null, Problems.Conflict("VERDICT_DOES_NOT_PROCEED",
                $"Verdict {review.Verdict} asks for changes: send the revision back instead.", new { verdict = review.Verdict }));
        }
        var open = review.Comments.Count(c => c.Blocking && c.Status == CommentStatuses.Open);
        if (open > 0)
        {
            return (null, Problems.Conflict("BLOCKING_COMMENTS_OPEN",
                $"{open} blocking comment(s) are open. They are settled before the release.", new { count = open }));
        }
        var status = request.Status ?? review.GrantedStatus!;
        if (status != review.GrantedStatus)
        {
            return (null, Problems.Conflict("STATUS_NOT_GRANTED",
                $"The deciding step granted {review.GrantedStatus}. Document Control releases what was decided.",
                new { granted = review.GrantedStatus }));
        }

        if (await ApprovalOwedAsync(review.RevisionId, cancellationToken) is { } owed) return (null, owed);
        var (outcome, outcomeProblem) = ControlService.Pick(catalog, request.Outcome, ControlService.Release);
        if (outcomeProblem is not null) return (null, outcomeProblem);
        await KeepRecipientsAsync(access, review.RevisionId, request.Kept, cancellationToken);
        if (await IssueWithReleaseAsync(access, review.RevisionId, request.Issue, cancellationToken) is { } noOne) return (null, noOne);
        await ReleaseCoreAsync(access, review, status, access.UserName, cancellationToken);
        control.Record(await db.Revisions.SingleAsync(r => r.Id == review.RevisionId, cancellationToken), outcome, null, access.UserName);
        await db.SaveChangesAsync(cancellationToken);
        return (review, null);
    }

    /// <summary>
    /// Released and issued are one act unless the organization keeps them separate (setting POLICY_RELEASE =
    /// SEPARATE): the release must have someone to send to. That is an open request naming people or organizations
    /// (asked when the review was decided), or the people named with the release itself, which become such a
    /// request. The release then sends it (see ReleaseCoreAsync). Returns the refusal, or null.
    /// </summary>
    private async Task<IResult?> IssueWithReleaseAsync(ProjectAccess access, Guid revisionId, Transmittals.IssueAsk? issue, CancellationToken cancellationToken)
    {
        var named = await db.IssueRequests.AnyAsync(r => r.RevisionId == revisionId && r.Status == IssueRequestStatuses.Open && !r.Delegated
            && (r.UserIds.Length > 0 || r.PartyIds.Length > 0), cancellationToken);
        var hasNames = issue is not null && ((issue.UserIds?.Length ?? 0) + (issue.PartyIds?.Length ?? 0)) > 0;
        if (hasNames)
        {
            var revision = await db.Revisions.SingleAsync(r => r.Id == revisionId, cancellationToken);
            var document = await db.Documents.SingleAsync(d => d.Id == revision.DocumentId, cancellationToken);
            var (request, problem) = await transmittals.NewRequestAsync(access, document, revision, issue! with { Delegated = false }, cancellationToken);
            if (problem is not null) return problem;
            db.IssueRequests.Add(request!);
            return null;
        }
        if (named || await ReleasePolicyAsync(access.Project.Id, cancellationToken) == "SEPARATE") return null;
        return Problems.Invalid("ISSUE_REQUIRED",
            "Released and issued go together here: say who receives it (our own people, an outside party, or both), and why.");
    }

    /// <summary>
    /// Releasing, Document Control may take people or organizations off what was asked (never add to a request; it
    /// names others on the release itself). The request keeps who asked and why, and says who was taken off, by whom
    /// and when. A request left naming nobody is closed as cancelled, with the same note.
    /// </summary>
    private async Task KeepRecipientsAsync(ProjectAccess access, Guid revisionId, IReadOnlyList<KeptRecipients>? kept, CancellationToken cancellationToken)
    {
        if (kept is null || kept.Count == 0) return;
        var ids = kept.Select(k => k.RequestId).ToList();
        var requests = await db.IssueRequests.Where(r => ids.Contains(r.Id) && r.RevisionId == revisionId
            && r.Status == IssueRequestStatuses.Open && !r.Delegated).ToListAsync(cancellationToken);
        var now = clock.GetCurrentInstant();
        foreach (var request in requests)
        {
            var keep = kept.First(k => k.RequestId == request.Id);
            var users = request.UserIds.Where(id => (keep.UserIds ?? []).Contains(id)).ToArray();
            var parties = request.PartyIds.Where(id => (keep.PartyIds ?? []).Contains(id)).ToArray();
            var offUsers = request.UserIds.Except(users).ToList();
            var offParties = request.PartyIds.Except(parties).ToList();
            if (offUsers.Count + offParties.Count == 0) continue;
            var names = (await db.Users.AsNoTracking().Where(u => offUsers.Contains(u.Id)).Select(u => u.Name).ToListAsync(cancellationToken))
                .Concat(await db.Parties.AsNoTracking().Where(p => offParties.Contains(p.Id)).Select(p => p.Name).ToListAsync(cancellationToken));
            var note = $"Taken off at release by {access.UserName}, {now.ToDateTimeOffset():d MMM yyyy}: {string.Join(", ", names)}.";
            request.ReleaseNote = request.ReleaseNote is null ? note : $"{request.ReleaseNote}\n{note}";
            request.UserIds = users;
            request.PartyIds = parties;
            if (users.Length + parties.Length == 0)
            {
                request.Status = IssueRequestStatuses.Cancelled;
                request.ClosedAt = now;
                request.ClosedByName = access.UserName;
            }
        }
    }

    /// <summary>The project's answer to POLICY_RELEASE, else the organization's; TOGETHER when neither said.</summary>
    private async Task<string> ReleasePolicyAsync(Guid projectId, CancellationToken cancellationToken)
    {
        var rows = await db.Settings.AsNoTracking().Where(s => s.Key == "POLICY_RELEASE" && (s.ProjectId == projectId || s.ProjectId == null))
            .Select(s => new { s.ProjectId, s.Value }).ToListAsync(cancellationToken);
        return rows.FirstOrDefault(r => r.ProjectId == projectId)?.Value ?? rows.FirstOrDefault(r => r.ProjectId == null)?.Value ?? "TOGETHER";
    }

    /// <summary>
    /// Document Control sends a review back: with no <c>ToStep</c>, the revision goes back to its author (replaced by a new revision if the verdict asked for changes or the outcome says so, otherwise corrected under the same revision);
    /// with a <c>ToStep</c>, the route restarts from that step. Called by the return endpoint.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> ReturnAsync(
        ProjectAccess access, Guid reviewId, ReturnRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        if (!await MayActForControlAsync(access, review, cancellationToken))
        {
            return (null, Problems.Forbidden("CONTROL_ONLY", "Sending a revision back is Document Control's act."));
        }
        if (review.State is not (ReviewStates.Decided or ReviewStates.InProgress))
        {
            return (null, Problems.Conflict("REVIEW_CLOSED", "The review is closed.", new { state = review.State }));
        }
        var note = request.Note?.Trim() ?? "";
        // A verdict that asked for changes already says why, with the comments written under it: nothing to add.
        if (note.Length == 0 && request.ToStep is null && review.State == ReviewStates.Decided && review.Verdict is { } said
            && !Proceeds(await Catalog.LoadAsync(db, cancellationToken), review.VerdictSet, said))
        {
            var written = review.Comments.Where(c => c.Status != CommentStatuses.Withdrawn).OrderBy(c => c.CreatedAt).Select(c => c.Text.Trim()).ToList();
            note = written.Count > 0 ? $"Verdict {said}: {string.Join(" / ", written)}" : $"Verdict {said}.";
        }
        if (note.Length == 0) return (null, Problems.Invalid("NOTE_REQUIRED", "Say why it goes back."));

        if (request.ToStep is null)
        {
            // Whatever the verdict, a problem Document Control finds in the submission
            // comes back corrected under the same revision. A verdict that asked for
            // changes is different: what the document says must change, so the next
            // revision replaces it.
            var catalog = await Catalog.LoadAsync(db, cancellationToken);
            var changesAsked = review.State == ReviewStates.Decided && review.Verdict is not null && !Proceeds(catalog, review.VerdictSet, review.Verdict);
            var revision = await db.Revisions.SingleAsync(r => r.Id == review.RevisionId, cancellationToken);
            var fromOutside = revision.AuthoredByParty is { } party
                && await db.Parties.AnyAsync(p => p.Code == party && !p.IsInternal, cancellationToken);
            var (outcome, outcomeProblem) = ControlService.Pick(catalog, request.Outcome, ControlService.Return,
                newRevision: request.Outcome is null ? changesAsked : null, to: fromOutside ? "sender" : "initiator");
            if (outcomeProblem is not null) return (null, outcomeProblem);
            if (changesAsked && outcome is not null && !ControlService.NeedsNewRevision(catalog, outcome))
            {
                return (null, Problems.Conflict("VERDICT_NEEDS_NEW_REVISION",
                    $"Verdict {review.Verdict} asked for changes, so a new revision replaces this one. Choose an outcome that says so.",
                    new { verdict = review.Verdict, outcome }));
            }
            var newRevision = changesAsked || (outcome is not null && ControlService.NeedsNewRevision(catalog, outcome));
            if (newRevision) await ReturnToAuthorAsync(review, note, access.UserName, cancellationToken);
            else await ReturnForCorrectionAsync(review, note, access.UserName, cancellationToken);
            control.Record(revision, outcome, note, access.UserName);
        }
        else
        {
            var problem = await SendBackToStepAsync(access, review, request.ToStep.Value - 1, request.Reason, note,
                onlyAnswered: false, cancellationToken);
            if (problem is not null) return (null, problem);
        }
        await db.SaveChangesAsync(cancellationToken);
        return (review, null);
    }

    /// <summary>
    /// Whoever holds the open step may send the route back to a step that has
    /// already answered, never forward: a reviewer who opened the wrong file has
    /// somewhere to go other than answering falsely. It is recorded with their name.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> RewindAsync(
        ProjectAccess access, Guid reviewId, RewindRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        var step = OpenStep(review);
        if (review.State != ReviewStates.InProgress || step is null || await SeatAsync(review, step, access, cancellationToken) is null)
        {
            return (null, Problems.Forbidden("NOT_ON_OPEN_STEP", "Only the people on the step that is open send the route back."));
        }
        if (request.ToStep - 1 >= step.Index || request.ToStep < 1)
        {
            return (null, Problems.Invalid("REWIND_FORWARD", "The route goes back only to a step that has already answered."));
        }
        var problem = await SendBackToStepAsync(access, review, request.ToStep - 1, request.Reason, request.Note?.Trim() ?? "",
            onlyAnswered: true, cancellationToken);
        if (problem is not null) return (null, problem);
        await db.SaveChangesAsync(cancellationToken);
        return (review, null);
    }
}
