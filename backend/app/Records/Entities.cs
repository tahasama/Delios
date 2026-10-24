using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Actions;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Records;

// ── Entities ──────────────────────────────────────────────────────────────────

/// <summary>A tag of the project's asset breakdown: equipment, a system, an area. Documents are linked to the tags they describe.</summary>
public sealed class Asset
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    /// <summary>The tag, as drawings cite it. Never changes once given.</summary>
    public required string Code { get; set; }
    public required string Name { get; set; }
    public string? Area { get; set; }
    public string? System { get; set; }
    public string? Unit { get; set; }
    public string? Description { get; set; }
    /// <summary>The organization's own fields, as JSON.</summary>
    public string? Extras { get; set; }
    /// <summary>Retired tags stay on record and are offered no more.</summary>
    public bool Active { get; set; } = true;
    public Instant CreatedAt { get; set; }
}

/// <summary>A document describes an asset.</summary>
public sealed class DocumentAsset
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid DocumentId { get; set; }
    public Guid AssetId { get; set; }
    public required string CreatedByName { get; set; }
    public Instant CreatedAt { get; set; }
}

/// <summary>A published exception to the standard: what, which clauses, why, on whose authority, from when, reviewed when.</summary>
public sealed class ExceptionEntry
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public required string Item { get; set; }
    public required string Clauses { get; set; }
    public required string Reason { get; set; }
    public required string Authority { get; set; }
    public LocalDate StartDate { get; set; }
    public LocalDate? ReviewPoint { get; set; }
    public required string RecordedByName { get; set; }
    public Instant CreatedAt { get; set; }
}

/// <summary>A block of numbers given to a named party to number its own documents with.</summary>
public sealed class NumberRange
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    /// <summary>The fields the range covers, as they lead the number (P1001-ACME-ME-DWG).</summary>
    public required string Prefix { get; set; }
    public int From { get; set; }
    public int To { get; set; }
    /// <summary>The last number the party said it used; From - 1 before the first.</summary>
    public int LastIssued { get; set; }
    public required string IssuedTo { get; set; }
    /// <summary>OPEN, EXHAUSTED or CLOSED.</summary>
    public string Status { get; set; } = "OPEN";
    public required string IssuedByName { get; set; }
    public Instant CreatedAt { get; set; }
}

/// <summary>The control function asks a department what documents the activities it is tagged on need, by a date.</summary>
public sealed class RequirementCall
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public required string Department { get; set; }
    /// <summary>The activities the call covers, as issued.</summary>
    public string[] ActivityCodes { get; set; } = [];
    public LocalDate DueOn { get; set; }
    public Instant IssuedAt { get; set; }
    public required string IssuedByName { get; set; }
    public int Reminders { get; set; }
    public Instant? LastRemindedAt { get; set; }
    public Instant? AnsweredAt { get; set; }
    public string? AnswerNote { get; set; }
}

/// <summary>A department says, before an activity, whether its documents are there.</summary>
public sealed class ReadinessConfirmation
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid ActivityId { get; set; }
    public required string Department { get; set; }
    public bool Available { get; set; }
    public string? Note { get; set; }
    public required string ConfirmedByName { get; set; }
    public Instant ConfirmedAt { get; set; }
    /// <summary>
    /// Written by the system, not a person: every document of the department was released at its status when the
    /// activity's day passed. Kept as it was then, whatever happens to the documents afterwards.
    /// </summary>
    public bool Automatic { get; set; }
    /// <summary>The control function took a person's confirmation back (an honest mistake): when, who and why. It then counts as not confirmed.</summary>
    public Instant? RevokedAt { get; set; }
    public string? RevokedByName { get; set; }
    public string? RevokedReason { get; set; }
}

/// <summary>The requirements list as it was issued to one sender (a supplier's code, or DEPT:{discipline}).</summary>
public sealed class SenderIssue
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public required string Sender { get; set; }
    public int EntryCount { get; set; }
    /// <summary>The needs it listed, so what changed since is known.</summary>
    public Guid[] NeedIds { get; set; } = [];
    public required string IssuedByName { get; set; }
    public Instant IssuedAt { get; set; }
}

/// <summary>
/// An uploaded list waiting for a decision before it applies: a draft, submitted,
/// then approved (and applied) or rejected. The version in force is the last approved.
/// </summary>
public sealed class ControlledVersion
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    /// <summary>Empty for the organization's own lists.</summary>
    public Guid? ProjectId { get; set; }
    public required string Kind { get; set; }
    public required string Key { get; set; }
    public required string Title { get; set; }
    /// <summary>Given once, never reused: v1, v2…</summary>
    public required string VersionLabel { get; set; }
    /// <summary>DRAFT, SUBMITTED, APPROVED, REJECTED or SUPERSEDED.</summary>
    public string State { get; set; } = "DRAFT";
    public required string Payload { get; set; }
    public string? Diff { get; set; }
    public int RowCount { get; set; }
    public string? SourceName { get; set; }
    public long? SourceSize { get; set; }
    public string? SourceHash { get; set; }
    /// <summary>An uploaded list's file, kept exactly as it came, to be downloaded as it is; its name ends the key.</summary>
    public string? ObjectKey { get; set; }
    /// <summary>A released revision's file the list was read from.</summary>
    public Guid? FileId { get; set; }
    public string? Notes { get; set; }
    public Guid CreatedById { get; set; }
    public required string CreatedByName { get; set; }
    public Instant CreatedAt { get; set; }
    public Guid? SubmittedById { get; set; }
    public string? SubmittedByName { get; set; }
    public Instant? SubmittedAt { get; set; }
    public string? DecidedByName { get; set; }
    public Instant? DecidedAt { get; set; }
    public string? DecisionReason { get; set; }
    public Instant? AppliedAt { get; set; }
    public string? AppliedSummary { get; set; }
    public Instant? SupersededAt { get; set; }
}

internal sealed class RecordsConfiguration :
    IEntityTypeConfiguration<Asset>, IEntityTypeConfiguration<DocumentAsset>, IEntityTypeConfiguration<ExceptionEntry>,
    IEntityTypeConfiguration<NumberRange>, IEntityTypeConfiguration<RequirementCall>, IEntityTypeConfiguration<ReadinessConfirmation>,
    IEntityTypeConfiguration<SenderIssue>, IEntityTypeConfiguration<ControlledVersion>
{
    public void Configure(EntityTypeBuilder<Asset> b)
    {
        b.ToTable("assets");
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Code }).IsUnique();
        b.Property(x => x.Code).HasMaxLength(64);
        b.Property(x => x.Name).HasMaxLength(300);
        b.Property(x => x.Area).HasMaxLength(100);
        b.Property(x => x.System).HasMaxLength(100);
        b.Property(x => x.Unit).HasMaxLength(100);
        b.Property(x => x.Description).HasMaxLength(2000);
        b.Property(x => x.Extras).HasColumnType("jsonb");
    }

    public void Configure(EntityTypeBuilder<DocumentAsset> b)
    {
        b.ToTable("document_assets");
        b.HasOne<Document>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Asset>().WithMany().HasForeignKey(x => x.AssetId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.DocumentId, x.AssetId }).IsUnique();
        b.HasIndex(x => x.AssetId);
        b.Property(x => x.CreatedByName).HasMaxLength(200);
    }

    public void Configure(EntityTypeBuilder<ExceptionEntry> b)
    {
        b.ToTable("exception_entries");
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.ProjectId);
        b.Property(x => x.Item).HasMaxLength(500);
        b.Property(x => x.Clauses).HasMaxLength(200);
        b.Property(x => x.Reason).HasMaxLength(2000);
        b.Property(x => x.Authority).HasMaxLength(200);
        b.Property(x => x.RecordedByName).HasMaxLength(200);
    }

    public void Configure(EntityTypeBuilder<NumberRange> b)
    {
        b.ToTable("number_ranges");
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Prefix });
        b.Property(x => x.Prefix).HasMaxLength(200);
        b.Property(x => x.IssuedTo).HasMaxLength(200);
        b.Property(x => x.Status).HasMaxLength(16);
        b.Property(x => x.IssuedByName).HasMaxLength(200);
    }

    public void Configure(EntityTypeBuilder<RequirementCall> b)
    {
        b.ToTable("requirement_calls");
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Department });
        b.Property(x => x.Department).HasMaxLength(64);
        b.Property(x => x.IssuedByName).HasMaxLength(200);
        b.Property(x => x.AnswerNote).HasMaxLength(2000);
    }

    public void Configure(EntityTypeBuilder<ReadinessConfirmation> b)
    {
        b.ToTable("readiness_confirmations");
        b.HasOne<Activity>().WithMany().HasForeignKey(x => x.ActivityId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ActivityId, x.Department }).IsUnique();
        b.HasIndex(x => x.ProjectId);
        b.Property(x => x.Department).HasMaxLength(64);
        b.Property(x => x.Note).HasMaxLength(2000);
        b.Property(x => x.ConfirmedByName).HasMaxLength(200);
        b.Property(x => x.RevokedByName).HasMaxLength(200);
        b.Property(x => x.RevokedReason).HasMaxLength(2000);
    }

    public void Configure(EntityTypeBuilder<SenderIssue> b)
    {
        b.ToTable("sender_issues");
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Sender, x.IssuedAt });
        b.Property(x => x.Sender).HasMaxLength(100);
        b.Property(x => x.IssuedByName).HasMaxLength(200);
    }

    public void Configure(EntityTypeBuilder<ControlledVersion> b)
    {
        b.ToTable("controlled_versions");
        b.HasIndex(x => new { x.TenantId, x.ProjectId, x.Kind, x.Key, x.VersionLabel }).IsUnique().AreNullsDistinct(false);
        b.HasIndex(x => new { x.TenantId, x.ProjectId, x.Kind, x.Key, x.State });
        b.Property(x => x.Kind).HasMaxLength(64);
        b.Property(x => x.Key).HasMaxLength(128);
        b.Property(x => x.Title).HasMaxLength(200);
        b.Property(x => x.VersionLabel).HasMaxLength(16);
        b.Property(x => x.State).HasMaxLength(16);
        b.Property(x => x.Payload).HasColumnType("jsonb");
        b.Property(x => x.Diff).HasColumnType("jsonb");
        b.Property(x => x.SourceName).HasMaxLength(300);
        b.Property(x => x.SourceHash).HasMaxLength(64);
        b.Property(x => x.ObjectKey).HasMaxLength(500);
        b.Property(x => x.Notes).HasMaxLength(2000);
        b.Property(x => x.CreatedByName).HasMaxLength(200);
        b.Property(x => x.SubmittedByName).HasMaxLength(200);
        b.Property(x => x.DecidedByName).HasMaxLength(200);
        b.Property(x => x.DecisionReason).HasMaxLength(2000);
        b.Property(x => x.AppliedSummary).HasMaxLength(2000);
    }
}
