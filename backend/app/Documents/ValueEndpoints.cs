using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

/// <summary>
/// The organization's published lists, for the screens' dropdowns and notes:
/// <c>GET /api/values?sets=DISCIPLINES,CONTROL_OUTCOMES</c>. Read-only; every
/// signed-in person reads their own organization's lists.
/// </summary>
public static class ValueEndpoints
{
    public static void MapValueEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/values", ValuesAsync).WithTags("Values").AddEndpointFilter<TransactionFilter>();
        app.MapGet("/api/values/serving", ServingAsync).WithTags("Values").AddEndpointFilter<TransactionFilter>();
        app.MapGet("/api/parties", PartiesAsync).WithTags("Values").AddEndpointFilter<TransactionFilter>();
    }

    /// <summary><c>GET /api/parties</c>: the organization's active outside parties (suppliers, client…), for pickers.</summary>
    /// Another organization's people (a guest, or an account standing for a collaborator's) read only their own: who else
    /// we work with is ours.
    private static async Task<IResult> PartiesAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var me = http.User.UserId();
        var mine = await db.Users.AsNoTracking().Where(u => u.Id == me)
            .Select(u => new { u.HomeTenantId, u.PartyId, Outside = u.Party != null && !u.Party.IsInternal }).SingleOrDefaultAsync(cancellationToken);
        var query = db.Parties.AsNoTracking().Where(p => p.Active && !p.IsInternal);
        if (mine is null) return Results.Ok(Array.Empty<object>());
        if (mine.HomeTenantId is not null || mine.Outside) query = query.Where(p => p.Id == mine.PartyId);
        return Results.Ok(await query.OrderBy(p => p.Name).Select(p => new { p.Code, p.Name, p.Participation }).ToListAsync(cancellationToken));
    }

    /// <summary>
    /// <c>GET /api/values/serving?sets=CRITICALITY,…</c>: for each list named, the set serving each deliverable type
    /// (`ListRules.Serving`; null: none, nothing is offered), its default set, and whether it holds more than one set. A
    /// form offers a document the values whose set (none: the default) is the one serving its deliverable type.
    /// </summary>
    private static async Task<IResult> ServingAsync(DeliosDbContext db, CancellationToken cancellationToken, string? sets = null)
    {
        var names = (sets ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(100).ToList();
        var all = await db.ListSets.AsNoTracking().Where(s => names.Contains(s.ListKey)).ToListAsync(cancellationToken);
        var types = await db.ValueEntries.AsNoTracking().Where(v => v.SetKey == ValueSets.DeliverableTypes).Select(v => v.Code).ToListAsync(cancellationToken);
        return Results.Ok(names.ToDictionary(n => n, n =>
        {
            var own = all.Where(s => s.ListKey == n).ToList();
            return new
            {
                defaultId = own.FirstOrDefault(s => s.IsDefault)?.Id,
                many = own.Count > 1,
                byType = types.ToDictionary(t => t, t => ListRules.Serving(own, t)?.Id),
            };
        }));
    }

    /// <summary>The values of each list named (up to 100), in their published order, retired ones marked.</summary>
    private static async Task<IResult> ValuesAsync(DeliosDbContext db, CancellationToken cancellationToken, string? sets = null)
    {
        var names = (sets ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(100).ToList();
        var values = await db.ValueEntries.AsNoTracking().Where(v => names.Contains(v.SetKey)).OrderBy(v => v.Sort).ToListAsync(cancellationToken);
        return Results.Ok(names.ToDictionary(n => n, n => values.Where(v => v.SetKey == n)
            .Select(v => new ListValue(v.Code, v.Label, v.Status, v.Props?.RootElement.Clone(), v.SetId)).ToList()));
    }
}
