using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

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
/// </summary>
public static class RevisionSchemeEndpoints
{
    public static void MapRevisionSchemeEndpoints(this IEndpointRouteBuilder app)
    {
        // The control function keeps these, as well as administrators: the same as numbering.
        var keepers = app.MapGroup("/api/admin/revisions").WithTags("Administration")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Filter);
        keepers.MapPost("/schemes", CreateAsync);
        keepers.MapPut("/schemes/{schemeId:guid}", UpdateAsync);
        keepers.MapPut("/routing", RouteAsync);
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
            // Nothing said: letters start at A, numbers at 0.
            var start = Blank(one.Start) ?? (kind == SeriesKinds.Numbers ? "0" : "A");
            var rule = new RevisionSeriesRule
            {
                Code = code,
                Label = label,
                Phase = phase,
                Kind = kind,
                Prefix = (one.Prefix ?? "").Trim(),
                Start = start,
                Width = Math.Clamp(one.Width, 0, 6),
                Lowercase = one.Lowercase,
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
        var routed = await db.RevisionSchemeRoutings.AsNoTracking().Select(r => new { r.DeliverableType, r.SchemeId }).ToListAsync(cancellationToken);
        var mine = routed.Where(r => r.SchemeId == scheme.Id).Select(r => r.DeliverableType).ToList();
        var elsewhere = routed.Where(r => r.SchemeId != scheme.Id).Select(r => r.DeliverableType).ToList();
        return scheme.IsDefault
            ? db.Documents.IgnoreQueryFilters().Where(d => d.TenantId == scheme.TenantId && !elsewhere.Contains(d.DeliverableType))
            : db.Documents.IgnoreQueryFilters().Where(d => d.TenantId == scheme.TenantId && mine.Contains(d.DeliverableType));
    }

    /// <summary>The series codes revisions of these documents already carry.</summary>
    private static Task<List<string>> SeriesUsedAsync(DeliosDbContext db, IQueryable<Document> documents, CancellationToken cancellationToken) =>
        db.Revisions.IgnoreQueryFilters().Where(r => documents.Select(d => d.Id).Contains(r.DocumentId))
            .Select(r => r.Series).Distinct().ToListAsync(cancellationToken);

    /// <summary>A series in use changed in a way that recounts it: its kind, prefix or start.</summary>
    private static string? Recounted(RevisionSeriesRule was, RevisionSeriesRule now) =>
        was.Kind != now.Kind || !string.Equals(was.Prefix, now.Prefix, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(was.Start, now.Start, StringComparison.OrdinalIgnoreCase)
            ? $"{was.Label} is carried by revisions already: how it counts, its prefix and its start stay; its name and the letters skipped may change."
            : null;

    /// <summary><c>POST /api/admin/revisions/schemes</c>: a new revision scheme.</summary>
    private static async Task<IResult> CreateAsync(RevisionSchemeRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var name = Blank(request.Name);
        if (name is null) return Problems.Invalid("NAME_REQUIRED", "A scheme has a name.");
        if (await db.RevisionSchemes.AnyAsync(s => s.Name == name, cancellationToken))
            return Problems.Conflict("NAME_TAKEN", $"A revision scheme is already called {name}.");
        var (series, problem) = await CheckAsync(db, request.Series ?? [], cancellationToken);
        if (problem is not null) return problem;
        var scheme = new RevisionScheme
        {
            TenantId = http.User.TenantId(),
            Name = name,
            ForwardOnly = request.ForwardOnly ?? true,
            Series = series!,
        };
        db.RevisionSchemes.Add(scheme);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "REVISION_SCHEME_CREATED", "RevisionScheme", scheme.Id, name,
            string.Join(" → ", scheme.Series.Select(s => $"{s.Label} {s.Prefix}{s.Start}")), cancellationToken: cancellationToken);
        return Results.Created($"/api/admin/revisions/schemes/{scheme.Id}", new { scheme.Id });
    }

    /// <summary>
    /// <c>PUT /api/admin/revisions/schemes/{id}</c>: changes a scheme. Revisions already named keep their values; a
    /// series they carry stays, and is not recounted.
    /// </summary>
    private static async Task<IResult> UpdateAsync(Guid schemeId, RevisionSchemeRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        CancellationToken cancellationToken)
    {
        var scheme = await db.RevisionSchemes.SingleOrDefaultAsync(s => s.Id == schemeId, cancellationToken);
        if (scheme is null) return Problems.NotFound("SCHEME_NOT_FOUND", "No such revision scheme.");
        var changes = new List<string>();
        if (Blank(request.Name) is { } name && name != scheme.Name)
        {
            if (await db.RevisionSchemes.AnyAsync(s => s.Name == name && s.Id != schemeId, cancellationToken))
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
            if (await db.RevisionSchemes.SingleOrDefaultAsync(s => s.IsDefault, cancellationToken) is { } current)
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
            string.Join("; ", changes), cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// <c>PUT /api/admin/revisions/routing</c>: which scheme a deliverable type follows; none, the default. It names the
    /// revisions of that type's documents not revised yet; one already started keeps counting the way it began.
    /// </summary>
    private static async Task<IResult> RouteAsync(RevisionRoutingRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var type = Blank(request.DeliverableType);
        if (type is null) return Problems.Invalid("DELIVERABLE_TYPE_REQUIRED", "Say which deliverable type follows the scheme.");
        var target = request.SchemeId is { } id
            ? await db.RevisionSchemes.AsNoTracking().SingleOrDefaultAsync(s => s.Id == id, cancellationToken)
            : await db.RevisionSchemes.AsNoTracking().SingleOrDefaultAsync(s => s.IsDefault, cancellationToken);
        if (target is null) return Problems.Invalid("SCHEME_NOT_FOUND", "No such revision scheme.");
        var routing = await db.RevisionSchemeRoutings.SingleOrDefaultAsync(r => r.DeliverableType == type, cancellationToken);
        if (request.SchemeId is null || target.IsDefault)
        {
            if (routing is null) return Results.NoContent();
            db.RevisionSchemeRoutings.Remove(routing);
        }
        else if (routing is null)
        {
            db.RevisionSchemeRoutings.Add(new RevisionSchemeRouting { TenantId = http.User.TenantId(), DeliverableType = type, SchemeId = target.Id });
        }
        else
        {
            routing.SchemeId = target.Id;
        }
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "REVISION_SCHEME_ROUTED", "RevisionSchemeRouting", null, type,
            $"follows {target.Name}", cancellationToken: cancellationToken);
        return Results.NoContent();
    }
}
