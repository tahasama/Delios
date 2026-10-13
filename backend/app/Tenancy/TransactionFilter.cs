using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.Caching.Hybrid;

namespace Delios.Host.Tenancy;

/// <summary>
/// Runs a request in one transaction: reads see the tenant's rows, and a change
/// that writes several rows commits completely or not at all. A response of 400
/// or above rolls back. A refusal (403) to a signed-in person is recorded in the
/// audit trail, once an hour per person and address, so repeated refusals show
/// without the screens' routine probing filling the trail.
/// </summary>
public sealed class TransactionFilter(DeliosDbContext db, Documents.SnapshotRecorder snapshots, AuditLog audit, HybridCache cache) : IEndpointFilter
{
    private static readonly HybridCacheEntryOptions RecordedFor = new()
    {
        Expiration = TimeSpan.FromHours(1),
        LocalCacheExpiration = TimeSpan.FromHours(1),
    };

    /// <summary>
    /// Starts a transaction, runs the endpoint, and commits unless the result has a status code of 400 or more.
    /// If the endpoint throws or returns an error, the transaction is disposed without commit, which rolls it back.
    /// </summary>
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var cancel = context.HttpContext.RequestAborted;
        object? result;
        await using (var transaction = await db.Database.BeginTransactionAsync(cancel))
        {
            result = await next(context);
            if (result is not IStatusCodeHttpResult { StatusCode: >= 400 })
            {
                await snapshots.CaptureAsync(cancel);
                await transaction.CommitAsync(cancel);
                return result;
            }
        }
        if (result is IStatusCodeHttpResult { StatusCode: StatusCodes.Status403Forbidden })
        {
            await RecordRefusalAsync(context.HttpContext, result, cancel);
        }
        return result;
    }

    /// <summary>Writes ACCESS_REFUSED with what was asked and why it was refused, in its own transaction.</summary>
    private async Task RecordRefusalAsync(HttpContext http, object result, CancellationToken cancel)
    {
        if (http.User.Identity?.IsAuthenticated != true) return;
        var route = (http.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? http.Request.Path.Value ?? "";
        var key = $"refused:{http.User.UserId():N}:{http.Request.Method}:{route}";
        var fresh = false;
        await cache.GetOrCreateAsync(key, _ => { fresh = true; return ValueTask.FromResult(true); }, RecordedFor, cancellationToken: cancel);
        if (!fresh) return;

        var code = result is ProblemHttpResult problem && problem.ProblemDetails.Extensions.TryGetValue("code", out var value) ? value?.ToString() : null;
        Guid? projectId = Guid.TryParse(http.GetRouteValue("projectId")?.ToString(), out var id) ? id : null;
        await using var record = await db.Database.BeginTransactionAsync(cancel);
        await audit.WriteAsync(http.User.Actor(), "ACCESS_REFUSED", detail: $"{http.Request.Method} {http.Request.Path}{(code is null ? "" : $": {code}")}",
            projectId: projectId, cancellationToken: cancel);
        await record.CommitAsync(cancel);
    }
}
