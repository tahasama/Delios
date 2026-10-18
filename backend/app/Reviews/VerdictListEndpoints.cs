using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Settings;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Reviews;

/// <summary>A set of the review outcomes as the routes read it: its verdicts with their meaning, and the routes deciding from it.</summary>
public sealed record VerdictListView(string Key, string Title, string? Description, bool Starter,
    IReadOnlyList<VerdictView> Verdicts, IReadOnlyList<string> Routes);

public sealed record VerdictView(string Code, string Label, string Status, string? Meaning);

/// <summary>
/// The verdicts are one list, the review outcomes, kept in Types &amp; sets like any list (owner): its sets are what a verdict
/// list was. Every verdict says which of the four meanings it has (accepted, accepted with comments, rejected, for
/// information), and every set in use keeps one that lets a revision go on to release (`ProjectLists`). The app reads the
/// meaning, never the code. A route decides from the set it names, else from the set serving the document's deliverable type.
/// </summary>
public static class VerdictListEndpoints
{
    /// <summary>The four meanings, as the props the review reads (<see cref="ReviewSets.Proceeds"/>).</summary>
    public static readonly IReadOnlyDictionary<string, (bool Proceed, bool Resubmit, bool Information)> Meanings =
        new Dictionary<string, (bool, bool, bool)>
        {
            ["FINAL"] = (true, false, false),
            ["FINAL_FIX_NEXT"] = (true, true, false),
            ["RETURN"] = (false, true, false),
            ["INFORMATION"] = (true, false, true),
        };

    /// <summary>The meaning a value's props say, or null when they say none.</summary>
    public static string? MeaningOf(JsonDocument? props)
    {
        if (props?.RootElement is not { ValueKind: JsonValueKind.Object } root || !root.TryGetProperty("proceed", out var proceed)
            || proceed.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return null;
        bool Flag(string name) => root.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.True;
        if (!proceed.GetBoolean()) return "RETURN";
        if (Flag("information")) return "INFORMATION";
        return Flag("resubmit") ? "FINAL_FIX_NEXT" : "FINAL";
    }

    public static void MapVerdictListEndpoints(this IEndpointRouteBuilder app)
    {
        // Whoever keeps the review routes reads them, to choose a route's set.
        app.MapGroup("/api/admin/verdict-lists").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Filter).MapGet("", ListAsync);
    }

    /// <summary><c>GET /api/admin/verdict-lists</c>: each set of the review outcomes, its verdicts, and the routes naming it.</summary>
    private static async Task<IResult> ListAsync(DeliosDbContext db, CancellationToken c)
    {
        var routes = await db.ReviewRoutes.AsNoTracking().Select(r => new { r.Name, r.Verdicts, r.Active }).ToListAsync(c);
        var sets = await db.ListSets.AsNoTracking().Where(s => s.ListKey == ReviewSets.Verdicts).OrderBy(s => s.Sort).ThenBy(s => s.Name).ToListAsync(c);
        var defaultId = sets.FirstOrDefault(s => s.IsDefault)?.Id;
        var values = await db.ValueEntries.AsNoTracking().Where(v => v.SetKey == ReviewSets.Verdicts).OrderBy(v => v.Sort).ToListAsync(c);
        return Results.Ok(sets.Select(set => new VerdictListView(set.Name, set.Name, set.DeliverableTypes.Length > 0 ? string.Join(", ", set.DeliverableTypes) : null,
            set.IsDefault,
            [.. values.Where(v => (v.SetId ?? defaultId) == set.Id).Select(v => new VerdictView(v.Code, v.Label, v.Status, MeaningOf(v.Props)))],
            [.. routes.Where(r => r.Verdicts == set.Name).Select(r => r.Active ? r.Name : $"{r.Name} (out of use)")])));
    }
}
