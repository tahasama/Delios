using Delios.Host.Documents;
using Delios.Host.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Schedules;

/// <summary>
/// Which document is the project's schedule, and how to read it. The schedule is
/// a controlled deliverable like any other: it is revised, reviewed and released,
/// and only a released revision changes the activities.
/// </summary>
public sealed class ScheduleSource
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid DocumentId { get; set; }
    /// <summary>Which column holds what. Empty names are found by their usual headings.</summary>
    public ScheduleColumns Columns { get; set; } = new();
    /// <summary>Days before an activity's start a document is needed, unless a need says otherwise.</summary>
    public int DefaultLeadDays { get; set; } = 7;
    /// <summary>A missing document owed within this many days marks its activity at risk.</summary>
    public int RiskWindowDays { get; set; } = 14;
}

/// <summary>The headings of the schedule export. Matched without regard to case or spacing.</summary>
public sealed class ScheduleColumns
{
    public string? Sheet { get; set; }
    public string? Code { get; set; }
    public string? Name { get; set; }
    public string? Start { get; set; }
    public string? Finish { get; set; }
    public string? Responsible { get; set; }
    public string? Departments { get; set; }
}

/// <summary>One released schedule revision read into activities, and what it changed.</summary>
public sealed class ScheduleImport
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid RevisionId { get; set; }
    public required string RevisionValue { get; set; }
    public Guid? FileId { get; set; }
    public string Status { get; set; } = ScheduleImportStatuses.Done;
    public string? Error { get; set; }
    public Instant ImportedAt { get; set; }
    public int Added { get; set; }
    public int Moved { get; set; }
    public int Changed { get; set; }
    public int Removed { get; set; }
    public int Unchanged { get; set; }
    public List<ActivityChange> Changes { get; set; } = [];
    /// <summary>Department names in the file that are no published discipline: left off the activities, listed here to put right.</summary>
    public string[] UnmatchedDepartments { get; set; } = [];
}

public static class ScheduleImportStatuses
{
    public const string Done = "DONE";
    /// <summary>The released revision had no file the activities could be read from, or it could not be read.</summary>
    public const string Failed = "FAILED";
}

public sealed class ActivityChange
{
    public required string Code { get; set; }
    public required string Name { get; set; }
    /// <summary>NEW, MOVED (a date changed), CHANGED (name, owner or departments), REMOVED.</summary>
    public required string Type { get; set; }
    public LocalDate? OldStart { get; set; }
    public LocalDate? NewStart { get; set; }
    public LocalDate? OldFinish { get; set; }
    public LocalDate? NewFinish { get; set; }
}

/// <summary>
/// An activity of the schedule, as the latest released revision states it. One
/// that a later revision drops is marked removed, never deleted: what it needed,
/// and what was decided about it, stay readable.
/// </summary>
public sealed class Activity
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    /// <summary>The schedule's own activity id.</summary>
    public required string Code { get; set; }
    public required string Name { get; set; }
    public LocalDate? Start { get; set; }
    public LocalDate? Finish { get; set; }
    public string? Responsible { get; set; }
    /// <summary>The departments concerned. A department is a discipline: these are published discipline codes.</summary>
    public string[] Departments { get; set; } = [];
    public string State { get; set; } = ActivityStates.Active;
    public Guid? SourceRevisionId { get; set; }
    public Instant UpdatedAt { get; set; }
    // What it is waiting for, kept on the activity so the schedule can be sorted
    // and filtered by it. Written by Readiness.RestateAsync; nothing here is a new fact.
    public int NeedCount { get; set; }
    public int MetCount { get; set; }
    public int WaivedCount { get; set; }
    /// <summary>The earliest day a document still missing is owed.</summary>
    public LocalDate? NextNeededBy { get; set; }
    public List<Requirement> Requirements { get; set; } = [];
}

public static class ActivityStates
{
    public const string Active = "ACTIVE";
    public const string Removed = "REMOVED";
}

/// <summary>
/// A document an activity needs, and what for: the reason for issue it serves
/// (for information, for construction…), and the day it is needed, counted from
/// the activity's start or finish, or fixed.
/// </summary>
public sealed class Requirement
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid ActivityId { get; set; }
    public Guid DocumentId { get; set; }
    /// <summary>From the reasons for issue. A reason marked "executes" is met only at a status that allows work.</summary>
    public required string Purpose { get; set; }
    /// <summary>Narrower than the purpose, where given: met only at one of these statuses.</summary>
    public string[] RequiredStatuses { get; set; } = [];
    /// <summary>START or FINISH: tests owed after the work are counted from its finish.</summary>
    public string Anchor { get; set; } = Anchors.Start;
    /// <summary>Days from the anchor: negative before it, positive after.</summary>
    public int OffsetDays { get; set; }
    /// <summary>A date of its own, overriding the anchor.</summary>
    public LocalDate? FixedDate { get; set; }
    /// <summary>Worked out from the anchor whenever the schedule moves.</summary>
    public LocalDate? NeededBy { get; set; }
    /// <summary>The department (a published discipline) that owns the need: its members may waive it.</summary>
    public string? Department { get; set; }
    public string State { get; set; } = RequirementStates.Missing;
    /// <summary>When the document was first there for it.</summary>
    public Instant? MetAt { get; set; }
    /// <summary>
    /// Waived on the concerned party's own responsibility: "not needed for this
    /// activity", "received outside, to be uploaded". The activity counts it as
    /// covered, but it stays marked until the document comes or the need is dropped.
    /// </summary>
    public string? WaiverNote { get; set; }
    public string? WaivedByName { get; set; }
    public Instant? WaivedAt { get; set; }
    public required string CreatedByName { get; set; }
    public Instant CreatedAt { get; set; }
}

public static class Anchors
{
    public const string Start = "START";
    public const string Finish = "FINISH";
}

public static class RequirementStates
{
    public const string Missing = "MISSING";
    public const string Met = "MET";
    public const string Waived = "WAIVED";
}

/// <summary>
/// What was decided about an activity that did not have its documents: it went
/// ahead anyway, or it was stopped. Written once, kept for ever; the planned day
/// is frozen in it, because a later schedule moves the date.
/// </summary>
public sealed class ActivityDecision
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid ActivityId { get; set; }
    /// <summary>From the organization's list of activity decisions; whether it went ahead is that value's "proceeds".</summary>
    public required string Decision { get; set; }
    public LocalDate? PlannedStart { get; set; }
    /// <summary>Who carries the decision: the manager the activity names.</summary>
    public required string ResponsibleName { get; set; }
    public required string Reason { get; set; }
    public string? DelayOwedBy { get; set; }
    public string? DelayReason { get; set; }
    public required string RecordedByName { get; set; }
    public Instant RecordedAt { get; set; }
}

public static class ScheduleSets
{
    /// <summary>What was decided about an activity whose documents were missing. Props: proceeds (bool: it went ahead).</summary>
    public const string Decisions = "ACTIVITY_DECISIONS";
}

internal sealed class ScheduleSourceConfiguration : IEntityTypeConfiguration<ScheduleSource>
{
    public void Configure(EntityTypeBuilder<ScheduleSource> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Document>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.ProjectId).IsUnique();
        b.HasIndex(x => x.DocumentId);
        b.OwnsOne(x => x.Columns, c => c.ToJson());
    }
}

internal sealed class ScheduleImportConfiguration : IEntityTypeConfiguration<ScheduleImport>
{
    public void Configure(EntityTypeBuilder<ScheduleImport> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Revision>().WithMany().HasForeignKey(x => x.RevisionId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.RevisionId).IsUnique();
        b.HasIndex(x => new { x.ProjectId, x.ImportedAt });
        b.Property(x => x.RevisionValue).HasMaxLength(16);
        b.Property(x => x.Status).HasMaxLength(16);
        b.Property(x => x.Error).HasMaxLength(2000);
        b.OwnsMany(x => x.Changes, c => c.ToJson());
    }
}

internal sealed class ActivityConfiguration : IEntityTypeConfiguration<Activity>
{
    public void Configure(EntityTypeBuilder<Activity> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(x => x.Requirements).WithOne().HasForeignKey(x => x.ActivityId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Code }).IsUnique();
        b.HasIndex(x => new { x.ProjectId, x.Start });
        b.HasIndex(x => new { x.ProjectId, x.NextNeededBy });
        b.Property(x => x.Code).HasMaxLength(64);
        b.Property(x => x.Name).HasMaxLength(500);
        b.Property(x => x.Responsible).HasMaxLength(200);
        b.Property(x => x.State).HasMaxLength(16);
    }
}

internal sealed class RequirementConfiguration : IEntityTypeConfiguration<Requirement>
{
    public void Configure(EntityTypeBuilder<Requirement> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Document>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ActivityId, x.DocumentId, x.Purpose }).IsUnique();
        b.HasIndex(x => x.DocumentId);
        b.HasIndex(x => new { x.ProjectId, x.State, x.NeededBy });
        b.Property(x => x.Purpose).HasMaxLength(64);
        b.Property(x => x.Anchor).HasMaxLength(8);
        b.Property(x => x.Department).HasMaxLength(32);
        b.Property(x => x.State).HasMaxLength(16);
        b.Property(x => x.WaiverNote).HasMaxLength(2000);
        b.Property(x => x.WaivedByName).HasMaxLength(200);
        b.Property(x => x.CreatedByName).HasMaxLength(200);
    }
}

internal sealed class ActivityDecisionConfiguration : IEntityTypeConfiguration<ActivityDecision>
{
    public void Configure(EntityTypeBuilder<ActivityDecision> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Activity>().WithMany().HasForeignKey(x => x.ActivityId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.ActivityId);
        b.Property(x => x.Decision).HasMaxLength(64);
        b.Property(x => x.ResponsibleName).HasMaxLength(200);
        b.Property(x => x.Reason).HasMaxLength(2000);
        b.Property(x => x.DelayOwedBy).HasMaxLength(200);
        b.Property(x => x.DelayReason).HasMaxLength(2000);
        b.Property(x => x.RecordedByName).HasMaxLength(200);
    }
}
