using NodaTime;

namespace Delios.Host.Packages;

/// <summary>
/// A set of documents delivered together, each at a status it must have reached:
/// a handover, a submission to the client, everything a supplier owes. Its
/// owners put it together; its acceptance authority, never one of the owners,
/// accepts what is missing and then the package itself.
/// </summary>
public sealed class Package
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    /// <summary>What people quote: P1001-PK-001. Never reused.</summary>
    public required string Number { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    /// <summary>From the published reasons for issue: what the delivery is for.</summary>
    public required string Reason { get; set; }
    /// <summary>A member is ready when its released status is any one of these.</summary>
    public string[] RequiredStatuses { get; set; } = [];
    public LocalDate? CompletionDate { get; set; }
    /// <summary>
    /// Fills itself: every document matching the rule joins, including ones
    /// registered later, until it is delivered. Empty: documents are added by hand.
    /// </summary>
    public PackageRule? Rule { get; set; }
    /// <summary>Taken out by hand. The rule does not bring them back.</summary>
    public Guid[] Excluded { get; set; } = [];
    /// <summary>The organizations it is delivered to; one transmittal each. Empty: handed over without one.</summary>
    public Guid[] RecipientPartyIds { get; set; } = [];
    public Guid[] OwnerIds { get; set; } = [];
    /// <summary>Any one of them accepts. Never one of the owners.</summary>
    public Guid[] AcceptorIds { get; set; } = [];
    public string State { get; set; } = PackageStates.Open;
    public Instant? AssessedAt { get; set; }
    public List<ShortfallLine> Shortfall { get; set; } = [];
    public Instant? ShortfallIssuedAt { get; set; }
    public Instant? ShortfallAcceptedAt { get; set; }
    public string? ShortfallAcceptedByName { get; set; }
    /// <summary>The owners declared that the rule admits nothing more.</summary>
    public Instant? RuleCeasedAt { get; set; }
    public Instant? ClosedAt { get; set; }
    public string? ClosedByName { get; set; }
    public string? ClosureNote { get; set; }
    public Instant? AcceptedAt { get; set; }
    public string? AcceptedByName { get; set; }
    public Guid CreatedById { get; set; }
    public required string CreatedByName { get; set; }
    public Instant CreatedAt { get; set; }
    public uint Version { get; set; }
    public List<PackageMember> Members { get; set; } = [];
}

public sealed class PackageRule
{
    public string[] DeliverableTypes { get; set; } = [];
    public string[] Disciplines { get; set; } = [];
    public string[] DocTypes { get; set; } = [];
    public string[] Originators { get; set; } = [];

    public bool IsEmpty => DeliverableTypes.Length + Disciplines.Length + DocTypes.Length + Originators.Length == 0;
}

/// <summary>A document the assessment found not ready, and why.</summary>
public sealed class ShortfallLine
{
    public Guid DocumentId { get; set; }
    public required string DocumentNumber { get; set; }
    public string[] Required { get; set; } = [];
    public string? Current { get; set; }
}

public static class PackageStates
{
    public const string Open = "OPEN";
    /// <summary>Gone to its organizations on transmittals; waiting to be accepted.</summary>
    public const string Delivered = "DELIVERED";
    /// <summary>Closed with nobody to deliver it to.</summary>
    public const string Closed = "CLOSED";
    public const string Accepted = "ACCEPTED";
}

public sealed class PackageMember
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid PackageId { get; set; }
    public Guid DocumentId { get; set; }
    /// <summary>For this document only; empty means the package's.</summary>
    public string[] RequiredStatuses { get; set; } = [];
    public bool ByRule { get; set; }
    public Instant AddedAt { get; set; }
}
