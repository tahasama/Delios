using Delios.Host.Audit;
using Delios.Host.Identity;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Platform;

public sealed class DeliosDbContext(DbContextOptions<DeliosDbContext> options)
    : DbContext(options), IDataProtectionKeyContext
{
    /// <summary>
    /// The keys that protect cookies and anti-forgery tokens. Shared through the
    /// database so that every node accepts what any other node issued.
    /// </summary>
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<Party> Parties => Set<Party>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<Function> Functions => Set<Function>();
    public DbSet<PermissionRule> PermissionRules => Set<PermissionRule>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(DeliosDbContext).Assembly);
}
