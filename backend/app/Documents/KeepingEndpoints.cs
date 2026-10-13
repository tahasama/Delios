using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Settings;
using Delios.Host.Tenancy;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>The keeping URLs under <c>/api/projects/{projectId}</c>.</summary>
public static class KeepingEndpoints
{
    public static void MapKeepingEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Documents")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapPost("/documents/{documentId:guid}/revisions/{revisionId:guid}/void",
            async (Guid documentId, Guid revisionId, VoidRequest r, HttpContext h, KeepingService s, CancellationToken c) =>
            {
                var (revision, problem) = await s.VoidAsync(h, ProjectAccessFilter.Of(h), documentId, revisionId, r, c);
                return problem ?? Results.Ok(new { revision!.Id, revision.State, revision.VoidReason });
            });
        project.MapPost("/documents/{documentId:guid}/revisions/{revisionId:guid}/unvoid",
            async (Guid documentId, Guid revisionId, VoidRequest r, HttpContext h, KeepingService s, CancellationToken c) =>
            {
                var (revision, problem) = await s.UnvoidAsync(h, ProjectAccessFilter.Of(h), documentId, revisionId, r, c);
                return problem ?? Results.Ok(new { revision!.Id, revision.State });
            });
        project.MapPost("/revisions/{revisionId:guid}/reassessment",
            async (Guid revisionId, ReassessmentRequest r, HttpContext h, KeepingService s, CancellationToken c) =>
            {
                var (revision, problem) = await s.ReassessAsync(h, ProjectAccessFilter.Of(h), revisionId, r, c);
                return problem ?? Results.NoContent();
            });
        project.MapGet("/exposures/void", async (HttpContext h, KeepingService s, CancellationToken c) =>
            Results.Ok(await s.UnresolvedVoidsAsync(ProjectAccessFilter.Of(h), c)));
        project.MapGet("/exposures/untold", async (HttpContext h, Transmittals.Supersession s, CancellationToken c) =>
            Results.Ok(await s.UntoldAsync(ProjectAccessFilter.Of(h), c)));
        project.MapPost("/documents/{documentId:guid}/legal-hold",
            (Guid documentId, LegalHoldRequest r, HttpContext h, KeepingService s, CancellationToken c) =>
                s.LegalHoldAsync(h, ProjectAccessFilter.Of(h), documentId, r, c));
        project.MapPost("/documents/{documentId:guid}/send-to-supplier",
            (Guid documentId, SupplierNoteRequest r, HttpContext h, KeepingService s, CancellationToken c) =>
                s.SendToSupplierAsync(h, ProjectAccessFilter.Of(h), documentId, r, c));
        project.MapGet("/documents/{documentId:guid}/asks", async (Guid documentId, HttpContext h, KeepingService s, CancellationToken c) =>
            await s.AsksAsync(ProjectAccessFilter.Of(h), documentId, c) is { } rows ? Results.Ok(rows) : Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document."));
        project.MapPost("/documents/{documentId:guid}/asks",
            (Guid documentId, SupplierNoteRequest r, HttpContext h, KeepingService s, CancellationToken c) =>
                s.AskBackAsync(h, ProjectAccessFilter.Of(h), documentId, r, c));
        project.MapPost("/asks/{askId:guid}/answer",
            (Guid askId, AnswerAskRequest r, HttpContext h, KeepingService s, CancellationToken c) =>
                s.AnswerAskAsync(h, ProjectAccessFilter.Of(h), askId, r, c));
        project.MapGet("/documents/{documentId:guid}/readers", async (Guid documentId, HttpContext h, KeepingService s, CancellationToken c) =>
            await s.ReadersAsync(ProjectAccessFilter.Of(h), documentId, c) is { } rows ? Results.Ok(rows) : Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document."));
        project.MapPost("/documents/{documentId:guid}/readers",
            (Guid documentId, ReadersRequest r, HttpContext h, KeepingService s, CancellationToken c) =>
                s.AddReadersAsync(h, ProjectAccessFilter.Of(h), documentId, r, c));
        project.MapDelete("/document-readers/{accessId:guid}", async (Guid accessId, HttpContext h, DeliosDbContext db, KeepingService s, CancellationToken c) =>
        {
            var row = await db.DocumentAccess.AsNoTracking().SingleOrDefaultAsync(a => a.Id == accessId, c);
            return row is null ? Results.NoContent() : await s.RemoveReaderAsync(h, ProjectAccessFilter.Of(h), row.DocumentId, row.UserId, c);
        });
        project.MapDelete("/documents/{documentId:guid}/readers/{userId:guid}",
            (Guid documentId, Guid userId, HttpContext h, KeepingService s, CancellationToken c) =>
                s.RemoveReaderAsync(h, ProjectAccessFilter.Of(h), documentId, userId, c));
    }
}
