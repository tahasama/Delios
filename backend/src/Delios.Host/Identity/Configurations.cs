using Delios.Host.Audit;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Delios.Host.Identity;

/// <summary>
/// Database mapping for organizations: the slug (short name used at sign-in) is unique.
/// An <c>IEntityTypeConfiguration</c> tells Entity Framework Core (the library that maps C# classes to database tables) about
/// column lengths, indexes, keys and defaults. These are picked up by <c>DeliosDbContext</c> and turned into migrations.
/// </summary>
internal sealed class TenantConfiguration : IEntityTypeConfiguration<Tenant>
{
    /// <summary>Called by Entity Framework Core when it builds the model, to set up the <c>Tenant</c> table.</summary>
    public void Configure(EntityTypeBuilder<Tenant> b)
    {
        b.HasIndex(x => x.Slug).IsUnique();
        b.Property(x => x.Slug).HasMaxLength(64);
        b.Property(x => x.Name).HasMaxLength(200);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }
}

/// <summary>
/// Database mapping for single sign-on providers: at most one per tenant. Picked up by <c>DeliosDbContext</c>.
/// </summary>
internal sealed class IdentityProviderConfiguration : IEntityTypeConfiguration<IdentityProvider>
{
    /// <summary>
    /// Called by Entity Framework Core when it builds the model, to set up the <c>IdentityProvider</c> table.
    /// </summary>
    public void Configure(EntityTypeBuilder<IdentityProvider> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.TenantId).IsUnique();
        b.Property(x => x.Name).HasMaxLength(100);
        b.Property(x => x.Authority).HasMaxLength(500);
        b.Property(x => x.ClientId).HasMaxLength(200);
        b.Property(x => x.ClientSecretProtected).HasMaxLength(2000);
        b.Property(x => x.Scopes).HasMaxLength(500);
    }
}

/// <summary>
/// Database mapping for parties (companies taking part in projects): the code is unique within a tenant. Picked up by <c>DeliosDbContext</c>.
/// </summary>
internal sealed class PartyConfiguration : IEntityTypeConfiguration<Party>
{
    /// <summary>Called by Entity Framework Core when it builds the model, to set up the <c>Party</c> table.</summary>
    public void Configure(EntityTypeBuilder<Party> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.Code }).IsUnique();
        b.Property(x => x.Code).HasMaxLength(32);
        b.Property(x => x.Name).HasMaxLength(200);
        b.Property(x => x.Participation).HasMaxLength(16);
        b.Property(x => x.CustodianFunction).HasMaxLength(32);
        b.Property(x => x.ExternalSystem).HasMaxLength(200);
    }
}

/// <summary>
/// Database mapping for users: the normalized email is unique within a tenant. Picked up by <c>DeliosDbContext</c>.
/// </summary>
internal sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    /// <summary>Called by Entity Framework Core when it builds the model, to set up the <c>User</c> table.</summary>
    public void Configure(EntityTypeBuilder<User> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Party).WithMany().HasForeignKey(x => x.PartyId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.NormalizedEmail }).IsUnique();
        b.Property(x => x.Email).HasMaxLength(320);
        b.Property(x => x.NormalizedEmail).HasMaxLength(320);
        b.Property(x => x.Name).HasMaxLength(200);
        b.Property(x => x.MfaSecretProtected).HasMaxLength(1000);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }
}

/// <summary>Database mapping for projects: the code is unique within a tenant. Picked up by <c>DeliosDbContext</c>.</summary>
internal sealed class ProjectConfiguration : IEntityTypeConfiguration<Project>
{
    /// <summary>Called by Entity Framework Core when it builds the model, to set up the <c>Project</c> table.</summary>
    public void Configure(EntityTypeBuilder<Project> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.Code }).IsUnique();
        b.Property(x => x.Code).HasMaxLength(32);
        b.Property(x => x.Name).HasMaxLength(200);
        b.Property(x => x.ContractRole).HasMaxLength(32);
        b.Property(x => x.Status).HasMaxLength(16);
        b.Property(x => x.TimeZone).HasMaxLength(64);
        b.Property(x => x.ContentExtraction).HasMaxLength(16);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }
}

/// <summary>
/// Database mapping for functions (job roles that carry permission rules): deleting a function deletes its rules. Picked up by <c>DeliosDbContext</c>.
/// </summary>
internal sealed class FunctionConfiguration : IEntityTypeConfiguration<Function>
{
    /// <summary>Called by Entity Framework Core when it builds the model, to set up the <c>Function</c> table.</summary>
    public void Configure(EntityTypeBuilder<Function> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.Code }).IsUnique();
        b.Property(x => x.Code).HasMaxLength(32);
        b.Property(x => x.Name).HasMaxLength(200);
        b.HasMany(x => x.Rules).WithOne().HasForeignKey(x => x.FunctionId).OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>Database mapping for permission rules. Picked up by <c>DeliosDbContext</c>.</summary>
internal sealed class PermissionRuleConfiguration : IEntityTypeConfiguration<PermissionRule>
{
    /// <summary>Called by Entity Framework Core when it builds the model, to set up the <c>PermissionRule</c> table.</summary>
    public void Configure(EntityTypeBuilder<PermissionRule> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.TenantId);
    }
}

/// <summary>
/// Database mapping for project memberships: a user is on a project at most once. Picked up by <c>DeliosDbContext</c>.
/// </summary>
internal sealed class MembershipConfiguration : IEntityTypeConfiguration<Membership>
{
    /// <summary>Called by Entity Framework Core when it builds the model, to set up the <c>Membership</c> table.</summary>
    public void Configure(EntityTypeBuilder<Membership> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Project).WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Function).WithMany().HasForeignKey(x => x.FunctionId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.UserId }).IsUnique();
        b.HasIndex(x => x.UserId);
        b.Property(x => x.Department).HasMaxLength(32);
    }
}

/// <summary>
/// Database mapping for sign-in sessions: the token hash is unique so a session can be found by it. Picked up by <c>DeliosDbContext</c>.
/// </summary>
internal sealed class SessionConfiguration : IEntityTypeConfiguration<Session>
{
    /// <summary>Called by Entity Framework Core when it builds the model, to set up the <c>Session</c> table.</summary>
    public void Configure(EntityTypeBuilder<Session> b)
    {
        b.HasIndex(x => x.TokenHash).IsUnique();
        b.HasIndex(x => x.UserId);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }
}

/// <summary>
/// Database mapping for audit log entries: the id is a database-generated increasing number. Picked up by <c>DeliosDbContext</c>.
/// </summary>
internal sealed class AuditEventConfiguration : IEntityTypeConfiguration<AuditEvent>
{
    /// <summary>Called by Entity Framework Core when it builds the model, to set up the <c>AuditEvent</c> table.</summary>
    public void Configure(EntityTypeBuilder<AuditEvent> b)
    {
        b.Property(x => x.Id).UseIdentityAlwaysColumn();
        b.HasIndex(x => new { x.TenantId, x.Id });
        b.HasIndex(x => new { x.EntityType, x.EntityId });
        b.HasIndex(x => x.ProjectId);
        b.Property(x => x.Action).HasMaxLength(64);
        b.Property(x => x.EntityType).HasMaxLength(64);
    }
}
