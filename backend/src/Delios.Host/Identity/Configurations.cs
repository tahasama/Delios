using Delios.Host.Audit;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Delios.Host.Identity;

internal sealed class TenantConfiguration : IEntityTypeConfiguration<Tenant>
{
    public void Configure(EntityTypeBuilder<Tenant> b)
    {
        b.HasIndex(x => x.Slug).IsUnique();
        b.Property(x => x.Slug).HasMaxLength(64);
        b.Property(x => x.Name).HasMaxLength(200);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }
}

internal sealed class PartyConfiguration : IEntityTypeConfiguration<Party>
{
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

internal sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Party).WithMany().HasForeignKey(x => x.PartyId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.NormalizedEmail }).IsUnique();
        b.Property(x => x.Email).HasMaxLength(320);
        b.Property(x => x.NormalizedEmail).HasMaxLength(320);
        b.Property(x => x.Name).HasMaxLength(200);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }
}

internal sealed class ProjectConfiguration : IEntityTypeConfiguration<Project>
{
    public void Configure(EntityTypeBuilder<Project> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.Code }).IsUnique();
        b.Property(x => x.Code).HasMaxLength(32);
        b.Property(x => x.Name).HasMaxLength(200);
        b.Property(x => x.ContractRole).HasMaxLength(32);
        b.Property(x => x.Status).HasMaxLength(16);
        b.Property(x => x.TimeZone).HasMaxLength(64);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }
}

internal sealed class FunctionConfiguration : IEntityTypeConfiguration<Function>
{
    public void Configure(EntityTypeBuilder<Function> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.Code }).IsUnique();
        b.Property(x => x.Code).HasMaxLength(32);
        b.Property(x => x.Name).HasMaxLength(200);
        b.HasMany(x => x.Rules).WithOne().HasForeignKey(x => x.FunctionId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class PermissionRuleConfiguration : IEntityTypeConfiguration<PermissionRule>
{
    public void Configure(EntityTypeBuilder<PermissionRule> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.TenantId);
    }
}

internal sealed class MembershipConfiguration : IEntityTypeConfiguration<Membership>
{
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

internal sealed class SessionConfiguration : IEntityTypeConfiguration<Session>
{
    public void Configure(EntityTypeBuilder<Session> b)
    {
        b.HasIndex(x => x.TokenHash).IsUnique();
        b.HasIndex(x => x.UserId);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }
}

internal sealed class AuditEventConfiguration : IEntityTypeConfiguration<AuditEvent>
{
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
