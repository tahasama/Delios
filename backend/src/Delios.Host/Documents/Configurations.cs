using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Delios.Host.Documents;

internal sealed class ValueEntryConfiguration : IEntityTypeConfiguration<ValueEntry>
{
    public void Configure(EntityTypeBuilder<ValueEntry> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.SetKey, x.Code }).IsUnique();
        b.Property(x => x.SetKey).HasMaxLength(64);
        b.Property(x => x.Code).HasMaxLength(64);
        b.Property(x => x.Label).HasMaxLength(200);
        b.Property(x => x.Status).HasMaxLength(16);
    }
}

internal sealed class NumberingSchemeConfiguration : IEntityTypeConfiguration<NumberingScheme>
{
    public void Configure(EntityTypeBuilder<NumberingScheme> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.Name }).IsUnique();
        b.Property(x => x.Name).HasMaxLength(100);
        b.Property(x => x.Delimiter).HasMaxLength(4);
        b.OwnsMany(x => x.Fields, f => f.ToJson());
    }
}

internal sealed class SchemeRoutingConfiguration : IEntityTypeConfiguration<SchemeRouting>
{
    public void Configure(EntityTypeBuilder<SchemeRouting> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Scheme).WithMany().HasForeignKey(x => x.SchemeId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.DeliverableType }).IsUnique();
        b.Property(x => x.DeliverableType).HasMaxLength(64);
    }
}

internal sealed class NumberCounterConfiguration : IEntityTypeConfiguration<NumberCounter>
{
    public void Configure(EntityTypeBuilder<NumberCounter> b)
    {
        b.HasKey(x => new { x.ProjectId, x.Prefix });
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.Property(x => x.Prefix).HasMaxLength(200);
    }
}

internal sealed class DocumentConfiguration : IEntityTypeConfiguration<Document>
{
    public void Configure(EntityTypeBuilder<Document> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(x => x.Revisions).WithOne().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Number }).IsUnique();
        b.HasIndex(x => new { x.ProjectId, x.Discipline });
        b.HasIndex(x => new { x.ProjectId, x.DocType });
        b.HasIndex(x => new { x.ProjectId, x.State });
        b.HasIndex(x => new { x.ProjectId, x.Originator });
        b.Property(x => x.Number).HasMaxLength(200);
        b.Property(x => x.Title).HasMaxLength(500);
        b.Property(x => x.DeliverableType).HasMaxLength(64);
        b.Property(x => x.DocType).HasMaxLength(64);
        b.Property(x => x.Discipline).HasMaxLength(64);
        b.Property(x => x.Originator).HasMaxLength(32);
        b.Property(x => x.Subproject).HasMaxLength(64);
        b.Property(x => x.ContractRef).HasMaxLength(64);
        b.Property(x => x.Criticality).HasMaxLength(64);
        b.Property(x => x.Confidentiality).HasMaxLength(64);
        b.Property(x => x.RetentionClass).HasMaxLength(64);
        b.Property(x => x.State).HasMaxLength(16);
        b.Property(x => x.Kind).HasMaxLength(16);
        b.Property(x => x.CreatedByName).HasMaxLength(200);
        b.Property(x => x.LatestRevisionValue).HasMaxLength(16);
        b.Property(x => x.LatestRevisionState).HasMaxLength(16);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
        b.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");
        b.Property(x => x.Version).IsRowVersion();
        b.Ignore(x => x.Facts);
    }
}

internal sealed class RevisionConfiguration : IEntityTypeConfiguration<Revision>
{
    public void Configure(EntityTypeBuilder<Revision> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(x => x.Files).WithOne().HasForeignKey(x => x.RevisionId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.DocumentId, x.Value }).IsUnique();
        b.Property(x => x.Value).HasMaxLength(16);
        b.Property(x => x.Series).HasMaxLength(16);
        b.Property(x => x.State).HasMaxLength(16);
        b.Property(x => x.FilesState).HasMaxLength(16);
        b.Property(x => x.AuthoredByName).HasMaxLength(200);
        b.Property(x => x.AuthoredByParty).HasMaxLength(32);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
        b.Property(x => x.Version).IsRowVersion();
    }
}

internal sealed class StoredFileConfiguration : IEntityTypeConfiguration<StoredFile>
{
    public void Configure(EntityTypeBuilder<StoredFile> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Document>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.ObjectKey).IsUnique();
        b.HasIndex(x => x.DocumentId);
        b.HasIndex(x => x.RevisionId);
        b.Property(x => x.ObjectKey).HasMaxLength(300);
        b.Property(x => x.Name).HasMaxLength(255);
        b.Property(x => x.ContentType).HasMaxLength(200);
        b.Property(x => x.Sha256).HasMaxLength(64).IsFixedLength();
        b.Property(x => x.Kind).HasMaxLength(16);
        b.Property(x => x.Status).HasMaxLength(16);
        b.Property(x => x.DetectedType).HasMaxLength(100);
        b.Property(x => x.UploadedByName).HasMaxLength(200);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }
}

internal sealed class DocumentAccessConfiguration : IEntityTypeConfiguration<DocumentAccess>
{
    public void Configure(EntityTypeBuilder<DocumentAccess> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Document>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.DocumentId, x.UserId }).IsUnique();
        b.HasIndex(x => x.UserId);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }
}

internal sealed class OutboxMessageConfiguration : IEntityTypeConfiguration<OutboxMessage>
{
    public void Configure(EntityTypeBuilder<OutboxMessage> b)
    {
        b.Property(x => x.Id).UseIdentityAlwaysColumn();
        b.Property(x => x.RoutingKey).HasMaxLength(100);
        b.Property(x => x.Payload).HasColumnType("jsonb");
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
        // Only unsent messages are ever looked for.
        b.HasIndex(x => x.Id).HasFilter("sent_at IS NULL").HasDatabaseName("ix_outbox_messages_unsent");
    }
}

internal sealed class IdempotencyRecordConfiguration : IEntityTypeConfiguration<IdempotencyRecord>
{
    public void Configure(EntityTypeBuilder<IdempotencyRecord> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.UserId, x.Key }).IsUnique();
        b.Property(x => x.Key).HasMaxLength(100);
        b.Property(x => x.Endpoint).HasMaxLength(200);
        b.Property(x => x.RequestHash).HasMaxLength(64);
        b.Property(x => x.Body).HasColumnType("jsonb");
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }
}
