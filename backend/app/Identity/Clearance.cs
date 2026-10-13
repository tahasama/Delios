using System.Text.Json;
using Delios.Host.Documents;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Identity;

/// <summary>
/// A function's clearance: the highest confidentiality level its holders read without being named on the document.
/// A document above it is read only by the people named on it, whoever registered it, and whoever it was sent to.
/// No clearance means no limit. The levels are ordered by their <c>level</c> property, else by their order in the list.
/// </summary>
public static class Clearance
{
    /// <summary>Each confidentiality code, retired ones too, with its rank: higher is more confidential.</summary>
    public static async Task<IReadOnlyDictionary<string, int>> RanksAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var values = await db.ValueEntries.AsNoTracking().Where(v => v.SetKey == ValueSets.Confidentiality)
            .OrderBy(v => v.Sort).ThenBy(v => v.Code).ToListAsync(cancellationToken);
        var ranks = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < values.Count; i++)
        {
            var level = values[i].Props?.RootElement.TryGetProperty("level", out var l) == true && l.ValueKind == JsonValueKind.Number
                ? l.GetInt32() * 1000 : i;
            ranks[values[i].Code] = level;
        }
        return ranks;
    }

    /// <summary>The confidentiality codes above a clearance; none when there is no clearance or it is not a known level.</summary>
    public static IReadOnlyList<string> Above(IReadOnlyDictionary<string, int> ranks, string? clearance) =>
        clearance is not null && ranks.TryGetValue(clearance, out var ceiling)
            ? ranks.Where(r => r.Value > ceiling).Select(r => r.Key).ToList()
            : [];

    /// <summary>Whether a clearance reaches a document's confidentiality.</summary>
    public static bool Reaches(IReadOnlyDictionary<string, int> ranks, string? clearance, string? confidentiality) =>
        confidentiality is null || !Above(ranks, clearance).Contains(confidentiality);
}
