using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Checks;

/// <summary>
/// In the worker: every project's checks run once a day by themselves. Each
/// project is decided under its own lock, so two workers never queue it twice.
/// </summary>
public sealed class CheckScheduler(IServiceScopeFactory scopes, ILogger<CheckScheduler> logger) : BackgroundService
{
    public static readonly Duration Every = Duration.FromHours(24);
    private static readonly TimeSpan Pass = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let the rest of the worker come up first.
        await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var queued = await QueueDueAsync(scopes, stoppingToken);
                if (queued > 0) logger.LogInformation("Queued the daily checks for {Count} project(s)", queued);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "Scheduling checks failed; trying again later");
            }
            await Task.Delay(Pass, stoppingToken);
        }
    }

    public static async Task<int> QueueDueAsync(IServiceScopeFactory scopes, CancellationToken cancellationToken)
    {
        List<Guid> tenants;
        await using (var scope = scopes.CreateAsyncScope())
        {
            tenants = await scope.ServiceProvider.GetRequiredService<DeliosDbContext>().Tenants.AsNoTracking()
                .Where(t => t.Active).Select(t => t.Id).ToListAsync(cancellationToken);
        }
        var queued = 0;
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
                var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
                var clock = scope.ServiceProvider.GetRequiredService<IClock>();
                if (await RequestAsync(db, clock, tenantId, projectId, "Schedule", onlyIfDue: true, cancellationToken) is not null) queued++;
            }
        }
        return queued;
    }

    /// <summary>
    /// Queues a run, unless one is already queued or running, or (for the schedule)
    /// one finished within the day. Returns the new run, or null.
    /// </summary>
    public static async Task<CheckRun?> RequestAsync(
        DeliosDbContext db, IClock clock, Guid tenantId, Guid projectId, string by, bool onlyIfDue, CancellationToken cancellationToken)
    {
        // Inside a request the transaction is already open; the schedule opens its own.
        var own = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(cancellationToken) : null;
        await using var _ = own;
        // One decision per project at a time, whichever node asks.
        await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(hashtext({"checks:" + projectId}))", cancellationToken);
        var now = clock.GetCurrentInstant();
        var since = now - Every;
        var busy = await db.CheckRuns.AnyAsync(r => r.ProjectId == projectId
            && (r.Status == CheckRunStatuses.Queued || r.Status == CheckRunStatuses.Running), cancellationToken);
        var recent = onlyIfDue && await db.CheckRuns.AnyAsync(r => r.ProjectId == projectId && r.RequestedAt > since, cancellationToken);
        if (busy || recent) return null;
        var run = new CheckRun { TenantId = tenantId, ProjectId = projectId, RequestedByName = by, RequestedAt = now };
        db.CheckRuns.Add(run);
        db.Enqueue(CheckRunRequested.RoutingKey, new CheckRunRequested(tenantId, run.Id));
        await db.SaveChangesAsync(cancellationToken);
        if (own is not null) await own.CommitAsync(cancellationToken);
        return run;
    }
}
