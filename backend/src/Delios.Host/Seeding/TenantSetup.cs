using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Seeding;

/// <summary>
/// Creating a tenant and its first administrator: the one act that happens
/// before anybody can sign in, so it is a command rather than an endpoint.
/// </summary>
public sealed class TenantSetup(
    DeliosDbContext db, TenantContext tenant, AuditLog audit, IPasswordHasher<User> hasher)
{
    public async Task<Tenant> CreateAsync(
        string slug, string name, string adminEmail, string adminName, string adminPassword,
        CancellationToken cancellationToken = default)
    {
        slug = slug.Trim().ToLowerInvariant();
        if (await db.Tenants.AnyAsync(t => t.Slug == slug, cancellationToken))
        {
            throw new InvalidOperationException($"A tenant called '{slug}' already exists.");
        }

        var organization = new Tenant { Slug = slug, Name = name };
        db.Tenants.Add(organization);
        await db.SaveChangesAsync(cancellationToken);

        tenant.Set(organization.Id);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var admin = NewUser(organization.Id, adminEmail, adminName, adminPassword, isAdmin: true);
        db.Users.Add(admin);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor.System, "TENANT_CREATED", "Tenant", organization.Id, slug,
            $"Tenant created with administrator {adminEmail}.", cancellationToken: cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return organization;
    }

    public User NewUser(Guid tenantId, string email, string name, string password, bool isAdmin = false, Guid? partyId = null)
    {
        var user = new User
        {
            TenantId = tenantId,
            Email = email.Trim(),
            NormalizedEmail = email.Trim().ToUpperInvariant(),
            Name = name,
            PasswordHash = "",
            IsAdmin = isAdmin,
            PartyId = partyId,
        };
        user.PasswordHash = hasher.HashPassword(user, password);
        return user;
    }
}
