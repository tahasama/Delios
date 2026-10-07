using NodaTime;

namespace Delios.Host.Transmittals;

/// <summary>
/// Somebody asking for a released revision to be sent: to whom, and why.
/// Releasing a revision and telling people about it are two acts; the second is
/// always asked for. Document Control carries a request out, or, on a project
/// where nobody holds that function, the person who asked.
/// </summary>
public sealed class IssueRequest
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid DocumentId { get; set; }
    public Guid RevisionId { get; set; }
    /// <summary>From the published reasons for issue. What is wanted back is a property of the reason.</summary>
    public required string Reason { get; set; }
    /// <summary>Our own people. The distribution matrix proposes them.</summary>
    public Guid[] UserIds { get; set; } = [];
    /// <summary>Organizations on the project.</summary>
    public Guid[] PartyIds { get; set; } = [];
    public string? Note { get; set; }
    /// <summary>Why people outside the defined distribution receive it. Required when there are any.</summary>
    public string? OffDistributionReason { get; set; }
    public Guid RaisedById { get; set; }
    public required string RaisedByName { get; set; }
    public Instant RaisedAt { get; set; }
    public string Status { get; set; } = IssueRequestStatuses.Open;
    public Instant? ClosedAt { get; set; }
    public string? ClosedByName { get; set; }
    public uint Version { get; set; }
}

public static class IssueRequestStatuses
{
    public const string Open = "OPEN";
    /// <summary>Its transmittals exist.</summary>
    public const string Done = "DONE";
    public const string Cancelled = "CANCELLED";
}

/// <summary>
/// A numbered record that documents went to somebody, for a reason. What was sent
/// is never changed after it went.
/// </summary>
public sealed class Transmittal
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    /// <summary>What people quote: P1001-TR-0001. Never reused.</summary>
    public required string Number { get; set; }
    public string Direction { get; set; } = TransmittalDirections.Outgoing;
    public required string Reason { get; set; }
    public required string Subject { get; set; }
    public string? Message { get; set; }
    /// <summary>The outside party it went to; empty for our own people.</summary>
    public Guid? ToPartyId { get; set; }
    public required string ToName { get; set; }
    public bool ResponseRequired { get; set; }
    public LocalDate? ResponseDue { get; set; }
    public Instant IssuedAt { get; set; }
    /// <summary>Empty when the system sent it on a release nobody had to make.</summary>
    public Guid? IssuedById { get; set; }
    public required string IssuedByName { get; set; }
    /// <summary>The request it carried out, the review step it carried to a party, or the package it delivered.</summary>
    public Guid? IssueRequestId { get; set; }
    public Guid? ReviewStepId { get; set; }
    /// <summary>The package it delivered.</summary>
    public Guid? PackageId { get; set; }
    public List<TransmittalItem> Items { get; set; } = [];
    public List<TransmittalRecipient> Recipients { get; set; } = [];
}

public static class TransmittalDirections
{
    public const string Outgoing = "OUTGOING";
}

/// <summary>One revision on a transmittal, as it stood when it went.</summary>
public sealed class TransmittalItem
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid TransmittalId { get; set; }
    public Guid DocumentId { get; set; }
    public Guid RevisionId { get; set; }
    public required string DocumentNumber { get; set; }
    public required string Title { get; set; }
    public required string RevisionValue { get; set; }
    /// <summary>The status it was released at; empty when it went for review before any release.</summary>
    public string? StatusCode { get; set; }
}

/// <summary>
/// One person, or one organization with nobody here, a transmittal went to. A
/// person's opening and acknowledgement are recorded. An organization with no
/// accounts here cannot open anything, so one of ours sends it outside the system
/// and records that it went, with the proof.
/// </summary>
public sealed class TransmittalRecipient
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid TransmittalId { get; set; }
    public Guid? UserId { get; set; }
    public Guid? PartyId { get; set; }
    public required string Name { get; set; }
    public string? Organization { get; set; }
    public Instant? OpenedAt { get; set; }
    public Instant? AcknowledgedAt { get; set; }
    public Instant? DispatchedAt { get; set; }
    public string? DispatchChannel { get; set; }
    public string? DispatchRef { get; set; }
    public string? DispatchedByName { get; set; }
    public Guid? ProofFileId { get; set; }

    /// <summary>Waiting for one of ours to send it outside the system.</summary>
    public bool AwaitsDispatch => UserId is null && DispatchedAt is null;
}

public static class TransmittalSets
{
    /// <summary>Why a revision goes to someone. Props: response (bool), responseDays (working days).</summary>
    public const string Reasons = "REASONS_FOR_ISSUE";
}
