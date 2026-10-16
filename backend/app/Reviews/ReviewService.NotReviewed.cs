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
    // ── Not reviewed ──────────────────────────────────────────────────────────

    /// <summary>
    /// A revision of a document type the organization does not review (its
    /// published <c>review</c> property is false) goes from preparation straight to
    /// release. Whoever would have sent it for review settles its status here, and
    /// who receives it. It waits for the control function as a decided review would, on
    /// a review with no steps; where nobody holds that function, it is released at once.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> SendOnAsync(
        ProjectAccess access, Guid revisionId, SendOnRequest request, CancellationToken cancellationToken)
    {
        var revision = await db.Revisions.Include(r => r.Files).SingleOrDefaultAsync(r => r.Id == revisionId, cancellationToken);
        var document = revision is null ? null : await VisibleDocumentAsync(access, revision.DocumentId, cancellationToken);
        if (revision is null || document is null) return Fail(Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        if (!access.Allows(Verbs.Create, document.Facts) && !access.Allows(Verbs.Revise, document.Facts)
            && revision.AuthoredById != access.UserId && !access.Allows(Verbs.Control, document.Facts))
        {
            return Fail(Problems.Forbidden("SEND_ON_NOT_ALLOWED", "Only the author, someone who may revise it, or the control function sends it on."));
        }
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        if (catalog.Prop(ValueSets.DocumentTypes, document.DocType, "review") is not { ValueKind: JsonValueKind.False })
        {
            return Fail(Problems.Conflict("TYPE_IS_REVIEWED", $"{document.DocType} is reviewed before release: send it for review.",
                new { docType = document.DocType }));
        }
        if (revision.State != RevisionStates.InPreparation)
        {
            return Fail(Problems.Conflict("REVISION_NOT_IN_PREPARATION",
                $"Revision {revision.Value} is {Words(revision.State)}; only a revision in preparation is sent on.", new { state = revision.State }));
        }
        if (revision.FilesState != FilesStates.Ready)
        {
            return Fail(Problems.Conflict("FILES_NOT_READY", "The revision's files have not all passed scanning.", new { filesState = revision.FilesState }));
        }
        if (!revision.Files.Any(f => f.Kind == FileKinds.Rendition && f.Status == FileStatuses.Clean && f.Submission == revision.Submission))
        {
            return Fail(Problems.Conflict("NO_RENDITION", "Attach the file first: a PDF is what is released."));
        }
        var status = request.Status?.Trim() ?? "";
        if (!catalog.IsActive(ReviewSets.Statuses, status))
        {
            return Fail(Problems.Invalid("STATUS_REQUIRED", "Choose the status it is released at.", new { field = "status", value = status }));
        }
        if (request.Issue is not null)
        {
            var (asked, problem) = await transmittals.NewRequestAsync(access, document, revision, request.Issue, cancellationToken);
            if (problem is not null) return Fail(problem);
            db.IssueRequests.Add(asked!);
            await db.SaveChangesAsync(cancellationToken);
            if (await OpenApprovalAsync(access, asked!, cancellationToken) is { } approvalProblem) return Fail(approvalProblem);
        }

        var now = clock.GetCurrentInstant();
        var review = new Review
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            DocumentId = document.Id,
            RevisionId = revision.Id,
            Number = await numbering.RecordAsync(access.Project.TenantId, access.Project.Id, RecordKinds.Review,
                NumberFields.ForRecord(access.Project.Code), "RV", cancellationToken),
            RouteName = "Not reviewed",
            State = ReviewStates.Decided,
            GrantedStatus = status,
            StartedById = access.UserId,
            StartedByName = access.UserName,
            StartedAt = now,
            DecidedAt = now,
        };
        db.Reviews.Add(review);
        revision.State = RevisionStates.InReview;
        document.LatestRevisionState = RevisionStates.InReview;
        document.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor(access), "SENT_FOR_RELEASE", "Revision", revision.Id, $"{document.Number} rev {revision.Value}",
            $"Not reviewed: document type {document.DocType} goes from preparation straight to release, at {status}.",
            access.Project.Id, cancellationToken);

        var controllers = await notifier.ControlHoldersAsync(access.Project.Id, cancellationToken);
        if (controllers.Count == 0 && await ApprovalOwedAsync(revision.Id, cancellationToken) is null)
        {
            await ReleaseCoreAsync(access, review, status, "System", cancellationToken);
        }
        else
        {
            await TellAsync(review, controllers, Notifications.NotificationKinds.ReviewDecided,
                $"{TransmittalService.Label(document, revision)} is ready to release at {status}",
                $"{document.DocType} is not reviewed; {access.UserName} sent it on.", cancellationToken, $"/documents/{document.Id}");
        }
        await db.SaveChangesAsync(cancellationToken);
        return (review, null);
    }
}
