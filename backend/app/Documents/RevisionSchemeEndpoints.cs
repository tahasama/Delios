using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Notifications;
using Delios.Host.Platform;
using Delios.Host.Settings;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>Body of creating or changing a revision scheme: its series in order. A null field is left as it is.</summary>
public sealed record RevisionSchemeRequest(string? Name = null, bool? IsDefault = null, bool? ForwardOnly = null, RevisionLineRequest[]? Series = null);

/// <summary>One line of a revision scheme as written: its phase (none: the default line), how it counts, and its code once it has one.</summary>
public sealed record RevisionLineRequest(
    string? Code = null, string? Label = null, string? Phase = null, string? Kind = null, string? Prefix = null, string? Start = null,
    int Width = 0, bool Lowercase = false, string[]? ExcludedLetters = null);

/// <summary>Body of saying which revision scheme a deliverable type follows. No scheme: the default one.</summary>
public sealed record RevisionRoutingRequest(string? DeliverableType, Guid? SchemeId);

/// <summary>
/// How revisions are named (A, B, C… then 0, 1, 2…, or the organization's own), and which deliverable types follow
/// which scheme. A scheme chosen for a type names the revisions of its documents not revised yet; a document already
/// started keeps counting the way it began. A series some revision already carries stays in its scheme: it may be
/// relabelled, never dropped or recounted (backend SERIES_IN_USE). Every change is audited.
/// Two levels (owner), as numbering: the organization's schemes and routing (project empty) name every project's
/// revisions, changed by an administrator from the organization's Settings; a project changes them only where the
/// organization left revisions free (<see cref="Liberty"/>), its first change making its own copy (<c>REVISIONS_OWN</c>),
/// which the organization's later changes never touch. Put back to the organization's only from its Settings, with why.
/// </summary>
public static class RevisionSchemeEndpoints
{
    /// <summary>The project's setting saying it names revisions by its own copy.</summary>
    public const string OwnKey = "REVISIONS_OWN";

    /// <summary>The revision naming a project uses: its own copy where it made one (its id), else the organization's (null).</summary>
    public static async Task<Guid?> ScopeAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken) =>
        await db.Set<Setting>().AnyAsync(s => s.ProjectId == projectId && s.Key == OwnKey, cancellationToken) ? projectId : null;

    public static void MapRevisionSchemeEndpoints(this IEndpointRouteBuilder app)
    {
        var org = app.MapGroup("/api/admin/revisions").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("The organization's revision naming is the same on every project: an administrator changes it."));
        org.MapPost("/schemes", (RevisionSchemeRequest r, HttpContext h, DeliosDbContext db, AuditLog a, CancellationToken c) => CreateAsync(null, r, h, db, a, c));
        org.MapPut("/schemes/{schemeId:guid}", (Guid schemeId, RevisionSchemeRequest r, HttpContext h, DeliosDbContext db, AuditLog a, CancellationToken c) =>
            UpdateAsync(null, schemeId, r, h, db, a, c));
        org.MapPut("/routing", (RevisionRoutingRequest r, HttpContext h, DeliosDbContext db, AuditLog a, CancellationToken c) => RouteAsync(null, r, h, db, a, c));
        org.MapGet("/projects", OwnCopiesAsync);
        org.MapPost("/projects/{projectId:guid}/reset", ResetAsync);

        var project = app.MapGroup("/api/projects/{projectId:guid}/revisions").WithTags("Settings")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
        {
            var access = ProjectAccessFilter.Of(h);
            var scope = await ScopeAsync(db, access.Project.Id, c);
            var free = await Liberty.IsFreeAsync(db, Liberty.Revisions, c);
            var schemes = await db.RevisionSchemes.AsNoTracking().Where(s => s.ProjectId == scope).OrderBy(s => s.Name).ToListAsync(c);
            var routing = await db.RevisionSchemeRoutings.AsNoTracking().Where(r => r.ProjectId == scope).ToListAsync(c);
            return Results.Ok(new
            {
                RevisionSchemes = schemes.Select(s => new { s.Id, s.Name, s.IsDefault, s.ForwardOnly, s.Series }),
                RevisionRouting = routing.Select(r => new { r.DeliverableType, r.SchemeId }),
                Own = scope is not null, Free = free,
                MayChange = free && await ProjectLists.MayChangeAsync(db, access, c),
                MayChangeOrganization = await Keepers.ConfiguresAsync(h),
            });
        });
        project.MapPost("/schemes", (RevisionSchemeRequest r, HttpContext h, DeliosDbContext db, AuditLog a, IClock clock, CancellationToken c) =>
            ProjectAsync(h, db, clock, c, scope => CreateAsync(scope, r, h, db, a, c)));
        project.MapPut("/schemes/{schemeId:guid}", (Guid schemeId, RevisionSchemeRequest r, HttpContext h, DeliosDbContext db, AuditLog a, IClock clock, CancellationToken c) =>
            ProjectAsync(h, db, clock, c, scope => UpdateAsync(scope, schemeId, r, h, db, a, c), schemeId));
        project.MapPut("/routing", (RevisionRoutingRequest r, HttpContext h, DeliosDbContext db, AuditLog a, IClock clock, CancellationToken c) =>
            ProjectAsync(h, db, clock, c, scope => RouteAsync(scope, r, h, db, a, c), r.SchemeId));
    }

    /// <summary>A change on a project: only where revisions are free, by whoever changes the project's settings; its own copy made first.</summary>
    private static async Task<IResult> ProjectAsync(HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken,
        Func<Guid?, Task<IResult>> act, Guid? schemeId = null)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!await Liberty.IsFreeAsync(db, Liberty.Revisions, cancellationToken))
            return Problems.Forbidden("REVISIONS_FIXED", "Revision naming is the organization's, the same on every project: an administrator changes it in the organization's Settings.");
        if (!await ProjectLists.MayChangeAsync(db, access, cancellationToken))
            return Problems.Forbidden("CONTROL_ONLY", "Whoever acts as the control function on this project changes its revision naming (on a project with none, whoever opened it).");
        var copied = await EnsureOwnAsync(db, access, clock, cancellationToken);
        if (copied.TryGetValue(schemeId ?? Guid.Empty, out var mine)) http.Items["revisions.scheme"] = mine;
        return await act(access.Project.Id);
    }

    private static Guid Mapped(HttpContext http, Guid schemeId) => http.Items["revisions.scheme"] is Guid mine ? mine : schemeId;

    /// <summary>The project's own copy of the organization's revision naming, made once: the organization's ids and their copies.</summary>
    private static async Task<Dictionary<Guid, Guid>> EnsureOwnAsync(DeliosDbContext db, ProjectAccess access, IClock clock, CancellationToken cancellationToken)
    {
        var map = new Dictionary<Guid, Guid>();
        if (await ScopeAsync(db, access.Project.Id, cancellationToken) is not null) return map;
        foreach (var scheme in await db.RevisionSchemes.AsNoTracking().Where(s => s.ProjectId == null).ToListAsync(cancellationToken))
        {
            var copy = new RevisionScheme
            {
                TenantId = access.Project.TenantId, ProjectId = access.Project.Id, Name = scheme.Name, IsDefault = scheme.IsDefault, ForwardOnly = scheme.ForwardOnly,
                Series = scheme.Series.Select(r => new RevisionSeriesRule
                {
                    Code = r.Code, Label = r.Label, Phase = r.Phase, Kind = r.Kind, Prefix = r.Prefix, Start = r.Start, Width = r.Width,
                    Lowercase = r.Lowercase, ExcludedLetters = [.. r.ExcludedLetters],
                }).ToList(),
            };
            db.RevisionSchemes.Add(copy);
            map[scheme.Id] = copy.Id;
        }
        foreach (var route in await db.RevisionSchemeRoutings.AsNoTracking().Where(r => r.ProjectId == null).ToListAsync(cancellationToken))
            if (map.TryGetValue(route.SchemeId, out var schemeId))
                db.RevisionSchemeRoutings.Add(new RevisionSchemeRouting { TenantId = access.Project.TenantId, ProjectId = access.Project.Id, DeliverableType = route.DeliverableType, SchemeId = schemeId });
        db.Add(new Setting
        {
            TenantId = access.Project.TenantId, ProjectId = access.Project.Id, Key = OwnKey, Value = "ON",
            UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = access.UserName,
        });
        await db.SaveChangesAsync(cancellationToken);
        return map;
    }

    /// <summary><c>GET /api/admin/revisions/projects</c>: the projects naming revisions by their own copy, since when and by whom.</summary>
    private static async Task<IResult> OwnCopiesAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var rows = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId != null && s.Key == OwnKey)
            .Join(db.Projects.AsNoTracking(), s => s.ProjectId, p => (Guid?)p.Id, (s, p) => new { p.Id, p.Code, p.Name, s.UpdatedAt, s.UpdatedByName })
            .OrderBy(x => x.Code).ToListAsync(cancellationToken);
        return Results.Ok(rows.Select(r => new { r.Id, r.Code, r.Name, Since = r.UpdatedAt.ToDateTimeOffset(), By = r.UpdatedByName }));
    }

    /// <summary>
    /// <c>POST /api/admin/revisions/projects/{id}/reset</c> (owner: from the organization's Settings, for a mess only): the
    /// project names revisions by the organization's again; its own schemes go, revisions already named keep their values.
    /// Always with why, logged, its control function told.
    /// </summary>
    private static async Task<IResult> ResetAsync(Guid projectId, NumberingLevels.ResetRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        Notifier notifier, CancellationToken cancellationToken)
    {
        var reason = Blank(request.Reason);
        if (reason is null) return Problems.Invalid("REASON_REQUIRED", "Say why the project goes back to the organization's revision naming.");
        var project = await db.Projects.AsNoTracking().SingleOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return Problems.NotFound("PROJECT_NOT_FOUND", "No such project.");
        var mark = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == projectId && s.Key == OwnKey, cancellationToken);
        if (mark is null) return Problems.Invalid("NOT_OWN", $"{project.Code} already names revisions by the organization's.");
        db.RevisionSchemeRoutings.RemoveRange(await db.RevisionSchemeRoutings.Where(r => r.ProjectId == projectId).ToListAsync(cancellationToken));
        await db.SaveChangesAsync(cancellationToken);
        db.RevisionSchemes.RemoveRange(await db.RevisionSchemes.Where(s => s.ProjectId == projectId).ToListAsync(cancellationToken));
        db.Remove(mark);
        await db.SaveChangesAsync(cancellationToken);
        var actor = await ActorAsync(http, db, cancellationToken);
        await audit.WriteAsync(actor, "SETTING_RESET", "Project", project.Id, $"{project.Code}: revision naming", reason, project.Id, cancellationToken);
        await notifier.NotifyAsync(project.TenantId, project.Id, await Actions.NoticeLog.HoldersAsync(db, project.Id, Verbs.Control, cancellationToken),
            NotificationKinds.General, $"{project.Code} names revisions by the organization's again",
            $"{actor.Name} put {project.Code}'s revision naming back to the organization's: {reason}. Revisions already named keep their values.",
            "/settings/revisions", cancellationToken);
        return Results.NoContent();
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static async Task<Actor> ActorAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var id = http.User.UserId();
        return new Actor(id, await db.Users.Where(u => u.Id == id).Select(u => u.Name).SingleAsync(cancellationToken));
    }

    /// <summary>
    /// The lines as given, tidied, or why they cannot name revisions. Each line names revisions in one phase (PHASES), or
    /// is the default line for any phase without its own: one default at most, one line per phase. A line's code is
    /// its phase's (DEFAULT for the default line) unless it already had one: revisions carry it.
    /// </summary>
    private static async Task<(List<RevisionSeriesRule>? Series, IResult? Problem)> CheckAsync(DeliosDbContext db, RevisionLineRequest[] given,
        CancellationToken cancellationToken)
    {
        if (given.Length == 0) return (null, Problems.Invalid("SERIES_REQUIRED", "A scheme has at least one line."));
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var series = new List<RevisionSeriesRule>();
        foreach (var one in given)
        {
            var phase = Blank(one.Phase);
            if (phase is not null && !catalog.IsActive(ValueSets.Phases, phase))
                return (null, Problems.Invalid("VALUE_NOT_PUBLISHED", $"{phase} is not a published phase.", new { field = "phase", value = phase }));
            var code = (Blank(one.Code) ?? phase ?? "DEFAULT").ToUpperInvariant();
            if (code.Length > 16) code = code[..16];
            var label = Blank(one.Label) ?? (phase is null ? "Any phase" : catalog.Label(ValueSets.Phases, phase) ?? phase);
            if (!code.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-'))
                return (null, Problems.Invalid("SERIES_CODE_INVALID", $"{label}: its code is letters, digits, - or _."));
            var kind = (one.Kind ?? "").Trim().ToUpperInvariant();
            // Nothing said: letters start at A, numbers at 0. The start as written also says how values look: "a" counts
            // in small letters, "01" in two digits (the width and the case given are kept when the start says nothing).
            var written = Blank(one.Start) ?? (kind == SeriesKinds.Numbers ? "0" : "A");
            var width = kind == SeriesKinds.Numbers && written.Length > 1 && written[0] == '0' && written.All(char.IsAsciiDigit)
                ? written.Length : one.Width;
            var lowercase = kind == SeriesKinds.Letters && written.All(char.IsAsciiLetter) ? written.Any(char.IsAsciiLetterLower) : one.Lowercase;
            var start = Normal(kind, written);
            var rule = new RevisionSeriesRule
            {
                Code = code,
                Label = label,
                Phase = phase,
                Kind = kind,
                Prefix = (one.Prefix ?? "").Trim(),
                Start = start,
                Width = Math.Clamp(width, 0, 6),
                Lowercase = lowercase,
                ExcludedLetters = [.. (one.ExcludedLetters ?? []).Select(l => l.Trim().ToUpperInvariant()).Where(l => l.Length == 1).Distinct()],
            };
            if (rule.Kind is not (SeriesKinds.Letters or SeriesKinds.Numbers))
                return (null, Problems.Invalid("SERIES_INVALID", $"{label}: say whether it counts in letters or in numbers."));
            if (RevisionValues.Problem(rule) is not null)
                return (null, Problems.Invalid("SERIES_INVALID", rule.Kind == SeriesKinds.Numbers
                    ? $"{label}: it counts in numbers, so it starts at a number (0, 1…), written after the prefix."
                    : $"{label}: it counts in letters, so it starts at a letter (A, B…), written after the prefix."));
            series.Add(rule);
        }
        if (series.Count(s => s.Phase is null) > 1)
            return (null, Problems.Invalid("SERIES_DEFAULT_TWICE", "Only one line is for any phase; give the others their phase."));
        if (series.Where(s => s.Phase is not null).GroupBy(s => s.Phase).FirstOrDefault(g => g.Count() > 1) is { } phaseTwice)
            return (null, Problems.Invalid("SERIES_PHASE_TWICE", $"{phaseTwice.First().Label} has two lines; keep one."));
        if (series.GroupBy(s => s.Code).FirstOrDefault(g => g.Count() > 1) is { } twice)
            return (null, Problems.Invalid("SERIES_CODE_TWICE", $"{twice.Key} is used by two lines of the scheme."));
        return (series, null);
    }

    /// <summary>The deliverable types a scheme serves now: those routed to it, and for the default every type routed nowhere.</summary>
    private static async Task<IQueryable<Document>> ServedAsync(DeliosDbContext db, RevisionScheme scheme, CancellationToken cancellationToken)
    {
        var routed = await db.RevisionSchemeRoutings.AsNoTracking().Where(r => r.ProjectId == scheme.ProjectId)
            .Select(r => new { r.DeliverableType, r.SchemeId }).ToListAsync(cancellationToken);
        var mine = routed.Where(r => r.SchemeId == scheme.Id).Select(r => r.DeliverableType).ToList();
        var elsewhere = routed.Where(r => r.SchemeId != scheme.Id).Select(r => r.DeliverableType).ToList();
        // The organization's names the documents of every project without its own copy; a project's copy, that project's.
        var own = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId != null && s.Key == OwnKey).Select(s => s.ProjectId!.Value).ToListAsync(cancellationToken);
        var documents = db.Documents.IgnoreQueryFilters().Where(d => d.TenantId == scheme.TenantId
            && (scheme.ProjectId == null ? !own.Contains(d.ProjectId) : d.ProjectId == scheme.ProjectId));
        return scheme.IsDefault
            ? documents.Where(d => !elsewhere.Contains(d.DeliverableType))
            : documents.Where(d => mine.Contains(d.DeliverableType));
    }

    /// <summary>The series codes revisions of these documents already carry.</summary>
    private static Task<List<string>> SeriesUsedAsync(DeliosDbContext db, IQueryable<Document> documents, CancellationToken cancellationToken) =>
        db.Revisions.IgnoreQueryFilters().Where(r => documents.Select(d => d.Id).Contains(r.DocumentId))
            .Select(r => r.Series).Distinct().ToListAsync(cancellationToken);

    /// <summary>A series in use changed in a way that recounts it: its kind, prefix or start.</summary>
    private static string? Recounted(RevisionSeriesRule was, RevisionSeriesRule now) =>
        was.Kind != now.Kind || !string.Equals(was.Prefix, now.Prefix, StringComparison.OrdinalIgnoreCase)
            || Normal(was.Kind, was.Start) != Normal(now.Kind, now.Start) || was.Width != now.Width || was.Lowercase != now.Lowercase
            ? $"{was.Label} is carried by revisions already: how it counts, its prefix, its start and how its values are written (small letters, digits) stay; its name and the letters skipped may change."
            : null;

    /// <summary>A start as kept: numbers without their leading zeros (the width says them), letters in capitals (the case says them).</summary>
    private static string Normal(string kind, string start) =>
        kind == SeriesKinds.Numbers && start.All(char.IsAsciiDigit) ? (start.TrimStart('0') is { Length: > 0 } n ? n : "0")
        : kind == SeriesKinds.Letters ? start.ToUpperInvariant() : start;

    /// <summary><c>POST /api/admin/revisions/schemes</c>: a new revision scheme.</summary>
    private static async Task<IResult> CreateAsync(Guid? scope, RevisionSchemeRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var name = Blank(request.Name);
        if (name is null) return Problems.Invalid("NAME_REQUIRED", "A scheme has a name.");
        if (await db.RevisionSchemes.AnyAsync(s => s.ProjectId == scope && s.Name == name, cancellationToken))
            return Problems.Conflict("NAME_TAKEN", $"A revision scheme is already called {name}.");
        var (series, problem) = await CheckAsync(db, request.Series ?? [], cancellationToken);
        if (problem is not null) return problem;
        var scheme = new RevisionScheme
        {
            TenantId = http.User.TenantId(),
            ProjectId = scope,
            Name = name,
            ForwardOnly = request.ForwardOnly ?? true,
            Series = series!,
        };
        db.RevisionSchemes.Add(scheme);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "REVISION_SCHEME_CREATED", "RevisionScheme", scheme.Id, name,
            string.Join(" → ", scheme.Series.Select(s => $"{s.Label} {s.Prefix}{s.Start}")), scope, cancellationToken);
        return Results.Created($"/api/admin/revisions/schemes/{scheme.Id}", new { scheme.Id });
    }

    /// <summary>
    /// <c>PUT /api/admin/revisions/schemes/{id}</c>: changes a scheme. Revisions already named keep their values; a
    /// series they carry stays, and is not recounted.
    /// </summary>
    private static async Task<IResult> UpdateAsync(Guid? scope, Guid schemeId, RevisionSchemeRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        CancellationToken cancellationToken)
    {
        schemeId = Mapped(http, schemeId);
        var scheme = await db.RevisionSchemes.SingleOrDefaultAsync(s => s.Id == schemeId && s.ProjectId == scope, cancellationToken);
        if (scheme is null) return Problems.NotFound("SCHEME_NOT_FOUND", "No such revision scheme.");
        var changes = new List<string>();
        if (Blank(request.Name) is { } name && name != scheme.Name)
        {
            if (await db.RevisionSchemes.AnyAsync(s => s.ProjectId == scope && s.Name == name && s.Id != schemeId, cancellationToken))
                return Problems.Conflict("NAME_TAKEN", $"A revision scheme is already called {name}.");
            changes.Add($"name → {name}");
            scheme.Name = name;
        }
        if (request.ForwardOnly is { } forward && forward != scheme.ForwardOnly)
        {
            changes.Add(forward ? "forward only" : "may go back to an earlier series");
            scheme.ForwardOnly = forward;
        }
        if (request.Series is { } given)
        {
            var (series, problem) = await CheckAsync(db, given, cancellationToken);
            if (problem is not null) return problem;
            var used = await SeriesUsedAsync(db, await ServedAsync(db, scheme, cancellationToken), cancellationToken);
            foreach (var was in scheme.Series.Where(s => used.Contains(s.Code)))
            {
                var now = series!.FirstOrDefault(s => s.Code == was.Code);
                if (now is null)
                    return Problems.Conflict("SERIES_IN_USE", $"{was.Label} is carried by revisions already: it stays in the scheme.");
                if (Recounted(was, now) is { } why) return Problems.Conflict("SERIES_IN_USE", why);
            }
            scheme.Series = series!;
            changes.Add($"series → {string.Join(" → ", series!.Select(s => $"{s.Label} {s.Prefix}{s.Start}"))}");
        }
        if (request.IsDefault is true && !scheme.IsDefault)
        {
            // Documents already started under the old default keep counting the way they began.
            if (await db.RevisionSchemes.SingleOrDefaultAsync(s => s.ProjectId == scope && s.IsDefault, cancellationToken) is { } current)
            {
                current.IsDefault = false;
                await db.SaveChangesAsync(cancellationToken);
            }
            scheme.IsDefault = true;
            changes.Add("the default");
        }
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "REVISION_SCHEME_UPDATED", "RevisionScheme", scheme.Id, scheme.Name,
            string.Join("; ", changes), scope, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// <c>PUT /api/admin/revisions/routing</c>: which scheme a deliverable type follows; none, the default. It names the
    /// revisions of that type's documents not revised yet; one already started keeps counting the way it began.
    /// </summary>
    private static async Task<IResult> RouteAsync(Guid? scope, RevisionRoutingRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var type = Blank(request.DeliverableType);
        if (type is null) return Problems.Invalid("DELIVERABLE_TYPE_REQUIRED", "Say which deliverable type follows the scheme.");
        Guid? schemeId = request.SchemeId is { } named ? Mapped(http, named) : null;
        var target = schemeId is { } id
            ? await db.RevisionSchemes.AsNoTracking().SingleOrDefaultAsync(s => s.Id == id && s.ProjectId == scope, cancellationToken)
            : await db.RevisionSchemes.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == scope && s.IsDefault, cancellationToken);
        if (target is null) return Problems.Invalid("SCHEME_NOT_FOUND", "No such revision scheme.");
        var routing = await db.RevisionSchemeRoutings.SingleOrDefaultAsync(r => r.ProjectId == scope && r.DeliverableType == type, cancellationToken);
        if (request.SchemeId is null || target.IsDefault)
        {
            if (routing is null) return Results.NoContent();
            db.RevisionSchemeRoutings.Remove(routing);
        }
        else if (routing is null)
        {
            db.RevisionSchemeRoutings.Add(new RevisionSchemeRouting { TenantId = http.User.TenantId(), ProjectId = scope, DeliverableType = type, SchemeId = target.Id });
        }
        else
        {
            routing.SchemeId = target.Id;
        }
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "REVISION_SCHEME_ROUTED", "RevisionSchemeRouting", null, type,
            $"follows {target.Name}", scope, cancellationToken);
        return Results.NoContent();
    }
}
