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

/// <summary>One verdict as written: its code, its label, and which of the four meanings it has.</summary>
public sealed record VerdictRequest(string? Code, string? Label, string? Meaning, bool Retired = false);

/// <summary>Body of making or changing a verdict list. Verdicts named by a code already there change; new codes are added.</summary>
public sealed record VerdictListRequest(string? Title, string? Description = null, VerdictRequest[]? Verdicts = null);

/// <summary>A verdict list as Settings shows it: its verdicts with their meaning, and the routes deciding from it.</summary>
public sealed record VerdictListView(string Key, string Title, string? Description, bool Starter,
    IReadOnlyList<VerdictView> Verdicts, IReadOnlyList<string> Routes);

public sealed record VerdictView(string Code, string Label, string Status, string? Meaning);

/// <summary>
/// The verdict lists a route decides from (Settings, Verdict lists). A verdict list is made as one: every verdict says
/// which of the four meanings it has (accepted, accepted with comments, rejected, for information), and at least one
/// lets a revision go on to release. The app reads the meaning, never the code. The review outcomes list is the
/// starter one; the organization adds its own (for suppliers' documents, say), any codes and names.
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

    private const string SetPrefix = "SET:";
    private const string Kind = "VERDICTS";

    public static void MapVerdictListEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/admin/verdict-lists").WithTags("Administration")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("Only an administrator publishes the organization's verdict lists."));
        // Whoever keeps the review routes reads them, to choose a route's list.
        app.MapGroup("/api/admin/verdict-lists").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Filter).MapGet("", ListAsync);
        admin.MapPost("", CreateAsync);
        admin.MapPut("/{key}", UpdateAsync);
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>What the organization said of each list it named (Settings key SET:&lt;key&gt;): its title, and whether it is verdicts.</summary>
    private static async Task<Dictionary<string, (string? Title, string? Description, bool Verdicts)>> NamedAsync(DeliosDbContext db, CancellationToken c)
    {
        var rows = await db.Settings.AsNoTracking().Where(s => s.ProjectId == null && s.Key.StartsWith(SetPrefix)).ToListAsync(c);
        var named = new Dictionary<string, (string?, string?, bool)>();
        foreach (var row in rows)
        {
            try
            {
                using var json = JsonDocument.Parse(row.Value);
                var root = json.RootElement;
                string? Text(string name) => root.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
                named[row.Key[SetPrefix.Length..]] = (Text("title"), Text("description"), Text("kind") == Kind);
            }
            catch (JsonException) { }
        }
        return named;
    }

    /// <summary><c>GET /api/admin/verdict-lists</c>: the review outcomes, every list made as verdicts, and any a route decides from.</summary>
    private static async Task<IResult> ListAsync(DeliosDbContext db, CancellationToken c)
    {
        var named = await NamedAsync(db, c);
        var routes = await db.ReviewRoutes.AsNoTracking().Select(r => new { r.Name, Set = r.VerdictSet ?? ReviewSets.Verdicts, r.Active }).ToListAsync(c);
        var keys = new HashSet<string> { ReviewSets.Verdicts };
        keys.UnionWith(named.Where(n => n.Value.Verdicts).Select(n => n.Key));
        keys.UnionWith(routes.Select(r => r.Set));
        var values = await db.ValueEntries.AsNoTracking().Where(v => keys.Contains(v.SetKey)).OrderBy(v => v.Sort).ToListAsync(c);
        return Results.Ok(keys.OrderBy(k => k == ReviewSets.Verdicts ? 0 : 1).ThenBy(k => k).Select(key =>
        {
            var info = named.GetValueOrDefault(key);
            return new VerdictListView(key, info.Title ?? (key == ReviewSets.Verdicts ? "Review outcomes" : key), info.Description,
                key == ReviewSets.Verdicts,
                [.. values.Where(v => v.SetKey == key).Select(v => new VerdictView(v.Code, v.Label, v.Status, MeaningOf(v.Props)))],
                [.. routes.Where(r => r.Set == key).Select(r => r.Active ? r.Name : $"{r.Name} (out of use)")]);
        }));
    }

    /// <summary>The verdicts as given, checked: codes, labels and a meaning each; refused with why.</summary>
    private static IResult? Check(VerdictRequest[] verdicts, IEnumerable<(string Code, string? Meaning, bool Active)> kept)
    {
        foreach (var v in verdicts)
        {
            var code = Blank(v.Code);
            var label = Blank(v.Label) ?? code;
            if (code is null) return Problems.Invalid("CODE_REQUIRED", "Each verdict has a code.");
            if (code.Length > 64) return Problems.Invalid("CODE_TOO_LONG", $"{code}: a code has at most 64 characters.");
            if (Blank(v.Meaning) is not { } meaning || !Meanings.ContainsKey(meaning))
                return Problems.Invalid("MEANING_REQUIRED", $"{label}: say what it means: accepted, accepted with comments, rejected, or for information.");
        }
        if (verdicts.Select(v => v.Code!.Trim()).GroupBy(c => c, StringComparer.OrdinalIgnoreCase).FirstOrDefault(g => g.Count() > 1) is { } twice)
            return Problems.Invalid("CODE_TWICE", $"{twice.Key} is written twice.");
        var after = kept.Where(k => !verdicts.Any(v => string.Equals(v.Code?.Trim(), k.Code, StringComparison.OrdinalIgnoreCase)))
            .Select(k => (Meaning: k.Meaning, Active: k.Active))
            .Concat(verdicts.Select(v => (Meaning: (string?)v.Meaning!.Trim(), Active: !v.Retired)));
        if (!after.Any(a => a.Active && a.Meaning is { } m && Meanings[m].Proceed))
            return Problems.Invalid("NO_VERDICT_ACCEPTS", "No verdict of the list lets a revision go on to be released: give one the meaning accepted (or accepted with comments, or for information).");
        return null;
    }

    private static JsonDocument Props(string meaning)
    {
        var (proceed, resubmit, information) = Meanings[meaning];
        return JsonDocument.Parse(JsonSerializer.Serialize(new { proceed, resubmit, information }));
    }

    /// <summary>Writes the list's own name, as Settings shows it, marked as verdicts.</summary>
    private static async Task NameAsync(DeliosDbContext db, IClock clock, Guid tenantId, string key, string title, string? description, string by, CancellationToken c)
    {
        var row = await db.Settings.SingleOrDefaultAsync(s => s.ProjectId == null && s.Key == SetPrefix + key, c);
        var version = 1;
        if (row is not null)
        {
            try { using var was = JsonDocument.Parse(row.Value); if (was.RootElement.TryGetProperty("version", out var v) && v.TryGetInt32(out var n)) version = n + 1; }
            catch (JsonException) { }
        }
        var value = JsonSerializer.Serialize(new { title, description, group = "Review & issue", version, kind = Kind });
        if (row is null)
            db.Settings.Add(new Setting { TenantId = tenantId, Key = SetPrefix + key, Value = value, UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = by });
        else { row.Value = value; row.UpdatedAt = clock.GetCurrentInstant(); row.UpdatedByName = by; }
    }

    /// <summary><c>POST /api/admin/verdict-lists</c>: a new verdict list, with its verdicts. Its key is made from its title.</summary>
    private static async Task<IResult> CreateAsync(VerdictListRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c)
    {
        var title = Blank(request.Title);
        if (title is null) return Problems.Invalid("TITLE_REQUIRED", "A verdict list has a name.");
        var verdicts = request.Verdicts ?? [];
        if (verdicts.Length == 0) return Problems.Invalid("VERDICTS_REQUIRED", "A verdict list has at least one verdict.");
        if (Check(verdicts, []) is { } problem) return problem;
        if ((await NamedAsync(db, c)).Values.Any(n => string.Equals(n.Title, title, StringComparison.OrdinalIgnoreCase)))
            return Problems.Conflict("NAME_TAKEN", $"A list is already called {title}.");
        var stem = new string([.. title.ToUpperInvariant().Select(ch => char.IsAsciiLetterOrDigit(ch) ? ch : '_')]).Trim('_');
        while (stem.Contains("__")) stem = stem.Replace("__", "_");
        stem = stem.Length == 0 ? "VERDICTS" : stem[..Math.Min(stem.Length, 40)];
        var key = stem;
        for (var n = 2; await db.ValueEntries.AnyAsync(v => v.SetKey == key, c) || await db.Settings.AnyAsync(s => s.ProjectId == null && s.Key == SetPrefix + key, c); n++)
            key = $"{stem}_{n}";
        var me = await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), c);
        var tenantId = http.User.TenantId();
        // Made on a project: into the project's own lists (its copy made first); else the organization's.
        var scope = await Documents.ProjectLists.WriteScopeAsync(db, c);
        await NameAsync(db, clock, tenantId, key, title, Blank(request.Description), me.Name, c);
        var sort = 10;
        foreach (var v in verdicts)
        {
            db.ValueEntries.Add(new ValueEntry
            {
                TenantId = tenantId, ProjectId = scope, SetKey = key, Code = v.Code!.Trim(), Label = Blank(v.Label) ?? v.Code!.Trim(), Sort = sort,
                Status = v.Retired ? ValueStatus.Retired : ValueStatus.Active, Props = Props(v.Meaning!.Trim()),
            });
            sort += 10;
        }
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(new Actor(me.Id, me.Name), "VERDICT_LIST_CREATED", "Value", null, key,
            $"{title}: {string.Join(", ", verdicts.Select(v => $"{v.Code!.Trim()} ({v.Meaning})"))}", cancellationToken: c);
        return Results.Created($"/api/admin/verdict-lists/{key}", new { key });
    }

    /// <summary>
    /// <c>PUT /api/admin/verdict-lists/{key}</c>: its name, and its verdicts: a code already there changes its label,
    /// meaning or whether it is retired; a new code is added. A code never changes; a verdict is retired, never deleted.
    /// </summary>
    private static async Task<IResult> UpdateAsync(string key, VerdictListRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken c)
    {
        var scope = await Documents.ProjectLists.WriteScopeAsync(db, c);
        var values = await db.ValueEntries.Where(v => v.SetKey == key).ToListAsync(c);
        var named = await NamedAsync(db, c);
        if (values.Count == 0 && !named.ContainsKey(key)) return Problems.NotFound("LIST_NOT_FOUND", "No such list.");
        var verdicts = request.Verdicts ?? [];
        if (Check(verdicts, values.Select(v => (v.Code, MeaningOf(v.Props), v.Status == ValueStatus.Active))) is { } problem) return problem;
        var me = await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), c);
        var changes = new List<string>();
        if (Blank(request.Title) is { } title)
        {
            await NameAsync(db, clock, http.User.TenantId(), key, title, Blank(request.Description), me.Name, c);
            if (title != named.GetValueOrDefault(key).Title) changes.Add($"name → {title}");
        }
        var sort = values.Count == 0 ? 0 : values.Max(v => v.Sort);
        foreach (var v in verdicts)
        {
            var code = v.Code!.Trim();
            var label = Blank(v.Label) ?? code;
            var meaning = v.Meaning!.Trim();
            var status = v.Retired ? ValueStatus.Retired : ValueStatus.Active;
            var row = values.FirstOrDefault(x => string.Equals(x.Code, code, StringComparison.OrdinalIgnoreCase));
            if (row is null)
            {
                db.ValueEntries.Add(new ValueEntry { TenantId = http.User.TenantId(), ProjectId = scope, SetKey = key, Code = code, Label = label, Sort = sort += 10, Status = status, Props = Props(meaning) });
                changes.Add($"{code} added ({meaning})");
                continue;
            }
            if (row.Label != label) { changes.Add($"{code}: label → {label}"); row.Label = label; }
            if (MeaningOf(row.Props) != meaning) { changes.Add($"{code}: means {meaning}"); row.Props = Props(meaning); }
            if (row.Status != status) { changes.Add($"{code}: {(v.Retired ? "retired" : "active again")}"); row.Status = status; }
        }
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(new Actor(me.Id, me.Name), "VERDICT_LIST_CHANGED", "Value", null, key, string.Join("; ", changes), cancellationToken: c);
        return Results.NoContent();
    }
}
