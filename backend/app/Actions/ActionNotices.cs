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
/// In the worker: the activities' automatic notices and confirmations.
/// <list type="bullet">
/// <item>From the day an activity is at risk (its day less the documents' risk window) until its day, each department
/// still short of a document and not confirmed is told, once.</item>
/// <item>When its day has passed, a department whose documents were all released is confirmed by the system, as it
/// stood then; each department still short and not confirmed is told, once. A postponed activity is left alone.</item>
/// </list>
/// </summary>
public sealed class ActionNotices(IServiceScopeFactory scopes, ILogger<ActionNotices> logger) : BackgroundService
{
    /// <summary>How long the job waits between looks (30 minutes).</summary>
    private static readonly TimeSpan Pass = TimeSpan.FromMinutes(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var told = await RunAsync(scopes, stoppingToken);
                if (told > 0) logger.LogInformation("Sent {Count} automatic notice(s) about activities", told);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "Automatic notices about activities failed; trying again later");
            }
            await Task.Delay(Pass, stoppingToken);
        }
    }

    /// <summary>Every active project of every active tenant. Returns how many notices were sent.</summary>
    public static async Task<int> RunAsync(IServiceScopeFactory scopes, CancellationToken cancellationToken)
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
                // A schedule read by an older reading is read again first, by itself.
                try
                {
                    await using var catchUp = scopes.CreateAsyncScope();
                    catchUp.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
                    await catchUp.ServiceProvider.GetRequiredService<ScheduleImporter>().CatchUpAsync(projectId, cancellationToken);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    await using var logs = scopes.CreateAsyncScope();
                    logs.ServiceProvider.GetRequiredService<ILogger<ScheduleImporter>>().LogWarning(e, "Reading the schedule of project {Project} again failed; trying again later", projectId);
                }
                await using var scope = scopes.CreateAsyncScope();
                scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
                told += await ProjectAsync(scope.ServiceProvider, projectId, cancellationToken);
            }
        }
        return told;
    }

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

        var ids = await db.Activities.Where(a => a.ProjectId == projectId && a.State == ActivityStates.Active && a.Start != null
            && a.Departments.Length > 0 && a.Requirements.Any()).Select(a => a.Id).ToListAsync(cancellationToken);
        if (ids.Count == 0) { await tx.CommitAsync(cancellationToken); return 0; }
        // The documents may have moved since the last look: their state, and the day the activity is at risk from.
        await Readiness.RestateAsync(db, clock, ids, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        var activities = await db.Activities.Include(a => a.Requirements).Where(a => ids.Contains(a.Id)).ToListAsync(cancellationToken);
        var confirmations = await db.Set<ReadinessConfirmation>().Where(c => c.ProjectId == projectId).ToListAsync(cancellationToken);
        var catalog = await Documents.Catalog.LoadAsync(db, cancellationToken);
        var postponed = (await db.ActivityDecisions.AsNoTracking().Where(d => d.ProjectId == projectId && d.ReversedAt == null)
            .Select(d => new { d.ActivityId, d.Decision }).ToListAsync(cancellationToken))
            .Where(d => !Proceeds(catalog, d.Decision)).Select(d => d.ActivityId).ToHashSet();
        var escalateAfter = int.TryParse(await Settings.ProjectAnswers.PolicyAsync(db, projectId, EscalateAfterKey, cancellationToken), out var days) && days > 0
            ? days : DefaultEscalateAfter;
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
            }
            // Every document of a discipline released at its status: it is confirmed by itself, and its people are told
            // so, once: nothing is asked of them for this action.
            // Only for an action still ahead: a day already passed is settled by the confirmation above.
            foreach (var department in activity.Departments.Where(d => !passed && missing[d] == 0))
            {
                var listed = activity.Requirements.Count(r => r.Department == null || string.Equals(r.Department, department, StringComparison.OrdinalIgnoreCase));
                if (listed == 0) continue;
                var subject = $"activity:{activity.Id}:ready:{department}";
                if (await NoticeLog.SentAsync(db, projectId, subject, cancellationToken)) continue;
                var people = await NoticeLog.DepartmentMembersAsync(db, projectId, department, cancellationToken);
                if (people.Count == 0) continue;
                await NoticeLog.SendAsync(db, notifier, clock, project.TenantId, projectId, subject, true, "Automatic",
                    $"{activity.Code} on {day:yyyy-MM-dd}: all of {department}'s documents are ready",
                    $"{activity.Name}. Every one of {department}'s {listed} document{(listed == 1 ? " is" : "s are")} released at the status the action needs, "
                    + $"so {department} is confirmed automatically. Nothing is asked of you for this action.",
                    $"/actions/{activity.Code}", people, cancellationToken);
                told++;
            }
            var atRisk = !passed && activity.RiskFrom is { } from && from <= today;
            if (!passed && !atRisk) continue;
            foreach (var department in activity.Departments.Where(d => missing[d] > 0 && !Confirmed(d)))
            {
                var subject = $"activity:{activity.Id}:{(passed ? "passed" : "risk")}:{department}";
                if (await NoticeLog.SentAsync(db, projectId, subject, cancellationToken))
                {
                    // Told when the day passed, and still no answer some working days later: the discipline, whoever holds Manage
                    // and the control function are all told, once.
                    if (passed && WorkingCalendar.AddWorkingDays(day, escalateAfter, project.WeekendDays, await WorkingCalendar.HolidaysAsync(db, project, cancellationToken)) <= today)
                        told += await EscalateAsync(db, notifier, clock, project, activity, department, missing[department], escalateAfter, cancellationToken);
                    continue;
                }
                var people = await NoticeLog.DepartmentMembersAsync(db, projectId, department, cancellationToken);
                var title = passed
                    ? $"{activity.Code}: its day ({day:yyyy-MM-dd}) passed with {missing[department]} of {department}'s documents missing"
                    : $"{activity.Code} on {day:yyyy-MM-dd} is at risk: {missing[department]} of {department}'s documents missing";
                var body = passed
                    ? $"{activity.Name}. Confirm {department}'s documents on the action's page and say why the work went ahead without them, or that it was postponed."
                    : $"{activity.Name}. Send the documents, or confirm on the action's page and say why it can go ahead without them.";
                await NoticeLog.SendAsync(db, notifier, clock, project.TenantId, projectId, subject, true, "Automatic", title, body,
                    $"/actions/{activity.Code}", people, cancellationToken);
                told++;
            }
        }
        await db.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return told;
    }

    /// <summary>The project setting: working days after an action's day before an unanswered discipline is escalated.</summary>
    public const string EscalateAfterKey = "ESCALATE_AFTER_DAYS";
    /// <summary>Unless the project says otherwise: three working days.</summary>
    public const int DefaultEscalateAfter = 3;

    /// <summary>
    /// A discipline still short of its documents and silent some working days after the action's day: its people,
    /// whoever holds Manage, and the control function are told, once. Nothing on the action is marked; the notice is the record.
    /// </summary>
    private static async Task<int> EscalateAsync(DeliosDbContext db, Notifications.Notifier notifier, IClock clock, Identity.Project project,
        Activity activity, string department, int missing, int after, CancellationToken cancellationToken)
    {
        var subject = $"activity:{activity.Id}:escalated:{department}";
        if (await NoticeLog.SentAsync(db, project.Id, subject, cancellationToken)) return 0;
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
