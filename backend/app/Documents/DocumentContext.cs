using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Actions;
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
        Guid documentId, HttpContext http, DeliosDbContext db, DocumentService documents, Transmittals.TransmittalService sending,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Read)) return Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register.");
        var seen = await DocumentQueries.Visible(db, access).Where(d => d.Id == documentId).Select(d => new { d.Originator }).SingleOrDefaultAsync(cancellationToken);
        if (seen is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        // Another organization reads, of one of our documents, only what was sent to it: those revisions, the transmittals
        // it may open, the packages shared with it, and no review but one it answers (OutsideReading).
        var whole = OutsideReading.Whole(access, seen.Originator);
        var readable = await OutsideReading.RevisionsAsync(db, access, documentId, seen.Originator, cancellationToken);

        var revisionIds = await db.Revisions.Where(r => r.DocumentId == documentId).Select(r => r.Id).ToListAsync(cancellationToken);
        if (readable is not null) revisionIds = revisionIds.Where(readable.Contains).ToList();
        var reviews = await (from r in OutsideReading.Reviews(db, access, db.Reviews)
                             join v in db.Revisions on r.RevisionId equals v.Id
                             where r.DocumentId == documentId
                             orderby r.StartedAt descending
                             select new { r.Id, r.Number, r.RevisionId, Revision = v.Value, r.RouteName, r.State, r.Verdict, r.GrantedStatus, r.StartedAt, r.DecidedAt })
            .AsNoTracking().ToListAsync(cancellationToken);
        var transmittals = await (from i in db.TransmittalItems
                                  join t in db.Transmittals on i.TransmittalId equals t.Id
                                  where i.DocumentId == documentId
                                  orderby t.IssuedAt descending
                                  select new
                                  {
                                      t.Id,
                                      t.Number,
                                      t.Reason,
                                      t.ToName,
                                      t.IssuedAt,
                                      Revision = i.RevisionValue,
                                      ForReview = t.ReviewStepId != null,
                                      t.Direction,
                                      i.RevisionId,
                                      t.FromName,
                                      ItemKind = i.Kind
                                  })
            .AsNoTracking().ToListAsync(cancellationToken);
        var packages = await (from m in db.PackageMembers
                              join p in db.Packages on m.PackageId equals p.Id
                              where m.DocumentId == documentId
                              orderby p.Number
                              select new
                              {
                                  p.Id,
                                  p.Number,
                                  p.Title,
                                  p.State,
                                  p.Kind,
                                  Required = m.RequiredStatuses.Length > 0 ? m.RequiredStatuses : p.RequiredStatuses,
                                  p.RecipientPartyIds,
                                  p.SupplierPartyId,
                                  Shared = p.SharedAt != null
                              }).AsNoTracking().ToListAsync(cancellationToken);
        var partyNames = await db.Parties.AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);
        var transmittalIds = transmittals.Select(t => t.Id).Distinct().ToList();
        // The reader opens only the transmittals they may see; the others are listed, not linked (to our own people).
        var mayOpen = (await sending.Visible(access).Where(t => transmittalIds.Contains(t.Id)).Select(t => t.Id).ToListAsync(cancellationToken)).ToHashSet();
        if (!access.IsInternal)
        {
            // Another organization: only the transmittals it may open, and the supplier packages shared with it.
            transmittals = transmittals.Where(t => mayOpen.Contains(t.Id)).ToList();
            transmittalIds = transmittalIds.Where(mayOpen.Contains).ToList();
            var code = access.PartyCode ?? "\u0000";
            var mine = (await db.Parties.AsNoTracking().Where(p => p.Code == code).Select(p => p.Id).ToListAsync(cancellationToken)).ToHashSet();
            packages = packages.Where(p => p.Kind == Packages.PackageKinds.Supply && p.Shared && p.SupplierPartyId is { } s && mine.Contains(s)).ToList();
        }
        var recipients = (await db.TransmittalRecipients.AsNoTracking().Where(r => transmittalIds.Contains(r.TransmittalId))
            .Select(r => new { r.TransmittalId, r.Name, r.Organization, Person = r.UserId != null, r.OpenedAt, r.AcknowledgedAt, r.DispatchedAt })
            .ToListAsync(cancellationToken)).ToLookup(r => r.TransmittalId);
        var activities = await (from n in db.Requirements
                                join a in db.Activities on n.ActivityId equals a.Id
                                where n.DocumentId == documentId && a.State == ActivityStates.Active
                                orderby n.NeededBy
                                select new { ActivityId = a.Id, a.Code, a.Name, n.Purpose, n.NeededBy, n.State, n.WaiverNote, NeedId = n.Id, n.RequiredStatuses, a.Start })
            .AsNoTracking().ToListAsync(cancellationToken);
        // The document's own events and its revisions'. Another organization sees what happened, not who did it inside.
        // One list of the items it is about, read by its index (entity, id).
        var about = whole ? revisionIds.Append(documentId).ToList() : revisionIds.ToList();
        var history = await db.AuditEvents.AsNoTracking()
            .Where(e => e.EntityId != null && about.Contains(e.EntityId.Value))
            .OrderByDescending(e => e.Id).Take(200)
            .Select(e => new { e.At, Actor = access.IsInternal ? e.ActorName : null, e.Action, e.EntityType, e.EntityId, e.EntityLabel, e.Detail })
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
            transmittals = transmittals.Select(t => new
            {
                t.Id,
                t.Number,
                t.Reason,
                t.ToName,
                IssuedAt = t.IssuedAt.ToDateTimeOffset(),
                t.Revision,
                t.ForReview,
                t.Direction,
                t.RevisionId,
                t.FromName,
                t.ItemKind,
                MayOpen = mayOpen.Contains(t.Id),
                Recipients = recipients[t.Id].Select(r => new
                {
                    r.Name,
                    r.Organization,
                    r.Person,
                    OpenedAt = r.OpenedAt?.ToDateTimeOffset(),
                    AcknowledgedAt = r.AcknowledgedAt?.ToDateTimeOffset(),
                    DispatchedAt = r.DispatchedAt?.ToDateTimeOffset()
                }),
            }),
            packages = packages.Select(p => new
            {
                p.Id,
                p.Number,
                p.Title,
                p.State,
                p.Kind,
                Required = p.Required,
                To = p.SupplierPartyId is { } supplier ? partyNames.GetValueOrDefault(supplier)
                    : string.Join(", ", p.RecipientPartyIds.Select(id => partyNames.GetValueOrDefault(id)).Where(n => n != null)),
            }),
            activities = activities.Select(a => new
            {
                a.ActivityId,
                a.Code,
                a.Name,
                a.Purpose,
                NeededBy = a.NeededBy?.ToDateOnly(),
                a.State,
                a.WaiverNote,
                a.NeedId,
                a.RequiredStatuses,
                Start = a.Start?.ToDateOnly()
            }),
            history = history.Select(e => new { At = e.At.ToDateTimeOffset(), e.Actor, e.Action, e.EntityType, e.EntityId, e.EntityLabel, e.Detail }),
        });
    }
}
