using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Delios.Host.Tenancy;

/// <summary>
/// Where heavy reads go. With a replica configured, they run there in their own
/// transaction (so the tenant is set the same way); without one, or when it does
/// not answer, they run on the primary. A replica is a fraction of a second
/// behind: use it for lists and reports, not to read back what a request just wrote.
/// </summary>
public sealed class ReadDatabase(
    DeliosDbContext primary, TenantTransactionInterceptor tenant, IOptions<ConnectionStringsOptions> options,
    ILogger<ReadDatabase> logger)
{
    private readonly string? _replica = string.IsNullOrWhiteSpace(options.Value.PostgresReadOnly) ? null : options.Value.PostgresReadOnly;

    public bool HasReplica => _replica is not null;

    public async Task<T> ReadAsync<T>(Func<DeliosDbContext, Task<T>> query, CancellationToken cancellationToken)
    {
        if (_replica is null) return await query(primary);
        try
        {
            await using var replica = new DeliosDbContext(new DbContextOptionsBuilder<DeliosDbContext>()
                .UseNpgsql(_replica, npgsql => npgsql.UseNodaTime())
                .UseSnakeCaseNamingConvention()
                .AddInterceptors(tenant)
                .Options);
            await using var transaction = await replica.Database.BeginTransactionAsync(cancellationToken);
            var result = await query(replica);
            await transaction.CommitAsync(cancellationToken);
            return result;
        }
        catch (Exception ex) when (ex is NpgsqlException or TimeoutException
            || ex.InnerException is NpgsqlException or TimeoutException)
        {
            logger.LogWarning(ex, "The read replica did not answer; reading from the primary");
            return await query(primary);
        }
    }
}
