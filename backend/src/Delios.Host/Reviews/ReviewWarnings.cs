using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Reviews;

/// <summary>
/// In the worker: the people on a step who have not answered are warned the working day before it falls due, once.
/// The step is stamped when they were warned; reopening the step clears the stamp.
/// </summary>
public sealed class ReviewWarnings(IServiceScopeFactory scopes, ILogger<ReviewWarnings> logger) : BackgroundService
{
    /// <summary>How long the job waits between looks (30 minutes).</summary>
    private static readonly TimeSpan Pass = TimeSpan.FromMinutes(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(45), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var warned = await WarnDueAsync(scopes, stoppingToken);
                if (warned > 0) logger.LogInformation("Warned the people on {Count} step(s) falling due", warned);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "Warning of steps falling due failed; trying again later");
            }
            await Task.Delay(Pass, stoppingToken);
        }
    }

    /// <summary>Every active project of every active tenant: warns the steps due by the next working day. Returns how many steps were warned.</summary>
    public static async Task<int> WarnDueAsync(IServiceScopeFactory scopes, CancellationToken cancellationToken)
    {
        List<Guid> tenants;
        await using (var scope = scopes.CreateAsyncScope())
        {
            tenants = await scope.ServiceProvider.GetRequiredService<DeliosDbContext>().Tenants.AsNoTracking()
                .Where(t => t.Active).Select(t => t.Id).ToListAsync(cancellationToken);
        }
        var warned = 0;
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
                await using var scope = scopes.CreateAsyncScope();
                scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
                warned += await WarnProjectAsync(scope.ServiceProvider, projectId, cancellationToken);
            }
        }
        return warned;
    }

    private static async Task<int> WarnProjectAsync(IServiceProvider services, Guid projectId, CancellationToken cancellationToken)
    {
        var db = services.GetRequiredService<DeliosDbContext>();
        var clock = services.GetRequiredService<IClock>();
        var notifier = services.GetRequiredService<Notifications.Notifier>();
        await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
        // One pass per project at a time, whichever worker runs it.
        await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(hashtext({"review-warnings:" + projectId}))", cancellationToken);
        var project = await db.Projects.AsNoTracking().SingleAsync(p => p.Id == projectId, cancellationToken);
        var today = WorkingCalendar.Today(clock, project.TimeZone);
        var until = WorkingCalendar.AddWorkingDays(today, 1, project.WeekendDays);
        var steps = await (from s in db.ReviewSteps.Include(s => s.Participants)
                           join r in db.Reviews on s.ReviewId equals r.Id
                           where r.ProjectId == projectId && r.State == ReviewStates.InProgress && s.State == StepStates.Open
                               && s.WarnedAt == null && s.DueDate != null && s.DueDate >= today && s.DueDate <= until
                           select new { Step = s, Review = r }).ToListAsync(cancellationToken);
        var now = clock.GetCurrentInstant();
        foreach (var (step, review) in steps.Select(x => (x.Step, x.Review)))
        {
            var waiting = step.Participants.Where(p => p.AnsweredAt is null).Select(p => p.UserId).ToList();
            step.WarnedAt = now;
            if (waiting.Count == 0) continue;
            var document = await db.Documents.AsNoTracking().Where(d => d.Id == review.DocumentId).Select(d => d.Number).SingleAsync(cancellationToken);
            var due = step.DueDate == today ? "today" : $"on {step.DueDate:yyyy-MM-dd}";
            await notifier.NotifyAsync(review.TenantId, projectId, waiting, Notifications.NotificationKinds.ReviewStep,
                $"Due {due}: {document}, {step.Title}", $"Review {review.Number}, step {step.Index + 1}, falls due {due}.",
                $"/reviews/{review.Id}", cancellationToken, Notifications.EmailKinds.Review);
        }
        await db.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return steps.Count;
    }
}
