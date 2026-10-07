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
    /// <summary>QUEUED, RUNNING, DONE or FAILED (see <see cref="CheckRunStatuses"/>).</summary>
    public string Status { get; set; } = CheckRunStatuses.Queued;
    /// <summary>A person, or "Schedule" for the nightly run.</summary>
    public required string RequestedByName { get; set; }
    public Instant RequestedAt { get; set; }
    public Instant? StartedAt { get; set; }
    public Instant? FinishedAt { get; set; }
    /// <summary>How many checks ran to a PASS or FAIL in this run.</summary>
    public int Executed { get; set; }
    public int Passed { get; set; }
    public int Failed { get; set; }
    /// <summary>How many checks could not ask their question because something is not set up yet.</summary>
    public int NeedsSetup { get; set; }
    /// <summary>How many checks the project has switched off.</summary>
    public int Off { get; set; }
    /// <summary>Documents free of open Critical and Major defects, as a percentage of all documents.</summary>
    public decimal Integrity { get; set; }
    /// <summary>Checks that ran, as a percentage of those asked (switched-off checks are not asked).</summary>
    public decimal Coverage { get; set; }
    /// <summary>How many Critical defects were open (or accepted) after the run.</summary>
    public int OpenCritical { get; set; }
    /// <summary>Why the run failed, when it did; null otherwise.</summary>
    public string? Error { get; set; }
    /// <summary>Each check's result in this run, stored as JSON inside the run's row.</summary>
    public List<CheckResult> Results { get; set; } = [];
}

/// <summary>The states a check run goes through: queued by a person or the scheduler, running in the worker, then done or failed.</summary>
public static class CheckRunStatuses
{
    public const string Queued = "QUEUED";
    public const string Running = "RUNNING";
    public const string Done = "DONE";
    public const string Failed = "FAILED";
}

/// <summary>What one check returned in one run. Stored as part of <see cref="CheckRun.Results"/>.</summary>
public sealed class CheckResult
{
    public required string CheckId { get; set; }
    /// <summary>PASS, FAIL, NEEDS_SETUP, OFF or NOT_EXECUTABLE.</summary>
    public required string Result { get; set; }
    /// <summary>How many items the check found wrong.</summary>
    public int Failing { get; set; }
    /// <summary>How long the check took to run, in milliseconds.</summary>
    public int Milliseconds { get; set; }
    /// <summary>Extra text: what needs setting up, why the check could not run, or why it is switched off.</summary>
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
    /// <summary>OPEN, ACCEPTED or CLOSED (see <see cref="DefectStatuses"/>).</summary>
    public string Status { get; set; } = DefectStatuses.Open;
    public Instant FirstSeenAt { get; set; }
    public Instant LastSeenAt { get; set; }
    /// <summary>When the check stopped returning it; null while it is still open or accepted.</summary>
    public Instant? ClosedAt { get; set; }
    /// <summary>Accepted as it is, with the reason and whose decision: it stays counted, never hidden.</summary>
    public string? AcceptedReason { get; set; }
    public string? AcceptedByName { get; set; }
    public Instant? AcceptedAt { get; set; }
}

/// <summary>The states of a defect. Open: the check still returns it. Accepted: a person decided to keep it as it is (it still counts). Closed: the check no longer returns it.</summary>
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

/// <summary>Tells Entity Framework (the database mapping library) how to store <see cref="CheckRun"/>: its foreign keys, indexes, column sizes and the results as JSON.</summary>
internal sealed class CheckRunConfiguration : IEntityTypeConfiguration<CheckRun>
{
    /// <summary>Sets up the table mapping. Called by Entity Framework when it builds the database model.</summary>
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

/// <summary>Tells Entity Framework how to store <see cref="Defect"/>. A project holds at most one defect per check and item.</summary>
internal sealed class DefectConfiguration : IEntityTypeConfiguration<Defect>
{
    /// <summary>Sets up the table mapping. Called by Entity Framework when it builds the database model.</summary>
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

/// <summary>Tells Entity Framework how to store <see cref="CheckOptOut"/>. A project switches a given check off at most once.</summary>
internal sealed class CheckOptOutConfiguration : IEntityTypeConfiguration<CheckOptOut>
{
    /// <summary>Sets up the table mapping. Called by Entity Framework when it builds the database model.</summary>
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
