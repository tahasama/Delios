using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Delios.Host.Tenancy;

/// <summary>
/// Superusers and roles with BYPASSRLS ignore row-level security, so a node
/// connected as one would serve every tenant's rows to every tenant. Such a
/// node reports itself not ready and receives no traffic.
/// </summary>
public sealed class DatabaseRoleHealthCheck(DeliosDbContext db) : IHealthCheck
{
    /// <summary>
    /// Asks Postgres whether the role this node logs in as is a superuser or has BYPASSRLS.
    /// Called by the health check endpoints (registered as "postgres-role"); returns Unhealthy if so, or if the role cannot be read.
    /// </summary>
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            var bypasses = await db.Database
                .SqlQuery<bool>($"SELECT rolsuper OR rolbypassrls AS \"Value\" FROM pg_roles WHERE rolname = current_user")
                .SingleAsync(cancellationToken);
            return bypasses
                ? HealthCheckResult.Unhealthy("The database role bypasses row-level security")
                : HealthCheckResult.Healthy();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return HealthCheckResult.Unhealthy("Could not read the database role", ex);
        }
    }
}
