using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Settings;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>
/// Numbering on two levels (owner). The organization's schemes and which scheme numbers what (project empty) are the
/// numbering of every project; an administrator changes them, for all. A project reads them, and changes them only where
/// the organization left numbering free (<see cref="Liberty"/>): its first change gives it its own copy, which later changes
/// of the organization never touch (<c>NUMBERING_OWN</c>). A scheme that gave a number keeps its parts and delimiter
/// (renamed or retired only, SCHEME_IN_USE); one that never did is changed entirely or deleted.
/// </summary>
public static class NumberingLevels
{
    /// <summary>The project's setting saying it numbers by its own copy.</summary>
    public const string OwnKey = "NUMBERING_OWN";

    /// <summary>The numbering a project uses: its own copy where it made one (its id), else the organization's (null).</summary>
    public static async Task<Guid?> ScopeAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken) =>
        await db.Set<Setting>().AnyAsync(s => s.ProjectId == projectId && s.Key == OwnKey, cancellationToken) ? projectId : null;

    public static void MapNumberingEndpoints(this IEndpointRouteBuilder app)
    {
        // The organization's: read by whoever keeps the register, changed by an administrator only.
        var read = app.MapGroup("/api/admin").WithTags("Administration").AddEndpointFilter<TransactionFilter>().AddEndpointFilter(Keepers.Filter);
        read.MapGet("/numbering", (DeliosDbContext db, CancellationToken c) => ViewAsync(db, null, c));
        var org = app.MapGroup("/api/admin/numbering").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("The organization's numbering is the same on every project: an administrator changes it."));
        org.MapPost("/schemes", (SchemeRequest r, HttpContext h, DeliosDbContext db, AuditLog a, CancellationToken c) => CreateAsync(null, r, h, db, a, c));
        org.MapPut("/schemes/{schemeId:guid}", (Guid schemeId, SchemeRequest r, HttpContext h, DeliosDbContext db, AuditLog a, CancellationToken c) =>
            UpdateAsync(null, schemeId, r, h, db, a, c));
        org.MapDelete("/schemes/{schemeId:guid}", (Guid schemeId, HttpContext h, DeliosDbContext db, AuditLog a, CancellationToken c) =>
            DeleteAsync(null, schemeId, h, db, a, c));
        org.MapPut("/routing", (SchemeRoutingRequest r, HttpContext h, DeliosDbContext db, AuditLog a, CancellationToken c) => RouteAsync(null, r, h, db, a, c));

        // A project's: what it numbers by, and, where numbering is free, its own copy.
        var project = app.MapGroup("/api/projects/{projectId:guid}/numbering").WithTags("Settings")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
        {
            var access = ProjectAccessFilter.Of(h);
            var scope = await ScopeAsync(db, access.Project.Id, c);
            var free = await Liberty.IsFreeAsync(db, Liberty.Numbering, c);
            var view = await ReadAsync(db, scope, c);
            return Results.Ok(new
            {
                view.Schemes, view.Routing, Own = scope is not null, Free = free,
                MayChange = free && await ProjectLists.MayChangeAsync(db, access, c),
                MayChangeOrganization = await Keepers.ConfiguresAsync(h),
            });
        });
        project.MapPost("/schemes", (SchemeRequest r, HttpContext h, DeliosDbContext db, AuditLog a, IClock clock, CancellationToken c) =>
            ProjectAsync(h, db, clock, c, scope => CreateAsync(scope, r, h, db, a, c)));
        project.MapPut("/schemes/{schemeId:guid}", (Guid schemeId, SchemeRequest r, HttpContext h, DeliosDbContext db, AuditLog a, IClock clock, CancellationToken c) =>
            ProjectAsync(h, db, clock, c, scope => UpdateAsync(scope, schemeId, r, h, db, a, c), schemeId));
        project.MapDelete("/schemes/{schemeId:guid}", (Guid schemeId, HttpContext h, DeliosDbContext db, AuditLog a, IClock clock, CancellationToken c) =>
            ProjectAsync(h, db, clock, c, scope => DeleteAsync(scope, schemeId, h, db, a, c), schemeId));
        project.MapPut("/routing", (SchemeRoutingRequest r, HttpContext h, DeliosDbContext db, AuditLog a, IClock clock, CancellationToken c) =>
            ProjectAsync(h, db, clock, c, scope => RouteAsync(scope, r, h, db, a, c), r.SchemeId, routing: true));
    }

    private sealed record View(object[] Schemes, object[] Routing);

    private static async Task<View> ReadAsync(DeliosDbContext db, Guid? scope, CancellationToken cancellationToken)
    {
        var schemes = await db.NumberingSchemes.AsNoTracking().Where(s => s.ProjectId == scope).OrderBy(s => s.Name).ToListAsync(cancellationToken);
        var routing = await db.SchemeRoutings.AsNoTracking().Where(r => r.ProjectId == scope).OrderBy(r => r.DeliverableType).ToListAsync(cancellationToken);
        return new(
            schemes.Select(s => (object)new { s.Id, s.Name, s.Delimiter, s.Active, s.Notes, s.Used, s.Fields }).ToArray(),
            routing.Select(r => (object)new { r.Id, r.DeliverableType, r.SchemeId, r.Active }).ToArray());
    }

    /// <summary><c>GET /api/admin/numbering</c>: the organization's schemes and routing, and the revision schemes.</summary>
    private static async Task<IResult> ViewAsync(DeliosDbContext db, Guid? scope, CancellationToken cancellationToken)
    {
        var view = await ReadAsync(db, scope, cancellationToken);
        var revisions = await db.RevisionSchemes.AsNoTracking().OrderBy(s => s.Name).ToListAsync(cancellationToken);
        var revisionRouting = await db.RevisionSchemeRoutings.AsNoTracking().ToListAsync(cancellationToken);
        return Results.Ok(new
        {
            view.Schemes, view.Routing,
            RevisionSchemes = revisions.Select(s => new { s.Id, s.Name, s.IsDefault, s.ForwardOnly, s.Series }),
            RevisionRouting = revisionRouting.Select(r => new { r.DeliverableType, r.SchemeId }),
        });
    }

    /// <summary>
    /// A change on a project: only where numbering is free and by whoever changes the project's settings; the project's own
    /// copy is made first. A scheme named is translated to the copy's (the same name).
    /// </summary>
    private static async Task<IResult> ProjectAsync(HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken,
        Func<Guid?, Task<IResult>> act, Guid? schemeId = null, bool routing = false)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!await Liberty.IsFreeAsync(db, Liberty.Numbering, cancellationToken))
            return Problems.Forbidden("NUMBERING_FIXED", "Numbering is the organization's, the same on every project: an administrator changes it on the organization's page.");
        if (!await ProjectLists.MayChangeAsync(db, access, cancellationToken))
            return Problems.Forbidden("CONTROL_ONLY", "Whoever acts as the control function on this project changes its numbering (on a project with none, whoever opened it).");
        var copied = await EnsureOwnAsync(db, access, clock, cancellationToken);
        if (copied.TryGetValue(schemeId ?? Guid.Empty, out var mine))
        {
            // The request named the organization's scheme it was shown: it now means the project's copy of it.
            http.Items["numbering.scheme"] = mine;
        }
        return await act(access.Project.Id);
    }

    /// <summary>The scheme a project request means: the copy of the organization's one it named, else that one.</summary>
    private static Guid Mapped(HttpContext http, Guid schemeId) => http.Items["numbering.scheme"] is Guid mine ? mine : schemeId;

    /// <summary>The project's own copy of the organization's numbering, made once; returns the organization's scheme ids and their copies.</summary>
    private static async Task<Dictionary<Guid, Guid>> EnsureOwnAsync(DeliosDbContext db, ProjectAccess access, IClock clock, CancellationToken cancellationToken)
    {
        var map = new Dictionary<Guid, Guid>();
        if (await ScopeAsync(db, access.Project.Id, cancellationToken) is not null) return map;
        var schemes = await db.NumberingSchemes.AsNoTracking().Where(s => s.ProjectId == null).ToListAsync(cancellationToken);
        foreach (var scheme in schemes)
        {
            var copy = new NumberingScheme
            {
                TenantId = access.Project.TenantId, ProjectId = access.Project.Id, Name = scheme.Name, Delimiter = scheme.Delimiter,
                Active = scheme.Active, Notes = scheme.Notes,
                Fields = scheme.Fields.Select(f => new SchemeField { Label = f.Label, Source = f.Source, Value = f.Value, Digits = f.Digits }).ToList(),
            };
            db.NumberingSchemes.Add(copy);
            map[scheme.Id] = copy.Id;
        }
        foreach (var route in await db.SchemeRoutings.AsNoTracking().Where(r => r.ProjectId == null).ToListAsync(cancellationToken))
            if (map.TryGetValue(route.SchemeId, out var schemeId))
                db.SchemeRoutings.Add(new SchemeRouting
                {
                    TenantId = access.Project.TenantId, ProjectId = access.Project.Id, DeliverableType = route.DeliverableType, SchemeId = schemeId, Active = route.Active,
                });
        db.Add(new Setting
        {
            TenantId = access.Project.TenantId, ProjectId = access.Project.Id, Key = OwnKey, Value = "ON",
            UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = access.UserName,
        });
        await db.SaveChangesAsync(cancellationToken);
        return map;
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static async Task<Actor> ActorAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var id = http.User.UserId();
        return new Actor(id, await db.Users.Where(u => u.Id == id).Select(u => u.Name).SingleAsync(cancellationToken));
    }

    private static async Task<IResult?> CheckFieldsAsync(DeliosDbContext db, Guid? scope, SchemeField[] fields, CancellationToken cancellationToken)
    {
        if (fields.Length == 0) return Problems.Invalid("FIELDS_REQUIRED", "A number is built from at least one part.");
        string[] sources = [FieldSources.Project, FieldSources.Subproject, FieldSources.Originator, FieldSources.ContractRef, FieldSources.Discipline,
            FieldSources.DocType, FieldSources.Sequence, FieldSources.Fixed, FieldSources.Sender, FieldSources.Receiver];
        if (fields.FirstOrDefault(f => !sources.Contains(f.Source)
                && !(f.Source.StartsWith(FieldSources.ListPrefix, StringComparison.Ordinal) && f.Source.Length > FieldSources.ListPrefix.Length)) is { } bad)
            return Problems.Invalid("FIELD_SOURCE_UNKNOWN", $"{bad.Source} is not something a number can be built from.", new { source = bad.Source });
        if (fields.Count(f => f.Source == FieldSources.Sequence) != 1)
            return Problems.Invalid("SEQUENCE_REQUIRED", "A number has exactly one running number, so no two share it.");
        if (fields.Any(f => f.Source == FieldSources.Sequence && f.Digits is < 1 or > 9))
            return Problems.Invalid("DIGITS_INVALID", "The running number has 1 to 9 digits.");
        if (fields.Any(f => f.Source == FieldSources.Fixed && string.IsNullOrWhiteSpace(f.Value)))
            return Problems.Invalid("FIXED_VALUE_REQUIRED", "A fixed part says the text it always holds.");
        // The organization's numbering is every project's: a part reads only one of the organization's lists.
        if (scope is null)
            foreach (var list in fields.Where(f => f.Source.StartsWith(FieldSources.ListPrefix, StringComparison.Ordinal)).Select(f => f.Source[FieldSources.ListPrefix.Length..]))
                if (!await db.Set<Setting>().AnyAsync(s => s.ProjectId == null && s.Key == "SET:" + list, cancellationToken))
                    return Problems.Invalid("LIST_NOT_ORGANIZATIONS", $"{list} is a list of one project only: the organization's numbering reads the organization's lists.", new { list });
        return null;
    }

    private static async Task<IResult> CreateAsync(Guid? scope, SchemeRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var name = Blank(request.Name);
        if (name is null) return Problems.Invalid("NAME_REQUIRED", "A scheme has a name.");
        if (await db.NumberingSchemes.AnyAsync(s => s.ProjectId == scope && s.Name == name, cancellationToken))
            return Problems.Invalid("NAME_TAKEN", "A scheme of that name exists already.");
        var fields = request.Fields ?? [];
        if (await CheckFieldsAsync(db, scope, fields, cancellationToken) is { } problem) return problem;
        var scheme = new NumberingScheme
        {
            TenantId = http.User.TenantId(), ProjectId = scope, Name = name, Delimiter = request.Delimiter ?? "-", Active = request.Active ?? true,
            Notes = Blank(request.Notes), Fields = fields.ToList(),
        };
        db.NumberingSchemes.Add(scheme);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "NUMBERING_SCHEME_CREATED", "NumberingScheme", scheme.Id, name,
            string.Join(scheme.Delimiter, fields.Select(f => f.Label)), scope, cancellationToken);
        return Results.Created($"/api/admin/numbering/schemes/{scheme.Id}", new { scheme.Id });
    }

    /// <summary>
    /// Changes a scheme. One that gave a number is renamed, re-noted or retired only: its parts and delimiter stay. Retired,
    /// it may not still number something. Numbers already given never change.
    /// </summary>
    private static async Task<IResult> UpdateAsync(Guid? scope, Guid schemeId, SchemeRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        CancellationToken cancellationToken)
    {
        schemeId = Mapped(http, schemeId);
        var scheme = await db.NumberingSchemes.SingleOrDefaultAsync(s => s.Id == schemeId && s.ProjectId == scope, cancellationToken);
        if (scheme is null) return Problems.NotFound("SCHEME_NOT_FOUND", "No such numbering scheme.");
        var changes = new List<string>();
        if (Blank(request.Name) is { } name && name != scheme.Name)
        {
            if (await db.NumberingSchemes.AnyAsync(s => s.ProjectId == scope && s.Name == name && s.Id != scheme.Id, cancellationToken))
                return Problems.Invalid("NAME_TAKEN", "A scheme of that name exists already.");
            changes.Add($"name → {name}");
            scheme.Name = name;
        }
        if (request.Notes is { } notes && Blank(notes) != scheme.Notes) { changes.Add("when it is used"); scheme.Notes = Blank(notes); }
        var reshaped = (request.Delimiter is { } d && d != scheme.Delimiter)
            || (request.Fields is { } f && !f.Select(Shape).SequenceEqual(scheme.Fields.Select(Shape)));
        if (reshaped && scheme.Used)
            return Problems.Invalid("SCHEME_IN_USE", $"{scheme.Name} has given numbers: its parts stay as they are. Rename or retire it, or make a new scheme and choose it instead.");
        if (request.Delimiter is { } delimiter && delimiter != scheme.Delimiter) { changes.Add($"delimiter → '{delimiter}'"); scheme.Delimiter = delimiter; }
        if (request.Fields is { } fields && reshaped)
        {
            if (await CheckFieldsAsync(db, scope, fields, cancellationToken) is { } problem) return problem;
            scheme.Fields = fields.ToList();
            changes.Add($"parts → {string.Join(scheme.Delimiter, fields.Select(x => x.Label))}");
        }
        if (request.Active is { } active && active != scheme.Active)
        {
            if (!active && await db.SchemeRoutings.Where(r => r.SchemeId == scheme.Id && r.Active).Select(r => r.DeliverableType).FirstOrDefaultAsync(cancellationToken) is { } routed)
                return Problems.Invalid("SCHEME_ROUTED", $"{scheme.Name} still numbers {routed.TrimStart('@')}: choose another scheme for it first.", new { routed });
            changes.Add(active ? "brought back" : "retired");
            scheme.Active = active;
        }
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "NUMBERING_SCHEME_UPDATED", "NumberingScheme", scheme.Id, scheme.Name,
            string.Join("; ", changes), scope, cancellationToken);
        return Results.NoContent();
    }

    private static string Shape(SchemeField f) => $"{f.Label}|{f.Source}|{f.Value}|{f.Digits}";

    /// <summary>Deletes a scheme that never gave a number and numbers nothing; one that gave numbers is retired instead.</summary>
    private static async Task<IResult> DeleteAsync(Guid? scope, Guid schemeId, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        schemeId = Mapped(http, schemeId);
        var scheme = await db.NumberingSchemes.SingleOrDefaultAsync(s => s.Id == schemeId && s.ProjectId == scope, cancellationToken);
        if (scheme is null) return Problems.NotFound("SCHEME_NOT_FOUND", "No such numbering scheme.");
        if (scheme.Used) return Problems.Invalid("SCHEME_IN_USE", $"{scheme.Name} has given numbers: it is kept. Retire it instead.");
        var routes = await db.SchemeRoutings.Where(r => r.SchemeId == scheme.Id).ToListAsync(cancellationToken);
        if (routes.FirstOrDefault(r => r.Active) is { } routed)
            return Problems.Invalid("SCHEME_ROUTED", $"{scheme.Name} numbers {routed.DeliverableType.TrimStart('@')}: choose another scheme for it first.", new { routed = routed.DeliverableType });
        db.SchemeRoutings.RemoveRange(routes);
        db.NumberingSchemes.Remove(scheme);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "NUMBERING_SCHEME_DELETED", "NumberingScheme", scheme.Id, scheme.Name,
            "never gave a number", scope, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>Which scheme numbers a deliverable type or a record kind; no scheme: numbering of it switched off.</summary>
    private static async Task<IResult> RouteAsync(Guid? scope, SchemeRoutingRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var type = Blank(request.DeliverableType);
        if (type is null) return Problems.Invalid("DELIVERABLE_TYPE_REQUIRED", "Say what the scheme numbers.");
        Guid? schemeId = request.SchemeId is { } named ? Mapped(http, named) : null;
        if (schemeId is { } id)
        {
            var target = await db.NumberingSchemes.AsNoTracking().SingleOrDefaultAsync(s => s.Id == id && s.ProjectId == scope, cancellationToken);
            if (target is null) return Problems.Invalid("SCHEME_NOT_FOUND", "No such numbering scheme.");
            if (!target.Active) return Problems.Invalid("SCHEME_RETIRED", $"{target.Name} is retired: bring it back first, or choose another.");
        }
        var routing = await db.SchemeRoutings.SingleOrDefaultAsync(r => r.ProjectId == scope && r.DeliverableType == type, cancellationToken);
        if (schemeId is null)
        {
            if (routing is null) return Results.NoContent();
            routing.Active = false;
        }
        else if (routing is null)
            db.SchemeRoutings.Add(new SchemeRouting { TenantId = http.User.TenantId(), ProjectId = scope, DeliverableType = type, SchemeId = schemeId.Value });
        else
        {
            routing.SchemeId = schemeId.Value;
            routing.Active = true;
        }
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "NUMBERING_ROUTED", "SchemeRouting", null, type,
            schemeId is null ? "switched off" : $"scheme {schemeId}", scope, cancellationToken);
        return Results.NoContent();
    }
}
