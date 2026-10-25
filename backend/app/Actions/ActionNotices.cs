using Delios.Host.Platform;
using Delios.Host.Records;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Actions;

/// <summary>
/// Sending a notice and keeping it: who was told, by whom, about what. Every notice about an activity goes through
/// here, the automatic ones and the ones a person sends, so the screens can say who was told and how many days since
/// the first notice on the same subject.
/// </summary>
public static class NoticeLog
{
    /// <summary>
    /// Tells the people (repeats and blanks ignored) and keeps the notice. Does not save: the caller does. With
    /// <paramref name="tell"/> false the notice is only kept: a transmittal told them. People of
    /// another organization (a supplier) cannot open the schedule: they are given <paramref name="outsideLink"/>, the
    /// page of theirs it is about, instead of <paramref name="link"/>.
    /// </summary>
    public static async Task<Notice> SendAsync(DeliosDbContext db, Notifications.Notifier notifier, IClock clock,
        Guid tenantId, Guid projectId, string subject, bool automatic, string sentByName, string title, string? body, string? link,
        IEnumerable<Guid> people, CancellationToken cancellationToken, string? outsideLink = null, bool tell = true)
    {
        var ids = people.Where(id => id != Guid.Empty).Distinct().ToArray();
        var names = await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id)).OrderBy(u => u.Name).Select(u => u.Name).ToArrayAsync(cancellationToken);
        var outside = await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id) && u.PartyId != null && !u.Party!.IsInternal)
            .Select(u => u.Id).ToListAsync(cancellationToken);
        var inside = tell ? ids.Except(outside).ToArray() : [];
        if (!tell) outside.Clear();
        if (inside.Length > 0)
            await notifier.NotifyAsync(tenantId, projectId, inside, Notifications.NotificationKinds.General, title, body, link, cancellationToken);
        if (outside.Count > 0)
            await notifier.NotifyAsync(tenantId, projectId, outside, Notifications.NotificationKinds.General, title, body, outsideLink ?? "/", cancellationToken);
        var notice = new Notice
        {
            TenantId = tenantId,
            ProjectId = projectId,
            Subject = subject.Length > 200 ? subject[..200] : subject,
            Automatic = automatic,
            Title = title.Length > 300 ? title[..300] : title,
            Body = body is { Length: > 4000 } ? body[..4000] : body,
            RecipientIds = ids,
            RecipientNames = names,
            SentByName = sentByName,
            SentAt = clock.GetCurrentInstant(),
        };
        db.Add(notice);
        return notice;
    }

    /// <summary>Whether a notice on this subject was already sent.</summary>
    public static Task<bool> SentAsync(DeliosDbContext db, Guid projectId, string subject, CancellationToken cancellationToken) =>
        db.Notices.AnyAsync(n => n.ProjectId == projectId && n.Subject == subject, cancellationToken);

    /// <summary>The people who answer for a department (a discipline) on the project.</summary>
    public static Task<List<Guid>> DepartmentMembersAsync(DeliosDbContext db, Guid projectId, string department, CancellationToken cancellationToken) =>
        (from m in db.Memberships
         join u in db.Users on m.UserId equals u.Id
         where m.ProjectId == projectId && m.Active && u.Active && m.Department == department
         select u.Id).Distinct().ToListAsync(cancellationToken);

    /// <summary>
    /// Everyone on the project whose function holds the verb outright (Plan: whoever plans the schedule); for CONTROL, also
    /// whoever is named to act as the control function.
    /// </summary>
    public static Task<List<Guid>> HoldersAsync(DeliosDbContext db, Guid projectId, string verb, CancellationToken cancellationToken) =>
        db.Memberships.AsNoTracking()
            .Where(m => m.ProjectId == projectId && m.Active && m.Function!.Active
                && ((verb == Identity.Verbs.Control && m.ActsAsControl) || db.PermissionRules.IgnoreQueryFilters().Any(r => r.FunctionId == m.FunctionId && r.ProjectId == (m.Project!.OwnFunctions ? (Guid?)m.ProjectId : null) && r.Verbs.Contains(verb))))
            .Select(m => m.UserId).Distinct().ToListAsync(cancellationToken);

    /// <summary>The departments of an activity still short of a document: a need with no department counts against every one.</summary>
    public static Dictionary<string, int> Missing(Activity activity) =>
        activity.Departments.ToDictionary(d => d, d => activity.Requirements.Count(r => r.State == RequirementStates.Missing
            && (r.Department == null || string.Equals(r.Department, d, StringComparison.OrdinalIgnoreCase))));
}

/// <summary>
/// In the worker: the day's notices, sent once a day per project at its notify hour, on the project's own clock (owner:
/// "09:00, and add it to settings as a choice"). Nothing sweeps the schedule: where things stand (ready, at risk,
/// overdue) is read when someone looks; only what has to reach people without them looking falls on a date known in
/// advance, and only the actions and steps whose date falls today are read.
/// <list type="bullet">
/// <item>At risk: from the day an action's risk window opens until its day, each discipline still short of a document
/// and not confirmed is told, once.</item>
/// <item>When its day has passed, a discipline whose documents were all released is confirmed by the system, as it
/// stood then (kept even if a document later stops counting).</item>
/// <item>Still silent some working days after the day (the Control room, "Disciplines confirm"): the discipline,
/// whoever holds Manage and the control function are notified again, once.</item>
/// <item>A review step due today or the next working day: whoever on it has not answered is told, once (<see cref="Reviews.ReviewWarnings"/>).</item>
/// </list>
/// A postponed action is left alone. Every notice is kept in the notice log and goes as a notification, an email and a pop-up.
/// </summary>
public sealed class ActionNotices(IServiceScopeFactory scopes, ILogger<ActionNotices> logger) : BackgroundService
{
    /// <summary>The project setting: the hour of the project's day (0–23) its notices go out.</summary>
    public const string NotifyAtKey = "NOTIFY_AT";
    /// <summary>Unless the project says otherwise: 09:00.</summary>
    public const int DefaultNotifyAt = 9;
    /// <summary>How far back an action's day may lie and still be looked at: past the longest "notified again" (60 working days).</summary>
    private const int PassedWindowDays = 120;

    /// <summary>The day each project last had its notices, so a project runs once a day (a restart runs it again: nothing is sent twice).</summary>
    private readonly Dictionary<Guid, LocalDate> ran = [];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken);
        // A schedule read by an older version of the app's reading is read again once, after the app is updated
        // (owner: never on a clock: the schedule is read when someone uploads it).
        await CatchUpSchedulesAsync(stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var told = await RunAsync(stoppingToken);
                if (told > 0) logger.LogInformation("Sent the day's notices: {Count}", told);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "The day's notices failed; trying again within the hour");
            }
            // Wakes at the top of every hour: a project's notify hour is a whole hour of its own clock.
            var now = DateTimeOffset.UtcNow;
            var next = new DateTimeOffset(now.Year, now.Month, now.Day, now.Hour, 0, 5, TimeSpan.Zero).AddHours(1);
            await Task.Delay(next - now, stoppingToken);
        }
    }

    /// <summary>Every active tenant: the projects whose notify hour has come today, and only those, are run.</summary>
    private async Task<int> RunAsync(CancellationToken cancellationToken)
    {
        List<Guid> tenants;
        await using (var scope = scopes.CreateAsyncScope())
        {
            tenants = await scope.ServiceProvider.GetRequiredService<DeliosDbContext>().Tenants.AsNoTracking()
                .Where(t => t.Active).Select(t => t.Id).ToListAsync(cancellationToken);
        }
        var told = 0;
        foreach (var tenantId in tenants)
        {
            List<(Guid Id, LocalDate Today)> due;
            await using (var scope = scopes.CreateAsyncScope())
            {
                scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
                var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
                var clock = scope.ServiceProvider.GetRequiredService<IClock>();
                await using var read = await db.Database.BeginTransactionAsync(cancellationToken);
                // One look per organization: its active projects with their clocks and notify hours.
                var projects = await db.Projects.AsNoTracking().Where(p => p.Status == "ACTIVE").Select(p => new { p.Id, p.TimeZone }).ToListAsync(cancellationToken);
                var hours = await db.Set<Settings.Setting>().AsNoTracking().Where(s => s.Key == NotifyAtKey).Select(s => new { s.ProjectId, s.Value }).ToListAsync(cancellationToken);
                await read.CommitAsync(cancellationToken);
                var orgHour = HourOf(hours.FirstOrDefault(h => h.ProjectId == null)?.Value);
                due = [];
                foreach (var p in projects)
                {
                    var hour = HourOf(hours.FirstOrDefault(h => h.ProjectId == p.Id)?.Value) ?? orgHour ?? DefaultNotifyAt;
                    var local = clock.GetCurrentInstant().InZone(DateTimeZoneProviders.Tzdb.GetZoneOrNull(p.TimeZone) ?? DateTimeZone.Utc);
                    if (local.Hour >= hour && (!ran.TryGetValue(p.Id, out var last) || last < local.Date)) due.Add((p.Id, local.Date));
                }
            }
            foreach (var (projectId, today) in due)
            {
                try
                {
                    await using (var scope = scopes.CreateAsyncScope())
                    {
                        scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
                        told += await Reviews.ReviewWarnings.WarnProjectAsync(scope.ServiceProvider, projectId, cancellationToken);
                    }
                    await using (var scope = scopes.CreateAsyncScope())
                    {
                        scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
                        told += await ProjectAsync(scope.ServiceProvider, projectId, cancellationToken);
                    }
                    ran[projectId] = today;
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    logger.LogWarning(e, "The day's notices of project {Project} failed; trying again within the hour", projectId);
                }
            }
        }
        return told;
    }

    private static int? HourOf(string? value) => int.TryParse(value, out var hour) && hour is >= 0 and <= 23 ? hour : null;

    /// <summary>Once, when the worker starts: every project's schedule read by an older reading is read again.</summary>
    private async Task CatchUpSchedulesAsync(CancellationToken cancellationToken)
    {
        try
        {
            List<Guid> tenants;
            await using (var scope = scopes.CreateAsyncScope())
            {
                tenants = await scope.ServiceProvider.GetRequiredService<DeliosDbContext>().Tenants.AsNoTracking()
                    .Where(t => t.Active).Select(t => t.Id).ToListAsync(cancellationToken);
            }
            foreach (var tenantId in tenants)
            {
                List<Guid> projects;
                await using (var scope = scopes.CreateAsyncScope())
                {
                    scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
                    var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
                    await using var read = await db.Database.BeginTransactionAsync(cancellationToken);
                    projects = await db.Projects.Where(p => p.Status == "ACTIVE").Select(p => p.Id).ToListAsync(cancellationToken);
                    await read.CommitAsync(cancellationToken);
                }
                foreach (var projectId in projects)
                {
                    try
                    {
                        await using var catchUp = scopes.CreateAsyncScope();
                        catchUp.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
                        await catchUp.ServiceProvider.GetRequiredService<ScheduleImporter>().CatchUpAsync(projectId, cancellationToken);
                    }
                    catch (Exception e) when (e is not OperationCanceledException)
                    {
                        logger.LogWarning(e, "Reading the schedule of project {Project} again failed", projectId);
                    }
                }
            }
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogWarning(e, "Reading older schedules again failed");
        }
    }

    /// <summary>
    /// One project's day: only the actions whose risk window is open, or whose day passed lately, are read, their
    /// documents read again first; nothing else of the schedule is touched.
    /// </summary>
    private static async Task<int> ProjectAsync(IServiceProvider services, Guid projectId, CancellationToken cancellationToken)
    {
        var db = services.GetRequiredService<DeliosDbContext>();
        var clock = services.GetRequiredService<IClock>();
        var notifier = services.GetRequiredService<Notifications.Notifier>();
        await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(hashtext({"action-notices:" + projectId}))", cancellationToken);
        var project = await db.Projects.AsNoTracking().SingleAsync(p => p.Id == projectId, cancellationToken);
        db.UseListsOf(project.Id, project.OwnListKeys, project.OwnFunctions);
        var today = WorkingCalendar.Today(clock, project.TimeZone);
        var since = today.PlusDays(-PassedWindowDays);

        // What falls today: inside its risk window and its day still ahead, or its day passed lately.
        var ids = await db.Activities.Where(a => a.ProjectId == projectId && a.State == ActivityStates.Active && a.Start != null
                && a.Departments.Length > 0 && a.Requirements.Any()
                && ((a.Start >= today && a.RiskFrom != null && a.RiskFrom <= today) || (a.Start < today && a.Start >= since)))
            .Select(a => a.Id).ToListAsync(cancellationToken);
        if (ids.Count == 0) { await tx.CommitAsync(cancellationToken); return 0; }
        // Their documents as they stand now, before anyone is told.
        await Readiness.RestateAsync(db, clock, ids, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        var activities = await db.Activities.Include(a => a.Requirements).Where(a => ids.Contains(a.Id)).ToListAsync(cancellationToken);
        var confirmations = await db.Set<ReadinessConfirmation>().Where(c => c.ProjectId == projectId && ids.Contains(c.ActivityId)).ToListAsync(cancellationToken);
        var catalog = await Documents.Catalog.LoadAsync(db, cancellationToken);
        var postponed = (await db.ActivityDecisions.AsNoTracking().Where(d => d.ProjectId == projectId && ids.Contains(d.ActivityId) && d.ReversedAt == null)
            .Select(d => new { d.ActivityId, d.Decision }).ToListAsync(cancellationToken))
            .Where(d => !Proceeds(catalog, d.Decision)).Select(d => d.ActivityId).ToHashSet();
        var after = int.TryParse(await Settings.ProjectAnswers.PolicyAsync(db, projectId, EscalateAfterKey, cancellationToken), out var days) && days > 0
            ? days : DefaultEscalateAfter;
        var holidays = await WorkingCalendar.HolidaysAsync(db, project, cancellationToken);
        // What was already sent about these actions, read once.
        var subjects = activities.SelectMany(a => a.Departments.SelectMany(d => new[] { $"activity:{a.Id}:risk:{d}", $"activity:{a.Id}:escalated:{d}" })).ToList();
        var sent = (await db.Notices.AsNoTracking().Where(n => n.ProjectId == projectId && subjects.Contains(n.Subject))
            .Select(n => n.Subject).Distinct().ToListAsync(cancellationToken)).ToHashSet();

        var told = 0;
        foreach (var activity in activities)
        {
            if (postponed.Contains(activity.Id)) continue;
            var day = activity.Start!.Value;
            var missing = NoticeLog.Missing(activity);
            bool Confirmed(string department) =>
                confirmations.Any(c => c.ActivityId == activity.Id && c.Department == department && c.RevokedAt == null);
            var passed = day < today;
            if (passed)
            {
                // The day has passed: what was all there is confirmed by the system, as it stood.
                foreach (var department in activity.Departments.Where(d => missing[d] == 0 && !Confirmed(d)))
                {
                    var listed = activity.Requirements.Count(r => r.Department == null || string.Equals(r.Department, department, StringComparison.OrdinalIgnoreCase));
                    if (listed == 0) continue;
                    var row = confirmations.FirstOrDefault(c => c.ActivityId == activity.Id && c.Department == department);
                    if (row is null)
                    {
                        row = new ReadinessConfirmation { TenantId = project.TenantId, ProjectId = projectId, ActivityId = activity.Id, Department = department, ConfirmedByName = "" };
                        db.Add(row);
                        confirmations.Add(row);
                    }
                    row.Available = true;
                    row.Automatic = true;
                    row.Note = $"Every document ({listed}) was released at its status by the day.";
                    row.ConfirmedByName = "Automatic";
                    row.ConfirmedAt = clock.GetCurrentInstant();
                    row.RevokedAt = null;
                    row.RevokedByName = null;
                    row.RevokedReason = null;
                }
                // Still silent some working days after the day: notified again, with whoever holds Manage and the control function.
                if (WorkingCalendar.AddWorkingDays(day, after, project.WeekendDays, holidays) <= today)
                    foreach (var department in activity.Departments.Where(d => missing[d] > 0 && !Confirmed(d)))
                        told += await NotifyAgainAsync(db, notifier, clock, project, activity, department, missing[department], after, sent, cancellationToken);
                continue;
            }
            // At risk: its risk window is open and its day is still ahead.
            foreach (var department in activity.Departments.Where(d => missing[d] > 0 && !Confirmed(d)))
            {
                var subject = $"activity:{activity.Id}:risk:{department}";
                if (!sent.Add(subject)) continue;
                var people = await NoticeLog.DepartmentMembersAsync(db, projectId, department, cancellationToken);
                await NoticeLog.SendAsync(db, notifier, clock, project.TenantId, projectId, subject, true, "Automatic",
                    $"{activity.Code} on {day:yyyy-MM-dd} is at risk: {missing[department]} of {department}'s documents missing",
                    $"{activity.Name}. Send the documents, or confirm on the action's page and say why it can go ahead without them.",
                    $"/actions/{activity.Code}", people, cancellationToken);
                told++;
            }
        }
        await db.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return told;
    }

    /// <summary>The project setting: working days after an action's day before an unanswered discipline is notified again.</summary>
    public const string EscalateAfterKey = "ESCALATE_AFTER_DAYS";
    /// <summary>Unless the project says otherwise: three working days.</summary>
    public const int DefaultEscalateAfter = 3;

    /// <summary>
    /// A discipline still short of its documents and silent some working days after the action's day: its people,
    /// whoever holds Manage, and the control function are told, once. Nothing on the action is marked; the notice is the record.
    /// </summary>
    private static async Task<int> NotifyAgainAsync(DeliosDbContext db, Notifications.Notifier notifier, IClock clock, Identity.Project project,
        Activity activity, string department, int missing, int after, HashSet<string> sent, CancellationToken cancellationToken)
    {
        // The subject keeps the words it was first written with, so a notice sent before is never sent again.
        var subject = $"activity:{activity.Id}:escalated:{department}";
        if (!sent.Add(subject)) return 0;
        var people = await NoticeLog.DepartmentMembersAsync(db, project.Id, department, cancellationToken);
        people.AddRange(await NoticeLog.HoldersAsync(db, project.Id, Identity.Verbs.Manage, cancellationToken));
        people.AddRange(await NoticeLog.HoldersAsync(db, project.Id, Identity.Verbs.Control, cancellationToken));
        if (people.Count == 0) return 0;
        await NoticeLog.SendAsync(db, notifier, clock, project.TenantId, project.Id, subject, true, "Automatic",
            $"{activity.Code}: {department} has not answered, {after} working days after its day ({activity.Start:yyyy-MM-dd})",
            $"{activity.Name}. {missing} of {department}'s documents are still missing and nobody of {department} has confirmed whether the work went ahead without them. "
            + "Confirm it on the action's page and say why, or record that it was postponed.",
            $"/actions/{activity.Code}", people, cancellationToken);
        return 1;
    }

    /// <summary>Whether a decision means the work went ahead (the published value's "proceeds"); otherwise it was postponed.</summary>
    public static bool Proceeds(Documents.Catalog catalog, string decision) =>
        catalog.Prop(ScheduleSets.Decisions, decision, "proceeds") is { ValueKind: System.Text.Json.JsonValueKind.True };
}
