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
    }

    /// <summary>
    /// GET <c>/activity</c>: the project's acts, newest first. <c>actions</c> narrows to some kinds (comma-separated);
    /// <c>from</c>/<c>to</c> are whole days in the project's time zone; <c>before</c> reads further back; <c>q</c> looks in
    /// the label, the person and the detail; at most 200.
    /// </summary>
    private static async Task<IResult> ActivityAsync(
        HttpContext http, DeliosDbContext db, CancellationToken cancellationToken, string? actions = null, DateOnly? from = null,
        DateOnly? to = null, DateTimeOffset? since = null, DateTimeOffset? before = null, string? q = null, int take = 60)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal || !access.Holds(Verbs.Read)) return Results.Ok(Array.Empty<ActivityRow>());
        var asked = (actions ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(News.Contains).ToList();
        var kinds = asked.Count > 0 ? asked : News.ToList();
        var query = db.AuditEvents.AsNoTracking().Where(e => e.ProjectId == access.Project.Id && kinds.Contains(e.Action));
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
        return Results.Ok(rows.Select(e => new ActivityRow(e.Id, e.At.ToDateTimeOffset(), e.ActorName, e.Action, e.EntityType,
            e.EntityLabel, e.Detail)));
    }
}
