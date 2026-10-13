using System.Text.Json;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Actions;

/// <summary>One of a supplier's documents an action needs: when by, at what status, and where it stands.</summary>
public sealed record SupplierNeed(Guid DocumentId, string Number, string Title, DateOnly? NeededBy, IReadOnlyList<string> RequiredStatuses,
    string? Revision, string? Stage, bool HasReleased, bool? WithSupplier, int? RiskDays);

/// <summary>An action that needs a supplier's documents, with only those documents. A postponed one has no date to show.</summary>
public sealed record SupplierAction(string Code, string Name, DateOnly? Start, DateOnly? Finish, bool DateToConfirm,
    IReadOnlyList<SupplierNeed> Needs);

/// <summary>
/// What a supplier sees of our schedule: the actions that need its documents (those asked of it or exchanged with it),
/// and in each only its own documents, with where each stands. Nothing else of the plan: no other documents, no
/// disciplines, confirmations, notices, or why an action moved or was postponed.
/// </summary>
public static class SupplierSchedule
{
    /// <summary>Maps <c>GET /api/projects/{projectId}/supplier-schedule</c>, for another organization's people.</summary>
    public static void MapSupplierSchedule(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Schedule")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("/supplier-schedule", ReadAsync);
    }

    private static async Task<IResult> ReadAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (access.IsInternal || access.PartyCode is not { } code)
            return Problems.Forbidden("SUPPLIERS_ONLY", "This is what a supplier sees of the schedule; our own people read the schedule itself.");
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        // Its own documents it may see: asked of it, or sent by it.
        var documents = await DocumentQueries.Visible(db, access, catalog.RestrictedLevels())
            .Where(d => d.Originator == code)
            .Select(d => new { d.Id, d.Number, d.Title, d.LatestRevisionId, d.LatestRevisionValue, d.WithSupplier })
            .ToListAsync(cancellationToken);
        var ids = documents.Select(d => d.Id).ToList();
        var needs = await (from n in db.Requirements
                           join a in db.Activities on n.ActivityId equals a.Id
                           where a.ProjectId == access.Project.Id && a.State == ActivityStates.Active && ids.Contains(n.DocumentId)
                           select new { n.ActivityId, a.Code, a.Name, a.Start, a.Finish, n.DocumentId, n.NeededBy, n.RequiredStatuses, n.RiskDays })
            .AsNoTracking().ToListAsync(cancellationToken);
        var latestIds = documents.Where(d => d.LatestRevisionId != null).Select(d => d.LatestRevisionId!.Value).ToList();
        var latest = await db.Revisions.AsNoTracking().Where(r => latestIds.Contains(r.Id))
            .Select(r => new { r.Id, r.State, r.ResentAt, r.ReturnedAt }).ToDictionaryAsync(r => r.Id, cancellationToken);
        var released = (await db.Revisions.AsNoTracking()
            .Where(r => ids.Contains(r.DocumentId) && r.State == RevisionStates.Released).Select(r => r.DocumentId).ToListAsync(cancellationToken)).ToHashSet();
        var asked = (await db.TransmittalItems.AsNoTracking()
            .Where(i => i.DocumentId != null && ids.Contains(i.DocumentId.Value) && i.Kind == TransmittalItemKinds.Placeholder)
            .Select(i => i.DocumentId!.Value).Distinct().ToListAsync(cancellationToken)).ToHashSet();
        // Postponed: a decision that does not proceed, not taken back. Shown as a date to be confirmed, never why.
        var activityIds = needs.Select(n => n.ActivityId).Distinct().ToList();
        var decisions = await db.ActivityDecisions.AsNoTracking()
            .Where(d => activityIds.Contains(d.ActivityId) && d.ReversedAt == null).Select(d => new { d.ActivityId, d.Decision })
            .ToListAsync(cancellationToken);
        var postponed = decisions.Where(d => catalog.Prop(ScheduleSets.Decisions, d.Decision, "proceeds") is not { ValueKind: JsonValueKind.True })
            .Select(d => d.ActivityId).ToHashSet();
        var byId = documents.ToDictionary(d => d.Id);

        var actions = needs.GroupBy(n => n.ActivityId).Select(g =>
        {
            var first = g.First();
            var later = postponed.Contains(g.Key);
            return new SupplierAction(first.Code, first.Name, later ? null : first.Start?.ToDateOnly(), later ? null : first.Finish?.ToDateOnly(), later,
                g.OrderBy(n => n.NeededBy).Select(n =>
                {
                    var d = byId[n.DocumentId];
                    var rev = d.LatestRevisionId is { } id && latest.TryGetValue(id, out var r) ? r : null;
                    return new SupplierNeed(d.Id, d.Number, d.Title, later ? null : n.NeededBy?.ToDateOnly(), n.RequiredStatuses, d.LatestRevisionValue,
                        RegisterEndpoints.SupplierStage(asked.Contains(d.Id), rev?.State, rev?.ResentAt, rev?.ReturnedAt),
                        released.Contains(d.Id), d.WithSupplier, n.RiskDays);
                }).ToList());
        }).OrderBy(a => a.Start ?? DateOnly.MaxValue).ThenBy(a => a.Code).ToList();
        return Results.Ok(actions);
    }
}
