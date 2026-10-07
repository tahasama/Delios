using Delios.Host.Documents;
using Delios.Host.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Delios.Host.Packages;

/// <summary>
/// Entity Framework Core (EF Core, the database mapping library) setup for the <c>packages</c> table. The rule and the
/// shortfall are stored as JSON columns inside the package row.
/// </summary>
internal sealed class PackageConfiguration : IEntityTypeConfiguration<Package>
{
    /// <summary>Called by EF Core when it builds the database model at startup and for migrations.</summary>
    public void Configure(EntityTypeBuilder<Package> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(x => x.Members).WithOne().HasForeignKey(x => x.PackageId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Number }).IsUnique();
        b.HasIndex(x => new { x.ProjectId, x.State });
        b.Property(x => x.Number).HasMaxLength(64);
        b.Property(x => x.Title).HasMaxLength(300);
        b.Property(x => x.Description).HasMaxLength(4000);
        b.Property(x => x.Reason).HasMaxLength(64);
        b.Property(x => x.State).HasMaxLength(16);
        b.Property(x => x.ShortfallAcceptedByName).HasMaxLength(200);
        b.Property(x => x.ClosedByName).HasMaxLength(200);
        b.Property(x => x.ClosureNote).HasMaxLength(2000);
        b.Property(x => x.AcceptedByName).HasMaxLength(200);
        b.Property(x => x.CreatedByName).HasMaxLength(200);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
        b.Property(x => x.Version).IsRowVersion();
        b.OwnsOne(x => x.Rule, r =>
        {
            r.ToJson();
            r.Ignore(x => x.IsEmpty);
        });
        b.OwnsMany(x => x.Shortfall, s => s.ToJson());
    }
}

/// <summary>EF Core setup for the <c>package_members</c> table: a document appears at most once per package.</summary>
internal sealed class PackageMemberConfiguration : IEntityTypeConfiguration<PackageMember>
{
    /// <summary>Called by EF Core when it builds the database model at startup and for migrations.</summary>
    public void Configure(EntityTypeBuilder<PackageMember> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Document>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.PackageId, x.DocumentId }).IsUnique();
        b.HasIndex(x => x.DocumentId);
        b.Property(x => x.AddedAt).HasDefaultValueSql("now()");
    }
}
