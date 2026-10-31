using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using NodaTime;

namespace Delios.Host.Audit;

/// <summary>
/// How many acts of each kind a trail holds (the Audit trail, a person's activity, Home's log), counted once and then only
/// the acts written since (owner: never the whole trail again on every page). The trail is only ever added to, so what
/// was counted stays true: each process keeps, per trail, the counts up to an act and counts the newer ones on each
/// reading, folding in those older than a few minutes (an act still being written commits within them; one whose
/// transaction ran longer than that would be missed until the count is made again, at most 15 minutes later). Kept under the
/// organization's number (<see cref="AccessVersions"/>): a change to how things work (what is kept, who may read)
/// counts it again whole.
/// </summary>
public sealed class AuditCounts(AccessVersions versions, IClock clock)
{
    /// <summary>Acts this recent are counted on every reading, never folded in: one may still be committing.</summary>
    private static readonly Duration Settling = Duration.FromMinutes(10);

    private sealed record Kept(long UpTo, Dictionary<string, int> Counts);

    /// <summary>
    /// The count of each act in <paramref name="trail"/>, a query that is the same for the same <paramref name="name"/>
    /// (no words, no dates: those are counted as asked).
    /// </summary>
    public async Task<Dictionary<string, int>> ByActionAsync(Guid tenantId, string name, IQueryable<AuditEvent> trail, CancellationToken cancellationToken)
    {
        var version = await versions.CurrentAsync(tenantId);
        if (version is null)
            return await trail.GroupBy(e => e.Action).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, cancellationToken);
        var key = $"audit-counts:{tenantId:N}:{version}:{name}";
        var kept = versions.Kept.TryGetValue(key, out Kept? found) && found is not null ? found : new Kept(0, []);
        var settled = clock.GetCurrentInstant() - Settling;
        var newer = await trail.Where(e => e.Id > kept.UpTo)
            .GroupBy(e => new { e.Action, Settled = e.At < settled })
            .Select(g => new { g.Key.Action, g.Key.Settled, N = g.Count(), Last = g.Max(e => e.Id) })
            .ToListAsync(cancellationToken);
        var counts = new Dictionary<string, int>(kept.Counts);
        foreach (var x in newer) counts[x.Action] = counts.GetValueOrDefault(x.Action) + x.N;
        // Folded in: the acts written before the last few minutes (ids follow the order acts are written).
        var settledOnes = newer.Where(x => x.Settled).ToList();
        if (settledOnes.Count > 0)
        {
            var folded = new Dictionary<string, int>(kept.Counts);
            foreach (var x in settledOnes) folded[x.Action] = folded.GetValueOrDefault(x.Action) + x.N;
            versions.Kept.Set(key, new Kept(settledOnes.Max(x => x.Last), folded), new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = Identity.ProjectAccessLoader.KeptAtMost,
                Size = 1,
            });
        }
        return counts;
    }
}
