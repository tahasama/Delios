using NodaTime;

namespace Delios.Host.Platform;

/// <summary>The answer already given to a request carrying an Idempotency-Key, replayed on retry.</summary>
public sealed class IdempotencyRecord
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public required string Key { get; set; }
    public required string Endpoint { get; set; }
    public required string RequestHash { get; set; }
    public int StatusCode { get; set; }
    public string? Body { get; set; }
    public Instant CreatedAt { get; set; }
}
