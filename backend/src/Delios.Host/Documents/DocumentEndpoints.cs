using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

public static class DocumentEndpoints
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 200;

    public static void MapDocumentEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Documents")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();

        project.MapGet("/documents", ListAsync);
        project.MapGet("/documents/{documentId:guid}", GetAsync);
        project.MapPost("/documents", RegisterAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapPost("/documents/{documentId:guid}/uploads", RequestUploadAsync);
        project.MapPost("/documents/{documentId:guid}/revisions", StartRevisionAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapGet("/files/{fileId:guid}/download", DownloadAsync);
    }

    private static async Task<IResult> ListAsync(
        HttpContext http, DeliosDbContext db, DocumentService documents, CancellationToken cancellationToken,
        string? after = null, int? limit = null, string? q = null,
        string? discipline = null, string? docType = null, string? state = null, string? originator = null)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Read)) return Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register.");
        var size = Math.Clamp(limit ?? DefaultPageSize, 1, MaxPageSize);

        var query = DocumentQueries.Visible(db, access, await documents.RestrictedAsync(cancellationToken)).AsNoTracking();
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

        var rows = await query.OrderBy(d => d.Number).Take(size + 1)
            .Select(d => new DocumentSummary(d.Id, d.Number, d.Title, d.DeliverableType, d.DocType, d.Discipline,
                d.Originator, d.State, d.Kind, d.IsPlaceholder, d.Confidentiality, d.LatestRevisionValue,
                d.LatestRevisionState, d.UpdatedAt.ToDateTimeOffset()))
            .ToListAsync(cancellationToken);
        var next = rows.Count > size ? rows[size - 1].Number : null;
        return Results.Ok(new DocumentPage(rows.Take(size).ToList(), next));
    }

    private static async Task<IResult> GetAsync(
        Guid documentId, HttpContext http, DeliosDbContext db, DocumentService documents, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Read)) return Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register.");
        var document = await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(cancellationToken))
            .AsNoTracking()
            .Include(d => d.Revisions.OrderBy(r => r.CreatedAt)).ThenInclude(r => r.Files.OrderBy(f => f.Name))
            .SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
        return document is null ? Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.") : Results.Ok(View(document));
    }

    private static async Task<IResult> RegisterAsync(
        RegisterDocumentRequest request, HttpContext http, DocumentService documents, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (document, problem) = await documents.RegisterAsync(access, request, cancellationToken);
        return problem ?? Results.Created($"/api/projects/{access.Project.Id}/documents/{document!.Id}", View(document));
    }

    private static async Task<IResult> RequestUploadAsync(
        Guid documentId, UploadRequest request, HttpContext http, DocumentService documents, CancellationToken cancellationToken)
    {
        var (ticket, problem) = await documents.RequestUploadAsync(ProjectAccessFilter.Of(http), documentId, request, cancellationToken);
        return problem ?? Results.Ok(ticket);
    }

    private static async Task<IResult> StartRevisionAsync(
        Guid documentId, StartRevisionRequest request, HttpContext http, DocumentService documents,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (revision, problem) = await documents.StartRevisionAsync(access, documentId, request, cancellationToken);
        return problem ?? Results.Created(
            $"/api/projects/{access.Project.Id}/documents/{documentId}", View(revision!));
    }

    private static async Task<IResult> DownloadAsync(
        Guid fileId, HttpContext http, DeliosDbContext db, DocumentService documents, FileStorage storage, AuditLog audit,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Read)) return Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register.");
        var file = await db.StoredFiles.AsNoTracking()
            .SingleOrDefaultAsync(f => f.Id == fileId && f.ProjectId == access.Project.Id, cancellationToken);
        var visible = file is not null && await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(cancellationToken))
            .AnyAsync(d => d.Id == file.DocumentId, cancellationToken);
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

    private static DocumentView View(Document d) => new(
        d.Id, d.Number, d.Title, d.DeliverableType, d.DocType, d.Discipline, d.Originator, d.Subproject, d.ContractRef,
        d.Criticality, d.Confidentiality, d.RetentionClass, d.State, d.Kind, d.IsPlaceholder,
        d.ReceivedDate?.ToDateOnly(), d.PlannedDate?.ToDateOnly(), d.CreatedByName,
        d.CreatedAt.ToDateTimeOffset(), d.UpdatedAt.ToDateTimeOffset(), d.Revisions.Select(View).ToList());

    private static RevisionView View(Revision r) => new(
        r.Id, r.Value, r.Series, r.State, r.FilesState, r.ReasonForRevision, r.ChangeDescription, r.AuthoredByName,
        r.CreatedAt.ToDateTimeOffset(),
        r.Files.Select(f => new FileView(f.Id, f.Name, f.Kind, f.ContentType, f.Size, f.Sha256, f.Status,
            f.StatusDetail, f.DetectedType, f.CreatedAt.ToDateTimeOffset())).ToList());
}
