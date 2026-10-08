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
    /// <summary>One of <c>IssueRequestStatuses</c>: OPEN, DONE or CANCELLED.</summary>
    public string Status { get; set; } = IssueRequestStatuses.Open;
    /// <summary>When it was carried out or cancelled; empty while it is still open.</summary>
    public Instant? ClosedAt { get; set; }
    public string? ClosedByName { get; set; }
    /// <summary>
    /// Row version kept by the database; EF Core uses it to detect two people changing the same request at once.
    /// </summary>
    public uint Version { get; set; }
}

/// <summary>The values <c>IssueRequest.Status</c> can take.</summary>
public static class IssueRequestStatuses
{
    /// <summary>Waiting to be carried out.</summary>
    public const string Open = "OPEN";
    /// <summary>Its transmittals exist.</summary>
    public const string Done = "DONE";
    /// <summary>Withdrawn by a person, or lapsed because the revision went back to its author.</summary>
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
    /// <summary>Only OUTGOING exists today; see <c>TransmittalDirections</c>.</summary>
    public string Direction { get; set; } = TransmittalDirections.Outgoing;
    /// <summary>Incoming: the organization that sent it. Its people see it.</summary>
    public Guid? FromPartyId { get; set; }
    /// <summary>Incoming: the sending organization's name as it was.</summary>
    public string? FromName { get; set; }
    /// <summary>Incoming: the sender's own number for it, when they quote one.</summary>
    public string? TheirReference { get; set; }
    /// <summary>
    /// Incoming, recorded by Document Control for an organization that works in its own system: their covering
    /// letter or e-mail, as proof of what came in.
    /// </summary>
    public Guid? ProofFileId { get; set; }
    public required string Reason { get; set; }
    public required string Subject { get; set; }
    public string? Message { get; set; }
    /// <summary>The outside party it went to; empty for our own people.</summary>
    public Guid? ToPartyId { get; set; }
    public required string ToName { get; set; }
    public bool ResponseRequired { get; set; }
    /// <summary>
    /// The date a response is due. Worked out in working days from the reason for issue when not given; empty when no
    /// response is wanted.
    /// </summary>
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

/// <summary>The values <c>Transmittal.Direction</c> can take.</summary>
public static class TransmittalDirections
{
    public const string Outgoing = "OUTGOING";
    /// <summary>Sent to us by another organization. Received the moment it is sent: that is its receipt.</summary>
    public const string Incoming = "INCOMING";
}

/// <summary>The values <c>TransmittalItem.Kind</c> can take.</summary>
public static class TransmittalItemKinds
{
    /// <summary>A revision as it stood when it went.</summary>
    public const string Revision = "REVISION";
    /// <summary>A placeholder a supplier is asked to fill, with its due date. No revision yet.</summary>
    public const string Placeholder = "PLACEHOLDER";
    /// <summary>Incoming: a placeholder filled, or a correction sent again. It made or updated a revision in our register.</summary>
    public const string Submission = "SUBMISSION";
    /// <summary>
    /// Incoming: something not planned (an RFI, an NCR, minutes…), files with the sender's reference. It stays on the
    /// transmittal until Document Control registers it.
    /// </summary>
    public const string Unplanned = "UNPLANNED";
}

/// <summary>One revision on a transmittal, as it stood when it went.</summary>
public sealed class TransmittalItem
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid TransmittalId { get; set; }
    /// <summary>One of <c>TransmittalItemKinds</c>.</summary>
    public string Kind { get; set; } = TransmittalItemKinds.Revision;
    /// <summary>Empty for an unplanned item until it is registered.</summary>
    public Guid? DocumentId { get; set; }
    /// <summary>Empty for a placeholder and an unplanned item.</summary>
    public Guid? RevisionId { get; set; }
    /// <summary>Our number; for an unplanned item, the sender's reference (or empty).</summary>
    public required string DocumentNumber { get; set; }
    public required string Title { get; set; }
    /// <summary>The revision label as it was when sent, for example A or 01.</summary>
    public required string RevisionValue { get; set; }
    /// <summary>
    /// The status it was released at; empty when it went for review before any release. Incoming: the status the
    /// sender proposes (for review, for approval, for information…).
    /// </summary>
    public string? StatusCode { get; set; }
    /// <summary>A placeholder requested: when it is due.</summary>
    public LocalDate? DueDate { get; set; }
    /// <summary>Incoming submission: which submission of the revision this was (1, then 2 after a correction…).</summary>
    public int? Submission { get; set; }
    /// <summary>Unplanned: what the sender says it is, from the document types (RFI, NCR, MOM…).</summary>
    public string? DocType { get; set; }
    /// <summary>Unplanned: when Document Control put it in our register, and by whom. DocumentId is then set.</summary>
    public Instant? RegisteredAt { get; set; }
    public string? RegisteredByName { get; set; }
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
    /// <summary>
    /// Set when the recipient is a person with an account here; empty for an organization that receives it by proxy
    /// (through one of our people).
    /// </summary>
    public Guid? UserId { get; set; }
    public Guid? PartyId { get; set; }
    public required string Name { get; set; }
    public string? Organization { get; set; }
    /// <summary>First time this person opened the transmittal; used as evidence it was read.</summary>
    public Instant? OpenedAt { get; set; }
    public Instant? AcknowledgedAt { get; set; }
    public Instant? DispatchedAt { get; set; }
    /// <summary>How it was sent outside the system, for example email, their portal, by hand.</summary>
    public string? DispatchChannel { get; set; }
    /// <summary>The other organization's own reference for it, if they gave one.</summary>
    public string? DispatchRef { get; set; }
    public string? DispatchedByName { get; set; }
    /// <summary>The uploaded proof that it went (a stored file of kind Evidence).</summary>
    public Guid? ProofFileId { get; set; }

    /// <summary>Waiting for one of ours to send it outside the system.</summary>
    public bool AwaitsDispatch => UserId is null && DispatchedAt is null;
}

/// <summary>Names of the value sets (admin-managed lists of allowed codes) used by issuing.</summary>
public static class TransmittalSets
{
    /// <summary>Why a revision goes to someone. Props: response (bool), responseDays (working days).</summary>
    public const string Reasons = "REASONS_FOR_ISSUE";
}
