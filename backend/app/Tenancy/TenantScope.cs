using Delios.Host.Platform;

namespace Delios.Host.Tenancy;

/// <summary>
/// Work done as another organization than the request's: a scope of its own, that organization's row-level security,
/// one transaction committed at the end. Used where two organizations meet (a link between them, a linked account);
/// nothing else reaches across. A request's own data is in its own transaction, so do the other organization's part last.
/// </summary>
public static class TenantScope
{
    public static async Task<T> RunAsync<T>(IServiceScopeFactory scopes, Guid tenantId,
        Func<IServiceProvider, DeliosDbContext, Task<T>> work, CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
        var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var result = await work(scope.ServiceProvider, db);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return result;
    }

    public static Task RunAsync(IServiceScopeFactory scopes, Guid tenantId,
        Func<IServiceProvider, DeliosDbContext, Task> work, CancellationToken cancellationToken) =>
        RunAsync<bool>(scopes, tenantId, async (services, db) => { await work(services, db); return true; }, cancellationToken);
}
