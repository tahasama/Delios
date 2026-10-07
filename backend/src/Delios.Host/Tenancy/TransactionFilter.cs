using Delios.Host.Platform;

namespace Delios.Host.Tenancy;

/// <summary>
/// Runs a request in one transaction: reads see the tenant's rows, and a change
/// that writes several rows commits completely or not at all. A response of 400
/// or above rolls back.
/// </summary>
public sealed class TransactionFilter(DeliosDbContext db) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var cancel = context.HttpContext.RequestAborted;
        await using var transaction = await db.Database.BeginTransactionAsync(cancel);
        var result = await next(context);
        if (result is not IStatusCodeHttpResult { StatusCode: >= 400 })
        {
            await transaction.CommitAsync(cancel);
        }
        return result;
    }
}
