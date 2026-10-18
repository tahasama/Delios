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
    // ── Answers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Records the caller's answer on the open step. On the deciding step the answer is a verdict (plus a status if it lets the revision proceed, and optionally who receives it once released);
    /// on an advising step the answer is worked out from the caller's comments. Completes the step when everyone needed has answered.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> AnswerAsync(
        ProjectAccess access, Guid reviewId, AnswerRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        var step = OpenStep(review);
        var seat = review.State == ReviewStates.InProgress && step is not null ? await SeatAsync(review, step, access, cancellationToken) : null;
        if (step is null || seat is null)
        {
            return (null, Problems.Forbidden("NOT_ON_OPEN_STEP", "Only the people on the step that is open answer it."));
        }
        if (seat.AnsweredAt is not null) return (null, Problems.Conflict("ALREADY_ANSWERED", "You have answered this step."));
        if (step.ByProxy)
        {
            if (step.DispatchedAt is null) return (null, NotDispatched(step));
            var evidenceRequired = await db.Parties.AsNoTracking().Where(p => p.Id == step.PartyId)
                .Select(p => p.EvidenceRequired).SingleAsync(cancellationToken);
            if (evidenceRequired && request.EvidenceFileId is null)
            {
                return (null, Problems.Invalid("EVIDENCE_REQUIRED",
                    $"An answer recorded for {step.PartyName} carries its proof: their stamped copy, or the message that brought it."));
            }
        }

        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        string answer;
        string? granted = null;
        var kindWritten = Advice_None;
        if (step.Deciding)
        {
            answer = request.Verdict ?? "";
            if (!catalog.IsActive(review.VerdictSet, answer) || !catalog.InSet(review.VerdictSet, answer, review.Verdicts))
            {
                return (null, Problems.Invalid("VALUE_NOT_PUBLISHED", $"{answer} is not a published verdict.",
                    new { field = "verdict", value = answer }));
            }
            if (Proceeds(catalog, review.VerdictSet, answer) && review.IssueRequestId is null)
            {
                granted = request.Status ?? "";
                if (!catalog.IsActive(ReviewSets.Statuses, granted))
                {
                    return (null, Problems.Invalid("STATUS_REQUIRED",
                        "A verdict that lets the revision proceed names the status it will be released at.",
                        new { field = "status", value = granted }));
                }
                if (step.GrantsStatuses.Length > 0 && !step.GrantsStatuses.Contains(granted))
                {
                    return (null, Problems.Invalid("STATUS_NOT_GRANTABLE",
                        $"This step may grant {string.Join(", ", step.GrantsStatuses)}, not {granted}.",
                        new { allowed = step.GrantsStatuses }));
                }
                var other = step.Participants.FirstOrDefault(p => p.GrantedStatus is not null && p.GrantedStatus != granted);
                if (other is not null)
                {
                    return (null, Problems.Conflict("STATUS_DISAGREES",
                        $"{other.UserName} granted {other.GrantedStatus}; the deciders must agree on one status.",
                        new { granted = other.GrantedStatus }));
                }
            }
        }
        else
        {
            // The adviser picks from the published advice set. What they wrote sets the
            // floor: advice may not say less than their comments do.
            var mine = review.Comments.Where(c => c.StepIndex == step.Index && c.Status != CommentStatuses.Withdrawn
                && (c.AuthorId == access.UserId || c.AuthorId == seat.UserId)).ToList();
            var kind = mine.Any(c => c.Blocking) ? Advice_Blocking : mine.Count > 0 ? Advice_Some : Advice_None;
            kindWritten = kind;
            answer = string.IsNullOrWhiteSpace(request.Verdict) ? AdviceCode(catalog, kind) : request.Verdict;
            if (!catalog.IsActive(ReviewSets.Advice, answer) && answer != AdviceCode(catalog, kind))
            {
                return (null, Problems.Invalid("VALUE_NOT_PUBLISHED", $"{answer} is not published advice.",
                    new { field = "verdict", value = answer }));
            }
            var severity = new[] { Advice_None, Advice_Some, Advice_Blocking };
            if (Array.IndexOf(severity, AdviceKind(catalog, answer)) < Array.IndexOf(severity, kind))
            {
                return (null, Problems.Invalid("ADVICE_BELOW_COMMENTS",
                    $"Your comments say {AdviceCode(catalog, kind)}; your advice cannot say less than they do.",
                    new { field = "verdict", floor = AdviceCode(catalog, kind) }));
            }
            // What the revision is issued for, as this adviser sees it: kept, or changed.
            // It is carried to the next step, which confirms it or changes it again.
            if (!string.IsNullOrWhiteSpace(request.Status))
            {
                if (!catalog.IsActive(ReviewSets.Statuses, request.Status))
                {
                    return (null, Problems.Invalid("VALUE_NOT_PUBLISHED", $"{request.Status} is not a published status.",
                        new { field = "status", value = request.Status }));
                }
                granted = request.Status;
            }
        }

        // Who it goes to once released: offered to whoever decides, because they are
        // the likeliest to know. Leaving it out is an answer too.
        IssueRequest? issue = null;
        if (request.Issue is not null)
        {
            if (!step.Deciding || granted is null)
            {
                return (null, Problems.Invalid("ISSUE_ONLY_WITH_DECISION",
                    "Who receives it is asked with a decision that lets the revision out."));
            }
            var (document, revision) = await SubjectAsync(review, cancellationToken);
            var (asked, problem) = await transmittals.NewRequestAsync(access, document, revision, request.Issue, cancellationToken);
            if (problem is not null) return (null, problem);
            issue = asked;
        }
        if (request.EvidenceFileId is { } evidence)
        {
            if (!step.ByProxy) return (null, Problems.Invalid("EVIDENCE_ONLY_BY_PROXY", "Proof is filed with an answer recorded for a party."));
            if (await transmittals.BindEvidenceAsync(access, evidence, review.RevisionId, cancellationToken) is { } bad) return (null, bad);
        }

        var now = clock.GetCurrentInstant();
        // The comment is said with the answer, in one place: it joins the review's comments.
        if (request.Note?.Trim() is { Length: > 0 } said)
        {
            if (request.ClosesWithStep is { } later && (later <= step.Index + 1 || later > review.Steps.Count))
            {
                return (null, Problems.Invalid("CLOSING_STEP_INVALID", "A comment can only be settled by a later step of this route."));
            }
            var blocking = !step.Deciding && AdviceKind(catalog, answer) == Advice_Blocking;
            db.ReviewComments.Add(new ReviewComment
            {
                TenantId = review.TenantId,
                ReviewId = review.Id,
                StepIndex = step.Index,
                AuthorId = access.UserId,
                AuthorName = step.ByProxy ? $"{step.PartyName} (recorded by {access.UserName})"
                    : seat.UserId == access.UserId ? access.UserName : $"{access.UserName} for {seat.UserName}",
                Text = said,
                Class = catalog.CodeWhere(ReviewSets.CommentClasses, "blocking", blocking) ?? (blocking ? "BLOCKING" : "NON_BLOCKING"),
                Blocking = blocking,
                ClosesWith = request.ClosesWithStep is null ? CommentClosure.Revision : CommentClosure.Step,
                ClosesWithStep = request.ClosesWithStep,
                CreatedAt = now,
            });
        }
        else if (!step.Deciding && AdviceKind(catalog, answer) != Advice_None && kindWritten == Advice_None)
        {
            return (null, Problems.Invalid("COMMENT_REQUIRED", "Advice with comments says what they are: write them with it.", new { field = "comment" }));
        }
        seat.Answer = answer;
        seat.GrantedStatus = granted;
        if (!step.Deciding && granted is not null)
        {
            var (_, subject) = await SubjectAsync(review, cancellationToken);
            subject.StatusCode = granted;
        }
        // What they wrote is a comment of the step now (above), not a second copy on the answer.
        seat.Note = null;
        seat.AnsweredAt = now;
        var stoodIn = seat.UserId != access.UserId;
        if (stoodIn)
        {
            seat.AnsweredById = access.UserId;
            seat.AnsweredByName = access.UserName;
        }
        if (step.ByProxy)
        {
            step.ForeignAnswer = request.ForeignAnswer?.Trim() is { Length: > 0 } theirs ? theirs : null;
            step.RecordedByName = access.UserName;
            step.EvidenceFileId = request.EvidenceFileId;
        }
        if (issue is not null)
        {
            db.IssueRequests.Add(issue);
            // Saved now, so a release this answer brings about carries it out.
            await db.SaveChangesAsync(cancellationToken);
            if (await OpenApprovalAsync(access, issue, cancellationToken) is { } approvalProblem) return (null, approvalProblem);
        }
        await audit.WriteAsync(Actor(access), step.Deciding ? "VERDICT" : "ADVICE", "Review", review.Id, review.Number,
            $"Step {step.Index + 1} ({step.Title}): {answer}{(granted is null ? "" : step.Deciding ? $", granting {granted}" : $", issued for {granted}")}"
            + (stoodIn ? $", answered for {seat.UserName}, who handed the step over" : "")
            + (step.ByProxy ? $", recorded for {step.PartyName}{(step.ForeignAnswer is null ? "" : $" who wrote \"{step.ForeignAnswer}\"")}." : "."),
            review.ProjectId, cancellationToken);

        var complete = step.Mode == StepModes.Any || step.Participants.All(p => p.AnsweredAt is not null);
        if (complete)
        {
            await CompleteStepAsync(access, review, step, catalog, cancellationToken);
        }
        await db.SaveChangesAsync(cancellationToken);
        return (review, null);
    }

    /// <summary>
    /// Closes a step once answered: works out the step's answer (the most restrictive verdict, or the most severe advice), closes comments this step was named to settle, and opens the next step.
    /// After the deciding step the review becomes decided; if the project has nobody with the control function role, it is released or returned automatically. Called by <see cref="AnswerAsync"/>.
    /// </summary>
    private async Task CompleteStepAsync(
        ProjectAccess access, Review review, ReviewStep step, Catalog catalog, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var answered = step.Participants.Where(p => p.AnsweredAt is not null).OrderBy(p => p.AnsweredAt).ToList();
        step.State = StepStates.Done;
        step.CompletedAt = now;
        if (step.Deciding)
        {
            // Several deciders: the most restrictive verdict binds.
            var binding = answered.FirstOrDefault(p => !Proceeds(catalog, review.VerdictSet, p.Answer!)) ?? answered[^1];
            step.Answer = binding.Answer;
            review.Verdict = binding.Answer;
            review.GrantedStatus = Proceeds(catalog, review.VerdictSet, binding.Answer!) ? binding.GrantedStatus : null;
            // What the decider granted is what the revision now carries: release reads it from here.
            if (review.GrantedStatus is not null)
            {
                var (_, decided) = await SubjectAsync(review, cancellationToken);
                decided.StatusCode = review.GrantedStatus;
            }
        }
        else
        {
            var severity = new[] { Advice_None, Advice_Some, Advice_Blocking };
            step.Answer = answered.Select(p => p.Answer!)
                .MaxBy(code => Array.IndexOf(severity, AdviceKind(catalog, code))) ?? AdviceCode(catalog, Advice_None);
        }

        // Reservations this step was named to settle close themselves, unless it objected.
        var settles = step.Deciding ? Proceeds(catalog, review.VerdictSet, step.Answer!) : AdviceKind(catalog, step.Answer!) != Advice_Blocking;
        if (settles)
        {
            foreach (var c in review.Comments.Where(c => c.Status == CommentStatuses.Open
                && c.ClosesWith == CommentClosure.Step && c.ClosesWithStep == step.Index + 1))
            {
                Close(c, $"Settled by step {step.Index + 1} ({step.Title}).", "System");
            }
        }

        if (!step.Deciding)
        {
            await OpenStepAsync(access, review, step.Index + 1, cancellationToken);
            return;
        }
        if (review.IssueRequestId is not null)
        {
            await SettleApprovalAsync(access, review, catalog, cancellationToken);
            return;
        }

        review.State = ReviewStates.Decided;
        review.DecidedAt = now;
        await audit.WriteAsync(Audit.Actor.System, "REVIEW_DECIDED", "Review", review.Id, review.Number,
            $"Verdict {review.Verdict}{(review.GrantedStatus is null ? "" : $", granting {review.GrantedStatus}")}.",
            review.ProjectId, cancellationToken);
        // Everyone it concerns: the route, those copied in, the control function, its author, and another organization's people.
        var (decidedDocument, decidedRevision) = await SubjectAsync(review, cancellationToken);
        await TellAsync(review, await InvolvedAsync(review, decidedDocument, decidedRevision, cancellationToken), Notifications.NotificationKinds.ReviewDecided,
            $"{TransmittalService.Label(decidedDocument, decidedRevision)} decided: {review.Verdict}",
            $"Review {review.Number}{(review.GrantedStatus is null ? "" : $" grants {review.GrantedStatus}")}.", cancellationToken);

        // Where nobody holds the control function, the people doing the work take
        // its acts: a verdict that proceeds releases, one that does not returns.
        if (await ControlHoldersAsync(access.Project.Id, cancellationToken) > 0) return;
        if (!Proceeds(catalog, review.VerdictSet, review.Verdict!))
        {
            await ReturnToAuthorAsync(review, $"Verdict {review.Verdict}.", "System", cancellationToken);
        }
        else if (!review.Comments.Any(c => c.Blocking && c.Status == CommentStatuses.Open)
            && await ApprovalOwedAsync(review.RevisionId, cancellationToken) is null)
        {
            await ReleaseCoreAsync(access, review, review.GrantedStatus!, "System", cancellationToken);
        }
    }
}
