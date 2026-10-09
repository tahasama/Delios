using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>Body of correcting a record: the new record's own title.</summary>
public sealed record CorrectionRequest(string? Title);
/// <summary>Body of withdrawing an approval, or reclassifying a comment: why.</summary>
public sealed record WithdrawApprovalRequest(string? Reason);
public sealed record ReclassifyRequest(bool Blocking, string? Note = null);

/// <summary>
/// Acts that change what a record means without rewriting it: a record confirmed
/// as evidence, a record corrected by a further record, an approval withdrawn,
/// a comment reclassified. Each keeps what was there and says what changed.
/// </summary>
public static class GovernanceEndpoints
{
    public static void MapGovernanceEndpoints(this IEndpointRouteBuilder app)
    {
        var p = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Documents")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        p.MapPost("/documents/{documentId:guid}/confirm", ConfirmAsync);
        p.MapPost("/documents/{documentId:guid}/correction", CorrectAsync);
        p.MapPost("/revisions/{revisionId:guid}/withdraw-approval", WithdrawApprovalAsync);
        p.MapPost("/reviews/{reviewId:guid}/comments/{commentId:guid}/reclassify", ReclassifyAsync);
    }

    private static Actor Who(ProjectAccess a) => new(a.UserId, a.UserName);

    private static async Task<Document?> VisibleAsync(DeliosDbContext db, DocumentService documents, ProjectAccess access, Guid id, CancellationToken c) =>
        await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(c)).SingleOrDefaultAsync(d => d.Id == id, c);

    /// <summary>A record is confirmed: fixed as evidence, never revised; a mistake is corrected by a further record.</summary>
    private static async Task<IResult> ConfirmAsync(Guid documentId, HttpContext h, DeliosDbContext db, DocumentService documents, AuditLog audit,
        IClock clock, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        var document = await VisibleAsync(db, documents, access, documentId, c);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (!access.IsInternal || !(access.Allows(Verbs.Create, document.Facts) || access.Allows(Verbs.Control, document.Facts)))
            return Problems.Forbidden("CONFIRM_NOT_ALLOWED", "Your function cannot confirm this record.");
        if (document.Kind != DocumentKinds.Record) return Problems.Conflict("NOT_A_RECORD", "Only a record is confirmed.");
        if (document.ConfirmedAt is not null) return Problems.Conflict("ALREADY_CONFIRMED", "Already confirmed.");
        document.ConfirmedAt = clock.GetCurrentInstant();
        document.ConfirmedByName = access.UserName;
        if (document.State == DocumentStates.Planned) document.State = DocumentStates.Active;
        document.UpdatedAt = document.ConfirmedAt.Value;
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "RECORD_CONFIRMED", "Document", document.Id, document.Number,
            "Record confirmed: fixed as evidence, never revised. A correction is a further record referencing this one.", access.Project.Id, c);
        return Results.NoContent();
    }

    /// <summary>A correction is a new record that names the one it corrects; both are kept, the original never altered.</summary>
    private static async Task<IResult> CorrectAsync(Guid documentId, CorrectionRequest r, HttpContext h, DeliosDbContext db, DocumentService documents,
        AuditLog audit, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        var original = await VisibleAsync(db, documents, access, documentId, c);
        if (original is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (original.Kind != DocumentKinds.Record) return Problems.Conflict("NOT_A_RECORD", "A document is revised; only a record is corrected by a further one.");
        var title = r.Title?.Trim() ?? "";
        if (title.Length == 0) return Problems.Invalid("TITLE_REQUIRED", "The correction needs its own descriptive title.");
        var (correction, problem) = await documents.RegisterAsync(access, new RegisterDocumentRequest(
            title, original.DeliverableType, original.DocType, original.Discipline, original.Originator, original.Subproject, original.ContractRef,
            original.Criticality, original.Confidentiality, original.RetentionClass, original.ReceivedDate?.ToDateOnly(), null, DocumentKinds.Record), c);
        if (problem is not null) return problem;
        correction!.CorrectsId = original.Id;
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "RECORD_CORRECTED", "Document", original.Id, original.Number,
            $"Corrected by {correction.Number}; both kept, the original never altered.", access.Project.Id, c);
        return Results.Ok(new { correction.Id, correction.Number });
    }

    /// <summary>
    /// Document Control withdraws the approval a released revision stands on. The review is kept as it was, marked;
    /// the document is withdrawn until a replacement is released; its author is told.
    /// </summary>
    private static async Task<IResult> WithdrawApprovalAsync(Guid revisionId, WithdrawApprovalRequest r, HttpContext h, DeliosDbContext db,
        DocumentService documents, AuditLog audit, IClock clock, Notifications.Notifier notifier, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        var revision = await db.Revisions.SingleOrDefaultAsync(x => x.Id == revisionId && x.ProjectId == access.Project.Id, c);
        var document = revision is null ? null : await VisibleAsync(db, documents, access, revision.DocumentId, c);
        if (revision is null || document is null) return Problems.NotFound("REVISION_NOT_FOUND", "No such revision.");
        if (!access.Allows(Verbs.Control, document.Facts))
            return Problems.Forbidden("CONTROL_ONLY", "The control function withdraws an approval. Ask them, and say why: the reason goes on the record.");
        var reason = r.Reason?.Trim() ?? "";
        if (reason.Length == 0) return Problems.Invalid("REASON_REQUIRED", "A withdrawal is recorded with its reason.");
        var newer = await db.Revisions.AsNoTracking().Where(x => x.DocumentId == revision.DocumentId && x.CreatedAt > revision.CreatedAt
            && (x.State == RevisionStates.InReview || x.State == RevisionStates.Released || x.State == RevisionStates.Superseded))
            .Select(x => x.Value).FirstOrDefaultAsync(c);
        if (newer is not null)
            return Problems.Conflict("REPLACED", $"Rev {revision.Value} has already been replaced by rev {newer}. Withdraw the approval on rev {newer}: an approval on a replaced revision changes nothing.");
        var review = await db.Reviews.Where(x => x.RevisionId == revision.Id && x.State == ReviewStates.Released && x.IssueRequestId == null)
            .OrderByDescending(x => x.ClosedAt).FirstOrDefaultAsync(c);
        if (review is null || review.ApprovalWithdrawnAt is not null) return Problems.Conflict("NO_LIVE_APPROVAL", "No live approval to withdraw.");
        review.ApprovalWithdrawnAt = clock.GetCurrentInstant();
        review.ApprovalWithdrawnByName = access.UserName;
        review.ApprovalWithdrawnReason = reason;
        document.State = DocumentStates.Withdrawn;
        document.UpdatedAt = review.ApprovalWithdrawnAt.Value;
        await db.SaveChangesAsync(c);
        var label = $"{document.Number} rev {revision.Value}";
        await audit.WriteAsync(Who(access), "APPROVAL_WITHDRAWN", "Revision", revision.Id, label,
            $"{reason} The approval on review {review.Number} is kept, marked withdrawn; the document is withdrawn until a replacement is released.",
            access.Project.Id, c);
        await notifier.NotifyAsync(document.TenantId, document.ProjectId, [revision.AuthoredById, document.CreatedById],
            Notifications.NotificationKinds.General, $"Approval withdrawn: {label}", reason, $"/documents/{document.Id}", c);
        return Results.NoContent();
    }

    /// <summary>
    /// A comment's weight is changed after it was written: whether it stops the release. What it was is kept. The
    /// party carrying out the work (Document Control, or the revision's author) may force it, with a note.
    /// </summary>
    private static async Task<IResult> ReclassifyAsync(Guid reviewId, Guid commentId, ReclassifyRequest r, HttpContext h, DeliosDbContext db,
        AuditLog audit, IClock clock, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        var review = await db.Reviews.Include(x => x.Comments).SingleOrDefaultAsync(x => x.Id == reviewId && x.ProjectId == access.Project.Id, c);
        var comment = review?.Comments.SingleOrDefault(x => x.Id == commentId);
        if (review is null || comment is null) return Problems.NotFound("COMMENT_NOT_FOUND", "No such comment.");
        var revision = await db.Revisions.AsNoTracking().SingleAsync(x => x.Id == review.RevisionId, c);
        var document = await db.Documents.AsNoTracking().SingleAsync(x => x.Id == review.DocumentId, c);
        if (!access.Allows(Verbs.Control, document.Facts) && revision.AuthoredById != access.UserId)
            return Problems.Forbidden("RECLASSIFY_NOT_ALLOWED", "Document Control or the revision's author reclassifies a comment.");
        if (comment.Status != CommentStatuses.Open) return Problems.Conflict("COMMENT_CLOSED", "The comment is settled; reclassifying it changes nothing.");
        if (comment.Blocking == r.Blocking) return Results.NoContent();
        var catalog = await Catalog.LoadAsync(db, c);
        var code = catalog.CodeWhere(ReviewSets.CommentClasses, "blocking", r.Blocking)
            ?? (r.Blocking ? "BLOCKING" : "NON_BLOCKING");
        comment.OriginalBlocking ??= comment.Blocking;
        comment.Blocking = r.Blocking;
        comment.Class = code;
        comment.ReclassifiedAt = clock.GetCurrentInstant();
        comment.ReclassifiedByName = access.UserName;
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "COMMENT_RECLASSIFIED", "Review", review.Id, review.Number,
            $"{(r.Blocking ? "Now stops the release" : "No longer stops the release")}: \"{(comment.Text.Length > 120 ? comment.Text[..120] + "…" : comment.Text)}\""
            + (string.IsNullOrWhiteSpace(r.Note) ? "" : $" {r.Note.Trim()}"), access.Project.Id, c);
        return Results.NoContent();
    }
}
