using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Extraction;

public sealed record ExtractionModeRequest(string? Mode);

/// <summary>
/// Asking for files to be read, and the organization's switch. Reading is asked
/// for a revision (a scanned archive somebody needs to search) or for the whole
/// project; with the switch on AUTOMATIC every new file is read once scanned.
/// </summary>
public static class ExtractionEndpoints
{
    public static void MapExtractionEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Extraction")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();
        project.MapPost("/revisions/{revisionId:guid}/extract", RevisionAsync);
        project.MapPost("/extract", ProjectAsync);

        var admin = app.MapGroup("/api/admin/projects/{projectId:guid}/extraction").WithTags("Administration")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(async (context, next) => context.HttpContext.User.IsAdmin()
                ? await next(context)
                : Problems.Forbidden("ADMIN_ONLY", "Only an administrator decides whether files are read."));
        admin.MapGet("", StatusAsync);
        admin.MapPut("", ModeAsync);
    }

    private static async Task<IResult> RevisionAsync(
        Guid revisionId, HttpContext http, DeliosDbContext db, DocumentService documents, IOptions<ExtractionOptions> options,
        AuditLog audit, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (await RefusedAsync(access, db, options.Value, cancellationToken) is { } refused) return refused;
        var revision = await db.Revisions.AsNoTracking().SingleOrDefaultAsync(r => r.Id == revisionId, cancellationToken);
        var visible = revision is not null && await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(cancellationToken))
            .AnyAsync(d => d.Id == revision.DocumentId, cancellationToken);
        if (revision is null || !visible) return Problems.NotFound("REVISION_NOT_FOUND", "No such revision.");

        var files = await db.StoredFiles.AsNoTracking()
            .Where(f => f.RevisionId == revisionId && f.Submission == revision.Submission && f.Status == FileStatuses.Clean
                && (f.Kind == FileKinds.Native || f.Kind == FileKinds.Rendition)
                && !db.FileTexts.Any(t => t.FileId == f.Id))
            .ToListAsync(cancellationToken);
        foreach (var file in files) ExtractionProcessor.Enqueue(db, file);
        await db.SaveChangesAsync(cancellationToken);
        if (files.Count > 0)
        {
            await audit.WriteAsync(http.User.Actor(), "EXTRACTION_REQUESTED", "Revision", revision.Id, $"rev {revision.Value}",
                $"{files.Count} file(s) to read.", access.Project.Id, cancellationToken);
        }
        return Results.Accepted(value: new { queued = files.Count });
    }

    /// <summary>Every file of the project not read yet: a scanned archive, brought into search at once.</summary>
    private static async Task<IResult> ProjectAsync(
        HttpContext http, DeliosDbContext db, IOptions<ExtractionOptions> options, AuditLog audit, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (await RefusedAsync(access, db, options.Value, cancellationToken) is { } refused) return refused;
        if (!access.Holds(Verbs.Control))
            return Problems.Forbidden("CONTROL_ONLY", "Reading a whole project is Document Control's to ask.");
        var files = await db.StoredFiles.AsNoTracking()
            .Where(f => f.ProjectId == access.Project.Id && f.RevisionId != null && f.Status == FileStatuses.Clean
                && (f.Kind == FileKinds.Native || f.Kind == FileKinds.Rendition)
                && !db.FileTexts.Any(t => t.FileId == f.Id))
            .ToListAsync(cancellationToken);
        foreach (var file in files) ExtractionProcessor.Enqueue(db, file);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "EXTRACTION_REQUESTED", "Project", access.Project.Id, access.Project.Code,
            $"{files.Count} file(s) to read.", access.Project.Id, cancellationToken);
        return Results.Accepted(value: new { queued = files.Count });
    }

    private static async Task<IResult?> RefusedAsync(
        ProjectAccess access, DeliosDbContext db, ExtractionOptions options, CancellationToken cancellationToken)
    {
        if (!access.IsInternal || !access.Holds(Verbs.Read))
            return Problems.Forbidden("EXTRACTION_NOT_ALLOWED", "Your function cannot ask for files to be read.");
        var mode = await db.Projects.Where(p => p.Id == access.Project.Id).Select(p => p.ContentExtraction).SingleAsync(cancellationToken);
        if (mode == ExtractionModes.Off)
            return Problems.Conflict("EXTRACTION_OFF", "Reading inside this project's files has not been allowed.");
        if (!options.Installed)
            return Problems.Conflict("EXTRACTION_NOT_INSTALLED", "The extraction service is not running on this server.");
        return null;
    }

    private static async Task<IResult> StatusAsync(
        Guid projectId, DeliosDbContext db, IOptions<ExtractionOptions> options, CancellationToken cancellationToken)
    {
        var project = await db.Projects.AsNoTracking().SingleOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return Problems.NotFound("PROJECT_NOT_FOUND", "No such project.");
        var read = await db.FileTexts.CountAsync(t => t.ProjectId == projectId, cancellationToken);
        return Results.Ok(new { mode = project.ContentExtraction, installed = options.Value.Installed, filesRead = read, modes = ExtractionModes.All });
    }

    /// <summary>
    /// The project's switch, set as its client asked. Turning it off deletes every
    /// text already read in the project, and the search index drops it on its next
    /// pass: off means nothing is kept.
    /// </summary>
    private static async Task<IResult> ModeAsync(
        Guid projectId, ExtractionModeRequest request, HttpContext http, DeliosDbContext db, IClock clock, AuditLog audit,
        CancellationToken cancellationToken)
    {
        if (request.Mode is not { } mode || !ExtractionModes.All.Contains(mode))
            return Problems.Invalid("MODE_INVALID", "OFF, ON_DEMAND or AUTOMATIC.", new { allowed = ExtractionModes.All });
        var project = await db.Projects.SingleOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return Problems.NotFound("PROJECT_NOT_FOUND", "No such project.");
        var purged = 0;
        if (mode == ExtractionModes.Off)
        {
            var documents = await db.FileTexts.Where(t => t.ProjectId == projectId).Select(t => t.DocumentId).Distinct()
                .ToListAsync(cancellationToken);
            purged = await db.FileTexts.Where(t => t.ProjectId == projectId).ExecuteDeleteAsync(cancellationToken);
            var now = clock.GetCurrentInstant();
            await db.Documents.Where(d => documents.Contains(d.Id))
                .ExecuteUpdateAsync(d => d.SetProperty(x => x.UpdatedAt, now), cancellationToken);
        }
        var before = project.ContentExtraction;
        project.ContentExtraction = mode;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "EXTRACTION_MODE_CHANGED", "Project", project.Id, project.Code,
            mode == ExtractionModes.Off ? $"From {before} to OFF; {purged} file text(s) deleted." : $"From {before} to {mode}.",
            project.Id, cancellationToken);
        return Results.Ok(new { mode, purged });
    }
}
