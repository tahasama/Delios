using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Schedules;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

/// <summary>
/// Everything around one document that its page shows beside the document itself:
/// the reviews of its revisions, the transmittals that carried them, the packages
/// and activities it belongs to, and its history from the audit trail.
/// </summary>
public static class DocumentContextEndpoints
{
    public static void MapDocumentContextEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Documents")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("/documents/{documentId:guid}/context", ContextAsync);
    }

    /// <summary><c>GET /documents/{id}/context</c>: reviews, transmittals, packages, activities and history, for a document the caller may read.</summary>
    private static async Task<IResult> ContextAsync(
        Guid documentId, HttpContext http, DeliosDbContext db, DocumentService documents, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Read)) return Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register.");
        var restricted = await documents.RestrictedAsync(cancellationToken);
        if (!await DocumentQueries.Visible(db, access, restricted).AnyAsync(d => d.Id == documentId, cancellationToken))
            return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");

        var revisionIds = await db.Revisions.Where(r => r.DocumentId == documentId).Select(r => r.Id).ToListAsync(cancellationToken);
        var reviews = await (from r in db.Reviews
                             join v in db.Revisions on r.RevisionId equals v.Id
                             where r.DocumentId == documentId
                             orderby r.StartedAt descending
                             select new { r.Id, r.Number, r.RevisionId, Revision = v.Value, r.RouteName, r.State, r.Verdict, r.GrantedStatus, r.StartedAt, r.DecidedAt })
            .AsNoTracking().ToListAsync(cancellationToken);
        var transmittals = await (from i in db.TransmittalItems
                                  join t in db.Transmittals on i.TransmittalId equals t.Id
                                  where i.DocumentId == documentId
                                  orderby t.IssuedAt descending
                                  select new { t.Id, t.Number, t.Reason, t.ToName, t.IssuedAt, Revision = i.RevisionValue, ForReview = t.ReviewStepId != null })
            .AsNoTracking().ToListAsync(cancellationToken);
        var packages = await (from m in db.PackageMembers
                              join p in db.Packages on m.PackageId equals p.Id
                              where m.DocumentId == documentId
                              orderby p.Number
                              select new { p.Id, p.Number, p.Title, p.State }).AsNoTracking().ToListAsync(cancellationToken);
        var activities = await (from n in db.Requirements
                                join a in db.Activities on n.ActivityId equals a.Id
                                where n.DocumentId == documentId && a.State == ActivityStates.Active
                                orderby n.NeededBy
                                select new { ActivityId = a.Id, a.Code, a.Name, n.Purpose, n.NeededBy, n.State, n.WaiverNote })
            .AsNoTracking().ToListAsync(cancellationToken);
        // The document's own events and its revisions'. Another organization sees what happened, not who did it inside.
        var history = await db.AuditEvents.AsNoTracking()
            .Where(e => e.EntityId == documentId || (e.EntityId != null && revisionIds.Contains(e.EntityId.Value)))
            .OrderByDescending(e => e.Id).Take(200)
            .Select(e => new { e.At, Actor = access.IsInternal ? e.ActorName : null, e.Action, e.EntityType, e.EntityLabel, e.Detail })
            .ToListAsync(cancellationToken);
        return Results.Ok(new
        {
            reviews = reviews.Select(r => new
            {
                r.Id,
                r.Number,
                r.RevisionId,
                r.Revision,
                r.RouteName,
                r.State,
                r.Verdict,
                r.GrantedStatus,
                StartedAt = r.StartedAt.ToDateTimeOffset(),
                DecidedAt = r.DecidedAt?.ToDateTimeOffset()
            }),
            transmittals = transmittals.Select(t => new { t.Id, t.Number, t.Reason, t.ToName, IssuedAt = t.IssuedAt.ToDateTimeOffset(), t.Revision, t.ForReview }),
            packages,
            activities = activities.Select(a => new { a.ActivityId, a.Code, a.Name, a.Purpose, NeededBy = a.NeededBy?.ToDateOnly(), a.State, a.WaiverNote }),
            history = history.Select(e => new { At = e.At.ToDateTimeOffset(), e.Actor, e.Action, e.EntityType, e.EntityLabel, e.Detail }),
        });
    }
}
