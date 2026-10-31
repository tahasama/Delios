using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Audit;

/// <summary>One act of the project as Home's journal and log show it.</summary>
public sealed record ActivityRow(long Id, DateTimeOffset At, string ActorName, string Action, string? EntityType, string? EntityLabel,
    string? Detail);

/// <summary>
/// What the project did, read from the audit trail: what was released, decided, sent, received, returned. Only the
/// project's acts, and only for its own people: who signed in, who downloaded what and who was given which permission
/// are never in it (they are the administrators' trail).
/// </summary>
public static class ActivityEndpoints
{
    /// <summary>The acts that are the project's news. Anything else in the trail is bookkeeping or security.</summary>
    public static readonly HashSet<string> News =
    [
        "REGISTER_ENTRY", "REVISION_ESTABLISHED", "RESUBMITTED", "SUBMISSION_ACCEPTED", "RETURNED_FOR_CORRECTION",
        "REVIEW_STARTED", "STEP_DISPATCHED", "VERDICT", "REVIEW_DECIDED", "REVIEW_SENT_BACK_TO_STEP", "RETURNED_TO_AUTHOR",
        "RELEASED", "SUPERSEDED", "ISSUE_REQUESTED", "ISSUED", "TRANSMITTAL_ISSUED", "TRANSMITTAL_RECEIVED",
        "TRANSMITTAL_ACKNOWLEDGED", "TRANSMITTAL_DISPATCHED", "UNPLANNED_REGISTERED", "PACKAGE_CREATED", "PACKAGE_DELIVERED",
        "PACKAGE_ACCEPTED", "SHORTFALL_ISSUED", "SHORTFALL_ACCEPTED", "SUPPLY_REQUESTED", "ACTIVITY_DECISION", "SCHEDULE_READ",
        "CHECK_RUN",
    ];

    public static void MapActivityEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Activity")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("/activity", ActivityAsync);
        project.MapGet("/log", LogAsync);
    }

    /// <summary>
    /// GET <c>/activity</c>: the project's acts, newest first. <c>actions</c> narrows to some kinds (comma-separated);
    /// <c>from</c>/<c>to</c> are whole days in the project's time zone; <c>before</c> reads further back; <c>q</c> looks in
    /// the label, the person and the detail; at most 200.
    /// </summary>
    private static async Task<IResult> ActivityAsync(
        HttpContext http, DeliosDbContext db, Transmittals.TransmittalService transmittals, CancellationToken cancellationToken, string? actions = null, DateOnly? from = null,
        DateOnly? to = null, DateTimeOffset? since = null, DateTimeOffset? before = null, string? q = null, int take = 60)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal || !access.Holds(Verbs.Read)) return Results.Ok(Array.Empty<ActivityRow>());
        var asked = (actions ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(News.Contains).ToList();
        var kinds = asked.Count > 0 ? asked : News.ToList();
        var query = Readable(db, transmittals, access,
            db.AuditEvents.AsNoTracking().Where(e => e.ProjectId == access.Project.Id && kinds.Contains(e.Action)));
        var zone = DateTimeZoneProviders.Tzdb.GetZoneOrNull(access.Project.TimeZone) ?? DateTimeZone.Utc;
        if (from is { } f) { var start = LocalDate.FromDateOnly(f).AtStartOfDayInZone(zone).ToInstant(); query = query.Where(e => e.At >= start); }
        if (to is { } t) { var end = LocalDate.FromDateOnly(t).PlusDays(1).AtStartOfDayInZone(zone).ToInstant(); query = query.Where(e => e.At < end); }
        if (since is { } s) { var at = Instant.FromDateTimeOffset(s); query = query.Where(e => e.At >= at); }
        if (before is { } b) { var at = Instant.FromDateTimeOffset(b); query = query.Where(e => e.At < at); }
        if (!string.IsNullOrWhiteSpace(q))
        {
            var pattern = $"%{q.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_")}%";
            query = query.Where(e => (e.EntityLabel != null && EF.Functions.ILike(e.EntityLabel, pattern))
                || EF.Functions.ILike(e.ActorName, pattern) || (e.Detail != null && EF.Functions.ILike(e.Detail, pattern)));
        }
        var rows = await query.OrderByDescending(e => e.At).ThenByDescending(e => e.Id).Take(Math.Clamp(take, 1, 200))
            .ToListAsync(cancellationToken);
        var names = await NamesAsync(db, access, rows, cancellationToken);
        return Results.Ok(rows.Select(e => new ActivityRow(e.Id, e.At.ToDateTimeOffset(), e.ActorName, e.Action, e.EntityType,
            e.EntityLabel, AuditKinds.Readable(e.Detail, names))));
    }

    /// <summary>
    /// GET <c>/log</c>: Home's log, the project's trail on the logbook, read by everyone of ours on it (owner): the
    /// control function and administrators every act of this project, anyone else only the acts on what they may open
    /// (<see cref="Readable"/>); newest first, a page at a time, narrowed by a kind
    /// (<see cref="AuditKinds"/>), an act, words, and whole days in the project's time zone. Each act says its kind and,
    /// for a revision or a file, its document; the acts come with their counts. Only the project's work: sign-ins,
    /// reading, and people and settings are left out (they are the administrators' trail).
    /// </summary>
    private static async Task<IResult> LogAsync(HttpContext http, DeliosDbContext db, Transmittals.TransmittalService transmittals,
        AuditCounts counts, CancellationToken cancellationToken,
        string? kind = null, string? action = null, string? q = null, DateOnly? from = null, DateOnly? to = null, int page = 1, int per = 50)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal || !access.Holds(Verbs.Read))
            return Problems.Forbidden("OURS_ONLY", "The log is read by the people of the organization the project belongs to.");
        per = Math.Clamp(per, 10, 200);
        page = Math.Max(1, page);
        // The project's work only: who signed in, who opened or downloaded what, and people and settings stay in the
        // administrators' trail (Settings, Audit trail; a person's activity), never on Home.
        var hidden = LeftOffLog;
        var query = Readable(db, transmittals, access,
            db.AuditEvents.AsNoTracking().Where(e => e.ProjectId == access.Project.Id && !hidden.Contains(e.Action)));
        var zone = DateTimeZoneProviders.Tzdb.GetZoneOrNull(access.Project.TimeZone) ?? DateTimeZone.Utc;
        if (from is { } f) { var start = LocalDate.FromDateOnly(f).AtStartOfDayInZone(zone).ToInstant(); query = query.Where(e => e.At >= start); }
        if (to is { } t) { var end = LocalDate.FromDateOnly(t).PlusDays(1).AtStartOfDayInZone(zone).ToInstant(); query = query.Where(e => e.At < end); }
        if (!string.IsNullOrWhiteSpace(q))
        {
            var pattern = $"%{q.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_")}%";
            query = query.Where(e => (e.EntityLabel != null && EF.Functions.ILike(e.EntityLabel, pattern))
                || EF.Functions.ILike(e.ActorName, pattern) || (e.Detail != null && EF.Functions.ILike(e.Detail, pattern)));
        }
        // Those who read every act of the project, with no words or days asked: counted once, then only what was written
        // since (AuditCounts). Anyone else's counts are of what they may open, counted as asked.
        var counted = Whole(access) && from is null && to is null && string.IsNullOrWhiteSpace(q)
            ? await counts.ByActionAsync(access.Project.TenantId, $"log:{access.Project.Id}", query, cancellationToken)
            : await query.GroupBy(e => e.Action).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, cancellationToken);
        var actions = counted.Where(x => !hidden.Contains(x.Key)).Select(x => new { Action = x.Key, Count = x.Value }).ToList();
        if (!string.IsNullOrWhiteSpace(kind))
        {
            var codes = actions.Where(a => AuditKinds.Of(a.Action) == kind).Select(a => a.Action).ToArray();
            query = query.Where(e => codes.Contains(e.Action));
        }
        if (!string.IsNullOrWhiteSpace(action)) query = query.Where(e => e.Action == action);
        var total = await query.CountAsync(cancellationToken);
        var rows = await query.OrderByDescending(e => e.Id).Skip((page - 1) * per).Take(per).ToListAsync(cancellationToken);
        var documents = await AuditKinds.DocumentsOfAsync(db, rows, cancellationToken);
        var names = await NamesAsync(db, access, rows, cancellationToken);
        return Results.Ok(new
        {
            total,
            page,
            per,
            pages = Math.Max(1, (total + per - 1) / per),
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
                Project = (string?)access.Project.Code,
                DocumentId = e.EntityId is { } eid && documents.TryGetValue(eid, out var did) ? did : (Guid?)null,
            }),
        });
    }

    /// <summary>Who reads every act of the project: the control function and administrators.</summary>
    private static bool Whole(ProjectAccess access) => access.Holds(Verbs.Control) || access.Holds(Verbs.Configure);

    private static readonly string[] AboutDocuments = ["Document", "Revision", "StoredFile", "Review", "Transmittal"];

    /// <summary>
    /// The acts this person may read: an act on a document, its revision, file or review only when they may open the
    /// document (its clearance, <see cref="Documents.DocumentQueries.Visible"/>), on a transmittal only when they may
    /// open it; everything else of the project as it is. The control function and administrators read every act.
    /// </summary>
    /// <summary>What Home's log leaves out: sign-ins, reading, and people and settings (the administrators' trail).</summary>
    private static readonly string[] LeftOffLog = [.. new[] { "PEOPLE", "READING", "DOWNLOADED", "SIGN_IN" }.SelectMany(AuditKinds.CodesOf)];

    private static IQueryable<AuditEvent> Readable(DeliosDbContext db, Transmittals.TransmittalService transmittals, ProjectAccess access,
        IQueryable<AuditEvent> query)
    {
        if (Whole(access)) return query;
        var docs = Documents.DocumentQueries.Visible(db, access).Select(d => d.Id);
        var sent = transmittals.Visible(access).Select(t => t.Id);
        return query.Where(e => e.EntityType == null || !AboutDocuments.Contains(e.EntityType)
            || (e.EntityId != null && (
                (e.EntityType == "Document" && docs.Contains(e.EntityId.Value))
                || (e.EntityType == "Revision" && db.Revisions.Any(r => r.Id == e.EntityId && docs.Contains(r.DocumentId)))
                || (e.EntityType == "StoredFile" && db.StoredFiles.Any(f => f.Id == e.EntityId && f.DocumentId != null && docs.Contains(f.DocumentId.Value)))
                || (e.EntityType == "Review" && db.Reviews.Any(r => r.Id == e.EntityId && docs.Contains(r.DocumentId)))
                || (e.EntityType == "Transmittal" && sent.Contains(e.EntityId.Value)))));
    }

    /// <summary>The names inside the acts' details, without a document this person may not open.</summary>
    private static async Task<Dictionary<Guid, string>> NamesAsync(DeliosDbContext db, ProjectAccess access, List<AuditEvent> rows,
        CancellationToken cancellationToken)
    {
        var names = await AuditKinds.NamesInAsync(db, rows, cancellationToken);
        if (Whole(access) || names.Count == 0) return names;
        var ids = names.Keys.ToList();
        var documents = await db.Documents.AsNoTracking().Where(d => ids.Contains(d.Id)).Select(d => d.Id).ToListAsync(cancellationToken);
        if (documents.Count == 0) return names;
        var open = (await Documents.DocumentQueries.Visible(db, access).Where(d => documents.Contains(d.Id)).Select(d => d.Id)
            .ToListAsync(cancellationToken)).ToHashSet();
        foreach (var hidden in documents.Where(d => !open.Contains(d))) names[hidden] = "a document you may not open";
        return names;
    }
}
