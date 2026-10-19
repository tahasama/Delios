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

/// <summary>
/// Body of publishing or changing one value of a list. The pair (set, code) names it; a null field is left as it is.
/// <c>Props</c>, when given, replaces what the value means for the system.
/// </summary>
public sealed record ValueRequest(string? SetKey, string? Code, string? Label = null, string? Status = null, int? Sort = null,
    JsonElement? Props = null);

/// <summary>Body of creating or changing a numbering scheme: its fields in order, joined by the delimiter.</summary>
public sealed record SchemeRequest(string? Name, string? Delimiter = null, bool? Active = null, SchemeField[]? Fields = null, string? Notes = null);

/// <summary>Body of routing a deliverable type (or a record kind such as @TRANSMITTAL) to a numbering scheme. No scheme: unrouted.</summary>
public sealed record SchemeRoutingRequest(string? DeliverableType, Guid? SchemeId);

/// <summary>Body of creating or changing a review route. A null field is left as it is; lists, when given, replace.</summary>
public sealed record RouteRequest(
    string? Name = null, string? Description = null, bool? IsDefault = null, bool? Active = null, RoutePattern[]? Patterns = null,
    RouteStep[]? Steps = null, string? VerdictSet = null,
    /// <summary>The set of the review outcomes it decides from, by name; empty: the set serving the document's deliverable type.</summary>
    string? Verdicts = null);

/// <summary>
/// What an administrator publishes for the organization: the value lists, how numbers are built and which scheme
/// numbers what, and the review routes. Values in use are retired, never deleted; schemes and routes are switched
/// off. Every change is audited. The audit trail itself is read here too.
/// </summary>
public static class CatalogAdminEndpoints
{
    public static void MapCatalogAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/admin").WithTags("Administration")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("Only an administrator publishes the organization's lists and rules."));
        admin.MapGet("/value-sets", SetsAsync);
        admin.MapPut("/values", ValueAsync);

        // The control function keeps these day to day, as well as administrators.
        var keepers = app.MapGroup("/api/admin").WithTags("Administration")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Filter);
        // Numbering: NumberingLevels (the organization's and a project's).
        // Review routes on two levels: the organization's (an administrator, from its Settings) and a project's own copy.
        keepers.MapGet("/routes", (DeliosDbContext db, CancellationToken c) => RoutesAsync(db, null, c));
        var routes = app.MapGroup("/api/admin/routes").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("The organization's review routes are offered on every project: an administrator changes them."));
        routes.MapPost("", (RouteRequest r, HttpContext h, DeliosDbContext db, AuditLog a, CancellationToken c) => CreateRouteAsync(null, r, h, db, a, c));
        routes.MapPut("/{routeId:guid}", (Guid routeId, RouteRequest r, HttpContext h, DeliosDbContext db, AuditLog a, CancellationToken c) =>
            UpdateRouteAsync(null, routeId, r, h, db, a, c));
        routes.MapGet("/projects", RouteCopiesAsync);
        routes.MapPost("/projects/{projectId:guid}/reset", ResetRoutesAsync);
        var project = app.MapGroup("/api/projects/{projectId:guid}/routes").WithTags("Settings")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
        {
            var access = ProjectAccessFilter.Of(h);
            var free = await Liberty.IsFreeAsync(db, Liberty.Routes, c);
            return Results.Ok(new
            {
                Routes = await RouteViewsAsync(db, await RouteScopeAsync(db, access.Project.Id, c), c),
                Own = await RouteScopeAsync(db, access.Project.Id, c) is not null, Free = free,
                MayChange = free && await ProjectLists.MayChangeAsync(db, access, c),
                MayChangeOrganization = await Keepers.ConfiguresAsync(h),
            });
        });
        project.MapPost("", (RouteRequest r, HttpContext h, DeliosDbContext db, AuditLog a, IClock clock, CancellationToken c) =>
            ProjectRoutesAsync(h, db, clock, c, scope => CreateRouteAsync(scope, r, h, db, a, c)));
        project.MapPut("/{routeId:guid}", (Guid routeId, RouteRequest r, HttpContext h, DeliosDbContext db, AuditLog a, IClock clock, CancellationToken c) =>
            ProjectRoutesAsync(h, db, clock, c, scope => UpdateRouteAsync(scope, routeId, r, h, db, a, c), routeId));
        admin.MapGet("/audit", AuditAsync);
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static async Task<Actor> ActorAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var id = http.User.UserId();
        return new Actor(id, await db.Users.Where(u => u.Id == id).Select(u => u.Name).SingleAsync(cancellationToken));
    }

    // ── Value lists ─────────────────────────────────────────────────────────

    /// <summary><c>GET /api/admin/value-sets</c>: every list the organization keeps, with how many values are active and retired.</summary>
    private static async Task<IResult> SetsAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var sets = await db.ValueEntries.AsNoTracking().GroupBy(v => v.SetKey)
            .Select(g => new { Key = g.Key, Active = g.Count(v => v.Status == ValueStatus.Active), Retired = g.Count(v => v.Status != ValueStatus.Active) })
            .OrderBy(s => s.Key).ToListAsync(cancellationToken);
        return Results.Ok(sets);
    }

    /// <summary><c>PUT /api/admin/values</c>: publishes a value, or changes its label, order, meaning, or retires it.</summary>
    private static async Task<IResult> ValueAsync(
        ValueRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var set = Blank(request.SetKey)?.ToUpperInvariant();
        var code = Blank(request.Code);
        if (set is null || code is null) return Problems.Invalid("SET_AND_CODE_REQUIRED", "A value belongs to a list and has a code.");
        if (set.Length > 64 || code.Length > 64) return Problems.Invalid("CODE_TOO_LONG", "List names and codes have at most 64 characters.");
        var status = Blank(request.Status)?.ToUpperInvariant();
        if (status is not (null or ValueStatus.Active or ValueStatus.Retired))
            return Problems.Invalid("STATUS_INVALID", "A value is ACTIVE or RETIRED.");
        // Said from inside a project: the project's own lists (its copy made first); else the organization's.
        var scope = await ProjectLists.WriteScopeAsync(db, set, cancellationToken);
        var value = await db.ValueEntries.SingleOrDefaultAsync(v => v.SetKey == set && v.Code == code, cancellationToken);
        var changes = new List<string>();
        if (value is null)
        {
            var label = Blank(request.Label);
            if (label is null) return Problems.Invalid("LABEL_REQUIRED", "A value has a label people read.");
            var sort = request.Sort ?? (await db.ValueEntries.Where(v => v.SetKey == set).MaxAsync(v => (int?)v.Sort, cancellationToken) ?? 0) + 10;
            value = new ValueEntry { TenantId = http.User.TenantId(), ProjectId = scope, SetKey = set, Code = code, Label = label, Sort = sort, Status = status ?? ValueStatus.Active };
            db.ValueEntries.Add(value);
            changes.Add($"published: {label}");
        }
        else
        {
            if (Blank(request.Label) is { } label && label != value.Label) { changes.Add($"label → {label}"); value.Label = label; }
            if (status is not null && status != value.Status) { changes.Add(status == ValueStatus.Active ? "active again" : "retired"); value.Status = status; }
            if (request.Sort is { } sort && sort != value.Sort) { changes.Add($"order → {sort}"); value.Sort = sort; }
        }
        if (request.Props is { } props)
        {
            var text = props.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? null : props.GetRawText();
            if (text != value.Props?.RootElement.GetRawText())
            {
                value.Props = text is null ? null : JsonDocument.Parse(text);
                changes.Add("meaning changed");
            }
        }
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "VALUE_CHANGED", "Value", value.Id, $"{set}/{code}",
            string.Join("; ", changes), cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    // ── Review routes ───────────────────────────────────────────────────────

    /// <summary>The project's setting saying it offers its own copy of the review routes.</summary>
    public const string RoutesOwnKey = "ROUTES_OWN";

    /// <summary>The routes a project offers: its own copy where it made one (its id), else the organization's (null).</summary>
    public static async Task<Guid?> RouteScopeAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken) =>
        await db.Set<Settings.Setting>().AnyAsync(s => s.ProjectId == projectId && s.Key == RoutesOwnKey, cancellationToken) ? projectId : null;

    /// <summary>A change on a project: only where routes are free, by whoever changes the project's settings; its own copy made first.</summary>
    private static async Task<IResult> ProjectRoutesAsync(HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken,
        Func<Guid?, Task<IResult>> act, Guid? routeId = null)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!await Liberty.IsFreeAsync(db, Liberty.Routes, cancellationToken))
            return Problems.Forbidden("ROUTES_FIXED", "The review routes are the organization's, the same on every project: an administrator changes them in the organization's Settings.");
        if (!await ProjectLists.MayChangeAsync(db, access, cancellationToken))
            return Problems.Forbidden("CONTROL_ONLY", "Whoever acts as the control function on this project changes its review routes (on a project with none, whoever opened it).");
        var map = new Dictionary<Guid, Guid>();
        if (await RouteScopeAsync(db, access.Project.Id, cancellationToken) is null)
        {
            foreach (var route in await db.ReviewRoutes.AsNoTracking().Where(r => r.ProjectId == null).ToListAsync(cancellationToken))
            {
                var copy = new ReviewRoute
                {
                    TenantId = access.Project.TenantId, ProjectId = access.Project.Id, Name = route.Name, Description = route.Description,
                    IsDefault = route.IsDefault, Active = route.Active, Verdicts = route.Verdicts,
                    Patterns = route.Patterns.Select(x => new RoutePattern { DeliverableType = x.DeliverableType, DocType = x.DocType, Discipline = x.Discipline, Criticality = x.Criticality, Originator = x.Originator }).ToList(),
                    Steps = System.Text.Json.JsonSerializer.Deserialize<List<RouteStep>>(System.Text.Json.JsonSerializer.Serialize(route.Steps)) ?? [],
                };
                db.ReviewRoutes.Add(copy);
                map[route.Id] = copy.Id;
            }
            db.Add(new Settings.Setting
            {
                TenantId = access.Project.TenantId, ProjectId = access.Project.Id, Key = RoutesOwnKey, Value = "ON",
                UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = access.UserName,
            });
            await db.SaveChangesAsync(cancellationToken);
        }
        if (map.TryGetValue(routeId ?? Guid.Empty, out var mine)) http.Items["routes.route"] = mine;
        return await act(access.Project.Id);
    }

    /// <summary><c>GET /api/admin/routes/projects</c>: the projects offering their own copy of the review routes.</summary>
    private static async Task<IResult> RouteCopiesAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var rows = await db.Set<Settings.Setting>().AsNoTracking().Where(s => s.ProjectId != null && s.Key == RoutesOwnKey)
            .Join(db.Projects.AsNoTracking(), s => s.ProjectId, p => (Guid?)p.Id, (s, p) => new { p.Id, p.Code, p.Name, s.UpdatedAt, s.UpdatedByName })
            .OrderBy(x => x.Code).ToListAsync(cancellationToken);
        return Results.Ok(rows.Select(r => new { r.Id, r.Code, r.Name, Since = r.UpdatedAt.ToDateTimeOffset(), By = r.UpdatedByName }));
    }

    /// <summary>
    /// <c>POST /api/admin/routes/projects/{id}/reset</c> (owner: from the organization's Settings, for a mess only): the
    /// project offers the organization's routes again; its own go, reviews already sent keep their steps. Always with why,
    /// logged, its control function told.
    /// </summary>
    private static async Task<IResult> ResetRoutesAsync(Guid projectId, NumberingLevels.ResetRequest request, HttpContext http, DeliosDbContext db,
        AuditLog audit, Notifications.Notifier notifier, CancellationToken cancellationToken)
    {
        var reason = Blank(request.Reason);
        if (reason is null) return Problems.Invalid("REASON_REQUIRED", "Say why the project goes back to the organization's review routes.");
        var project = await db.Projects.AsNoTracking().SingleOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return Problems.NotFound("PROJECT_NOT_FOUND", "No such project.");
        var mark = await db.Set<Settings.Setting>().SingleOrDefaultAsync(s => s.ProjectId == projectId && s.Key == RoutesOwnKey, cancellationToken);
        if (mark is null) return Problems.Invalid("NOT_OWN", $"{project.Code} already offers the organization's review routes.");
        db.ReviewRoutes.RemoveRange(await db.ReviewRoutes.Where(r => r.ProjectId == projectId).ToListAsync(cancellationToken));
        db.Remove(mark);
        await db.SaveChangesAsync(cancellationToken);
        var actor = await ActorAsync(http, db, cancellationToken);
        await audit.WriteAsync(actor, "SETTING_RESET", "Project", project.Id, $"{project.Code}: review routes", reason, project.Id, cancellationToken);
        await notifier.NotifyAsync(project.TenantId, project.Id, await Actions.NoticeLog.HoldersAsync(db, project.Id, Verbs.Control, cancellationToken),
            Notifications.NotificationKinds.General, $"{project.Code} offers the organization's review routes again",
            $"{actor.Name} put {project.Code}'s review routes back to the organization's: {reason}. Reviews already sent keep their steps.",
            "/settings/workflow-templates", cancellationToken);
        return Results.NoContent();
    }

    /// <summary><c>GET /api/admin/routes</c>: every review route of the organization's, in use or not.</summary>
    private static async Task<IResult> RoutesAsync(DeliosDbContext db, Guid? scope, CancellationToken cancellationToken) =>
        Results.Ok(await RouteViewsAsync(db, scope, cancellationToken));

    /// <summary>The routes of one level (the organization's, or a project's own copy), in use or not.</summary>
    private static async Task<object[]> RouteViewsAsync(DeliosDbContext db, Guid? scope, CancellationToken cancellationToken)
    {
        var routes = await db.ReviewRoutes.AsNoTracking().Where(r => r.ProjectId == scope).OrderByDescending(r => r.IsDefault).ThenBy(r => r.Name).ToListAsync(cancellationToken);
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        // A route naming its own set of verdicts says which of the deliverable types it serves that set does not (owner:
        // a warning, never a refusal).
        return routes.Select(r => (object)new
        {
            r.Id, r.Name, r.Description, r.IsDefault, r.Active, r.Patterns, r.Steps, VerdictSet = ReviewSets.Verdicts, r.Verdicts,
            VerdictsMismatch = r.Verdicts is null ? [] : r.Patterns.Select(p => p.DeliverableType).OfType<string>().Distinct()
                .Where(t => catalog.ServingSetName(ReviewSets.Verdicts, t) != r.Verdicts).ToArray(),
        }).ToArray();
    }

    private static async Task<IResult?> CheckStepsAsync(DeliosDbContext db, RouteStep[] steps, CancellationToken cancellationToken)
    {
        if (steps.Length == 0) return Problems.Invalid("STEPS_REQUIRED", "A route has at least one step: the one that decides.");
        foreach (var step in steps)
        {
            if (string.IsNullOrWhiteSpace(step.Title)) return Problems.Invalid("STEP_TITLE_REQUIRED", "Every step has a title.");
            step.UserIds ??= [];
            step.GrantsStatuses ??= [];
            var ours = step.FunctionCode is not null || step.UserIds.Length > 0;
            if (ours == (step.PartyCode is not null))
                return Problems.Invalid("STEP_ANSWERER_REQUIRED", $"{step.Title}: a step is answered by one function of ours and people of ours named on it, or by one organization.");
            if (step.UserIds.Length > 0)
            {
                var ids = step.UserIds.Distinct().ToArray();
                if (await db.Users.CountAsync(u => ids.Contains(u.Id) && u.Active && (u.PartyId == null || u.Party!.IsInternal), cancellationToken) != ids.Length)
                    return Problems.Invalid("STEP_PERSON_UNKNOWN", $"{step.Title}: everybody named on a step is one of our people, still active.");
                step.UserIds = ids;
            }
            if (step.Mode is not (StepModes.Any or StepModes.All))
                return Problems.Invalid("STEP_MODE_INVALID", $"{step.Title}: the first answer closes it (ANY), or everyone answers (ALL).");
            if (step.FunctionCode is { } function && !await db.Functions.AnyAsync(f => f.Code == function && f.Active, cancellationToken))
                return Problems.Invalid("FUNCTION_UNKNOWN", $"{step.Title}: {function} is not a function in use.");
            if (step.PartyCode is { } party && !await db.Parties.AnyAsync(p => p.Code == party && p.Active, cancellationToken))
                return Problems.Invalid("PARTY_UNKNOWN", $"{step.Title}: {party} is not an organization taking part.");
            // A step another organization answers goes to them on a transmittal: it says why (a published reason for issue).
            if (step.PartyCode is not null)
            {
                step.Reason = Blank(step.Reason);
                if (step.Reason is null)
                    return Problems.Invalid("STEP_REASON_REQUIRED", $"{step.Title}: say why it goes to {step.PartyCode}, the reason for issue on the transmittal.");
                if (!(await Catalog.LoadAsync(db, cancellationToken)).IsActive(Transmittals.TransmittalSets.Reasons, step.Reason))
                    return Problems.Invalid("VALUE_NOT_PUBLISHED", $"{step.Title}: {step.Reason} is not a published reason for issue.");
            }
            else step.Reason = null;
        }
        return null;
    }

    /// <summary>A route's own set of the review outcomes, by name: there, with a verdict that lets a revision proceed. Empty: none.</summary>
    private static async Task<(string? Set, IResult? Problem)> CheckVerdictsAsync(DeliosDbContext db, string? requested, CancellationToken cancellationToken)
    {
        var name = Blank(requested);
        if (name is null) return (null, null);
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        if (catalog.SetNamed(ReviewSets.Verdicts, name) is null)
            return (null, Problems.Invalid("VERDICT_SET_UNKNOWN", $"The review outcomes have no set called {name}."));
        var codes = catalog.ActiveIn(ReviewSets.Verdicts, name);
        if (codes.Count == 0) return (null, Problems.Invalid("VERDICT_SET_EMPTY", $"{name} has no verdicts yet: add them in Types & sets, Review outcomes."));
        if (!codes.Any(c => ReviewSets.Proceeds(catalog, ReviewSets.Verdicts, c)))
            return (null, Problems.Invalid("VERDICT_SET_NEVER_PROCEEDS",
                $"None of the verdicts of {name} means accepted yet, so no revision could be released from it: give one that meaning in Types & sets."));
        return (name, null);
    }

    /// <summary><c>POST /api/admin/routes</c>: a new review route.</summary>
    private static async Task<IResult> CreateRouteAsync(Guid? scope,
        RouteRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var name = Blank(request.Name);
        if (name is null) return Problems.Invalid("NAME_REQUIRED", "A route has a name.");
        if (await db.ReviewRoutes.AnyAsync(r => r.ProjectId == scope && r.Name == name, cancellationToken))
            return Problems.Invalid("NAME_TAKEN", $"A route is already called {name}.");
        var steps = request.Steps ?? [];
        if (await CheckStepsAsync(db, steps, cancellationToken) is { } problem) return problem;
        var (verdicts, setProblem) = await CheckVerdictsAsync(db, request.Verdicts, cancellationToken);
        if (setProblem is not null) return setProblem;
        var route = new ReviewRoute
        {
            Verdicts = verdicts,
            TenantId = http.User.TenantId(),
            ProjectId = scope,
            Name = name,
            Description = Blank(request.Description),
            IsDefault = request.IsDefault ?? false,
            Active = request.Active ?? true,
            Patterns = (request.Patterns ?? []).ToList(),
            Steps = steps.ToList(),
        };
        if (route.IsDefault) await db.ReviewRoutes.Where(r => r.ProjectId == scope && r.IsDefault).ExecuteUpdateAsync(r => r.SetProperty(x => x.IsDefault, false), cancellationToken);
        db.ReviewRoutes.Add(route);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "ROUTE_CREATED", "ReviewRoute", route.Id, name,
            string.Join(" → ", steps.Select(s => s.Title)), scope, cancellationToken);
        return Results.Created($"/api/admin/routes/{route.Id}", new { route.Id });
    }

    /// <summary><c>PUT /api/admin/routes/{id}</c>: changes a route. Reviews already running keep the steps they started with.</summary>
    private static async Task<IResult> UpdateRouteAsync(Guid? scope,
        Guid routeId, RouteRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        if (http.Items["routes.route"] is Guid mine) routeId = mine;
        var route = await db.ReviewRoutes.SingleOrDefaultAsync(r => r.Id == routeId && r.ProjectId == scope, cancellationToken);
        if (route is null) return Problems.NotFound("ROUTE_NOT_FOUND", "No such route.");
        var changes = new List<string>();
        if (Blank(request.Name) is { } name && name != route.Name)
        {
            if (await db.ReviewRoutes.AnyAsync(r => r.ProjectId == scope && r.Name == name && r.Id != route.Id, cancellationToken))
                return Problems.Invalid("NAME_TAKEN", $"A route is already called {name}.");
            changes.Add($"name → {name}");
            route.Name = name;
        }
        if (request.Description is not null && Blank(request.Description) != route.Description) { route.Description = Blank(request.Description); changes.Add("description"); }
        if (request.IsDefault is { } isDefault && isDefault != route.IsDefault)
        {
            if (isDefault) await db.ReviewRoutes.Where(r => r.ProjectId == scope && r.IsDefault && r.Id != route.Id).ExecuteUpdateAsync(r => r.SetProperty(x => x.IsDefault, false), cancellationToken);
            route.IsDefault = isDefault;
            changes.Add(isDefault ? "the default" : "not the default");
        }
        if (request.Active is { } active && active != route.Active) { changes.Add(active ? "in use" : "out of use"); route.Active = active; }
        if (request.Verdicts is not null)
        {
            var (verdicts, setProblem) = await CheckVerdictsAsync(db, request.Verdicts, cancellationToken);
            if (setProblem is not null) return setProblem;
            if (verdicts != route.Verdicts)
            {
                route.Verdicts = verdicts;
                changes.Add(verdicts is null ? "decides from the verdicts serving each document" : $"decides from the verdicts {verdicts}");
            }
        }
        if (request.Patterns is { } patterns) { route.Patterns = patterns.ToList(); changes.Add($"serves {patterns.Length} pattern(s)"); }
        if (request.Steps is { } steps)
        {
            if (await CheckStepsAsync(db, steps, cancellationToken) is { } problem) return problem;
            route.Steps = steps.ToList();
            changes.Add($"steps → {string.Join(" → ", steps.Select(s => s.Title))}");
        }
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "ROUTE_UPDATED", "ReviewRoute", route.Id, route.Name,
            string.Join("; ", changes), scope, cancellationToken);
        return Results.NoContent();
    }

    // ── The audit trail ─────────────────────────────────────────────────────

    /// <summary>
    /// <c>GET /api/admin/audit</c>: the organization's audit trail, newest first, a page at a time. Narrowed here, never
    /// on the screen: free text (who, what, detail), a kind of act (<see cref="AuditKinds"/>), an act, an entity type,
    /// a project, a person, and a date range (UTC days). Each row says its kind; the kinds come with their counts.
    /// </summary>
    private static async Task<IResult> AuditAsync(
        DeliosDbContext db, CancellationToken cancellationToken, string? q = null, string? kind = null, string? action = null, string? entityType = null,
        Guid? projectId = null, Guid? actorId = null, DateOnly? from = null, DateOnly? to = null, int page = 1, int per = 50)
    {
        per = Math.Clamp(per, 10, 200);
        page = Math.Max(1, page);
        var query = db.AuditEvents.AsNoTracking();
        if (Blank(entityType) is { } t) query = query.Where(e => e.EntityType == t);
        if (projectId is { } p) query = query.Where(e => e.ProjectId == p);
        if (actorId is { } who) query = query.Where(e => e.ActorId == who);
        if (from is { } f) { var start = LocalDate.FromDateOnly(f).AtStartOfDayInZone(DateTimeZone.Utc).ToInstant(); query = query.Where(e => e.At >= start); }
        if (to is { } u) { var end = LocalDate.FromDateOnly(u).PlusDays(1).AtStartOfDayInZone(DateTimeZone.Utc).ToInstant(); query = query.Where(e => e.At < end); }
        if (Blank(q) is { } text)
        {
            var pattern = $"%{text.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_")}%";
            query = query.Where(e => EF.Functions.ILike(e.ActorName, pattern) || EF.Functions.ILike(e.Action, pattern)
                || (e.EntityLabel != null && EF.Functions.ILike(e.EntityLabel, pattern)) || (e.Detail != null && EF.Functions.ILike(e.Detail, pattern)));
        }
        // The kinds, counted over everything narrowed so far but the kind itself, so each count says what choosing it gives.
        var actions = await query.GroupBy(e => e.Action).Select(g => new { Action = g.Key, Count = g.Count() }).ToListAsync(cancellationToken);
        var kinds = AuditKinds.All.Select(k => new { k.Key, k.Label, Count = actions.Where(a => AuditKinds.Of(a.Action) == k.Key).Sum(a => a.Count) })
            .ToList();
        if (Blank(kind) is { } chosen)
        {
            var codes = actions.Where(a => AuditKinds.Of(a.Action) == chosen).Select(a => a.Action).ToArray();
            query = query.Where(e => codes.Contains(e.Action));
        }
        if (Blank(action) is { } a) query = query.Where(e => e.Action == a);
        var total = await query.CountAsync(cancellationToken);
        var rows = await query.OrderByDescending(e => e.Id).Skip((page - 1) * per).Take(per).ToListAsync(cancellationToken);
        var projects = await db.Projects.AsNoTracking().Select(x => new { x.Id, x.Code }).ToDictionaryAsync(x => x.Id, x => x.Code, cancellationToken);
        var documents = await AuditKinds.DocumentsOfAsync(db, rows, cancellationToken);
        var names = await AuditKinds.NamesInAsync(db, rows, cancellationToken);
        return Results.Ok(new
        {
            total,
            page,
            per,
            pages = Math.Max(1, (total + per - 1) / per),
            kinds,
            actions = actions.OrderByDescending(x => x.Count).Select(x => new { x.Action, x.Count, Kind = AuditKinds.Of(x.Action) }),
            rows = rows.Select(e => new
            {
                e.Id,
                At = e.At.ToDateTimeOffset(),
                e.ActorId,
                e.ActorName,
                e.Action,
                Kind = AuditKinds.Of(e.Action),
                e.EntityType,
                e.EntityId,
                e.EntityLabel,
                Detail = AuditKinds.Readable(e.Detail, names),
                e.ProjectId,
                Project = e.ProjectId is { } pid ? projects.GetValueOrDefault(pid) : null,
                DocumentId = e.EntityId is { } eid && documents.TryGetValue(eid, out var did) ? did : (Guid?)null,
            }),
        });
    }
}
