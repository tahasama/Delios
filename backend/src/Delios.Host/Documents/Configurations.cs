using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Delios.Host.Documents;

/// <summary>Tells Entity Framework Core (EF Core, the library that maps C# classes to database tables) how to store <see cref="ValueEntry"/>: one code per set per tenant, and column lengths.</summary>
internal sealed class ValueEntryConfiguration : IEntityTypeConfiguration<ValueEntry>
{
    /// <summary>
    /// Sets up the table: foreign keys, indexes, column lengths and defaults. Called by EF Core when it builds
    /// the model, through <c>ApplyConfigurationsFromAssembly</c> in <c>DeliosDbContext</c>.
    /// </summary>
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

/// <summary>Tells EF Core how to store <see cref="NumberingScheme"/>: unique name per tenant, fields kept as JSON in the row.</summary>
internal sealed class NumberingSchemeConfiguration : IEntityTypeConfiguration<NumberingScheme>
{
    /// <summary>
    /// Sets up the table: foreign keys, indexes, column lengths and defaults. Called by EF Core when it builds
    /// the model, through <c>ApplyConfigurationsFromAssembly</c> in <c>DeliosDbContext</c>.
    /// </summary>
    public void Configure(EntityTypeBuilder<NumberingScheme> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.Name }).IsUnique();
        b.Property(x => x.Name).HasMaxLength(100);
        b.Property(x => x.Delimiter).HasMaxLength(4);
        b.OwnsMany(x => x.Fields, f => f.ToJson());
    }
}

/// <summary>Tells EF Core how to store <see cref="SchemeRouting"/>: at most one numbering scheme per deliverable type per tenant.</summary>
internal sealed class SchemeRoutingConfiguration : IEntityTypeConfiguration<SchemeRouting>
{
    /// <summary>
    /// Sets up the table: foreign keys, indexes, column lengths and defaults. Called by EF Core when it builds
    /// the model, through <c>ApplyConfigurationsFromAssembly</c> in <c>DeliosDbContext</c>.
    /// </summary>
    public void Configure(EntityTypeBuilder<SchemeRouting> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Scheme).WithMany().HasForeignKey(x => x.SchemeId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.DeliverableType }).IsUnique();
        b.Property(x => x.DeliverableType).HasMaxLength(64);
    }
}

/// <summary>Tells EF Core how to store <see cref="RevisionScheme"/>: unique name, one default per tenant, series kept as JSON.</summary>
internal sealed class RevisionSchemeConfiguration : IEntityTypeConfiguration<RevisionScheme>
{
    /// <summary>
    /// Sets up the table: foreign keys, indexes, column lengths and defaults. Called by EF Core when it builds
    /// the model, through <c>ApplyConfigurationsFromAssembly</c> in <c>DeliosDbContext</c>.
    /// </summary>
    public void Configure(EntityTypeBuilder<RevisionScheme> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.Name }).IsUnique();
        // At most one default per organization.
        b.HasIndex(x => x.TenantId).IsUnique().HasFilter("is_default").HasDatabaseName("ix_revision_schemes_one_default");
        b.Property(x => x.Name).HasMaxLength(100);
        b.OwnsMany(x => x.Series, s => s.ToJson());
    }
}

/// <summary>Tells EF Core how to store <see cref="RevisionSchemeRouting"/>: at most one revision scheme per deliverable type per tenant.</summary>
internal sealed class RevisionSchemeRoutingConfiguration : IEntityTypeConfiguration<RevisionSchemeRouting>
{
    /// <summary>
    /// Sets up the table: foreign keys, indexes, column lengths and defaults. Called by EF Core when it builds
    /// the model, through <c>ApplyConfigurationsFromAssembly</c> in <c>DeliosDbContext</c>.
    /// </summary>
    public void Configure(EntityTypeBuilder<RevisionSchemeRouting> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Scheme).WithMany().HasForeignKey(x => x.SchemeId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.DeliverableType }).IsUnique();
        b.Property(x => x.DeliverableType).HasMaxLength(64);
    }
}

/// <summary>Tells EF Core how to store <see cref="NumberCounter"/>: one counter row per project and number prefix.</summary>
internal sealed class NumberCounterConfiguration : IEntityTypeConfiguration<NumberCounter>
{
    /// <summary>
    /// Sets up the table: foreign keys, indexes, column lengths and defaults. Called by EF Core when it builds
    /// the model, through <c>ApplyConfigurationsFromAssembly</c> in <c>DeliosDbContext</c>.
    /// </summary>
    public void Configure(EntityTypeBuilder<NumberCounter> b)
    {
        b.HasKey(x => new { x.ProjectId, x.Prefix });
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.Property(x => x.Prefix).HasMaxLength(200);
    }
}

/// <summary>Tells EF Core how to store <see cref="Document"/>: unique number per project, indexes for the register filters, column lengths and the row version.</summary>
internal sealed class DocumentConfiguration : IEntityTypeConfiguration<Document>
{
    /// <summary>
    /// Sets up the table: foreign keys, indexes, column lengths and defaults. Called by EF Core when it builds
    /// the model, through <c>ApplyConfigurationsFromAssembly</c> in <c>DeliosDbContext</c>.
    /// </summary>
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
        b.Property(x => x.PreviousNumber).HasMaxLength(200);
        b.Property(x => x.LegacyScheme).HasMaxLength(100);
        b.Property(x => x.AppVersion).HasMaxLength(100);
        b.Property(x => x.Extras).HasColumnType("jsonb");
        b.Property(x => x.LegalHoldReason).HasMaxLength(1000);
        b.Property(x => x.LegalHoldByName).HasMaxLength(200);
        b.Property(x => x.ConfirmedByName).HasMaxLength(200);
        b.HasIndex(x => x.CorrectsId);
        b.Property(x => x.LatestRevisionValue).HasMaxLength(16);
        b.Property(x => x.LatestRevisionState).HasMaxLength(16);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
        b.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");
        b.Property(x => x.Version).IsRowVersion();
        b.Ignore(x => x.Facts);
    }
}

/// <summary>Tells EF Core how to store <see cref="Revision"/>: unique value per document, files linked by revision, submissions kept as JSON.</summary>
internal sealed class RevisionConfiguration : IEntityTypeConfiguration<Revision>
{
    /// <summary>
    /// Sets up the table: foreign keys, indexes, column lengths and defaults. Called by EF Core when it builds
    /// the model, through <c>ApplyConfigurationsFromAssembly</c> in <c>DeliosDbContext</c>.
    /// </summary>
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
        b.Property(x => x.StatusCode).HasMaxLength(64);
        b.Property(x => x.ReleasedByName).HasMaxLength(200);
        b.Property(x => x.ReturnedReason).HasMaxLength(2000);
        b.Property(x => x.HeldReason).HasMaxLength(2000);
        b.Property(x => x.HeldByName).HasMaxLength(200);
        b.Property(x => x.VoidReason).HasMaxLength(2000);
        b.Property(x => x.VoidAuthority).HasMaxLength(200);
        b.Property(x => x.VoidReassessment).HasMaxLength(4000);
        b.Property(x => x.ControlOutcome).HasMaxLength(64);
        b.OwnsMany(x => x.Submissions, s => s.ToJson());
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
        b.Property(x => x.Version).IsRowVersion();
    }
}

/// <summary>Tells EF Core how to store <see cref="StoredFile"/>: a unique object key, look-up indexes and column lengths.</summary>
internal sealed class StoredFileConfiguration : IEntityTypeConfiguration<StoredFile>
{
    /// <summary>
    /// Sets up the table: foreign keys, indexes, column lengths and defaults. Called by EF Core when it builds
    /// the model, through <c>ApplyConfigurationsFromAssembly</c> in <c>DeliosDbContext</c>.
    /// </summary>
    public void Configure(EntityTypeBuilder<StoredFile> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Document>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.ObjectKey).IsUnique();
        b.HasIndex(x => x.DocumentId);
        b.HasIndex(x => x.RevisionId);
        b.HasIndex(x => x.DerivedFromId);
        b.HasOne<Transmittals.TransmittalItem>().WithMany().HasForeignKey(x => x.TransmittalItemId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.TransmittalItemId);
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

/// <summary>Tells EF Core how to store <see cref="DocumentAccess"/>: each person named once per document.</summary>
internal sealed class DocumentAccessConfiguration : IEntityTypeConfiguration<DocumentAccess>
{
    /// <summary>
    /// Sets up the table: foreign keys, indexes, column lengths and defaults. Called by EF Core when it builds
    /// the model, through <c>ApplyConfigurationsFromAssembly</c> in <c>DeliosDbContext</c>.
    /// </summary>
    public void Configure(EntityTypeBuilder<DocumentAccess> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Document>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.DocumentId, x.UserId }).IsUnique();
        b.HasIndex(x => x.UserId);
        b.Property(x => x.AddedByName).HasMaxLength(200);
        b.Property(x => x.Reason).HasMaxLength(1000);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }
}

/// <summary>Tells EF Core how to store <c>OutboxMessage</c>, the outbox table: messages saved with a change and sent to RabbitMQ afterwards by the outbox relay.</summary>
internal sealed class OutboxMessageConfiguration : IEntityTypeConfiguration<OutboxMessage>
{
    /// <summary>
    /// Sets up the table: foreign keys, indexes, column lengths and defaults. Called by EF Core when it builds
    /// the model, through <c>ApplyConfigurationsFromAssembly</c> in <c>DeliosDbContext</c>.
    /// </summary>
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

/// <summary>Tells EF Core how to store <c>IdempotencyRecord</c>: the saved first answer to a request, so a retry with the same <c>Idempotency-Key</c> is not done twice.</summary>
internal sealed class IdempotencyRecordConfiguration : IEntityTypeConfiguration<IdempotencyRecord>
{
    /// <summary>
    /// Sets up the table: foreign keys, indexes, column lengths and defaults. Called by EF Core when it builds
    /// the model, through <c>ApplyConfigurationsFromAssembly</c> in <c>DeliosDbContext</c>.
    /// </summary>
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
