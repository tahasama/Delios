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
    // ── Comments ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Adds a comment from someone on the open step. The class must be published; its <c>blocking</c> property decides whether the comment blocks release.
    /// For a party answering by proxy, the step must have been dispatched first and the author name records both the party and who typed it.
    /// </summary>
    public async Task<(ReviewComment? Comment, IResult? Problem)> CommentAsync(
        ProjectAccess access, Guid reviewId, CommentRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        var step = OpenStep(review);
        var seat = review.State == ReviewStates.InProgress && step is not null ? await SeatAsync(review, step, access, cancellationToken) : null;
        if (step is null || seat is null)
        {
            return (null, Problems.Forbidden("NOT_ON_OPEN_STEP", "Only the people on the step that is open comment on it."));
        }
        if (seat.AnsweredAt is not null) return (null, Problems.Conflict("ALREADY_ANSWERED", "This step is answered: what it says is settled."));
        if (step.ByProxy && step.DispatchedAt is null) return (null, NotDispatched(step));
        var text = request.Text?.Trim() ?? "";
        if (text.Length == 0) return (null, Problems.Invalid("COMMENT_EMPTY", "A comment needs words."));

        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var classCode = request.Class ?? "";
        if (!catalog.IsActive(ReviewSets.CommentClasses, classCode))
        {
            return (null, Problems.Invalid("VALUE_NOT_PUBLISHED", $"{classCode} is not a published comment class.",
                new { field = "class", value = classCode }));
        }
        var blocking = catalog.Prop(ReviewSets.CommentClasses, classCode, "blocking") is { ValueKind: JsonValueKind.True };
        // A reservation another party settles: "approved, under reserve of the architect".
        if (request.ClosesWithStep is { } later && (later <= step.Index + 1 || later > review.Steps.Count))
        {
            return (null, Problems.Invalid("CLOSING_STEP_INVALID", "A comment can only be settled by a later step of this route."));
        }

        var comment = new ReviewComment
        {
            TenantId = review.TenantId,
            ReviewId = review.Id,
            StepIndex = step.Index,
            AuthorId = access.UserId,
            // A party's comment, written down by one of ours: both are said.
            AuthorName = step.ByProxy ? $"{step.PartyName} (recorded by {access.UserName})"
                : seat.UserId == access.UserId ? access.UserName : $"{access.UserName} for {seat.UserName}",
            Text = text,
            Class = classCode,
            Blocking = blocking,
            ClosesWith = request.ClosesWithStep is null ? CommentClosure.Revision : CommentClosure.Step,
            ClosesWithStep = request.ClosesWithStep,
            CreatedAt = clock.GetCurrentInstant(),
        };
        db.ReviewComments.Add(comment);
        await db.SaveChangesAsync(cancellationToken);
        return (comment, null);
    }

    /// <summary>Closes an open comment with a resolution. Only its author or Document Control may close it. Returns null on success, or the problem.</summary>
    public async Task<IResult?> CloseCommentAsync(
        ProjectAccess access, Guid reviewId, Guid commentId, CloseCommentRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        var comment = review?.Comments.SingleOrDefault(c => c.Id == commentId);
        if (review is null || comment is null) return NotFound();
        if (comment.Status != CommentStatuses.Open) return Problems.Conflict("COMMENT_CLOSED", "The comment is already closed.");
        if (comment.AuthorId != access.UserId && !await HoldsControlAsync(access, review, cancellationToken))
        {
            return Problems.Forbidden("CLOSE_NOT_ALLOWED", "Its author or Document Control closes a comment.");
        }
        var resolution = request.Resolution?.Trim() ?? "";
        if (resolution.Length == 0) return Problems.Invalid("RESOLUTION_REQUIRED", "Say how the comment was settled.");

        Close(comment, resolution, access.UserName);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor(access), "COMMENT_CLOSED", "Review", review.Id, review.Number, resolution,
            review.ProjectId, cancellationToken);
        return null;
    }

    /// <summary>
    /// Changes a comment its author wrote, while the step it was written on is open
    /// and their seat has not answered: until then it is a draft, afterwards a record.
    /// The words it had are kept in the audit trail.
    /// </summary>
    public async Task<IResult?> EditCommentAsync(
        ProjectAccess access, Guid reviewId, Guid commentId, CommentRequest request, CancellationToken cancellationToken)
    {
        var (review, comment, problem) = await DraftCommentAsync(access, reviewId, commentId, "changed", cancellationToken);
        if (problem is not null) return problem;
        var text = request.Text?.Trim() ?? "";
        if (text.Length == 0) return Problems.Invalid("COMMENT_EMPTY", "A comment says something: write it, or take it back.");
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var classCode = request.Class ?? comment!.Class;
        if (!catalog.IsActive(ReviewSets.CommentClasses, classCode))
        {
            return Problems.Invalid("VALUE_NOT_PUBLISHED", $"{classCode} is not a published comment class.", new { field = "class", value = classCode });
        }
        var was = comment!.Text;
        comment.Text = text;
        comment.Class = classCode;
        comment.Blocking = catalog.Prop(ReviewSets.CommentClasses, classCode, "blocking") is { ValueKind: JsonValueKind.True };
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor(access), "COMMENT_CHANGED", "Review", review!.Id, review.Number,
            $"Before the step was answered. It said: \"{Clip(was)}\"", review.ProjectId, cancellationToken);
        return null;
    }

    /// <summary>Takes a comment back, on the same terms as changing it. It is kept, marked withdrawn, and no longer shown or counted.</summary>
    public async Task<IResult?> WithdrawCommentAsync(ProjectAccess access, Guid reviewId, Guid commentId, CancellationToken cancellationToken)
    {
        var (review, comment, problem) = await DraftCommentAsync(access, reviewId, commentId, "taken back", cancellationToken);
        if (problem is not null) return problem;
        comment!.Status = CommentStatuses.Withdrawn;
        comment.ClosedAt = clock.GetCurrentInstant();
        comment.ClosedByName = access.UserName;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor(access), "COMMENT_WITHDRAWN", "Review", review!.Id, review.Number,
            $"Taken back before the step was answered: \"{Clip(comment.Text)}\"", review.ProjectId, cancellationToken);
        return null;
    }

    /// <summary>The comment, when the caller wrote it and it is still a draft: its step open, their seat not answered.</summary>
    private async Task<(Review? Review, ReviewComment? Comment, IResult? Problem)> DraftCommentAsync(
        ProjectAccess access, Guid reviewId, Guid commentId, string act, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        var comment = review?.Comments.SingleOrDefault(c => c.Id == commentId && c.Status != CommentStatuses.Withdrawn);
        if (review is null || comment is null) return (null, null, NotFound());
        if (comment.AuthorId != access.UserId) return (null, null, Problems.Forbidden("NOT_AUTHOR", $"A comment is {act} by whoever wrote it."));
        var step = OpenStep(review);
        var seat = review.State == ReviewStates.InProgress && step is not null && step.Index == comment.StepIndex
            ? await SeatAsync(review, step, access, cancellationToken) : null;
        if (seat is null || seat.AnsweredAt is not null || comment.Status != CommentStatuses.Open)
        {
            return (null, null, Problems.Conflict("COMMENT_GIVEN",
                $"This step has been answered. A comment in the record is settled by closing it with a resolution, not {act}."));
        }
        return (review, comment, null);
    }

    private static string Clip(string text) => text.Length <= 200 ? text : text[..200] + "…";
}
