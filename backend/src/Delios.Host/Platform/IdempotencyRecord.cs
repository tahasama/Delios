using NodaTime;

namespace Delios.Host.Platform;

/// <summary>The answer already given to a request carrying an Idempotency-Key, replayed on retry.</summary>
public sealed class IdempotencyRecord
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    /// <summary>
    /// The user who sent the request. A key belongs to one user, so two people cannot collide on the same key.
    /// </summary>
    public Guid UserId { get; set; }
    /// <summary>The value of the <c>Idempotency-Key</c> header.</summary>
    public required string Key { get; set; }
    /// <summary>HTTP method and path of the first request, such as "POST /api/projects/.../documents".</summary>
    public required string Endpoint { get; set; }
    /// <summary>SHA-256 of the first request's body, to refuse the same key on a different request.</summary>
    public required string RequestHash { get; set; }
    /// <summary>HTTP status code of the first answer.</summary>
    public int StatusCode { get; set; }
    /// <summary>The first answer's body as JSON. Null when it had none.</summary>
    public string? Body { get; set; }
    /// <summary>When the answer was stored; filled in by the database (<c>now()</c>).</summary>
    public Instant CreatedAt { get; set; }
}
