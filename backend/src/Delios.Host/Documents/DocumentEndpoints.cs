using Delios.Host.Audit;
using Prometheus;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

/// <summary>
/// The HTTP API of the document register: list, read, register, upload files, start and resubmit revisions,
/// and download. Each handler checks access and then hands the work to <see cref="DocumentService"/>.
/// </summary>
public static class DocumentEndpoints
{
    /// <summary>Documents per page when the caller gives no <c>limit</c>.</summary>
    public const int DefaultPageSize = 50;
    /// <summary>The largest <c>limit</c> a caller may ask for; larger values are lowered to this.</summary>
    public const int MaxPageSize = 200;

    /// <summary>
    /// Registers the document routes under <c>/api/projects/{projectId}</c>. Every route runs in one database
    /// transaction and only after the project access check. Called at start-up from <c>PlatformSetup</c>.
    /// </summary>
    public static void MapDocumentEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Documents")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();

        project.MapGet("/documents", ListAsync);
        project.MapGet("/documents/{documentId:guid}", GetAsync);
        project.MapPost("/documents", RegisterAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapPost("/documents/{documentId:guid}/uploads", RequestUploadAsync);
        project.MapGet("/revisions/{revisionId:guid}", async (Guid revisionId, HttpContext h, DeliosDbContext db, DocumentService documents, CancellationToken c) =>
        {
            // A revision on its own, with the document it belongs to: for screens that hold only a revision's id.
            var access = ProjectAccessFilter.Of(h);
            var revision = await db.Revisions.AsNoTracking().SingleOrDefaultAsync(r => r.Id == revisionId && r.ProjectId == access.Project.Id, c);
            var visible = revision is not null && await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(c))
                .AnyAsync(d => d.Id == revision.DocumentId, c);
            return visible
                ? Results.Ok(new { revision!.Id, revision.DocumentId, revision.Value, revision.State, revision.StatusCode, revision.AuthoredById, revision.AuthoredByName })
                : Problems.NotFound("REVISION_NOT_FOUND", "No such revision.");
        });
        project.MapPost("/documents/{documentId:guid}/revisions", StartRevisionAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapPost("/documents/{documentId:guid}/revisions/{revisionId:guid}/submissions", ResubmitAsync);
        project.MapPost("/documents/{documentId:guid}/revisions/{revisionId:guid}/files", AttachAsync);
        project.MapPost("/documents/{documentId:guid}/revisions/{revisionId:guid}/update", UpdateFilesAsync);
        project.MapPost("/documents/{documentId:guid}/revisions/{revisionId:guid}/withdraw", WithdrawAsync);
        project.MapPut("/documents/{documentId:guid}", UpdateAsync);
        project.MapPost("/documents/{documentId:guid}/end", EndAsync);
        project.MapPost("/documents/{documentId:guid}/reinstate", ReinstateAsync);
        project.MapGet("/files/{fileId:guid}/download", DownloadAsync);
    }

    /// <summary>
    /// GET /documents: one page of the register the caller may see, filtered and searched by number or title.
    /// Pages are keyed on the document number (<c>after</c>), so later pages are as fast as the first. Runs on the read replica when there is one.
    /// </summary>
    private static async Task<IResult> ListAsync(
        HttpContext http, ReadDatabase reads, DocumentService documents, CancellationToken cancellationToken,
        string? after = null, int? limit = null, string? q = null,
        string? discipline = null, string? docType = null, string? state = null, string? originator = null)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Read)) return Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register.");
        var size = Math.Clamp(limit ?? DefaultPageSize, 1, MaxPageSize);
        using var timer = AppMetrics.RegisterQuerySeconds.WithLabels(string.IsNullOrWhiteSpace(q) ? "no" : "yes").NewTimer();

        var restricted = await documents.RestrictedAsync(cancellationToken);
        var rows = await reads.ReadAsync(source =>
        {
            var query = DocumentQueries.Visible(source, access, restricted).AsNoTracking();
            if (!string.IsNullOrWhiteSpace(q))
            {
                var pattern = "%" + q.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
                query = query.Where(d => EF.Functions.ILike(d.Number, pattern) || EF.Functions.ILike(d.Title, pattern));
            }
            if (discipline is not null) query = query.Where(d => d.Discipline == discipline);
            if (docType is not null) query = query.Where(d => d.DocType == docType);
            if (state is not null) query = query.Where(d => d.State == state);
            if (originator is not null) query = query.Where(d => d.Originator == originator);
            // Keyset paging on the number: page 1000 costs what page 1 costs.
            if (after is not null) query = query.Where(d => string.Compare(d.Number, after) > 0);

            return query.OrderBy(d => d.Number).Take(size + 1)
                .Select(d => new DocumentSummary(d.Id, d.Number, d.Title, d.DeliverableType, d.DocType, d.Discipline,
                    d.Originator, d.State, d.Kind, d.IsPlaceholder, d.Confidentiality, d.LatestRevisionValue,
                    d.LatestRevisionState, d.UpdatedAt.ToDateTimeOffset()))
                .ToListAsync(cancellationToken);
        }, cancellationToken);
        var next = rows.Count > size ? rows[size - 1].Number : null;
        return Results.Ok(new DocumentPage(rows.Take(size).ToList(), next));
    }

    /// <summary>GET /documents/{documentId}: one document with all its revisions, submissions and files, if the caller may see it.</summary>
    private static async Task<IResult> GetAsync(
        Guid documentId, HttpContext http, DeliosDbContext db, DocumentService documents, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Read)) return Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register.");
        var document = await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(cancellationToken))
            .AsNoTracking()
            .Include(d => d.Revisions.OrderBy(r => r.CreatedAt)).ThenInclude(r => r.Files.OrderBy(f => f.Name))
            // One query per collection: a single join would repeat every revision once per file.
            .AsSplitQuery()
            .SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
        return document is null ? Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.") : Results.Ok(View(document));
    }

    /// <summary>
    /// POST /documents: registers a new document and returns it with 201 Created. A retried request with the same
    /// <c>Idempotency-Key</c> header gets the first answer back instead of a second document.
    /// </summary>
    private static async Task<IResult> RegisterAsync(
        RegisterDocumentRequest request, HttpContext http, DocumentService documents, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (document, problem) = await documents.RegisterAsync(access, request, cancellationToken);
        return problem ?? Results.Created($"/api/projects/{access.Project.Id}/documents/{document!.Id}", View(document));
    }

    /// <summary>POST /documents/{documentId}/uploads: records a file the caller is about to upload and returns a signed upload link.</summary>
    private static async Task<IResult> RequestUploadAsync(
        Guid documentId, UploadRequest request, HttpContext http, DocumentService documents, CancellationToken cancellationToken)
    {
        var (ticket, problem) = await documents.RequestUploadAsync(ProjectAccessFilter.Of(http), documentId, request, cancellationToken);
        return problem ?? Results.Ok(ticket);
    }

    /// <summary>POST /documents/{documentId}/revisions: starts a new revision from files already uploaded, and returns it.</summary>
    private static async Task<IResult> StartRevisionAsync(
        Guid documentId, StartRevisionRequest request, HttpContext http, DocumentService documents,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (revision, problem) = await documents.StartRevisionAsync(access, documentId, request, cancellationToken);
        return problem ?? Results.Created(
            $"/api/projects/{access.Project.Id}/documents/{documentId}", View(revision!));
    }

    /// <summary>POST .../revisions/{revisionId}/submissions: sends corrected files for a revision Document Control returned.</summary>
    private static async Task<IResult> ResubmitAsync(
        Guid documentId, Guid revisionId, StartRevisionRequest request, HttpContext http, DocumentService documents,
        CancellationToken cancellationToken)
    {
        var (revision, problem) = await documents.ResubmitAsync(ProjectAccessFilter.Of(http), documentId, revisionId, request,
            cancellationToken);
        return problem ?? Results.Ok(View(revision!));
    }

    /// <summary>PUT /documents/{documentId}: changes the document's metadata, each change audited.</summary>
    private static async Task<IResult> UpdateAsync(
        Guid documentId, UpdateDocumentRequest request, HttpContext http, DocumentService documents, CancellationToken cancellationToken)
    {
        var (_, problem) = await documents.UpdateAsync(ProjectAccessFilter.Of(http), documentId, request, cancellationToken);
        return problem ?? Results.NoContent();
    }

    /// <summary>POST /documents/{documentId}/reinstate: takes a cancellation or withdrawal back, with the reason.</summary>
    private static async Task<IResult> ReinstateAsync(
        Guid documentId, EndDocumentRequest request, HttpContext http, DocumentService documents, CancellationToken cancellationToken)
    {
        var (_, problem) = await documents.ReinstateAsync(ProjectAccessFilter.Of(http), documentId, request, cancellationToken);
        return problem ?? Results.NoContent();
    }

    /// <summary>POST /documents/{documentId}/end: withdraws or cancels the document, with the reason.</summary>
    private static async Task<IResult> EndAsync(
        Guid documentId, EndDocumentRequest request, HttpContext http, DocumentService documents, CancellationToken cancellationToken)
    {
        var (_, problem) = await documents.EndAsync(ProjectAccessFilter.Of(http), documentId, request, cancellationToken);
        return problem ?? Results.NoContent();
    }

    /// <summary>
    /// POST .../revisions/{revisionId}/update: new files for a revision not yet released. One in review is first taken
    /// out of it — the review closes as withdrawn, everyone on it is told, and a reason is required — then the files
    /// come in as a new submission and the revision is sent again from its page.
    /// </summary>
    private static async Task<IResult> UpdateFilesAsync(
        Guid documentId, Guid revisionId, StartRevisionRequest request, HttpContext http, DeliosDbContext db, DocumentService documents,
        Reviews.ReviewService reviews, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var revision = await db.Revisions.AsNoTracking().SingleOrDefaultAsync(r => r.Id == revisionId && r.DocumentId == documentId, cancellationToken);
        if (revision is null) return Problems.NotFound("REVISION_NOT_FOUND", "No such revision.");
        if (revision.AuthoredById != access.UserId && !access.Holds(Verbs.Control))
            return Problems.Forbidden("AUTHOR_OR_CONTROL", "Its author or Document Control updates a revision's files.");
        if (revision.State == RevisionStates.InReview)
        {
            var reason = request.ChangeDescription?.Trim() ?? "";
            if (reason.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it is taken out of review: everyone on the route is told.");
            if (await reviews.WithdrawForUpdateAsync(access, revisionId, reason, cancellationToken) is { } refused) return refused;
            await db.SaveChangesAsync(cancellationToken);
        }
        var (updated, problem) = await documents.UpdateFilesAsync(access, documentId, revisionId, request, cancellationToken);
        return problem ?? Results.Ok(View(updated!));
    }

    /// <summary>
    /// POST .../revisions/{revisionId}/withdraw: its author or Document Control takes a revision out of its review to
    /// edit it. The review closes as withdrawn, comments kept, everyone on it told; the revision is in preparation again.
    /// </summary>
    private static async Task<IResult> WithdrawAsync(
        Guid documentId, Guid revisionId, StartRevisionRequest request, HttpContext http, DeliosDbContext db,
        Reviews.ReviewService reviews, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var revision = await db.Revisions.AsNoTracking().SingleOrDefaultAsync(r => r.Id == revisionId && r.DocumentId == documentId, cancellationToken);
        if (revision is null) return Problems.NotFound("REVISION_NOT_FOUND", "No such revision.");
        if (revision.AuthoredById != access.UserId && !access.Holds(Verbs.Control))
            return Problems.Forbidden("AUTHOR_OR_CONTROL", "Its author or Document Control takes a revision out of review.");
        if (revision.State != RevisionStates.InReview)
            return Problems.Conflict("NOT_IN_REVIEW", $"Revision {revision.Value} is not in review.");
        var reason = request.ChangeDescription?.Trim() ?? "";
        if (reason.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it is taken out of review: everyone on the route is told.");
        if (await reviews.WithdrawForUpdateAsync(access, revisionId, reason, cancellationToken) is { } refused) return refused;
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>POST .../revisions/{revisionId}/files: attaches files to a revision still in preparation.</summary>
    private static async Task<IResult> AttachAsync(
        Guid documentId, Guid revisionId, StartRevisionRequest request, HttpContext http, DocumentService documents,
        CancellationToken cancellationToken)
    {
        var (revision, problem) = await documents.AttachAsync(ProjectAccessFilter.Of(http), documentId, revisionId, request,
            cancellationToken);
        return problem ?? Results.Ok(View(revision!));
    }

    /// <summary>
    /// GET /files/{fileId}/download: returns a short-lived download link for a file that passed scanning,
    /// if the caller may see its document. Every download is written to the audit trail.
    /// </summary>
    private static async Task<IResult> DownloadAsync(
        Guid fileId, HttpContext http, DeliosDbContext db, DocumentService documents, Transmittals.TransmittalService transmittals,
        FileStorage storage, AuditLog audit, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Read)) return Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register.");
        var file = await db.StoredFiles.AsNoTracking()
            .SingleOrDefaultAsync(f => f.Id == fileId && f.ProjectId == access.Project.Id, cancellationToken);
        // A file of a document is read by whoever reads the document; one that came on a transmittal and belongs to
        // no document yet (an unplanned item, a covering letter), by whoever sees that transmittal.
        var visible = file is not null && (file.DocumentId is { } documentId
            ? await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(cancellationToken))
                .AnyAsync(d => d.Id == documentId, cancellationToken)
            : await transmittals.Visible(access).AnyAsync(t => t.ProofFileId == file.Id
                || t.Items.Any(i => i.Id == file.TransmittalItemId), cancellationToken));
        if (file is null || !visible) return Problems.NotFound("FILE_NOT_FOUND", "No such file.");
        if (file.Status != FileStatuses.Clean)
        {
            return Problems.Conflict("FILE_NOT_AVAILABLE", "The file can be downloaded only once it has passed scanning.",
                new { status = file.Status });
        }

        var (url, expires) = storage.PresignDownload(file.ObjectKey, file.Name);
        await audit.WriteAsync(http.User.Actor(), "DOWNLOAD", "StoredFile", file.Id, file.Name,
            projectId: access.Project.Id, cancellationToken: cancellationToken);
        return Results.Ok(new DownloadTicket(url, expires.ToDateTimeOffset()));
    }

    /// <summary>Turns a document entity (database row) into the shape the API returns.</summary>
    internal static DocumentView View(Document d) => new(
        d.Id, d.Number, d.Title, d.DeliverableType, d.DocType, d.Discipline, d.Originator, d.Subproject, d.ContractRef,
        d.Criticality, d.Confidentiality, d.RetentionClass, d.State, d.Kind, d.IsPlaceholder,
        d.ReceivedDate?.ToDateOnly(), d.PlannedDate?.ToDateOnly(), d.CreatedByName,
        d.CreatedAt.ToDateTimeOffset(), d.UpdatedAt.ToDateTimeOffset(), d.Revisions.Select(View).ToList(), d.CreatedById,
        d.LegalHold, d.LegalHoldReason, d.PreviousNumber, d.LegacyScheme, d.AppVersion,
        d.Extras is null ? null : System.Text.Json.JsonDocument.Parse(d.Extras).RootElement.Clone(), d.ConfirmedAt?.ToDateTimeOffset(),
        d.ConfirmedByName, d.CorrectsId, d.LegalHoldAt?.ToDateTimeOffset(), d.LegalHoldByName);

    /// <summary>Turns a revision entity, with its submissions and files, into the shape the API returns.</summary>
    private static RevisionView View(Revision r) => new(
        r.Id, r.Value, r.Series, r.State, r.FilesState, r.ReasonForRevision, r.ChangeDescription, r.AuthoredByName,
        r.CreatedAt.ToDateTimeOffset(), r.StatusCode, r.ReleasedAt?.ToDateTimeOffset(), r.SupersededAt?.ToDateTimeOffset(),
        r.ReturnedReason, r.Submission, r.ControlOutcome,
        r.Submissions.OrderBy(x => x.Number).Select(x => new SubmissionView(x.Number, x.SubmittedAt.ToDateTimeOffset(),
            x.SubmittedByName, x.Outcome, x.Note, x.DecidedByName, x.DecidedAt?.ToDateTimeOffset())).ToList(),
        r.Files.Select(f => new FileView(f.Id, f.Name, f.Kind, f.ContentType, f.Size, f.Sha256, f.Status,
            f.StatusDetail, f.DetectedType, f.CreatedAt.ToDateTimeOffset(), f.DerivedFromId, f.Submission)).ToList(),
        r.AuthoredById, r.AuthoredByParty, r.ReleasedByName, r.ReturnedAt?.ToDateTimeOffset(), r.HeldAt?.ToDateTimeOffset(), r.HeldReason,
        r.HeldByName, r.VoidedAt?.ToDateTimeOffset(), r.VoidReason, r.VoidAuthority, r.VoidReassessment);
}
