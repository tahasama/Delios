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
    // ── Routes ────────────────────────────────────────────────────────────────

    /// <summary>The routes that serve a document, most specific first; the default last.</summary>
    public async Task<IReadOnlyList<ReviewRoute>> RoutesForAsync(Document document, CancellationToken cancellationToken)
    {
        // The routes the project offers: its own copy, else the organization's.
        var scope = await CatalogAdminEndpoints.RouteScopeAsync(db, document.ProjectId, cancellationToken);
        var routes = await db.ReviewRoutes.AsNoTracking().Where(r => r.ProjectId == scope && r.Active).ToListAsync(cancellationToken);
        // A step naming a function and no people can come back with no list at all: read it as empty.
        foreach (var step in routes.SelectMany(r => r.Steps))
        {
            step.UserIds ??= [];
            step.GrantsStatuses ??= [];
        }
        return routes
            .Select(r => (Route: r, Score: Score(r, document)))
            .Where(x => x.Score >= 0)
            .OrderByDescending(x => x.Score).ThenBy(x => x.Route.IsDefault).ThenBy(x => x.Route.Name)
            .Select(x => x.Route).ToList();
    }

    /// <summary>-1 when the route does not serve the document; otherwise how many fields its best pattern pins.</summary>
    internal static int Score(ReviewRoute route, Document d)
    {
        if (route.Patterns.Count == 0) return route.IsDefault ? 0 : 0;
        var best = -1;
        foreach (var p in route.Patterns)
        {
            var fields = new[] { (p.DeliverableType, d.DeliverableType), (p.DocType, d.DocType), (p.Discipline, d.Discipline),
                (p.Criticality, d.Criticality), (p.Originator, d.Originator) };
            if (fields.Any(f => f.Item1 is not null && f.Item1 != f.Item2)) continue;
            best = Math.Max(best, fields.Count(f => f.Item1 is not null));
        }
        return best;
    }
}
