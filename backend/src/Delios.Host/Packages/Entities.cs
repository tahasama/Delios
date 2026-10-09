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
    /// <summary>One of <c>PackageKinds</c>: documents we deliver, or documents a supplier owes us.</summary>
    public string Kind { get; set; } = PackageKinds.Delivery;
    /// <summary>For a supply package: the supplier whose placeholders it holds. Its people see the package.</summary>
    public Guid? SupplierPartyId { get; set; }
    /// <summary>For a supply package: the purchase order it is under, as written on it. Optional.</summary>
    public string? PurchaseOrder { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    /// <summary>Further reasons for issue, after the one its transmittals go for; named on them.</summary>
    public string[] OtherReasons { get; set; } = [];
    /// <summary>The organization's own fields, as JSON.</summary>
    public string? Extras { get; set; }
    /// <summary>From the published reasons for issue: what the delivery is for, or what the supplier is asked for.</summary>
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
    /// <summary>The people (user ids) who put the package together and deliver it.</summary>
    public Guid[] OwnerIds { get; set; } = [];
    /// <summary>Any one of them accepts. Never one of the owners.</summary>
    public Guid[] AcceptorIds { get; set; } = [];
    /// <summary>One of <c>PackageStates</c>.</summary>
    public string State { get; set; } = PackageStates.Open;
    /// <summary>
    /// When readiness was last checked. Empty means not assessed since the last change to its contents.
    /// </summary>
    public Instant? AssessedAt { get; set; }
    /// <summary>Documents found not ready at the last assessment.</summary>
    public List<ShortfallLine> Shortfall { get; set; } = [];
    /// <summary>When the shortfall was sent to the acceptance authority.</summary>
    public Instant? ShortfallIssuedAt { get; set; }
    /// <summary>When the acceptance authority agreed it may go without the missing documents.</summary>
    public Instant? ShortfallAcceptedAt { get; set; }
    public string? ShortfallAcceptedByName { get; set; }
    /// <summary>The owners declared that the rule admits nothing more.</summary>
    public Instant? RuleCeasedAt { get; set; }
    /// <summary>When it was delivered or closed. Its contents are fixed from then on.</summary>
    public Instant? ClosedAt { get; set; }
    public string? ClosedByName { get; set; }
    public string? ClosureNote { get; set; }
    public Instant? AcceptedAt { get; set; }
    public string? AcceptedByName { get; set; }
    public Guid CreatedById { get; set; }
    public required string CreatedByName { get; set; }
    public Instant CreatedAt { get; set; }
    /// <summary>
    /// Row version kept by the database; EF Core uses it to detect two people changing the same package at once.
    /// </summary>
    public uint Version { get; set; }
    public List<PackageMember> Members { get; set; } = [];
}

/// <summary>
/// Which documents a package takes in by itself. A document matches when it matches every list that is not empty; an
/// empty list matches anything. Stored as JSON inside the package row.
/// </summary>
public sealed class PackageRule
{
    public string[] DeliverableTypes { get; set; } = [];
    public string[] Disciplines { get; set; } = [];
    public string[] DocTypes { get; set; } = [];
    public string[] Originators { get; set; } = [];
    /// <summary>Asset tags: a document linked to any of them matches.</summary>
    public Guid[] AssetIds { get; set; } = [];

    /// <summary>True when no list is filled in, which means there is no rule.</summary>
    public bool IsEmpty => DeliverableTypes.Length + Disciplines.Length + DocTypes.Length + Originators.Length + AssetIds.Length == 0;
}

/// <summary>A document the assessment found not ready, and why.</summary>
public sealed class ShortfallLine
{
    public Guid DocumentId { get; set; }
    public required string DocumentNumber { get; set; }
    /// <summary>The statuses the document needed.</summary>
    public string[] Required { get; set; } = [];
    /// <summary>The status of its released revision at the assessment; empty when nothing was released.</summary>
    public string? Current { get; set; }
}

/// <summary>The values <c>Package.Kind</c> can take.</summary>
public static class PackageKinds
{
    /// <summary>Documents we hand over to one or several organizations.</summary>
    public const string Delivery = "DELIVERY";
    /// <summary>Documents a supplier owes us: its placeholders, requested on transmittals and sent back on theirs.</summary>
    public const string Supply = "SUPPLY";
}

/// <summary>The values <c>Package.State</c> can take.</summary>
public static class PackageStates
{
    /// <summary>Being put together; documents can still be added and removed.</summary>
    public const string Open = "OPEN";
    /// <summary>Gone to its organizations on transmittals; waiting to be accepted.</summary>
    public const string Delivered = "DELIVERED";
    /// <summary>Closed with nobody to deliver it to.</summary>
    public const string Closed = "CLOSED";
    /// <summary>The acceptance authority accepted it. Final.</summary>
    public const string Accepted = "ACCEPTED";
}

/// <summary>One document in a package, with any status requirement of its own.</summary>
public sealed class PackageMember
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid PackageId { get; set; }
    public Guid DocumentId { get; set; }
    /// <summary>For this document only; empty means the package's.</summary>
    public string[] RequiredStatuses { get; set; } = [];
    /// <summary>True when the rule brought it in; false when it was added by hand.</summary>
    public bool ByRule { get; set; }
    public Instant AddedAt { get; set; }
    /// <summary>In a supply package: when the supplier was asked for it on a transmittal. Empty until then.</summary>
    public Instant? RequestedAt { get; set; }
}
