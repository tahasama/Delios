using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Settings;

/// <summary>
/// What one project changed from the organization's (owner: "select a project… keeping what's different in this
/// project"), read on the organization's Settings: the cards it keeps its own copy of, the fixed switches it is an
/// exception to, and the Control room and stamp answers it changed. Read only: a project's settings are changed in that
/// project's Settings, and put back only from the organization's card, as before.
/// </summary>
public static class ProjectDifferences
{
    /// <summary>A card the project keeps its own copy of; <c>Items</c> names which lists or forms, where it is copied one by one.</summary>
    public sealed record OwnCopy(string Area, DateTimeOffset? Since, string? By, IReadOnlyList<string> Items);

    /// <summary>Answers the project changed under one switch of the Control room or the stamp, against the organization's.</summary>
    public sealed record ChangedAnswers(string Key, string Area, string Title, int Changed, bool Free);

    /// <summary>Registers <c>GET /api/admin/projects/{projectId}/differences</c> (administrators).</summary>
    public static void MapProjectDifferenceEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGroup("/api/admin/projects/{projectId:guid}/differences").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("What a project changed is read by an administrator, from the organization's Settings."))
            .MapGet("", ReadAsync);
    }

    private static async Task<IResult> ReadAsync(Guid projectId, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var project = await db.Projects.AsNoTracking().SingleOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return Problems.NotFound("PROJECT_NOT_FOUND", "No such project.");
        var switches = await Liberty.ReadAsync(db, projectId, cancellationToken);
        var settings = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == projectId).ToListAsync(cancellationToken);
        var mark = (string key) => settings.FirstOrDefault(s => s.Key == key);

        var copies = new List<OwnCopy>();
        void Own(string area, Setting? row, IReadOnlyList<string>? items = null)
        {
            if (row is not null) copies.Add(new(area, row.UpdatedAt.ToDateTimeOffset(), row.UpdatedByName, items ?? []));
        }
        Own("Numbering", mark(NumberingLevels.OwnKey));
        Own("Revisions", mark(RevisionSchemeEndpoints.OwnKey));
        Own("Review routes", mark(CatalogAdminEndpoints.RoutesOwnKey));
        if (project.OwnListKeys.Length > 0)
            copies.Add(new("Types & sets", null, null, project.OwnListKeys
                .Select(key => switches.FirstOrDefault(s => s.Key == Liberty.ListKey(key))?.Title ?? key).OrderBy(t => t).ToList()));
        var forms = await FormRules.OwnedAsync(db, projectId, cancellationToken);
        if (forms.Count > 0) Own("Forms & fields", mark(FormRules.OwnFormsKey), forms.OrderBy(f => f).ToList());
        if (project.OwnFunctions) copies.Add(new("Functions & permissions", null, null, []));

        // The Control room's answers are copied from the defaults when a project opens; the stamp's are read from the
        // organization's own. An answer counts as changed when it differs from where it came from.
        var defaults = ReadDefaults(await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == null && s.Key == "PROJECT_DEFAULTS")
            .Select(s => s.Value).FirstOrDefaultAsync(cancellationToken));
        var organization = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == null).ToDictionaryAsync(s => s.Key, s => s.Value, cancellationToken);
        var answers = settings
            .Select(s => (Setting: s, Item: Liberty.RoomItemOf(s.Key)))
            .Where(x => x.Item is not null)
            .Where(x => x.Setting.Value != (x.Item == "POLICY_PDF_STAMP" ? organization.GetValueOrDefault(x.Setting.Key) : defaults.GetValueOrDefault(x.Setting.Key)))
            .GroupBy(x => x.Item!)
            .Select(g =>
            {
                var item = switches.FirstOrDefault(s => s.Key == g.Key);
                return new ChangedAnswers(g.Key, item?.Area ?? "Control room", item?.Title ?? g.Key, g.Count(), item?.Free ?? true);
            })
            .OrderBy(a => a.Area).ThenBy(a => a.Title).ToList();

        var exceptions = switches.Where(s => s.ExceptHere)
            .Select(s => new { s.Key, s.Area, s.Title, Exception = s.Except.First(e => e.ProjectId == projectId) })
            .Select(s => new { s.Key, s.Area, s.Title, s.Exception.Reason, s.Exception.At, s.Exception.By }).ToList();

        return Results.Ok(new { Project = new { project.Id, project.Code, project.Name }, Copies = copies, Answers = answers, Exceptions = exceptions });
    }

    private static Dictionary<string, string> ReadDefaults(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("values", out var values) || values.ValueKind != System.Text.Json.JsonValueKind.Object) return [];
            return values.EnumerateObject().Where(p => p.Value.ValueKind == System.Text.Json.JsonValueKind.String)
                .ToDictionary(p => p.Name, p => p.Value.GetString()!);
        }
        catch (System.Text.Json.JsonException) { return []; }
    }
}
