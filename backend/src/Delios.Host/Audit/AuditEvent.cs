using NodaTime;

namespace Delios.Host.Audit;

/// <summary>
/// An append-only, hash-chained record of what happened. Rows are written only by
/// the <c>audit_append</c> database function and can never be updated or deleted.
/// </summary>
public sealed class AuditEvent
{
    public long Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid? ProjectId { get; set; }
    public Instant At { get; set; }
    public Guid? ActorId { get; set; }
    public required string ActorName { get; set; }
    public required string Action { get; set; }
    public string? EntityType { get; set; }
    public Guid? EntityId { get; set; }
    public string? EntityLabel { get; set; }
    public string? Detail { get; set; }
    public required byte[] PreviousHash { get; set; }
    public required byte[] Hash { get; set; }
}
