namespace Delios.Host.Tenancy;

/// <summary>
/// The tenant the current request or job works for. Set once, from the session
/// or from the message, before any transaction starts.
/// </summary>
public sealed class TenantContext
{
    public Guid? TenantId { get; private set; }

    public void Set(Guid tenantId)
    {
        if (TenantId is { } current && current != tenantId)
        {
            throw new InvalidOperationException("The tenant of a request cannot change once set.");
        }
        TenantId = tenantId;
    }

    public Guid Required => TenantId ?? throw new InvalidOperationException("No tenant is set for this work.");
}
