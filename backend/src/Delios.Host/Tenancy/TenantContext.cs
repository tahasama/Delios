namespace Delios.Host.Tenancy;

/// <summary>
/// The tenant the current request or job works for. Set once, from the session
/// or from the message, before any transaction starts.
/// </summary>
public sealed class TenantContext
{
    /// <summary>The tenant id, or null until <see cref="Set"/> has been called.</summary>
    public Guid? TenantId { get; private set; }

    /// <summary>
    /// Records the tenant for this request or job. Called by session sign-in/authentication and by worker handlers with the message's tenant.
    /// Setting the same tenant again is allowed; setting a different one throws, so a request can never switch tenants halfway.
    /// </summary>
    public void Set(Guid tenantId)
    {
        if (TenantId is { } current && current != tenantId)
        {
            throw new InvalidOperationException("The tenant of a request cannot change once set.");
        }
        TenantId = tenantId;
    }

    /// <summary>The tenant id, throwing if none has been set. Use where work without a tenant would be a bug.</summary>
    public Guid Required => TenantId ?? throw new InvalidOperationException("No tenant is set for this work.");
}
