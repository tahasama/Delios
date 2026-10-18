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
/// <param name="SetId">The set it goes in (none: the list's default set); moved to another only while never used.</param>
public sealed record ProjectValueRequest(string? Code, string? NewCode = null, string? Label = null, string? Status = null, int? Sort = null,
    JsonElement? Props = null, Guid? SetId = null);

/// <summary>Body of making or renaming a list of the project; <paramref name="Active"/> switches a list of one's own off or on.</summary>
public sealed record ProjectListRequest(string? Key, string? Title, string? Description = null, string? Group = null, string? NewKey = null,
    bool? Active = null);

/// <summary>Body of making or changing a set of a list: its name, the deliverable types it serves, switched on or off.</summary>
public sealed record ProjectSetRequest(string? Name, string[]? DeliverableTypes = null, bool? Active = null);

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
        lists.MapPost("/{set}/sets", CreateSetAsync);
        lists.MapPut("/{set}/sets/{setId:guid}", UpdateSetAsync);
        lists.MapDelete("/{set}/sets/{setId:guid}", DeleteSetAsync);
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
        // The sets first, each under a new id the copied values point to.
        var sets = await db.ListSets.IgnoreQueryFilters().AsNoTracking().Where(s => s.ProjectId == null).ToListAsync(cancellationToken);
        var newId = sets.ToDictionary(s => s.Id, _ => Guid.CreateVersion7());
        db.ListSets.AddRange(sets.Select(s => new ValueSet
        {
            Id = newId[s.Id], TenantId = s.TenantId, ProjectId = project.Id, ListKey = s.ListKey, Name = s.Name,
            DeliverableTypes = [.. s.DeliverableTypes], IsDefault = s.IsDefault, Active = s.Active, Sort = s.Sort,
        }));
        var originals = await db.ValueEntries.IgnoreQueryFilters().AsNoTracking().Where(v => v.ProjectId == null).ToListAsync(cancellationToken);
        db.ValueEntries.AddRange(originals.Select(v => new ValueEntry
        {
            TenantId = v.TenantId, ProjectId = project.Id, SetKey = v.SetKey, Code = v.Code, Label = v.Label, Status = v.Status,
            SetId = v.SetId is { } setId && newId.TryGetValue(setId, out var copied) ? copied : null,
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
            case ValueSets.ProjectCodes:
                // Every document carries its project's code (the first part of its number).
                Add((await db.Projects.AsNoTracking()
                    .Select(p => new { p.Code, N = db.Documents.Count(d => d.ProjectId == p.Id) }).ToListAsync(cancellationToken))
                    .Select(x => ((string?)x.Code, x.N)), "document");
                break;
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

        // Another list pointing to it through a property that names a value of this list (only those: a code also written
        // elsewhere by chance is not a use), said with the names of the values pointing: "recommended by document types:
        // Calculation, Drawing".
        foreach (var (from, prop, to, how) in Pointers.Where(p => p.To == set))
        {
            var pointing = await db.ValueEntries.AsNoTracking().Where(v => v.SetKey == from && v.Props != null).ToListAsync(cancellationToken);
            foreach (var group in pointing
                .SelectMany(v => Named(v.Props!.RootElement, prop).Select(code => (Code: code, v.Label)))
                .GroupBy(x => x.Code))
                Mark([group.Key], $"{how}: {string.Join(", ", group.Select(x => x.Label).Distinct())}");
        }
        return used;
    }

    /// <summary>The properties by which a value of one list names values of another, and how that use is said.</summary>
    private static readonly (string From, string Prop, string To, string How)[] Pointers =
    [
        (ValueSets.DocumentTypes, "deliverables", ValueSets.DeliverableTypes, "document types belonging to it"),
        (ValueSets.DocumentTypes, "criticality", ValueSets.Criticality, "recommended by document types"),
        (ValueSets.Criticality, "retention", ValueSets.RetentionClasses, "brought by criticality levels"),
    ];

    /// <summary>The codes a property holds: one, or a list of them.</summary>
    private static IEnumerable<string> Named(JsonElement props, string prop) =>
        !props.TryGetProperty(prop, out var value) ? []
        : value.ValueKind == JsonValueKind.String ? [value.GetString()!]
        : value.ValueKind == JsonValueKind.Array ? value.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String).Select(e => e.GetString()!)
        : [];

    // ── Endpoints ────────────────────────────────────────────────────────────

    /// <summary>
    /// <c>GET /lists</c>: the groups and every list of the project in them, each with its sets (the deliverable types each
    /// serves, switched on or off, how many values), whether it is the app's, whether it holds more than one set; whether
    /// the lists are the project's own copy or still the organization's, and whether this person may change them.
    /// </summary>
    private static async Task<IResult> ListsAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var counts = await db.ValueEntries.AsNoTracking().GroupBy(v => new { v.SetKey, v.SetId })
            .Select(g => new { g.Key.SetKey, g.Key.SetId, Active = g.Count(v => v.Status == ValueStatus.Active), Others = g.Count(v => v.Status != ValueStatus.Active) })
            .ToListAsync(cancellationToken);
        var meta = await ListRules.MetaAsync(db, access.Project.Id, cancellationToken);
        // Every list has its default set as a set like any other (owner: every list behaves the same): one filled or made
        // before sets existed gets it now, in the lists this project reads.
        var known = await db.ListSets.AsNoTracking().Select(s => s.ListKey).Distinct().ToListAsync(cancellationToken);
        var missing = counts.Select(c => c.SetKey).Concat(meta.Keys).Append(ValueSets.Phases).Append(ValueSets.ProjectKinds)
            .Distinct().Where(k => k != ValueSets.ProjectCodes && !known.Contains(k)).ToList();
        if (missing.Count > 0)
        {
            db.ListSets.AddRange(missing.Select(key => new ValueSet
            {
                TenantId = access.Project.TenantId, ProjectId = access.Project.OwnLists ? access.Project.Id : null,
                ListKey = key, Name = "Default", IsDefault = true,
            }));
            await db.SaveChangesAsync(cancellationToken);
        }
        var sets = await db.ListSets.AsNoTracking().OrderBy(s => s.Sort).ThenBy(s => s.Name).ToListAsync(cancellationToken);
        // Project codes are not a list anyone keeps (owner): filled by the app, one per project, shown on This project.
        var keys = counts.Select(c => c.SetKey).Concat(sets.Select(s => s.ListKey)).Concat(meta.Keys)
            .Append(ValueSets.Phases).Append(ValueSets.ProjectKinds).Distinct().Where(k => k != ValueSets.ProjectCodes).ToList();
        var lists = keys.Select(key =>
        {
            var info = meta.GetValueOrDefault(key) ?? ListRules.ListMeta.Read(null);
            var own = sets.Where(s => s.ListKey == key).ToList();
            var defaultId = own.FirstOrDefault(s => s.IsDefault)?.Id;
            int Count(Guid? setId, bool active) => counts.Where(c => c.SetKey == key && (c.SetId ?? defaultId) == setId).Sum(c => active ? c.Active : c.Others);
            return new
            {
                key,
                title = ListRules.TitleOf(key, info),
                description = info.Description,
                group = ListRules.GroupOf(key, info),
                kind = info.Kind,
                app = ListRules.IsAppList(key),
                takesSets = ListRules.TakesSets(key),
                active = info.Active,
                rank = ListRules.Rank(key),
                count = counts.Where(c => c.SetKey == key).Sum(c => c.Active),
                // A list filled before it had sets reads as its one default set, made on its first change.
                sets = own.Count > 0
                    ? own.Select(s => new { Id = (Guid?)s.Id, s.Name, s.IsDefault, s.Active, s.DeliverableTypes, inUse = Count(s.Id, true), others = Count(s.Id, false) }).ToList()
                    : [new { Id = (Guid?)null, Name = "Default", IsDefault = true, Active = true, DeliverableTypes = Array.Empty<string>(), inUse = Count(null, true), others = Count(null, false) }],
            };
        }).OrderBy(l => l.rank).ThenBy(l => l.title).ToList();
        return Results.Ok(new
        {
            own = access.Project.OwnLists,
            mayChange = await MayChangeAsync(db, access, cancellationToken),
            groups = ListRules.Groups,
            lists,
            // Kept for the screens that only count: each list with its values in use and the rest.
            sets = lists.Select(l => new { l.key, active = l.count, retired = l.sets.Sum(s => s.others) }),
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
        // The review outcomes are kept here like any list; a verdict list of before, still holding a verdict whose code the
        // review outcomes already had, stays as it is for the reviews decided from it.
        if (set != ReviewSets.Verdicts && await IsVerdictListAsync(db, set, cancellationToken))
            return Problems.Invalid("VERDICT_LIST", "This verdict list is kept as it was, for the reviews decided from it. Verdicts are kept in Review outcomes.");
        return null;
    }

    private static async Task<bool> IsVerdictListAsync(DeliosDbContext db, string set, CancellationToken cancellationToken) =>
        (await db.Set<Setting>().AsNoTracking().Where(s => s.Key == SetPrefix + set).Select(s => s.Value).ToListAsync(cancellationToken))
        .Any(v => v.Contains("\"VERDICTS\"", StringComparison.Ordinal));

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>
    /// A verdict says which of the four meanings it has, chosen by the person; and every set of the review outcomes holding
    /// a verdict in use keeps one that lets a revision be released (MEANING_REQUIRED, NO_VERDICT_ACCEPTS).
    /// </summary>
    private static async Task<IResult?> VerdictsHoldAsync(DeliosDbContext db, ValueEntry changed, bool removed, CancellationToken cancellationToken)
    {
        if (!removed && changed.Status != ValueStatus.Retired && Reviews.VerdictListEndpoints.MeaningOf(changed.Props) is null)
            return Problems.Invalid("MEANING_REQUIRED", $"{changed.Label}: say what it means: accepted, accepted with comments, rejected, or for information.",
                new { field = "effect" });
        var sets = await db.ListSets.AsNoTracking().Where(s => s.ListKey == ReviewSets.Verdicts).ToListAsync(cancellationToken);
        var defaultId = sets.FirstOrDefault(s => s.IsDefault)?.Id;
        var all = await db.ValueEntries.Where(v => v.SetKey == ReviewSets.Verdicts).ToListAsync(cancellationToken);
        if (!all.Contains(changed)) all.Add(changed);
        if (removed) all.Remove(changed);
        var setOf = changed.SetId ?? defaultId;
        var inSet = all.Where(v => (v.SetId ?? defaultId) == setOf && v.Status != ValueStatus.Retired).ToList();
        if (inSet.Count > 0 && !inSet.Any(v => Reviews.VerdictListEndpoints.MeaningOf(v.Props) is { } m && Reviews.VerdictListEndpoints.Meanings[m].Proceed))
            return Problems.Invalid("NO_VERDICT_ACCEPTS",
                $"No verdict left in {sets.FirstOrDefault(s => s.Id == setOf)?.Name ?? "this set"} would let a revision be released: keep one meaning accepted (or accepted with comments, or for information).");
        return null;
    }

    /// <summary>The list's default set, made when the list has none yet (a list made before it held a value).</summary>
    private static async Task<ValueSet> DefaultSetAsync(DeliosDbContext db, ProjectAccess access, string set, CancellationToken cancellationToken)
    {
        var found = await db.ListSets.SingleOrDefaultAsync(s => s.ListKey == set && s.IsDefault, cancellationToken);
        if (found is not null) return found;
        found = new ValueSet { TenantId = access.Project.TenantId, ProjectId = access.Project.Id, ListKey = set, Name = "Default", IsDefault = true };
        db.ListSets.Add(found);
        await db.SaveChangesAsync(cancellationToken);
        return found;
    }

    /// <summary>Whether the values of a set are offered: the set is on and so is its list.</summary>
    private static async Task<bool> OfferedAsync(DeliosDbContext db, Guid projectId, ValueSet set, CancellationToken cancellationToken) =>
        set.Active && ((await ListRules.MetaAsync(db, projectId, cancellationToken)).GetValueOrDefault(set.ListKey)?.Active ?? true);

    /// <summary>
    /// <c>PUT /lists/{set}/values</c>: adds a value to a set (the default one unless named), or changes one: anything while it
    /// was never used, only its name (and retired or not, its place) once used.
    /// </summary>
    private static async Task<IResult> ValueAsync(string set, ProjectValueRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        set = set.ToUpperInvariant();
        if (await RefusedAsync(db, access, set, cancellationToken) is { } refused) return refused;
        if (Blank(request.Code) is not { } code) return Problems.Invalid("CODE_REQUIRED", "A value has a code.");
        var status = Blank(request.Status)?.ToUpperInvariant();
        if (status is not (null or ValueStatus.Active or ValueStatus.Retired)) return Problems.Invalid("STATUS_INVALID", "A value is in use or retired.");
        ValueSet? target = null;
        if (request.SetId is { } setId)
        {
            target = await OwnSetAsync(db, access, set, setId, cancellationToken);
            if (target is null) return Problems.NotFound("SET_NOT_FOUND", "That set is not in this list.");
        }
        await EnsureOwnAsync(db, access.Project.Id, cancellationToken);

        var value = await db.ValueEntries.SingleOrDefaultAsync(v => v.SetKey == set && v.Code == code, cancellationToken);
        var changes = new List<string>();
        if (value is null)
        {
            if (code.Length > 64) return Problems.Invalid("CODE_TOO_LONG", "A code has at most 64 characters.");
            if (Blank(request.Label) is not { } label) return Problems.Invalid("LABEL_REQUIRED", "A value has a name people read.");
            target ??= await DefaultSetAsync(db, access, set, cancellationToken);
            var sort = request.Sort ?? (await db.ValueEntries.Where(v => v.SetKey == set).MaxAsync(v => (int?)v.Sort, cancellationToken) ?? 0) + 10;
            var offered = await OfferedAsync(db, access.Project.Id, target, cancellationToken);
            value = new ValueEntry
            {
                TenantId = access.Project.TenantId, ProjectId = access.Project.Id, SetKey = set, SetId = target.Id, Code = code, Label = label, Sort = sort,
                Status = status == ValueStatus.Retired ? ValueStatus.Retired : offered ? ValueStatus.Active : ValueStatus.Off,
                Props = request.Props is { ValueKind: not (JsonValueKind.Null or JsonValueKind.Undefined) } p ? JsonDocument.Parse(p.GetRawText()) : null,
            };
            db.ValueEntries.Add(value);
            changes.Add($"added to {target.Name}: {label}");
        }
        else
        {
            var usedAt = (await UsageAsync(db, access.Project, set, cancellationToken)).GetValueOrDefault(code);
            var newCode = Blank(request.NewCode);
            var propsText = request.Props is { } props ? (props.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? null : props.GetRawText()) : value.Props?.RootElement.GetRawText();
            var propsChange = request.Props is not null && propsText != value.Props?.RootElement.GetRawText();
            var current = value.SetId is { } at
                ? await db.ListSets.SingleOrDefaultAsync(s => s.Id == at, cancellationToken)
                : await db.ListSets.SingleOrDefaultAsync(s => s.ListKey == set && s.IsDefault, cancellationToken);
            var moves = target is not null && target.Id != current?.Id;
            if (usedAt is { Count: > 0 } && ((newCode is not null && newCode != code) || propsChange || moves))
                return Problems.Conflict("VALUE_IN_USE", $"{code} is used ({string.Join(", ", usedAt)}): only its name may change now. Add a new value for anything else.");
            if (newCode is not null && newCode != code)
            {
                if (await db.ValueEntries.AnyAsync(v => v.SetKey == set && v.Code == newCode, cancellationToken))
                    return Problems.Conflict("CODE_TAKEN", $"{newCode} is already in this list.");
                changes.Add($"code {code} → {newCode}");
                value.Code = newCode;
            }
            if (moves)
            {
                value.SetId = target!.Id;
                current = target;
                changes.Add($"moved to {target.Name}");
            }
            if (Blank(request.Label) is { } label && label != value.Label) { changes.Add($"name → {label}"); value.Label = label; }
            if (status is not null)
            {
                // Brought back into a set (or a list) switched off, it waits there, off, until that is switched on.
                var wanted = status == ValueStatus.Retired ? ValueStatus.Retired
                    : current is null || await OfferedAsync(db, access.Project.Id, current, cancellationToken) ? ValueStatus.Active : ValueStatus.Off;
                if (wanted != value.Status && !(status == ValueStatus.Active && value.Status == ValueStatus.Off && wanted == ValueStatus.Off))
                {
                    changes.Add(wanted == ValueStatus.Retired ? "retired" : "in use again");
                    value.Status = wanted;
                }
            }
            if (request.Sort is { } sort && sort != value.Sort) { changes.Add($"order → {sort}"); value.Sort = sort; }
            if (propsChange) { value.Props = propsText is null ? null : JsonDocument.Parse(propsText); changes.Add("what it does changed"); }
        }
        if (changes.Count == 0) return Results.NoContent();
        if (set == ReviewSets.Verdicts && await VerdictsHoldAsync(db, value, false, cancellationToken) is { } verdictProblem) return verdictProblem;
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
        if (set == ReviewSets.Verdicts && await VerdictsHoldAsync(db, value, true, cancellationToken) is { } verdictProblem) return verdictProblem;
        db.ValueEntries.Remove(value);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "VALUE_DELETED", "Value", value.Id, $"{set}/{code}",
            $"Deleted, never used: {value.Label}", access.Project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// <c>POST /lists</c>: a list of one's own, in a group that takes lists (Numbering &amp; identity, Classification &amp;
    /// keeping): a document field. It starts with one set, "Default". Its short name never changes once a value of it is used.
    /// </summary>
    private static async Task<IResult> CreateListAsync(ProjectListRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var key = Blank(request.Key)?.ToUpperInvariant();
        var title = Blank(request.Title);
        if (key is null || title is null) return Problems.Invalid("KEY_AND_TITLE_REQUIRED", "A list has a name and a short name.");
        if (!System.Text.RegularExpressions.Regex.IsMatch(key, "^[A-Z][A-Z0-9_]{0,63}$"))
            return Problems.Invalid("KEY_INVALID", "A short name is capitals, digits and _ only, starting with a letter.");
        var group = ListRules.Groups.FirstOrDefault(g => g.Key == Blank(request.Group) || g.Title == Blank(request.Group));
        if (group is not { TakesLists: true })
            return Problems.Invalid("LIST_NOT_HERE", $"A list of your own is a document field: it goes in {string.Join(" or ", ListRules.Groups.Where(g => g.TakesLists).Select(g => g.Title))}.");
        if (await RefusedAsync(db, access, key, cancellationToken) is { } refused) return refused;
        await EnsureOwnAsync(db, access.Project.Id, cancellationToken);
        if (await db.ValueEntries.AnyAsync(v => v.SetKey == key, cancellationToken) || ListRules.IsAppList(key)
            || await db.ListSets.AnyAsync(s => s.ListKey == key, cancellationToken)
            || await db.Set<Setting>().AnyAsync(s => s.ProjectId == access.Project.Id && s.Key == SetPrefix + key, cancellationToken))
            return Problems.Conflict("LIST_EXISTS", $"There is already a list called {key}.");
        await SaveMetaAsync(db, clock, access, key, title, request.Description, group.Title, true, cancellationToken);
        await DefaultSetAsync(db, access, key, cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "LIST_CREATED", "List", null, key, $"{title} ({group.Title})", access.Project.Id, cancellationToken);
        return Results.Ok(new { key });
    }

    /// <summary>
    /// <c>PUT /lists/{set}</c>: its name and description change any time; its short name and group only while none of its
    /// values was used; a list of one's own is switched off and on (its values are then not offered, and come back).
    /// </summary>
    private static async Task<IResult> UpdateListAsync(string set, ProjectListRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        set = set.ToUpperInvariant();
        if (await RefusedAsync(db, access, set, cancellationToken) is { } refused) return refused;
        var title = Blank(request.Title);
        if (title is null) return Problems.Invalid("TITLE_REQUIRED", "A list has a name.");
        var app = ListRules.IsAppList(set);
        if (request.Active is not null && app)
            return Problems.Invalid("APP_LIST_STAYS", "The app runs on this list: it is not switched off here. Whether its field is asked is set in Forms & fields.");
        await EnsureOwnAsync(db, access.Project.Id, cancellationToken);
        var meta = (await ListRules.MetaAsync(db, access.Project.Id, cancellationToken)).GetValueOrDefault(set) ?? ListRules.ListMeta.Read(null);
        var used = (await UsageAsync(db, access.Project, set, cancellationToken)).Count > 0;
        var changes = new List<string> { $"name: {title}" };

        var group = meta.Group;
        if (!app && Blank(request.Group) is { } asked && ListRules.Groups.FirstOrDefault(g => g.Key == asked || g.Title == asked) is { } wanted
            && wanted.Title != meta.Group)
        {
            if (!wanted.TakesLists) return Problems.Invalid("LIST_NOT_HERE", $"A list of your own goes in {string.Join(" or ", ListRules.Groups.Where(g => g.TakesLists).Select(g => g.Title))}.");
            if (used) return Problems.Conflict("LIST_IN_USE", "A value of this list is used: it stays in its group.");
            group = wanted.Title;
            changes.Add($"group → {wanted.Title}");
        }

        var newKey = Blank(request.NewKey)?.ToUpperInvariant();
        if (newKey is not null && newKey != set)
        {
            if (app) return Problems.Invalid("LIST_RUNS_THE_APP", "The app reads this list by its short name: it stays.");
            if (!System.Text.RegularExpressions.Regex.IsMatch(newKey, "^[A-Z][A-Z0-9_]{0,63}$"))
                return Problems.Invalid("KEY_INVALID", "A short name is capitals, digits and _ only, starting with a letter.");
            if (used) return Problems.Conflict("LIST_IN_USE", "A value of this list is used: its short name stays. Its name may change.");
            if (await db.ValueEntries.AnyAsync(v => v.SetKey == newKey, cancellationToken) || await db.ListSets.AnyAsync(s => s.ListKey == newKey, cancellationToken))
                return Problems.Conflict("LIST_EXISTS", $"There is already a list called {newKey}.");
            foreach (var value in await db.ValueEntries.Where(v => v.SetKey == set).ToListAsync(cancellationToken)) value.SetKey = newKey;
            foreach (var one in await db.ListSets.Where(s => s.ListKey == set).ToListAsync(cancellationToken)) one.ListKey = newKey;
            var old = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id && s.Key == SetPrefix + set, cancellationToken);
            if (old is not null) db.Remove(old);
            changes.Add($"short name {set} → {newKey}");
            set = newKey;
        }

        var active = request.Active ?? meta.Active;
        if (active != meta.Active)
        {
            var sets = await db.ListSets.Where(s => s.ListKey == set).ToListAsync(cancellationToken);
            var on = sets.Where(s => s.Active).Select(s => s.Id).ToHashSet();
            var defaultId = sets.FirstOrDefault(s => s.IsDefault)?.Id;
            foreach (var value in await db.ValueEntries.Where(v => v.SetKey == set).ToListAsync(cancellationToken))
            {
                if (!active && value.Status == ValueStatus.Active) value.Status = ValueStatus.Off;
                else if (active && value.Status == ValueStatus.Off && (value.SetId ?? defaultId) is { } setId && on.Contains(setId)) value.Status = ValueStatus.Active;
            }
            changes.Add(active ? "switched on" : "switched off");
        }
        // Switching alone (nothing else asked) keeps the description as it was.
        var description = request.Active is not null && request.Description is null ? meta.Description : request.Description;
        await SaveMetaAsync(db, clock, access, set, title, description, group, active, cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "LIST_CHANGED", "List", null, set, string.Join("; ", changes),
            access.Project.Id, cancellationToken);
        return Results.Ok(new { key = set });
    }

    /// <summary>
    /// <c>DELETE /lists/{set}</c>: a list of one's own none of whose values was ever used on the project is deleted with its
    /// sets and values; the log keeps it. The app's lists stay.
    /// </summary>
    private static async Task<IResult> DeleteListAsync(string set, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        set = set.ToUpperInvariant();
        if (await RefusedAsync(db, access, set, cancellationToken) is { } refused) return refused;
        if (ListRules.IsAppList(set)) return Problems.Invalid("LIST_RUNS_THE_APP", "The app runs on this list: its values change, the list stays.");
        if ((await UsageAsync(db, access.Project, set, cancellationToken)).Count > 0)
            return Problems.Conflict("LIST_IN_USE", "A value of this list is used: switch the list off instead.");
        await EnsureOwnAsync(db, access.Project.Id, cancellationToken);
        db.ValueEntries.RemoveRange(await db.ValueEntries.Where(v => v.SetKey == set).ToListAsync(cancellationToken));
        db.ListSets.RemoveRange(await db.ListSets.Where(s => s.ListKey == set).ToListAsync(cancellationToken));
        var meta = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id && s.Key == SetPrefix + set, cancellationToken);
        if (meta is not null) db.Remove(meta);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "LIST_DELETED", "List", null, set, "Deleted, never used.",
            access.Project.Id, cancellationToken);
        return Results.NoContent();
    }

    // ── Sets ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// The deliverable types asked for a set, as they stand: each a value of Deliverable types; none another active set of
    /// the list already serves. Null with the refusal when they cannot be.
    /// </summary>
    private static async Task<(string[]? Types, IResult? Refused)> TypesForAsync(DeliosDbContext db, ValueSet set, string[]? asked, bool active,
        CancellationToken cancellationToken)
    {
        var types = (asked ?? set.DeliverableTypes).Select(t => t.Trim()).Where(t => t.Length > 0).Distinct().ToArray();
        var known = await db.ValueEntries.AsNoTracking().Where(v => v.SetKey == ValueSets.DeliverableTypes).Select(v => v.Code).ToListAsync(cancellationToken);
        if (types.FirstOrDefault(t => !known.Contains(t)) is { } unknown)
            return (null, Problems.Invalid("DELIVERABLE_TYPE_UNKNOWN", $"{unknown} is not a deliverable type of this project."));
        if (active)
        {
            var others = await db.ListSets.AsNoTracking().Where(s => s.ListKey == set.ListKey).ToListAsync(cancellationToken);
            if (ListRules.Overlaps(others, set, types) is { Count: > 0 } clash)
                return (null, Problems.Conflict("SETS_OVERLAP",
                    $"Two sets switched on never serve the same deliverable type: {string.Join(", ", clash.Select(c => $"{c.Type} is served by {c.Set}"))}."));
        }
        return (types, null);
    }

    /// <summary>The codes of a set's values: those it holds, and the default set's values made before sets were.</summary>
    private static async Task<List<ValueEntry>> ValuesOfAsync(DeliosDbContext db, ValueSet set, CancellationToken cancellationToken) =>
        await db.ValueEntries.Where(v => v.SetKey == set.ListKey && (v.SetId == set.Id || (set.IsDefault && v.SetId == null))).ToListAsync(cancellationToken);

    /// <summary>
    /// <c>POST /lists/{set}/sets</c>: another set of the list, with the deliverable types it serves (it may name them later:
    /// until then it serves none). Lists that hold one set refuse it.
    /// </summary>
    private static async Task<IResult> CreateSetAsync(string set, ProjectSetRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        set = set.ToUpperInvariant();
        if (await RefusedAsync(db, access, set, cancellationToken) is { } refused) return refused;
        if (!ListRules.TakesSets(set)) return Problems.Invalid("ONE_SET_ONLY", "This list holds one set: it is the same for every deliverable type.");
        if (Blank(request.Name) is not { } name) return Problems.Invalid("NAME_REQUIRED", "A set has a name.");
        await EnsureOwnAsync(db, access.Project.Id, cancellationToken);
        // A list filled before it had sets first gets its default set, for the values it already holds.
        if (!await db.ListSets.AnyAsync(s => s.ListKey == set, cancellationToken)) await DefaultSetAsync(db, access, set, cancellationToken);
        if (await db.ListSets.AnyAsync(s => s.ListKey == set && s.Name == name, cancellationToken))
            return Problems.Conflict("SET_EXISTS", $"This list already has a set called {name}.");
        var added = new ValueSet
        {
            TenantId = access.Project.TenantId, ProjectId = access.Project.Id, ListKey = set, Name = name, Active = request.Active ?? true,
            Sort = (await db.ListSets.Where(s => s.ListKey == set).MaxAsync(s => (int?)s.Sort, cancellationToken) ?? 0) + 10,
        };
        var (types, problem) = await TypesForAsync(db, added, request.DeliverableTypes ?? [], added.Active, cancellationToken);
        if (problem is not null) return problem;
        added.DeliverableTypes = types!;
        db.ListSets.Add(added);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "SET_CREATED", "List", added.Id, set,
            $"{name}: {(types!.Length > 0 ? string.Join(", ", types) : "no deliverable type yet")}", access.Project.Id, cancellationToken);
        return Results.Ok(new { id = added.Id });
    }

    /// <summary>
    /// The project's own set the screen named: the project gets its own copy first, and a set named while it still read
    /// the organization's is found again in that copy by its list and name.
    /// </summary>
    private static async Task<ValueSet?> OwnSetAsync(DeliosDbContext db, ProjectAccess access, string set, Guid setId, CancellationToken cancellationToken)
    {
        var named = await db.ListSets.AsNoTracking().SingleOrDefaultAsync(s => s.Id == setId && s.ListKey == set, cancellationToken);
        if (await EnsureOwnAsync(db, access.Project.Id, cancellationToken) && named is not null)
            return await db.ListSets.SingleOrDefaultAsync(s => s.ListKey == set && s.Name == named.Name, cancellationToken);
        return await db.ListSets.SingleOrDefaultAsync(s => s.Id == setId && s.ListKey == set, cancellationToken);
    }

    /// <summary>
    /// <c>PUT /lists/{set}/sets/{id}</c>: its name, the deliverable types it serves, switched on or off. The default set
    /// stays on: it is what every deliverable type no other set names finds.
    /// </summary>
    private static async Task<IResult> UpdateSetAsync(string set, Guid setId, ProjectSetRequest request, HttpContext http, DeliosDbContext db,
        AuditLog audit, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        set = set.ToUpperInvariant();
        if (await RefusedAsync(db, access, set, cancellationToken) is { } refused) return refused;
        var one = await OwnSetAsync(db, access, set, setId, cancellationToken);
        if (one is null) return Problems.NotFound("SET_NOT_FOUND", "That set is not in this list.");
        var changes = new List<string>();
        if (Blank(request.Name) is { } name && name != one.Name)
        {
            if (await db.ListSets.AnyAsync(s => s.ListKey == set && s.Name == name && s.Id != one.Id, cancellationToken))
                return Problems.Conflict("SET_EXISTS", $"This list already has a set called {name}.");
            changes.Add($"name {one.Name} → {name}");
            // Routes and the reviews still open name a set of verdicts by its name: they follow it.
            if (set == ReviewSets.Verdicts)
            {
                var was = one.Name;
                foreach (var route in await db.ReviewRoutes.Where(r => r.Verdicts == was).ToListAsync(cancellationToken)) route.Verdicts = name;
                foreach (var review in await db.Reviews.Where(r => r.ProjectId == access.Project.Id && r.Verdicts == was && r.State == ReviewStates.InProgress)
                    .ToListAsync(cancellationToken)) review.Verdicts = name;
            }
            one.Name = name;
        }
        // The default set is theirs like any other (owner): renamed, switched off, deleted; switched off, the deliverable
        // types no other set names find nothing in this list.
        var active = request.Active ?? one.Active;
        var (types, problem) = await TypesForAsync(db, one, request.DeliverableTypes, active, cancellationToken);
        if (problem is not null) return problem;
        if (!types!.SequenceEqual(one.DeliverableTypes))
        {
            changes.Add($"serves {(types!.Length > 0 ? string.Join(", ", types) : "no deliverable type")}");
            one.DeliverableTypes = types;
        }
        if (active != one.Active)
        {
            one.Active = active;
            var listOn = (await ListRules.MetaAsync(db, access.Project.Id, cancellationToken)).GetValueOrDefault(set)?.Active ?? true;
            foreach (var value in await ValuesOfAsync(db, one, cancellationToken))
            {
                if (!active && value.Status == ValueStatus.Active) value.Status = ValueStatus.Off;
                else if (active && listOn && value.Status == ValueStatus.Off) value.Status = ValueStatus.Active;
            }
            changes.Add(active ? "switched on" : "switched off");
        }
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "SET_CHANGED", "List", one.Id, set, $"{one.Name}: {string.Join("; ", changes)}",
            access.Project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary><c>DELETE /lists/{set}/sets/{id}</c>: a set none of whose values was ever used is deleted with them. The default set stays.</summary>
    private static async Task<IResult> DeleteSetAsync(string set, Guid setId, HttpContext http, DeliosDbContext db, AuditLog audit,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        set = set.ToUpperInvariant();
        if (await RefusedAsync(db, access, set, cancellationToken) is { } refused) return refused;
        var one = await OwnSetAsync(db, access, set, setId, cancellationToken);
        if (one is null) return Problems.NotFound("SET_NOT_FOUND", "That set is not in this list.");
        var values = await ValuesOfAsync(db, one, cancellationToken);
        var used = await UsageAsync(db, access.Project, set, cancellationToken);
        if (values.FirstOrDefault(v => used.ContainsKey(v.Code)) is { } inUse)
            return Problems.Conflict("SET_IN_USE", $"{inUse.Code} of this set is used ({string.Join(", ", used[inUse.Code])}): switch the set off instead.");
        if (set == ReviewSets.Verdicts && await db.ReviewRoutes.Where(r => r.Verdicts == one.Name).Select(r => r.Name).ToListAsync(cancellationToken) is { Count: > 0 } routes)
            return Problems.Conflict("SET_IN_USE", $"The review routes {string.Join(", ", routes)} decide from {one.Name}: choose them another set first, or switch it off.");
        db.ValueEntries.RemoveRange(values);
        db.ListSets.Remove(one);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "SET_DELETED", "List", one.Id, set,
            $"{one.Name}, never used ({values.Count} values)", access.Project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>A list's own name, description, group and switch, kept as the project's setting (it stands over the organization's).</summary>
    private static async Task SaveMetaAsync(DeliosDbContext db, IClock clock, ProjectAccess access, string key, string title, string? description,
        string? group, bool active, CancellationToken cancellationToken)
    {
        var org = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == null && s.Key == SetPrefix + key).Select(s => s.Value)
            .SingleOrDefaultAsync(cancellationToken);
        var kind = org is not null && org.Contains("\"VERDICTS\"", StringComparison.Ordinal) ? "VERDICTS" : null;
        var value = JsonSerializer.Serialize(new { title, description = Blank(description), group = Blank(group), kind, active }, JsonSerializerOptions.Web);
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
