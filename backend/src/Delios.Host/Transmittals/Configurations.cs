using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Reviews;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Delios.Host.Transmittals;

/// <summary>
/// Entity Framework Core (EF Core, the database mapping library) setup for the <c>issue_requests</c> table: foreign
/// keys, indexes, column lengths and the concurrency token.
/// </summary>
internal sealed class IssueRequestConfiguration : IEntityTypeConfiguration<IssueRequest>
{
    /// <summary>Called by EF Core when it builds the database model at startup and for migrations.</summary>
    public void Configure(EntityTypeBuilder<IssueRequest> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Document>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Revision>().WithMany().HasForeignKey(x => x.RevisionId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.RevisionId, x.Status });
        b.HasIndex(x => new { x.ProjectId, x.Status });
        b.Property(x => x.Reason).HasMaxLength(64);
        b.Property(x => x.Note).HasMaxLength(2000);
        b.Property(x => x.OffDistributionReason).HasMaxLength(2000);
        b.Property(x => x.RaisedByName).HasMaxLength(200);
        b.Property(x => x.Status).HasMaxLength(16);
        b.Property(x => x.ClosedByName).HasMaxLength(200);
        b.Property(x => x.RaisedAt).HasDefaultValueSql("now()");
        b.Property(x => x.Version).IsRowVersion();
    }
}

/// <summary>
/// EF Core setup for the <c>transmittals</c> table: foreign keys, a unique number per project, indexes and column
/// lengths.
/// </summary>
internal sealed class TransmittalConfiguration : IEntityTypeConfiguration<Transmittal>
{
    /// <summary>Called by EF Core when it builds the database model at startup and for migrations.</summary>
    public void Configure(EntityTypeBuilder<Transmittal> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Party>().WithMany().HasForeignKey(x => x.ToPartyId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<IssueRequest>().WithMany().HasForeignKey(x => x.IssueRequestId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ReviewStep>().WithMany().HasForeignKey(x => x.ReviewStepId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(x => x.Items).WithOne().HasForeignKey(x => x.TransmittalId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(x => x.Recipients).WithOne().HasForeignKey(x => x.TransmittalId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Number }).IsUnique();
        b.HasIndex(x => new { x.ProjectId, x.IssuedAt });
        b.HasIndex(x => x.IssueRequestId);
        b.HasIndex(x => x.ReviewStepId);
        b.HasOne<Packages.Package>().WithMany().HasForeignKey(x => x.PackageId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.PackageId);
        b.Property(x => x.Number).HasMaxLength(64);
        b.Property(x => x.Direction).HasMaxLength(16);
        b.Property(x => x.Reason).HasMaxLength(64);
        b.Property(x => x.Subject).HasMaxLength(400);
        b.Property(x => x.Message).HasMaxLength(4000);
        b.Property(x => x.ToName).HasMaxLength(200);
        b.Property(x => x.IssuedByName).HasMaxLength(200);
        b.Property(x => x.IssuedAt).HasDefaultValueSql("now()");
    }
}

/// <summary>
/// EF Core setup for the <c>transmittal_items</c> table (one row per revision sent on a transmittal).
/// </summary>
internal sealed class TransmittalItemConfiguration : IEntityTypeConfiguration<TransmittalItem>
{
    /// <summary>Called by EF Core when it builds the database model at startup and for migrations.</summary>
    public void Configure(EntityTypeBuilder<TransmittalItem> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Document>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Revision>().WithMany().HasForeignKey(x => x.RevisionId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.TransmittalId);
        b.HasIndex(x => x.RevisionId);
        b.HasIndex(x => x.DocumentId);
        b.Property(x => x.DocumentNumber).HasMaxLength(128);
        b.Property(x => x.Title).HasMaxLength(500);
        b.Property(x => x.RevisionValue).HasMaxLength(32);
        b.Property(x => x.StatusCode).HasMaxLength(64);
    }
}

/// <summary>
/// EF Core setup for the <c>transmittal_recipients</c> table. <c>AwaitsDispatch</c> is computed in code, so it is not
/// stored.
/// </summary>
internal sealed class TransmittalRecipientConfiguration : IEntityTypeConfiguration<TransmittalRecipient>
{
    /// <summary>Called by EF Core when it builds the database model at startup and for migrations.</summary>
    public void Configure(EntityTypeBuilder<TransmittalRecipient> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Party>().WithMany().HasForeignKey(x => x.PartyId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<StoredFile>().WithMany().HasForeignKey(x => x.ProofFileId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.TransmittalId);
        b.HasIndex(x => new { x.UserId, x.AcknowledgedAt });
        b.HasIndex(x => new { x.PartyId, x.DispatchedAt });
        b.Property(x => x.Name).HasMaxLength(200);
        b.Property(x => x.Organization).HasMaxLength(200);
        b.Property(x => x.DispatchChannel).HasMaxLength(64);
        b.Property(x => x.DispatchRef).HasMaxLength(200);
        b.Property(x => x.DispatchedByName).HasMaxLength(200);
        b.Ignore(x => x.AwaitsDispatch);
    }
}
