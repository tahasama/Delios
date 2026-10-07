using Delios.Host.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Checks;

/// <summary>One pass of every check over a project's register, and what each returned.</summary>
public sealed class CheckRun
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public string Status { get; set; } = CheckRunStatuses.Queued;
    /// <summary>A person, or "Schedule" for the nightly run.</summary>
    public required string RequestedByName { get; set; }
    public Instant RequestedAt { get; set; }
    public Instant? StartedAt { get; set; }
    public Instant? FinishedAt { get; set; }
    public int Executed { get; set; }
    public int Passed { get; set; }
    public int Failed { get; set; }
    public int NeedsSetup { get; set; }
    public int Off { get; set; }
    /// <summary>Documents free of open Critical and Major defects, as a percentage of all documents.</summary>
    public decimal Integrity { get; set; }
    /// <summary>Checks that ran, as a percentage of those asked (switched-off checks are not asked).</summary>
    public decimal Coverage { get; set; }
    public int OpenCritical { get; set; }
    public string? Error { get; set; }
    public List<CheckResult> Results { get; set; } = [];
}

public static class CheckRunStatuses
{
    public const string Queued = "QUEUED";
    public const string Running = "RUNNING";
    public const string Done = "DONE";
    public const string Failed = "FAILED";
}

public sealed class CheckResult
{
    public required string CheckId { get; set; }
    /// <summary>PASS, FAIL, NEEDS_SETUP, OFF or NOT_EXECUTABLE.</summary>
    public required string Result { get; set; }
    public int Failing { get; set; }
    public int Milliseconds { get; set; }
    public string? Note { get; set; }
}

/// <summary>
/// A finding a check returned: one item, one condition. It stays open while the
/// check keeps returning it and closes by itself when the check stops; somebody
/// fixes the register, not the defect.
/// </summary>
public sealed class Defect
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public required string CheckId { get; set; }
    public required string Severity { get; set; }
    /// <summary>Who fixes it: CF Document Control, OR whoever produced it, RV the reviewer, OG the organization.</summary>
    public required string Owner { get; set; }
    /// <summary>What it is about, stable from run to run: "document:{id}", "settings:STATUSES"…</summary>
    public required string EntityKey { get; set; }
    public required string EntityType { get; set; }
    public Guid? EntityId { get; set; }
    public Guid? DocumentId { get; set; }
    public required string Label { get; set; }
    public required string Description { get; set; }
    public string Status { get; set; } = DefectStatuses.Open;
    public Instant FirstSeenAt { get; set; }
    public Instant LastSeenAt { get; set; }
    public Instant? ClosedAt { get; set; }
    /// <summary>Accepted as it is, with the reason and whose decision: it stays counted, never hidden.</summary>
    public string? AcceptedReason { get; set; }
    public string? AcceptedByName { get; set; }
    public Instant? AcceptedAt { get; set; }
}

public static class DefectStatuses
{
    public const string Open = "OPEN";
    public const string Accepted = "ACCEPTED";
    public const string Closed = "CLOSED";
}

/// <summary>A check the project does not ask, and why. Its findings close; it does not count against coverage.</summary>
public sealed class CheckOptOut
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public required string CheckId { get; set; }
    public required string Reason { get; set; }
    public required string ByName { get; set; }
    public Instant At { get; set; }
}

internal sealed class CheckRunConfiguration : IEntityTypeConfiguration<CheckRun>
{
    public void Configure(EntityTypeBuilder<CheckRun> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.RequestedAt });
        b.Property(x => x.Status).HasMaxLength(16);
        b.Property(x => x.RequestedByName).HasMaxLength(200);
        b.Property(x => x.Integrity).HasPrecision(5, 1);
        b.Property(x => x.Coverage).HasPrecision(5, 1);
        b.Property(x => x.Error).HasMaxLength(2000);
        b.OwnsMany(x => x.Results, r => r.ToJson());
    }
}

internal sealed class DefectConfiguration : IEntityTypeConfiguration<Defect>
{
    public void Configure(EntityTypeBuilder<Defect> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.CheckId, x.EntityKey }).IsUnique();
        b.HasIndex(x => new { x.ProjectId, x.Status, x.Severity });
        b.HasIndex(x => x.DocumentId);
        b.Property(x => x.CheckId).HasMaxLength(16);
        b.Property(x => x.Severity).HasMaxLength(16);
        b.Property(x => x.Owner).HasMaxLength(4);
        b.Property(x => x.EntityKey).HasMaxLength(200);
        b.Property(x => x.EntityType).HasMaxLength(32);
        b.Property(x => x.Label).HasMaxLength(300);
        b.Property(x => x.Description).HasMaxLength(1000);
        b.Property(x => x.Status).HasMaxLength(16);
        b.Property(x => x.AcceptedReason).HasMaxLength(2000);
        b.Property(x => x.AcceptedByName).HasMaxLength(200);
    }
}

internal sealed class CheckOptOutConfiguration : IEntityTypeConfiguration<CheckOptOut>
{
    public void Configure(EntityTypeBuilder<CheckOptOut> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.CheckId }).IsUnique();
        b.Property(x => x.CheckId).HasMaxLength(16);
        b.Property(x => x.Reason).HasMaxLength(2000);
        b.Property(x => x.ByName).HasMaxLength(200);
    }
}
