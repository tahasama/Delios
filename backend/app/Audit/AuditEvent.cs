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
    /// <summary>The project the event belongs to; null for events about the whole organization.</summary>
    public Guid? ProjectId { get; set; }
    /// <summary>When it happened, stamped by the database clock, not by the app.</summary>
    public Instant At { get; set; }
    /// <summary>The user who acted; null when the system itself acted (for example the background worker).</summary>
    public Guid? ActorId { get; set; }
    public required string ActorName { get; set; }
    /// <summary>A short upper-case code for what happened, such as <c>REGISTER_ENTRY</c> or <c>DOWNLOAD</c>.</summary>
    public required string Action { get; set; }
    /// <summary>The kind of thing acted on, such as <c>Document</c> or <c>StoredFile</c>; null when there is none.</summary>
    public string? EntityType { get; set; }
    public Guid? EntityId { get; set; }
    /// <summary>A readable name for the thing, such as a document number, copied at the time so the trail reads well later.</summary>
    public string? EntityLabel { get; set; }
    /// <summary>Free text with more about what happened.</summary>
    public string? Detail { get; set; }
    /// <summary>
    /// The <see cref="Hash"/> of the tenant's previous event. This links each row to the one before it,
    /// forming a "hash chain".
    /// </summary>
    public required byte[] PreviousHash { get; set; }
    /// <summary>
    /// A SHA-256 fingerprint of this row's content plus <see cref="PreviousHash"/>. Changing any earlier row
    /// changes its hash and breaks every later link, which is how tampering is detected.
    /// </summary>
    public required byte[] Hash { get; set; }
}
