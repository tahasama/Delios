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
/// In the worker: the project's notices, at its notify hour on its own clock (owner: "09:00, and add it to settings as a
/// choice"), only on the days something was written down for it (<see cref="NoticeDays"/>: owner, "the changes are the
/// ones who tell us"). One alarm rings at the earliest moment of all projects; a change that writes an earlier one rings
/// it again (<see cref="NoticeAlarmBell"/>). A day with nothing written runs nothing.
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
public sealed class ActionNotices(IServiceScopeFactory scopes, NoticeAlarmBell bell, IClock clock, ILogger<ActionNotices> logger) : BackgroundService
{
    /// <summary>The project setting: the hour of the project's day (0–23) its notices go out.</summary>
    public const string NotifyAtKey = "NOTIFY_AT";
    /// <summary>Unless the project says otherwise: 09:00.</summary>
    public const int DefaultNotifyAt = 9;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Once, when the worker starts: a project whose days were never written (just after this update) has them written.
        await WriteMissingAsync(stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                foreach (var (projectId, tenantId) in await DueAsync(stoppingToken))
                {
                    try { await RunAsync(projectId, tenantId, stoppingToken); }
                    catch (Exception e) when (e is not OperationCanceledException)
                    {
                        // Failed: tried again in an hour, not at once over and over.
                        logger.LogWarning(e, "The notices of project {Project} failed; trying again in an hour", projectId);
                        await using var scope = scopes.CreateAsyncScope();
                        var later = clock.GetCurrentInstant() + Duration.FromHours(1);
                        await scope.ServiceProvider.GetRequiredService<DeliosDbContext>().Database
                            .ExecuteSqlAsync($"UPDATE notice_alarms SET due_at = {later} WHERE project_id = {projectId}", stoppingToken);
                    }
                }
                // Asleep until the earliest moment written, or until a change writes an earlier one.
                var next = await NextAsync(stoppingToken);
                var wait = next is { } at ? at - clock.GetCurrentInstant() : Duration.MaxValue;
                await bell.WaitAsync(wait <= Duration.Zero ? TimeSpan.Zero
                    : wait > Duration.FromDays(24) ? TimeSpan.FromDays(24) : wait.ToTimeSpan(), stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "Reading when the notices go failed; waiting for the next change");
                await bell.WaitAsync(Timeout.InfiniteTimeSpan, stoppingToken);
            }
        }
    }

    /// <summary>The projects whose moment has come.</summary>
    private async Task<List<(Guid ProjectId, Guid TenantId)>> DueAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
        var now = clock.GetCurrentInstant();
        return (await db.Set<NoticeAlarm>().AsNoTracking().Where(a => a.DueAt != null && a.DueAt <= now)
            .Select(a => new { a.ProjectId, a.TenantId }).ToListAsync(cancellationToken)).Select(a => (a.ProjectId, a.TenantId)).ToList();
    }

    private async Task<Instant?> NextAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<DeliosDbContext>().Set<NoticeAlarm>().Where(a => a.DueAt != null)
            .MinAsync(a => a.DueAt, cancellationToken);
    }

    /// <summary>One project's moment: its day is marked told first, then its steps and actions are told, then its days written again.</summary>
    private async Task RunAsync(Guid projectId, Guid tenantId, CancellationToken cancellationToken)
    {
        await using (var scope = scopes.CreateAsyncScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            var project = await db.Projects.AsNoTracking().SingleAsync(p => p.Id == projectId, cancellationToken);
            var today = WorkingCalendar.Today(clock, project.TimeZone);
            await db.Database.ExecuteSqlAsync($"UPDATE notice_alarms SET last_run = {today} WHERE project_id = {projectId}", cancellationToken);
        }
        var told = 0;
        if (await StillActiveAsync(projectId, tenantId, cancellationToken))
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
        }
        await using (var scope = scopes.CreateAsyncScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
            var project = await db.Projects.AsNoTracking().SingleAsync(p => p.Id == projectId, cancellationToken);
            var today = WorkingCalendar.Today(clock, project.TimeZone);
            // What fell today is written again, from tomorrow on.
            var activities = await db.Activities.Where(a => a.ProjectId == projectId && a.NoticeOn != null && a.NoticeOn <= today).Select(a => a.Id).ToListAsync(cancellationToken);
            var steps = await (from s in db.ReviewSteps
                               join r in db.Reviews on s.ReviewId equals r.Id
                               where r.ProjectId == projectId && s.WarnOn != null && s.WarnOn <= today
                               select s.Id).ToListAsync(cancellationToken);
            await NoticeDays.WriteAsync(db, clock, project, activities, steps, cancellationToken);
            await tx.CommitAsync(cancellationToken);
        }
        if (told > 0) logger.LogInformation("Sent the notices of project {Project}: {Count}", projectId, told);
    }

    private async Task<bool> StillActiveAsync(Guid projectId, Guid tenantId, CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
        var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
        await using var read = await db.Database.BeginTransactionAsync(cancellationToken);
        return await db.Projects.AnyAsync(p => p.Id == projectId && p.Status == "ACTIVE", cancellationToken);
    }

    /// <summary>Once, when the worker starts: every project with no moment kept yet has its days written.</summary>
    private async Task WriteMissingAsync(CancellationToken cancellationToken)
    {
        try
        {
            List<Guid> tenants;
            HashSet<Guid> kept;
            await using (var scope = scopes.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
                tenants = await db.Tenants.AsNoTracking().Where(t => t.Active).Select(t => t.Id).ToListAsync(cancellationToken);
                kept = (await db.Set<NoticeAlarm>().AsNoTracking().Select(a => a.ProjectId).ToListAsync(cancellationToken)).ToHashSet();
            }
            foreach (var tenantId in tenants)
            {
                await using var scope = scopes.CreateAsyncScope();
                scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
                var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
                await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
                var projects = await db.Projects.AsNoTracking().Where(p => p.Status == "ACTIVE").ToListAsync(cancellationToken);
                foreach (var project in projects.Where(p => !kept.Contains(p.Id)))
                    await NoticeDays.WriteAsync(db, clock, project, null, null, cancellationToken);
                await tx.CommitAsync(cancellationToken);
            }
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogWarning(e, "Writing the notice days of projects that had none failed");
        }
    }

    /// <summary>
    /// One project's day: only the actions whose notice day has come (<see cref="Activity.NoticeOn"/>) are read, their
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
        var since = today.PlusDays(-NoticeDays.PassedWindowDays);

        // What falls today, as written down by what changed it.
        var ids = await db.Activities.Where(a => a.ProjectId == projectId && a.NoticeOn != null && a.NoticeOn <= today
                && a.State == ActivityStates.Active && a.Start != null && a.Start >= since && a.Departments.Length > 0 && a.Requirements.Any())
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
            if (activity.RiskFrom is not { } riskFrom || riskFrom > today) continue;
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
