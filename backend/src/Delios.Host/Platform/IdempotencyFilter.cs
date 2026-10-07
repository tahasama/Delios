using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Delios.Host.Identity;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Delios.Host.Platform;

/// <summary>
/// A request sent again with the same <c>Idempotency-Key</c> gets the first answer
/// back instead of being done twice: a retried "register document" must not
/// allocate a second number. The record commits with the change it describes.
/// </summary>
public sealed class IdempotencyFilter(DeliosDbContext db, IOptions<JsonOptions> json) : IEndpointFilter
{
    public const string Header = "Idempotency-Key";

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var key = http.Request.Headers[Header].ToString();
        if (string.IsNullOrEmpty(key)) return await next(context);
        if (key.Length > 100) return Problems.Invalid("IDEMPOTENCY_KEY_INVALID", "The Idempotency-Key is too long.");

        var endpoint = $"{http.Request.Method} {http.Request.Path}";
        var requestHash = Hash(context.Arguments.Where(a => a?.GetType().Name.EndsWith("Request", StringComparison.Ordinal) == true));
        var userId = http.User.UserId();

        var earlier = await db.IdempotencyRecords.AsNoTracking()
            .SingleOrDefaultAsync(r => r.UserId == userId && r.Key == key, http.RequestAborted);
        if (earlier is not null)
        {
            if (earlier.Endpoint != endpoint || earlier.RequestHash != requestHash)
            {
                return Problems.Invalid("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used for a different request.");
            }
            http.Response.Headers["Idempotent-Replayed"] = "true";
            return Results.Content(earlier.Body ?? "null", "application/json", Encoding.UTF8, earlier.StatusCode);
        }

        var result = await next(context);
        if (result is IStatusCodeHttpResult { StatusCode: >= 200 and < 300 } success)
        {
            db.IdempotencyRecords.Add(new IdempotencyRecord
            {
                TenantId = http.User.TenantId(),
                UserId = userId,
                Key = key,
                Endpoint = endpoint,
                RequestHash = requestHash,
                StatusCode = success.StatusCode!.Value,
                Body = result is IValueHttpResult { Value: { } value }
                    ? JsonSerializer.Serialize(value, json.Value.SerializerOptions)
                    : null,
            });
            await db.SaveChangesAsync(http.RequestAborted);
        }
        return result;
    }

    private string Hash(IEnumerable<object?> requests) => Convert.ToHexStringLower(SHA256.HashData(
        Encoding.UTF8.GetBytes(JsonSerializer.Serialize(requests, json.Value.SerializerOptions))));
}
