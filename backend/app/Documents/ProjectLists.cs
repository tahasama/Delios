using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Settings;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>Body of adding or changing one value of a project's list.</summary>
/// <param name="Code">The value's code; with <paramref name="NewCode"/>, the one it had.</param>
/// <param name="NewCode">A new code: only for a value never used.</param>
public sealed record ProjectValueRequest(string? Code, string? NewCode = null, string? Label = null, string? Status = null, int? Sort = null,
    JsonElement? Props = null);

/// <summary>Body of making or renaming a list of the project.</summary>
public sealed record ProjectListRequest(string? Key, string? Title, string? Description = null, string? Group = null, string? NewKey = null);

/// <summary>
/// The project's lists (<c>/api/projects/{projectId}/lists</c>). The organization's lists are the default every project
/// starts from; the first change a project makes gives it its own copy of them all (<see cref="Project.OwnLists"/>), which
/// the organization's later changes never touch. While a value (or a list) was never used on the project, everything about
/// it may change and it may be deleted; once used, only its name changes (and it may be retired): anything else is a new
/// value. Whoever acts as the control function on the project changes them; on a project with none, only whoever opened it.
/// Every change is in the log.
/// </summary>
public static class ProjectLists
{
    /// <summary>Where a list's own name, description and group are kept: one setting each, the project's over the organization's.</summary>
    public const string SetPrefix = "SET:";

    /// <summary>Lists the app runs on: their values change, the list itself stays.</summary>
    private static readonly HashSet<string> RunsOn =
    [
        ValueSets.DeliverableTypes, ValueSets.DocumentTypes, ValueSets.Disciplines, ValueSets.Phases, ValueSets.Subprojects,
        ValueSets.Criticality, ValueSets.Confidentiality, ValueSets.RetentionClasses, ValueSets.PurchaseOrders, ValueSets.ProjectKinds,
        ReviewSets.Statuses, ReviewSets.Verdicts, ReviewSets.Advice, "REASONS_FOR_ISSUE", "COMMENT_CLASSES", "CONTRACT_ROLES",
    ];

    public static void MapProjectListEndpoints(this IEndpointRouteBuilder app)
    {
        var lists = app.MapGroup("/api/projects/{projectId:guid}/lists").WithTags("Settings")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        lists.MapGet("", ListsAsync);
        lists.MapGet("/{set}/usage", UsageEndpointAsync);
        lists.MapPost("", CreateListAsync);
        lists.MapPut("/{set}", UpdateListAsync);
        lists.MapDelete("/{set}", DeleteListAsync);
        lists.MapPut("/{set}/values", ValueAsync);
        lists.MapDelete("/{set}/values/{code}", DeleteValueAsync);
    }

    /// <summary>
    /// Whoever may change the project's lists: whoever acts as its control function; on a project with none, whoever opened
    /// it, and nobody else.
    /// </summary>
    public static async Task<bool> MayChangeAsync(DeliosDbContext db, ProjectAccess access, CancellationToken cancellationToken)
    {
        if (!access.IsInternal) return false;
        if (access.Holds(Verbs.Control)) return true;
        var control = await Actions.NoticeLog.HoldersAsync(db, access.Project.Id, Verbs.Control, cancellationToken);
        return control.Count == 0 && access.Project.OpenedById == access.UserId;
    }

    /// <summary>
    /// The project gets its own copy of the organization's lists, once, before its first change: from then on it reads its
    /// own. Returns whether the copy was made now.
    /// </summary>
    public static async Task<bool> EnsureOwnAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken)
    {
        var project = await db.Projects.SingleAsync(p => p.Id == projectId, cancellationToken);
        if (project.OwnLists)
        {
            db.UseListsOf(project.Id, true);
            return false;
        }
        var originals = await db.ValueEntries.IgnoreQueryFilters().AsNoTracking().Where(v => v.ProjectId == null).ToListAsync(cancellationToken);
        db.ValueEntries.AddRange(originals.Select(v => new ValueEntry
        {
            TenantId = v.TenantId, ProjectId = project.Id, SetKey = v.SetKey, Code = v.Code, Label = v.Label, Status = v.Status,
            Sort = v.Sort, Props = v.Props is null ? null : JsonDocument.Parse(v.Props.RootElement.GetRawText()),
        }));
        project.OwnLists = true;
        await db.SaveChangesAsync(cancellationToken);
        db.UseListsOf(project.Id, true);
        return true;
    }

    /// <summary>
    /// For the writers that are not about one project (a request saying which project it is in): the project to write the
    /// change into, with its own copy made first; none, the organization's lists.
    /// </summary>
    public static async Task<Guid?> WriteScopeAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        if (db.ListsProject is not { } projectId) return null;
        await EnsureOwnAsync(db, projectId, cancellationToken);
        return projectId;
    }

    /// <summary>
    /// Where each value of a list is used on the project: its documents and their revisions, reviews, transmittals, packages,
    /// the schedule, people's departments, routes, numbering, who may do what, the project itself, or another of its lists
    /// pointing to it. A value with no entry was never used.
    /// </summary>
    public static async Task<Dictionary<string, List<string>>> UsageAsync(DeliosDbContext db, Project project, string set, CancellationToken cancellationToken)
    {
        var used = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        void Add(IEnumerable<(string? Code, int N)> rows, string what)
        {
            foreach (var (code, n) in rows)
            {
                if (string.IsNullOrEmpty(code) || n == 0) continue;
                if (!used.TryGetValue(code, out var places)) used[code] = places = [];
                places.Add(n == 1 ? $"1 {what}" : $"{n} {what}s");
            }
        }
        void Mark(IEnumerable<string?> codes, string what)
        {
            foreach (var code in codes.Where(c => !string.IsNullOrEmpty(c)).Distinct())
            {
                if (!used.TryGetValue(code!, out var places)) used[code!] = places = [];
                if (!places.Contains(what)) places.Add(what);
            }
        }
        async Task CountAsync(IQueryable<string?> codes, string what) =>
            Add((await codes.Where(c => c != null).GroupBy(c => c).Select(g => new { g.Key, N = g.Count() }).ToListAsync(cancellationToken))
                .Select(x => (x.Key, x.N)), what);

        var pid = project.Id;
        var docs = db.Documents.AsNoTracking().Where(d => d.ProjectId == pid);
        var revisions = db.Revisions.AsNoTracking().Where(r => docs.Any(d => d.Id == r.DocumentId));
        switch (set)
        {
            case ValueSets.Disciplines:
                await CountAsync(docs.Select(d => (string?)d.Discipline), "document");
                Mark((await db.Activities.AsNoTracking().Where(a => a.ProjectId == pid).Select(a => a.Departments).ToListAsync(cancellationToken))
                    .SelectMany(d => d), "the schedule");
                Mark(await db.Memberships.AsNoTracking().Where(m => m.ProjectId == pid).Select(m => m.Department).ToListAsync(cancellationToken),
                    "people's department");
                break;
            case ValueSets.DocumentTypes: await CountAsync(docs.Select(d => (string?)d.DocType), "document"); break;
            case ValueSets.DeliverableTypes:
                await CountAsync(docs.Select(d => (string?)d.DeliverableType), "document");
                Mark(await db.SchemeRoutings.AsNoTracking().Select(r => r.DeliverableType).ToListAsync(cancellationToken), "numbering");
                Mark(await db.RevisionSchemeRoutings.AsNoTracking().Select(r => r.DeliverableType).ToListAsync(cancellationToken), "revision naming");
                break;
            case ValueSets.Criticality: await CountAsync(docs.Select(d => d.Criticality), "document"); break;
            case ValueSets.Confidentiality:
                await CountAsync(docs.Select(d => d.Confidentiality), "document");
                Mark(await db.Functions.AsNoTracking().Select(f => f.Clearance).ToListAsync(cancellationToken), "a function's clearance");
                break;
            case ValueSets.Phases:
                await CountAsync(docs.Select(d => d.Phase), "document");
                await CountAsync(revisions.Select(r => r.Phase), "revision");
                break;
            case ValueSets.Subprojects: await CountAsync(docs.Select(d => d.Subproject), "document"); break;
            case ValueSets.RetentionClasses: await CountAsync(docs.Select(d => d.RetentionClass), "document"); break;
            case ValueSets.PurchaseOrders: await CountAsync(docs.Select(d => d.ContractRef), "document"); break;
            case ValueSets.ProjectKinds: Mark([project.Kind], "this project's type"); break;
            case "CONTRACT_ROLES": Mark([project.ContractRole], "our role on this project"); break;
            case ReviewSets.Statuses:
                await CountAsync(revisions.Select(r => r.StatusCode), "revision");
                await CountAsync(db.Reviews.AsNoTracking().Where(r => r.ProjectId == pid).Select(r => r.GrantedStatus), "review");
                Mark((await db.Requirements.AsNoTracking().Where(r => r.ProjectId == pid).Select(r => r.RequiredStatuses).ToListAsync(cancellationToken))
                    .SelectMany(s => s), "the schedule");
                Mark((await db.Packages.AsNoTracking().Where(p => p.ProjectId == pid).Select(p => p.RequiredStatuses).ToListAsync(cancellationToken))
                    .SelectMany(s => s), "a package");
                break;
            case "REASONS_FOR_ISSUE":
                await CountAsync(db.Transmittals.AsNoTracking().Where(t => t.ProjectId == pid).Select(t => (string?)t.Reason), "transmittal");
                Mark(await db.Requirements.AsNoTracking().Where(r => r.ProjectId == pid).Select(r => (string?)r.Purpose).ToListAsync(cancellationToken), "the schedule");
                break;
            case ReviewSets.Advice:
                await CountAsync(db.ReviewParticipants.AsNoTracking()
                    .Where(p => db.ReviewSteps.Any(s => s.Id == p.StepId && db.Reviews.Any(r => r.Id == s.ReviewId && r.ProjectId == pid)))
                    .Select(p => p.Answer), "answer");
                break;
        }
        // A list a review decides with: the verdicts given on the project's reviews.
        await CountAsync(db.Reviews.AsNoTracking().Where(r => r.ProjectId == pid && r.VerdictSet == set).Select(r => r.Verdict), "review");

        // Routes and who may do what name values of the document lists.
        var routes = await db.ReviewRoutes.AsNoTracking().Where(r => r.Active).ToListAsync(cancellationToken);
        Mark(routes.SelectMany(r => r.Patterns.Select(p => set switch
        {
            ValueSets.DeliverableTypes => p.DeliverableType,
            ValueSets.DocumentTypes => p.DocType,
            ValueSets.Disciplines => p.Discipline,
            ValueSets.Criticality => p.Criticality,
            _ => null,
        })), "a review route");
        if (set == ReviewSets.Statuses) Mark(routes.SelectMany(r => r.Steps.SelectMany(s => s.GrantsStatuses)), "a review route");
        var rules = await db.PermissionRules.AsNoTracking().ToListAsync(cancellationToken);
        Mark(rules.Select(r => set switch
        {
            ValueSets.DeliverableTypes => r.DeliverableType,
            ValueSets.DocumentTypes => r.DocType,
            ValueSets.Disciplines => r.Discipline,
            ValueSets.Criticality => r.Criticality,
            ValueSets.Confidentiality => r.Confidentiality,
            _ => null,
        }), "who may do what");

        // Another list of the project pointing to it (a document type's deliverable types, a level's retention…).
        var others = await db.ValueEntries.AsNoTracking().Where(v => v.SetKey != set && v.Props != null).ToListAsync(cancellationToken);
        var codes = await db.ValueEntries.AsNoTracking().Where(v => v.SetKey == set).Select(v => v.Code).ToListAsync(cancellationToken);
        foreach (var code in codes)
        {
            var quoted = JsonSerializer.Serialize(code);
            foreach (var other in others.Where(o => o.Props!.RootElement.GetRawText().Contains(quoted, StringComparison.Ordinal)))
                Mark([code], $"the list {other.SetKey.Replace('_', ' ').ToLowerInvariant()} ({other.Code})");
        }
        return used;
    }

    // ── Endpoints ────────────────────────────────────────────────────────────

    /// <summary>
    /// <c>GET /lists</c>: each list of the project with how many values are in use and retired, whether it is the
    /// project's own copy or still the organization's, and whether this person may change them.
    /// </summary>
    private static async Task<IResult> ListsAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var counts = await db.ValueEntries.AsNoTracking().GroupBy(v => v.SetKey)
            .Select(g => new { Key = g.Key, Active = g.Count(v => v.Status == ValueStatus.Active), Retired = g.Count(v => v.Status != ValueStatus.Active) })
            .ToListAsync(cancellationToken);
        return Results.Ok(new
        {
            own = access.Project.OwnLists,
            mayChange = await MayChangeAsync(db, access, cancellationToken),
            sets = counts.OrderBy(c => c.Key),
            runsOn = RunsOn.OrderBy(k => k),
        });
    }

    /// <summary><c>GET /lists/{set}/usage</c>: where each value is used on the project; a value not named was never used.</summary>
    private static async Task<IResult> UsageEndpointAsync(string set, HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        return Results.Ok(await UsageAsync(db, access.Project, set.ToUpperInvariant(), cancellationToken));
    }

    private static async Task<IResult?> RefusedAsync(DeliosDbContext db, ProjectAccess access, string set, CancellationToken cancellationToken)
    {
        if (!await MayChangeAsync(db, access, cancellationToken))
            return Problems.Forbidden("CONTROL_ONLY", "Whoever acts as the control function on this project changes its lists (on a project with none, whoever opened it).");
        if (set == ValueSets.ProjectCodes)
            return Problems.Invalid("FILLED_BY_ITSELF", "Project codes is filled by the app: each project's code is in it.");
        if (set == ReviewSets.Verdicts || await IsVerdictListAsync(db, set, cancellationToken))
            return Problems.Invalid("VERDICT_LIST", "A verdict list is kept in Settings, Verdict lists.");
        return null;
    }

    private static async Task<bool> IsVerdictListAsync(DeliosDbContext db, string set, CancellationToken cancellationToken) =>
        (await db.Set<Setting>().AsNoTracking().Where(s => s.Key == SetPrefix + set).Select(s => s.Value).ToListAsync(cancellationToken))
        .Any(v => v.Contains("\"VERDICTS\"", StringComparison.Ordinal));

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary><c>PUT /lists/{set}/values</c>: adds a value, or changes one: anything while it was never used, only its name (and retired or not, its place) once used.</summary>
    private static async Task<IResult> ValueAsync(string set, ProjectValueRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        set = set.ToUpperInvariant();
        if (await RefusedAsync(db, access, set, cancellationToken) is { } refused) return refused;
        if (Blank(request.Code) is not { } code) return Problems.Invalid("CODE_REQUIRED", "A value has a code.");
        var status = Blank(request.Status)?.ToUpperInvariant();
        if (status is not (null or ValueStatus.Active or ValueStatus.Retired)) return Problems.Invalid("STATUS_INVALID", "A value is in use or retired.");
        await EnsureOwnAsync(db, access.Project.Id, cancellationToken);

        var value = await db.ValueEntries.SingleOrDefaultAsync(v => v.SetKey == set && v.Code == code, cancellationToken);
        var changes = new List<string>();
        if (value is null)
        {
            if (code.Length > 64) return Problems.Invalid("CODE_TOO_LONG", "A code has at most 64 characters.");
            if (Blank(request.Label) is not { } label) return Problems.Invalid("LABEL_REQUIRED", "A value has a name people read.");
            var sort = request.Sort ?? (await db.ValueEntries.Where(v => v.SetKey == set).MaxAsync(v => (int?)v.Sort, cancellationToken) ?? 0) + 10;
            value = new ValueEntry
            {
                TenantId = access.Project.TenantId, ProjectId = access.Project.Id, SetKey = set, Code = code, Label = label, Sort = sort,
                Status = status ?? ValueStatus.Active,
                Props = request.Props is { ValueKind: not (JsonValueKind.Null or JsonValueKind.Undefined) } p ? JsonDocument.Parse(p.GetRawText()) : null,
            };
            db.ValueEntries.Add(value);
            changes.Add($"added: {label}");
        }
        else
        {
            var usedAt = (await UsageAsync(db, access.Project, set, cancellationToken)).GetValueOrDefault(code);
            var newCode = Blank(request.NewCode);
            var propsText = request.Props is { } props ? (props.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? null : props.GetRawText()) : value.Props?.RootElement.GetRawText();
            var propsChange = request.Props is not null && propsText != value.Props?.RootElement.GetRawText();
            if (usedAt is { Count: > 0 } && ((newCode is not null && newCode != code) || propsChange))
                return Problems.Conflict("VALUE_IN_USE", $"{code} is used ({string.Join(", ", usedAt)}): only its name may change now. Add a new value for anything else.");
            if (newCode is not null && newCode != code)
            {
                if (await db.ValueEntries.AnyAsync(v => v.SetKey == set && v.Code == newCode, cancellationToken))
                    return Problems.Conflict("CODE_TAKEN", $"{newCode} is already in this list.");
                changes.Add($"code {code} → {newCode}");
                value.Code = newCode;
            }
            if (Blank(request.Label) is { } label && label != value.Label) { changes.Add($"name → {label}"); value.Label = label; }
            if (status is not null && status != value.Status) { changes.Add(status == ValueStatus.Active ? "in use again" : "retired"); value.Status = status; }
            if (request.Sort is { } sort && sort != value.Sort) { changes.Add($"order → {sort}"); value.Sort = sort; }
            if (propsChange) { value.Props = propsText is null ? null : JsonDocument.Parse(propsText); changes.Add("what it does changed"); }
        }
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "VALUE_CHANGED", "Value", value.Id, $"{set}/{value.Code}",
            string.Join("; ", changes), access.Project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary><c>DELETE /lists/{set}/values/{code}</c>: a value never used on the project is deleted; the log keeps it.</summary>
    private static async Task<IResult> DeleteValueAsync(string set, string code, HttpContext http, DeliosDbContext db, AuditLog audit,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        set = set.ToUpperInvariant();
        if (await RefusedAsync(db, access, set, cancellationToken) is { } refused) return refused;
        if ((await UsageAsync(db, access.Project, set, cancellationToken)).GetValueOrDefault(code) is { Count: > 0 } usedAt)
            return Problems.Conflict("VALUE_IN_USE", $"{code} is used ({string.Join(", ", usedAt)}): it is retired, never deleted.");
        await EnsureOwnAsync(db, access.Project.Id, cancellationToken);
        var value = await db.ValueEntries.SingleOrDefaultAsync(v => v.SetKey == set && v.Code == code, cancellationToken);
        if (value is null) return Problems.NotFound("VALUE_NOT_FOUND", "No such value.");
        db.ValueEntries.Remove(value);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "VALUE_DELETED", "Value", value.Id, $"{set}/{code}",
            $"Deleted, never used: {value.Label}", access.Project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary><c>POST /lists</c>: a new list of the project, with its short name, which never changes once a value of it is used.</summary>
    private static async Task<IResult> CreateListAsync(ProjectListRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var key = Blank(request.Key)?.ToUpperInvariant();
        var title = Blank(request.Title);
        if (key is null || title is null) return Problems.Invalid("KEY_AND_TITLE_REQUIRED", "A list has a name and a short name.");
        if (!System.Text.RegularExpressions.Regex.IsMatch(key, "^[A-Z][A-Z0-9_]{0,63}$"))
            return Problems.Invalid("KEY_INVALID", "A short name is capitals, digits and _ only, starting with a letter.");
        if (await RefusedAsync(db, access, key, cancellationToken) is { } refused) return refused;
        await EnsureOwnAsync(db, access.Project.Id, cancellationToken);
        if (await db.ValueEntries.AnyAsync(v => v.SetKey == key, cancellationToken) || RunsOn.Contains(key)
            || await db.Set<Setting>().AnyAsync(s => s.ProjectId == access.Project.Id && s.Key == SetPrefix + key, cancellationToken))
            return Problems.Conflict("LIST_EXISTS", $"There is already a list called {key}.");
        await SaveMetaAsync(db, clock, access, key, title, request.Description, request.Group, cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "LIST_CREATED", "List", null, key, title, access.Project.Id, cancellationToken);
        return Results.Ok(new { key });
    }

    /// <summary><c>PUT /lists/{set}</c>: its name, description and group change any time; its short name only while none of its values was used.</summary>
    private static async Task<IResult> UpdateListAsync(string set, ProjectListRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        set = set.ToUpperInvariant();
        if (await RefusedAsync(db, access, set, cancellationToken) is { } refused) return refused;
        var title = Blank(request.Title);
        if (title is null) return Problems.Invalid("TITLE_REQUIRED", "A list has a name.");
        await EnsureOwnAsync(db, access.Project.Id, cancellationToken);
        var newKey = Blank(request.NewKey)?.ToUpperInvariant();
        var changes = new List<string> { $"name: {title}" };
        if (newKey is not null && newKey != set)
        {
            if (RunsOn.Contains(set)) return Problems.Invalid("LIST_RUNS_THE_APP", "The app reads this list by its short name: it stays.");
            if (!System.Text.RegularExpressions.Regex.IsMatch(newKey, "^[A-Z][A-Z0-9_]{0,63}$"))
                return Problems.Invalid("KEY_INVALID", "A short name is capitals, digits and _ only, starting with a letter.");
            if ((await UsageAsync(db, access.Project, set, cancellationToken)).Count > 0)
                return Problems.Conflict("LIST_IN_USE", "A value of this list is used: its short name stays. Its name may change.");
            if (await db.ValueEntries.AnyAsync(v => v.SetKey == newKey, cancellationToken))
                return Problems.Conflict("LIST_EXISTS", $"There is already a list called {newKey}.");
            foreach (var value in await db.ValueEntries.Where(v => v.SetKey == set).ToListAsync(cancellationToken)) value.SetKey = newKey;
            var old = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id && s.Key == SetPrefix + set, cancellationToken);
            if (old is not null) db.Remove(old);
            changes.Add($"short name {set} → {newKey}");
            set = newKey;
        }
        await SaveMetaAsync(db, clock, access, set, title, request.Description, request.Group, cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "LIST_CHANGED", "List", null, set, string.Join("; ", changes),
            access.Project.Id, cancellationToken);
        return Results.Ok(new { key = set });
    }

    /// <summary><c>DELETE /lists/{set}</c>: a list none of whose values was ever used on the project is deleted with them; the log keeps it.</summary>
    private static async Task<IResult> DeleteListAsync(string set, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        set = set.ToUpperInvariant();
        if (await RefusedAsync(db, access, set, cancellationToken) is { } refused) return refused;
        if (RunsOn.Contains(set)) return Problems.Invalid("LIST_RUNS_THE_APP", "The app runs on this list: its values change, the list stays.");
        if ((await UsageAsync(db, access.Project, set, cancellationToken)).Count > 0)
            return Problems.Conflict("LIST_IN_USE", "A value of this list is used: retire its values instead.");
        await EnsureOwnAsync(db, access.Project.Id, cancellationToken);
        db.ValueEntries.RemoveRange(await db.ValueEntries.Where(v => v.SetKey == set).ToListAsync(cancellationToken));
        var meta = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id && s.Key == SetPrefix + set, cancellationToken);
        if (meta is not null) db.Remove(meta);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "LIST_DELETED", "List", null, set, "Deleted, never used.",
            access.Project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>A list's own name, description and group, kept as the project's setting (it stands over the organization's).</summary>
    private static async Task SaveMetaAsync(DeliosDbContext db, IClock clock, ProjectAccess access, string key, string title, string? description,
        string? group, CancellationToken cancellationToken)
    {
        var org = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == null && s.Key == SetPrefix + key).Select(s => s.Value)
            .SingleOrDefaultAsync(cancellationToken);
        var kind = org is not null && org.Contains("\"VERDICTS\"", StringComparison.Ordinal) ? "VERDICTS" : null;
        var value = JsonSerializer.Serialize(new { title, description = Blank(description), group = Blank(group), kind }, JsonSerializerOptions.Web);
        var row = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id && s.Key == SetPrefix + key, cancellationToken);
        if (row is null)
            db.Add(new Setting { TenantId = access.Project.TenantId, ProjectId = access.Project.Id, Key = SetPrefix + key, Value = value, UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = access.UserName });
        else
        {
            row.Value = value;
            row.UpdatedAt = clock.GetCurrentInstant();
            row.UpdatedByName = access.UserName;
        }
        await db.SaveChangesAsync(cancellationToken);
    }
}
