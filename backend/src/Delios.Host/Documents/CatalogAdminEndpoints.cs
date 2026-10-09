using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Reviews;
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
public sealed record SchemeRequest(string? Name, string? Delimiter = null, bool? Active = null, SchemeField[]? Fields = null);

/// <summary>Body of routing a deliverable type (or a record kind such as @TRANSMITTAL) to a numbering scheme. No scheme: unrouted.</summary>
public sealed record SchemeRoutingRequest(string? DeliverableType, Guid? SchemeId);

/// <summary>Body of creating or changing a review route. A null field is left as it is; lists, when given, replace.</summary>
public sealed record RouteRequest(
    string? Name = null, string? Description = null, bool? IsDefault = null, bool? Active = null, RoutePattern[]? Patterns = null,
    RouteStep[]? Steps = null, string? VerdictSet = null);

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

        // Document Control keeps these day to day, as well as administrators.
        var keepers = app.MapGroup("/api/admin").WithTags("Administration")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Filter);
        keepers.MapGet("/numbering", NumberingAsync);
        keepers.MapPost("/numbering/schemes", CreateSchemeAsync);
        keepers.MapPut("/numbering/schemes/{schemeId:guid}", UpdateSchemeAsync);
        keepers.MapPut("/numbering/routing", RouteSchemeAsync);
        keepers.MapGet("/routes", RoutesAsync);
        keepers.MapPost("/routes", CreateRouteAsync);
        keepers.MapPut("/routes/{routeId:guid}", UpdateRouteAsync);
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
        var value = await db.ValueEntries.SingleOrDefaultAsync(v => v.SetKey == set && v.Code == code, cancellationToken);
        var changes = new List<string>();
        if (value is null)
        {
            var label = Blank(request.Label);
            if (label is null) return Problems.Invalid("LABEL_REQUIRED", "A value has a label people read.");
            var sort = request.Sort ?? (await db.ValueEntries.Where(v => v.SetKey == set).MaxAsync(v => (int?)v.Sort, cancellationToken) ?? 0) + 10;
            value = new ValueEntry { TenantId = http.User.TenantId(), SetKey = set, Code = code, Label = label, Sort = sort, Status = status ?? ValueStatus.Active };
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

    // ── Numbering ───────────────────────────────────────────────────────────

    /// <summary><c>GET /api/admin/numbering</c>: the numbering schemes, which scheme numbers what, and the revision schemes.</summary>
    private static async Task<IResult> NumberingAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var schemes = await db.NumberingSchemes.AsNoTracking().OrderBy(s => s.Name).ToListAsync(cancellationToken);
        var routing = await db.SchemeRoutings.AsNoTracking().OrderBy(r => r.DeliverableType).ToListAsync(cancellationToken);
        var revisions = await db.RevisionSchemes.AsNoTracking().OrderBy(s => s.Name).ToListAsync(cancellationToken);
        var revisionRouting = await db.RevisionSchemeRoutings.AsNoTracking().ToListAsync(cancellationToken);
        return Results.Ok(new
        {
            Schemes = schemes.Select(s => new { s.Id, s.Name, s.Delimiter, s.Active, s.Fields }),
            Routing = routing.Select(r => new { r.Id, r.DeliverableType, r.SchemeId, r.Active }),
            RevisionSchemes = revisions.Select(s => new { s.Id, s.Name, s.IsDefault, s.ForwardOnly, s.Series }),
            RevisionRouting = revisionRouting.Select(r => new { r.DeliverableType, r.SchemeId }),
        });
    }

    private static IResult? CheckFields(SchemeField[] fields)
    {
        if (fields.Length == 0) return Problems.Invalid("FIELDS_REQUIRED", "A number is built from at least one field.");
        string[] sources = [FieldSources.Project, FieldSources.Subproject, FieldSources.Originator, FieldSources.ContractRef, FieldSources.Discipline,
            FieldSources.DocType, FieldSources.Sequence, FieldSources.Fixed, FieldSources.Sender, FieldSources.Receiver];
        if (fields.FirstOrDefault(f => !sources.Contains(f.Source)) is { } bad)
            return Problems.Invalid("FIELD_SOURCE_UNKNOWN", $"{bad.Source} is not something a number can be built from.", new { source = bad.Source });
        if (fields.Count(f => f.Source == FieldSources.Sequence) != 1)
            return Problems.Invalid("SEQUENCE_REQUIRED", "A number has exactly one sequence, so no two documents share it.");
        if (fields.Any(f => f.Source == FieldSources.Fixed && string.IsNullOrWhiteSpace(f.Value)))
            return Problems.Invalid("FIXED_VALUE_REQUIRED", "A fixed field says the text it always holds.");
        return null;
    }

    /// <summary><c>POST /api/admin/numbering/schemes</c>: a new numbering scheme.</summary>
    private static async Task<IResult> CreateSchemeAsync(
        SchemeRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var name = Blank(request.Name);
        if (name is null) return Problems.Invalid("NAME_REQUIRED", "A scheme has a name.");
        var fields = request.Fields ?? [];
        if (CheckFields(fields) is { } problem) return problem;
        var scheme = new NumberingScheme
        {
            TenantId = http.User.TenantId(),
            Name = name,
            Delimiter = request.Delimiter ?? "-",
            Active = request.Active ?? true,
            Fields = fields.ToList(),
        };
        db.NumberingSchemes.Add(scheme);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "NUMBERING_SCHEME_CREATED", "NumberingScheme", scheme.Id, name,
            string.Join(scheme.Delimiter, fields.Select(f => f.Label)), cancellationToken: cancellationToken);
        return Results.Created($"/api/admin/numbering/schemes/{scheme.Id}", new { scheme.Id });
    }

    /// <summary>
    /// <c>PUT /api/admin/numbering/schemes/{id}</c>: changes a scheme. Numbers already given are kept as they are; the
    /// change applies to the next number.
    /// </summary>
    private static async Task<IResult> UpdateSchemeAsync(
        Guid schemeId, SchemeRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var scheme = await db.NumberingSchemes.SingleOrDefaultAsync(s => s.Id == schemeId, cancellationToken);
        if (scheme is null) return Problems.NotFound("SCHEME_NOT_FOUND", "No such numbering scheme.");
        var changes = new List<string>();
        if (Blank(request.Name) is { } name && name != scheme.Name) { changes.Add($"name → {name}"); scheme.Name = name; }
        if (request.Delimiter is { } delimiter && delimiter != scheme.Delimiter) { changes.Add($"delimiter → '{delimiter}'"); scheme.Delimiter = delimiter; }
        if (request.Active is { } active && active != scheme.Active) { changes.Add(active ? "in use" : "out of use"); scheme.Active = active; }
        if (request.Fields is { } fields)
        {
            if (CheckFields(fields) is { } problem) return problem;
            scheme.Fields = fields.ToList();
            changes.Add($"fields → {string.Join(scheme.Delimiter, fields.Select(f => f.Label))}");
        }
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "NUMBERING_SCHEME_UPDATED", "NumberingScheme", scheme.Id, scheme.Name,
            string.Join("; ", changes), cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    /// <summary><c>PUT /api/admin/numbering/routing</c>: which scheme numbers a deliverable type or a record kind.</summary>
    private static async Task<IResult> RouteSchemeAsync(
        SchemeRoutingRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var type = Blank(request.DeliverableType);
        if (type is null) return Problems.Invalid("DELIVERABLE_TYPE_REQUIRED", "Say what the scheme numbers.");
        if (request.SchemeId is { } id && !await db.NumberingSchemes.AnyAsync(s => s.Id == id, cancellationToken))
            return Problems.Invalid("SCHEME_NOT_FOUND", "No such numbering scheme.");
        var routing = await db.SchemeRoutings.SingleOrDefaultAsync(r => r.DeliverableType == type, cancellationToken);
        if (request.SchemeId is null)
        {
            if (routing is null) return Results.NoContent();
            routing.Active = false;
        }
        else if (routing is null)
        {
            db.SchemeRoutings.Add(new SchemeRouting { TenantId = http.User.TenantId(), DeliverableType = type, SchemeId = request.SchemeId.Value });
        }
        else
        {
            routing.SchemeId = request.SchemeId.Value;
            routing.Active = true;
        }
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "NUMBERING_ROUTED", "SchemeRouting", null, type,
            request.SchemeId is null ? "unrouted" : $"scheme {request.SchemeId}", cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    // ── Review routes ───────────────────────────────────────────────────────

    /// <summary><c>GET /api/admin/routes</c>: every review route, in use or not.</summary>
    private static async Task<IResult> RoutesAsync(DeliosDbContext db, CancellationToken cancellationToken) =>
        Results.Ok(await db.ReviewRoutes.AsNoTracking().OrderByDescending(r => r.IsDefault).ThenBy(r => r.Name)
            .Select(r => new { r.Id, r.Name, r.Description, r.IsDefault, r.Active, r.Patterns, r.Steps, VerdictSet = r.VerdictSet ?? ReviewSets.Verdicts })
            .ToListAsync(cancellationToken));

    private static async Task<IResult?> CheckStepsAsync(DeliosDbContext db, RouteStep[] steps, CancellationToken cancellationToken)
    {
        if (steps.Length == 0) return Problems.Invalid("STEPS_REQUIRED", "A route has at least one step: the one that decides.");
        foreach (var step in steps)
        {
            if (string.IsNullOrWhiteSpace(step.Title)) return Problems.Invalid("STEP_TITLE_REQUIRED", "Every step has a title.");
            step.UserIds ??= [];
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
        }
        return null;
    }

    /// <summary>A route's own verdict list: published, with a verdict that lets it proceed. Null: the review outcomes.</summary>
    private static async Task<(string? Set, IResult? Problem)> CheckVerdictSetAsync(DeliosDbContext db, string? requested, CancellationToken cancellationToken)
    {
        var set = Blank(requested);
        if (set is null || set == ReviewSets.Verdicts) return (null, null);
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var codes = await db.ValueEntries.AsNoTracking().Where(v => v.SetKey == set && v.Status == ValueStatus.Active).Select(v => v.Code).ToListAsync(cancellationToken);
        if (codes.Count == 0) return (null, Problems.Invalid("VERDICT_SET_EMPTY", $"{set} has no published values to decide from."));
        if (!codes.Any(c => ReviewSets.Proceeds(catalog, set, c)))
            return (null, Problems.Invalid("VERDICT_SET_NEVER_PROCEEDS", $"No verdict of {set} lets a revision go on to release (proceed)."));
        return (set, null);
    }

    /// <summary><c>POST /api/admin/routes</c>: a new review route.</summary>
    private static async Task<IResult> CreateRouteAsync(
        RouteRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var name = Blank(request.Name);
        if (name is null) return Problems.Invalid("NAME_REQUIRED", "A route has a name.");
        var steps = request.Steps ?? [];
        if (await CheckStepsAsync(db, steps, cancellationToken) is { } problem) return problem;
        var (verdictSet, setProblem) = await CheckVerdictSetAsync(db, request.VerdictSet, cancellationToken);
        if (setProblem is not null) return setProblem;
        var route = new ReviewRoute
        {
            VerdictSet = verdictSet,
            TenantId = http.User.TenantId(),
            Name = name,
            Description = Blank(request.Description),
            IsDefault = request.IsDefault ?? false,
            Active = request.Active ?? true,
            Patterns = (request.Patterns ?? []).ToList(),
            Steps = steps.ToList(),
        };
        if (route.IsDefault) await db.ReviewRoutes.Where(r => r.IsDefault).ExecuteUpdateAsync(r => r.SetProperty(x => x.IsDefault, false), cancellationToken);
        db.ReviewRoutes.Add(route);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "ROUTE_CREATED", "ReviewRoute", route.Id, name,
            string.Join(" → ", steps.Select(s => s.Title)), cancellationToken: cancellationToken);
        return Results.Created($"/api/admin/routes/{route.Id}", new { route.Id });
    }

    /// <summary><c>PUT /api/admin/routes/{id}</c>: changes a route. Reviews already running keep the steps they started with.</summary>
    private static async Task<IResult> UpdateRouteAsync(
        Guid routeId, RouteRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var route = await db.ReviewRoutes.SingleOrDefaultAsync(r => r.Id == routeId, cancellationToken);
        if (route is null) return Problems.NotFound("ROUTE_NOT_FOUND", "No such route.");
        var changes = new List<string>();
        if (Blank(request.Name) is { } name && name != route.Name) { changes.Add($"name → {name}"); route.Name = name; }
        if (request.Description is not null && Blank(request.Description) != route.Description) { route.Description = Blank(request.Description); changes.Add("description"); }
        if (request.IsDefault is { } isDefault && isDefault != route.IsDefault)
        {
            if (isDefault) await db.ReviewRoutes.Where(r => r.IsDefault && r.Id != routeId).ExecuteUpdateAsync(r => r.SetProperty(x => x.IsDefault, false), cancellationToken);
            route.IsDefault = isDefault;
            changes.Add(isDefault ? "the default" : "not the default");
        }
        if (request.Active is { } active && active != route.Active) { changes.Add(active ? "in use" : "out of use"); route.Active = active; }
        if (request.VerdictSet is not null)
        {
            var (verdictSet, setProblem) = await CheckVerdictSetAsync(db, request.VerdictSet, cancellationToken);
            if (setProblem is not null) return setProblem;
            if (verdictSet != route.VerdictSet) { route.VerdictSet = verdictSet; changes.Add($"decides from {verdictSet ?? ReviewSets.Verdicts}"); }
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
            string.Join("; ", changes), cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    // ── The audit trail ─────────────────────────────────────────────────────

    /// <summary>
    /// <c>GET /api/admin/audit</c>: the organization's audit trail, newest first, a page at a time. Filters: free text
    /// (who, what, detail), an action, an entity type, a project, and a date range (UTC days).
    /// </summary>
    private static async Task<IResult> AuditAsync(
        DeliosDbContext db, CancellationToken cancellationToken, string? q = null, string? action = null, string? entityType = null,
        Guid? projectId = null, DateOnly? from = null, DateOnly? to = null, int page = 1, int per = 50)
    {
        per = Math.Clamp(per, 10, 200);
        page = Math.Max(1, page);
        var query = db.AuditEvents.AsNoTracking();
        if (Blank(action) is { } a) query = query.Where(e => e.Action == a);
        if (Blank(entityType) is { } t) query = query.Where(e => e.EntityType == t);
        if (projectId is { } p) query = query.Where(e => e.ProjectId == p);
        if (from is { } f) { var start = LocalDate.FromDateOnly(f).AtStartOfDayInZone(DateTimeZone.Utc).ToInstant(); query = query.Where(e => e.At >= start); }
        if (to is { } u) { var end = LocalDate.FromDateOnly(u).PlusDays(1).AtStartOfDayInZone(DateTimeZone.Utc).ToInstant(); query = query.Where(e => e.At < end); }
        if (Blank(q) is { } text)
        {
            var pattern = $"%{text.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_")}%";
            query = query.Where(e => EF.Functions.ILike(e.ActorName, pattern) || EF.Functions.ILike(e.Action, pattern)
                || (e.EntityLabel != null && EF.Functions.ILike(e.EntityLabel, pattern)) || (e.Detail != null && EF.Functions.ILike(e.Detail, pattern)));
        }
        var total = await query.CountAsync(cancellationToken);
        var rows = await query.OrderByDescending(e => e.Id).Skip((page - 1) * per).Take(per).ToListAsync(cancellationToken);
        var actions = await db.AuditEvents.AsNoTracking().GroupBy(e => e.Action).Select(g => new { Action = g.Key, Count = g.Count() })
            .OrderByDescending(g => g.Count).ToListAsync(cancellationToken);
        return Results.Ok(new
        {
            total,
            page,
            per,
            pages = Math.Max(1, (total + per - 1) / per),
            actions,
            rows = rows.Select(e => new
            {
                e.Id,
                At = e.At.ToDateTimeOffset(),
                e.ActorId,
                e.ActorName,
                e.Action,
                e.EntityType,
                e.EntityId,
                e.EntityLabel,
                e.Detail,
                e.ProjectId,
            }),
        });
    }
}
