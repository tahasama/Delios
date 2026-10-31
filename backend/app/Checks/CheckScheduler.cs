using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Checks;

/// <summary>
/// A project's checks run when someone asks for them ("Run the checks", owner: nothing runs on a clock that nobody
/// asked for). Each project is decided under its own lock, so a run is never queued twice.
/// </summary>
public static class CheckScheduler
{
    /// <summary>
    /// Queues a run, unless one is already queued or running. Returns the new run, or null.
    /// </summary>
    public static async Task<CheckRun?> RequestAsync(
        DeliosDbContext db, IClock clock, Guid tenantId, Guid projectId, string by, CancellationToken cancellationToken)
    {
        // Inside a request the transaction is already open; elsewhere it opens its own.
        var own = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(cancellationToken) : null;
        await using var _ = own;
        // One decision per project at a time, whichever node asks.
        await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(hashtext({"checks:" + projectId}))", cancellationToken);
        var now = clock.GetCurrentInstant();
        var busy = await db.CheckRuns.AnyAsync(r => r.ProjectId == projectId
            && (r.Status == CheckRunStatuses.Queued || r.Status == CheckRunStatuses.Running), cancellationToken);
        if (busy) return null;
        var run = new CheckRun { TenantId = tenantId, ProjectId = projectId, RequestedByName = by, RequestedAt = now };
        db.CheckRuns.Add(run);
        db.Enqueue(CheckRunRequested.RoutingKey, new CheckRunRequested(tenantId, run.Id));
        await db.SaveChangesAsync(cancellationToken);
        if (own is not null) await own.CommitAsync(cancellationToken);
        return run;
    }
}
