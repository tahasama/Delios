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
        app.MapGet("/api/parties", PartiesAsync).WithTags("Values").AddEndpointFilter<TransactionFilter>();
    }

    /// <summary><c>GET /api/parties</c>: the organization's active outside parties (suppliers, client…), for pickers.</summary>
    private static async Task<IResult> PartiesAsync(DeliosDbContext db, CancellationToken cancellationToken) =>
        Results.Ok(await db.Parties.AsNoTracking().Where(p => p.Active && !p.IsInternal).OrderBy(p => p.Name)
            .Select(p => new { p.Code, p.Name, p.Participation }).ToListAsync(cancellationToken));

    /// <summary>The values of each list named (up to 100), in their published order, retired ones marked.</summary>
    private static async Task<IResult> ValuesAsync(DeliosDbContext db, CancellationToken cancellationToken, string? sets = null)
    {
        var names = (sets ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(100).ToList();
        var values = await db.ValueEntries.AsNoTracking().Where(v => names.Contains(v.SetKey)).OrderBy(v => v.Sort).ToListAsync(cancellationToken);
        return Results.Ok(names.ToDictionary(n => n, n => values.Where(v => v.SetKey == n)
            .Select(v => new ListValue(v.Code, v.Label, v.Status, v.Props?.RootElement.Clone())).ToList()));
    }
}
