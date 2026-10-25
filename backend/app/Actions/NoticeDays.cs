using Delios.Host.Platform;
using Delios.Host.Records;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Actions;

/// <summary>
/// What changed the schedule, a review step or how a project counts its days, after its save: the activities, steps
/// and projects whose notice days are written again (<see cref="NoticeDays"/>). Sent by the save itself
/// (<see cref="ScreenChangeWatcher"/>), never looked for.
/// </summary>
public sealed record NoticesMoved(Guid TenantId, Guid[] Projects, bool Organization, Guid[] Activities, Guid[] Steps, Guid[] Reviews)
{
    public const string RoutingKey = "notices.moved";
}

/// <summary>
/// The days the project's notices fall on, written down by what changes them (owner: "the changes are the ones who
/// tell us"): an activity's next day to tell (<see cref="Activity.NoticeOn"/>: its risk window opening, the day after its
/// day, the day its silent disciplines are notified again), a step's day to warn (<see cref="Reviews.ReviewStep.WarnOn"/>),
/// and each project's next moment (<see cref="NoticeAlarm"/>), the earliest of them at its notify hour. The worker's one
/// alarm rings at the earliest moment of all (<see cref="ActionNotices"/>); a day with nothing written runs nothing.
/// </summary>
public static class NoticeDays
{
    /// <summary>How far back an action's day may lie and still be told about: past the longest "notified again" (60 working days).</summary>
    public const int PassedWindowDays = 120;

    /// <summary>In the worker: a change came; the notice days it moved are written again, and the alarm told.</summary>
    public static async Task OnMovedAsync(IServiceProvider services, NoticesMoved message, CancellationToken cancellationToken)
    {
        services.GetRequiredService<TenantContext>().Set(message.TenantId);
        var db = services.GetRequiredService<DeliosDbContext>();
        var clock = services.GetRequiredService<IClock>();
        await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
        var whole = message.Organization
            ? await db.Projects.AsNoTracking().Select(p => p.Id).ToListAsync(cancellationToken)
            : [.. message.Projects];
        var activities = message.Activities.Length == 0 ? [] : await db.Activities.AsNoTracking()
            .Where(a => message.Activities.Contains(a.Id) && !whole.Contains(a.ProjectId))
            .Select(a => new { a.Id, a.ProjectId }).ToListAsync(cancellationToken);
        var steps = message.Steps.Length + message.Reviews.Length == 0 ? [] : await (
            from s in db.ReviewSteps.AsNoTracking()
            join r in db.Reviews.AsNoTracking() on s.ReviewId equals r.Id
            where (message.Steps.Contains(s.Id) || message.Reviews.Contains(r.Id)) && !whole.Contains(r.ProjectId)
            select new { s.Id, r.ProjectId }).ToListAsync(cancellationToken);
        var projects = whole.Concat(activities.Select(a => a.ProjectId)).Concat(steps.Select(s => s.ProjectId)).Distinct().ToList();
        foreach (var projectId in projects)
        {
            var project = await db.Projects.AsNoTracking().SingleOrDefaultAsync(p => p.Id == projectId, cancellationToken);
            if (project is null) continue;
            if (whole.Contains(projectId)) await WriteAsync(db, clock, project, null, null, cancellationToken);
            else await WriteAsync(db, clock, project,
                activities.Where(a => a.ProjectId == projectId).Select(a => a.Id).ToList(),
                steps.Where(s => s.ProjectId == projectId).Select(s => s.Id).ToList(), cancellationToken);
        }
        await tx.CommitAsync(cancellationToken);
        if (projects.Count > 0) services.GetRequiredService<NoticeAlarmBell>().Ring();
    }

    /// <summary>
    /// Writes again the notice days of the activities and steps named (null: every one of the project that may have
    /// one), then the project's next moment. Written straight to the rows: nothing the screens show changes.
    /// </summary>
    public static async Task WriteAsync(DeliosDbContext db, IClock clock, Identity.Project project,
        IReadOnlyCollection<Guid>? activityIds, IReadOnlyCollection<Guid>? stepIds, CancellationToken cancellationToken)
    {
        var today = WorkingCalendar.Today(clock, project.TimeZone);
        var lastRun = await db.Set<NoticeAlarm>().Where(a => a.ProjectId == project.Id).Select(a => a.LastRun).SingleOrDefaultAsync(cancellationToken);
        // Already told today: the next day is the earliest it can go again.
        var from = lastRun is { } last && last >= today ? today.PlusDays(1) : today;
        var active = project.Status == "ACTIVE";
        if (activityIds is null || activityIds.Count > 0) await ActivitiesAsync(db, project, from, active, activityIds, cancellationToken);
        if (stepIds is null || stepIds.Count > 0) await StepsAsync(db, project, from, active, stepIds, cancellationToken);
        await AlarmAsync(db, project, cancellationToken);
    }

    private static async Task ActivitiesAsync(DeliosDbContext db, Identity.Project project, LocalDate from, bool active,
        IReadOnlyCollection<Guid>? ids, CancellationToken cancellationToken)
    {
        var since = from.PlusDays(-PassedWindowDays);
        var query = db.Activities.AsNoTracking().Include(a => a.Requirements).Where(a => a.ProjectId == project.Id);
        query = ids is null
            ? query.Where(a => a.NoticeOn != null || (a.State == ActivityStates.Active && a.Start != null && a.Start >= since))
            : query.Where(a => ids.Contains(a.Id));
        var activities = await query.AsSplitQuery().ToListAsync(cancellationToken);
        if (activities.Count == 0) return;
        var all = activities.Select(a => a.Id).ToList();
        var confirmed = (await db.Set<ReadinessConfirmation>().AsNoTracking()
            .Where(c => c.ProjectId == project.Id && all.Contains(c.ActivityId) && c.RevokedAt == null)
            .Select(c => new { c.ActivityId, c.Department }).ToListAsync(cancellationToken))
            .Select(c => (c.ActivityId, c.Department)).ToHashSet();
        var catalog = await Documents.Catalog.LoadAsync(db, cancellationToken);
        var postponed = (await db.ActivityDecisions.AsNoTracking().Where(d => d.ProjectId == project.Id && all.Contains(d.ActivityId) && d.ReversedAt == null)
            .Select(d => new { d.ActivityId, d.Decision }).ToListAsync(cancellationToken))
            .Where(d => !ActionNotices.Proceeds(catalog, d.Decision)).Select(d => d.ActivityId).ToHashSet();
        var subjects = activities.SelectMany(a => a.Departments.SelectMany(d => new[] { $"activity:{a.Id}:risk:{d}", $"activity:{a.Id}:escalated:{d}" })).ToList();
        var sent = (await db.Notices.AsNoTracking().Where(n => n.ProjectId == project.Id && subjects.Contains(n.Subject))
            .Select(n => n.Subject).Distinct().ToListAsync(cancellationToken)).ToHashSet();
        var after = int.TryParse(await Settings.ProjectAnswers.PolicyAsync(db, project.Id, ActionNotices.EscalateAfterKey, cancellationToken), out var days) && days > 0
            ? days : ActionNotices.DefaultEscalateAfter;
        var holidays = await WorkingCalendar.HolidaysAsync(db, project, cancellationToken);

        LocalDate? DayOf(Activity a)
        {
            if (!active || a.State != ActivityStates.Active || a.Start is not { } day || a.Departments.Length == 0 || a.Requirements.Count == 0
                || postponed.Contains(a.Id) || day < since) return null;
            var missing = NoticeLog.Missing(a);
            bool Waits(string d) => !confirmed.Contains((a.Id, d));
            var candidates = new List<LocalDate>();
            // At risk: its window opens, its day still ahead, a discipline short and not told yet.
            if (a.RiskFrom is { } risk && day >= from && a.Departments.Any(d => missing[d] > 0 && Waits(d) && !sent.Contains($"activity:{a.Id}:risk:{d}")))
            {
                var on = Max(risk, from);
                if (on <= day) candidates.Add(on);
            }
            // The day after its day: what was all there is confirmed by the system.
            if (a.Departments.Any(d => missing[d] == 0 && Waits(d) && a.Requirements.Any(r => r.Department == null || string.Equals(r.Department, d, StringComparison.OrdinalIgnoreCase))))
                candidates.Add(Max(day.PlusDays(1), from));
            // Still silent some working days after its day: notified again.
            if (a.Departments.Any(d => missing[d] > 0 && Waits(d) && !sent.Contains($"activity:{a.Id}:escalated:{d}")))
                candidates.Add(Max(WorkingCalendar.AddWorkingDays(day, after, project.WeekendDays, holidays), from));
            var next = candidates.Count == 0 ? (LocalDate?)null : candidates.Min();
            return next is { } n && n.PlusDays(-PassedWindowDays) > day ? null : next;
        }

        foreach (var group in activities.Select(a => (a.Id, Old: a.NoticeOn, New: DayOf(a))).Where(x => x.Old != x.New).GroupBy(x => x.New))
        {
            var change = group.Select(x => x.Id).ToList();
            var value = group.Key;
            await db.Activities.Where(a => change.Contains(a.Id)).ExecuteUpdateAsync(s => s.SetProperty(a => a.NoticeOn, value), cancellationToken);
        }
    }

    private static async Task StepsAsync(DeliosDbContext db, Identity.Project project, LocalDate from, bool active,
        IReadOnlyCollection<Guid>? ids, CancellationToken cancellationToken)
    {
        var query = from s in db.ReviewSteps.AsNoTracking()
                    join r in db.Reviews.AsNoTracking() on s.ReviewId equals r.Id
                    where r.ProjectId == project.Id
                    select new { s.Id, s.State, s.WarnedAt, s.DueDate, s.WarnOn, Review = r.State };
        query = ids is null ? query.Where(s => s.State == Reviews.StepStates.Open || s.WarnOn != null) : query.Where(s => ids.Contains(s.Id));
        var steps = await query.ToListAsync(cancellationToken);
        if (steps.Count == 0) return;
        var holidays = await WorkingCalendar.HolidaysAsync(db, project, cancellationToken);

        LocalDate? DayOf(LocalDate due)
        {
            // Warned on the earliest day from which it falls due by the next working day.
            var on = due;
            while (WorkingCalendar.AddWorkingDays(on.PlusDays(-1), 1, project.WeekendDays, holidays) >= due && on.PlusDays(-1) >= from) on = on.PlusDays(-1);
            on = Max(on, from);
            return on <= due ? on : null;
        }

        var written = steps.Select(s => (s.Id, Old: s.WarnOn,
            New: active && s.State == Reviews.StepStates.Open && s.Review == Reviews.ReviewStates.InProgress && s.WarnedAt == null && s.DueDate is { } due && due >= from
                ? DayOf(due) : null));
        foreach (var group in written.Where(x => x.Old != x.New).GroupBy(x => x.New))
        {
            var change = group.Select(x => x.Id).ToList();
            var value = group.Key;
            await db.ReviewSteps.Where(s => change.Contains(s.Id)).ExecuteUpdateAsync(s => s.SetProperty(x => x.WarnOn, value), cancellationToken);
        }
    }

    /// <summary>The project's next moment: the earliest day written on it, at its notify hour on its own clock.</summary>
    private static async Task AlarmAsync(DeliosDbContext db, Identity.Project project, CancellationToken cancellationToken)
    {
        var action = await db.Activities.Where(a => a.ProjectId == project.Id && a.NoticeOn != null).MinAsync(a => a.NoticeOn, cancellationToken);
        var step = await (from s in db.ReviewSteps
                          join r in db.Reviews on s.ReviewId equals r.Id
                          where r.ProjectId == project.Id && s.WarnOn != null
                          select s.WarnOn).MinAsync(cancellationToken);
        var day = action is null ? step : step is null || action < step ? action : step;
        Instant? due = null;
        if (day is { } d)
        {
            var zone = DateTimeZoneProviders.Tzdb.GetZoneOrNull(project.TimeZone) ?? DateTimeZone.Utc;
            due = d.At(new LocalTime(await HourAsync(db, project.Id, cancellationToken), 0)).InZoneLeniently(zone).ToInstant();
        }
        await db.Database.ExecuteSqlAsync($"""
            INSERT INTO notice_alarms (project_id, tenant_id, due_at) VALUES ({project.Id}, {project.TenantId}, {due})
            ON CONFLICT (project_id) DO UPDATE SET due_at = excluded.due_at
            """, cancellationToken);
    }

    /// <summary>The hour of the project's day its notices go out: its own, else the organization's, else 09:00.</summary>
    public static async Task<int> HourAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken)
    {
        var hours = await db.Set<Settings.Setting>().AsNoTracking()
            .Where(s => s.Key == ActionNotices.NotifyAtKey && (s.ProjectId == projectId || s.ProjectId == null))
            .Select(s => new { s.ProjectId, s.Value }).ToListAsync(cancellationToken);
        return HourOf(hours.FirstOrDefault(h => h.ProjectId == projectId)?.Value) ?? HourOf(hours.FirstOrDefault(h => h.ProjectId == null)?.Value)
            ?? ActionNotices.DefaultNotifyAt;
    }

    private static int? HourOf(string? value) => int.TryParse(value, out var hour) && hour is >= 0 and <= 23 ? hour : null;

    private static LocalDate Max(LocalDate a, LocalDate b) => a > b ? a : b;
}

/// <summary>Rung when a project's next moment was written: the worker's alarm sets itself again (<see cref="ActionNotices"/>).</summary>
public sealed class NoticeAlarmBell
{
    private readonly SemaphoreSlim bell = new(0, 1);

    public void Ring()
    {
        try { bell.Release(); }
        catch (SemaphoreFullException) { /* already rung */ }
    }

    /// <summary>Waits until rung or until the moment comes; true when rung.</summary>
    public Task<bool> WaitAsync(TimeSpan until, CancellationToken cancellationToken) => bell.WaitAsync(until, cancellationToken);
}
