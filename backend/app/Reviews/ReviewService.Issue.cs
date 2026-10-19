using Delios.Host.Platform;
using Delios.Host.Identity;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Reviews;

public sealed partial class ReviewService
{
    // ── Sending a review to its reviewers ─────────────────────────────────────

    /// <summary>
    /// The control function sends a review that waits for it (REVIEW_ISSUE carried out by the control function) to its
    /// reviewers: its first step opens, its people are told, its clock starts. Whoever sent it for review is told.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> IssueToReviewersAsync(ProjectAccess access, Guid reviewId, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        if (!access.Holds(Verbs.Control))
            return (null, Problems.Forbidden("CONTROL_ONLY", "The control function sends a review to its reviewers on this project."));
        if (!AwaitsIssue(review))
            return (null, Problems.Conflict("ALREADY_WITH_REVIEWERS", "This review is already with its reviewers, or closed."));
        await OpenStepAsync(access, review, 0, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor(access), "REVIEW_ISSUED", "Review", review.Id, review.Number,
            $"Sent to its reviewers by {access.UserName}.", review.ProjectId, cancellationToken);
        if (review.StartedById is { } starter && starter != access.UserId)
        {
            var (document, revision) = await SubjectAsync(review, cancellationToken);
            await TellAsync(review, [starter], Notifications.NotificationKinds.ReviewStep,
                $"{TransmittalService.Label(document, revision)} is with its reviewers",
                $"Review {review.Number} was sent to its reviewers by {access.UserName}.", cancellationToken);
        }
        return (review, null);
    }

    /// <summary>A review sent for review that waits for the control function to send it to its reviewers: in progress, no step opened yet.</summary>
    public static bool AwaitsIssue(Review review) =>
        review.State == ReviewStates.InProgress && review.Steps.All(s => s.State == StepStates.Waiting && s.OpenedAt == null);
}
