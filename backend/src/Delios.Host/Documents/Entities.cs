using System.Text.Json;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>
/// One published value of a list the organization controls: disciplines,
/// document types, criticality levels. Values in use are retired, never deleted.
/// </summary>
public sealed class ValueEntry
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public required string SetKey { get; set; }
    public required string Code { get; set; }
    public required string Label { get; set; }
    /// <summary><c>ACTIVE</c> or <c>RETIRED</c>; see <see cref="ValueStatus"/>. Retired values stay on old documents but cannot be chosen.</summary>
    public string Status { get; set; } = ValueStatus.Active;
    /// <summary>Display order within its set; lower comes first.</summary>
    public int Sort { get; set; }
    /// <summary>What a value means for the system, where it means something: a default flag, a mapping.</summary>
    public JsonDocument? Props { get; set; }
}

/// <summary>The states a <see cref="ValueEntry"/> can be in.</summary>
public static class ValueStatus
{
    public const string Active = "ACTIVE";
    public const string Retired = "RETIRED";
}

/// <summary>The keys of the value lists the organization controls, as stored in <see cref="ValueEntry.SetKey"/>.</summary>
public static class ValueSets
{
    public const string Disciplines = "DISCIPLINES";
    public const string DocumentTypes = "DOCUMENT_TYPES";
    public const string DeliverableTypes = "DELIVERABLE_TYPES";
    public const string Subprojects = "SUBPROJECTS";
    public const string PurchaseOrders = "PURCHASE_ORDERS";
    public const string Criticality = "CRITICALITY";
    public const string Confidentiality = "CONFIDENTIALITY";
    public const string RetentionClasses = "RETENTION_CLASSES";
    /// <summary>Words that, alone, make a title say nothing: "Drawing", "Report".</summary>
    public const string GenericTitleWords = "GENERIC_TITLE_WORDS";
}

/// <summary>How document numbers are built: fields in order, joined by one delimiter.</summary>
public sealed class NumberingScheme
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public required string Name { get; set; }
    public string Delimiter { get; set; } = "-";
    public bool Active { get; set; } = true;
    /// <summary>The parts of the number, in order. Stored as JSON inside the scheme's row.</summary>
    public List<SchemeField> Fields { get; set; } = [];
}

/// <summary>One part of a document number, such as the project code or the sequence. Belongs to a <see cref="NumberingScheme"/>.</summary>
public sealed class SchemeField
{
    public required string Label { get; set; }
    /// <summary>Which fact of the document fills it. See <see cref="FieldSources"/>.</summary>
    public required string Source { get; set; }
    /// <summary>For a FIXED field: the text it always holds, such as RV for reviews.</summary>
    public string? Value { get; set; }
    /// <summary>For the sequence: how many digits, zero-padded.</summary>
    public int? Digits { get; set; }
}

/// <summary>Where a <see cref="SchemeField"/> takes its text from. Read by <see cref="Numbering"/>.</summary>
public static class FieldSources
{
    public const string Project = "PROJECT";
    public const string Subproject = "SUBPROJECT";
    public const string Originator = "ORIGINATOR";
    public const string ContractRef = "CONTRACT_REF";
    public const string Discipline = "DISCIPLINE";
    public const string DocType = "DOC_TYPE";
    public const string Sequence = "SEQUENCE";
    public const string Fixed = "FIXED";
    /// <summary>On a transmittal: the party code of who sends it, and of who receives it.</summary>
    public const string Sender = "SENDER";
    public const string Receiver = "RECEIVER";
}

/// <summary>
/// Records other than documents that carry a number, routed to a scheme the
/// same way a deliverable type is. The "@" keeps them apart from deliverable types.
/// </summary>
public static class RecordKinds
{
    public const string Review = "@REVIEW";
    public const string Transmittal = "@TRANSMITTAL";
    public const string Package = "@PACKAGE";
}

/// <summary>Which scheme numbers which deliverable type.</summary>
public sealed class SchemeRouting
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public required string DeliverableType { get; set; }
    public Guid SchemeId { get; set; }
    public NumberingScheme? Scheme { get; set; }
    public bool Active { get; set; } = true;
}

/// <summary>The next sequence for one number prefix on one project. A number is never reused.</summary>
public sealed class NumberCounter
{
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public required string Prefix { get; set; }
    /// <summary>The sequence number the next allocation for this prefix will get.</summary>
    public int Next { get; set; }
}

/// <summary>
/// A document in the project's register: its number, title, coded facts and state, with its revisions.
/// Created by <see cref="DocumentService.RegisterAsync"/>; stored in the <c>documents</c> table.
/// </summary>
public sealed class Document
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    /// <summary>Allocated by the system once, never typed and never reused.</summary>
    public required string Number { get; set; }
    public required string Title { get; set; }
    /// <summary>Where it came from; picks the numbering scheme. Fixed at creation.</summary>
    public required string DeliverableType { get; set; }
    public required string DocType { get; set; }
    public required string Discipline { get; set; }
    /// <summary>The party that produces it, when that is not us.</summary>
    public string? Originator { get; set; }
    public string? Subproject { get; set; }
    public string? ContractRef { get; set; }
    public string? Criticality { get; set; }
    public string? Confidentiality { get; set; }
    public string? RetentionClass { get; set; }
    /// <summary>Where the document is in its life; see <see cref="DocumentStates"/>.</summary>
    public string State { get; set; } = DocumentStates.Planned;
    /// <summary>DOCUMENT is revised; RECORD is fixed evidence with one revision.</summary>
    public string Kind { get; set; } = DocumentKinds.Document;
    /// <summary>A register entry with no revision yet.</summary>
    public bool IsPlaceholder { get; set; } = true;
    public LocalDate? ReceivedDate { get; set; }
    public LocalDate? PlannedDate { get; set; }
    /// <summary>The number it went by before this register, and the scheme that number belonged to.</summary>
    public string? PreviousNumber { get; set; }
    public string? LegacyScheme { get; set; }
    /// <summary>The application (and version) its native file is made with.</summary>
    public string? AppVersion { get; set; }
    /// <summary>The organization's own fields (Settings → Forms &amp; fields), name to value, as JSON. Null when none.</summary>
    public string? Extras { get; set; }
    /// <summary>Kept whatever its retention says: nothing about it may be disposed of while it holds.</summary>
    public bool LegalHold { get; set; }
    /// <summary>A record confirmed: fixed as evidence from then on.</summary>
    public Instant? ConfirmedAt { get; set; }
    public string? ConfirmedByName { get; set; }
    /// <summary>The record this one corrects; both are kept, the original never altered.</summary>
    public Guid? CorrectsId { get; set; }
    public string? LegalHoldReason { get; set; }
    public Instant? LegalHoldAt { get; set; }
    public string? LegalHoldByName { get; set; }
    public Guid CreatedById { get; set; }
    public required string CreatedByName { get; set; }
    public Instant CreatedAt { get; set; }
    public Instant UpdatedAt { get; set; }
    // The newest revision, kept on the document so the register can sort and page by it.
    public Guid? LatestRevisionId { get; set; }
    public string? LatestRevisionValue { get; set; }
    public string? LatestRevisionState { get; set; }
    /// <summary>Optimistic concurrency: Postgres' row version.</summary>
    public uint Version { get; set; }
    public List<Revision> Revisions { get; set; } = [];

    /// <summary>The facts that access rules are checked against. Worked out from the properties, not stored.</summary>
    public Identity.DocumentFacts Facts => new(DeliverableType, DocType, Discipline, Criticality, Confidentiality);
}

/// <summary>The states a <see cref="Document"/> can be in. New documents start as <see cref="Planned"/>.</summary>
public static class DocumentStates
{
    public const string Planned = "PLANNED";
    public const string Active = "ACTIVE";
    public const string Withdrawn = "WITHDRAWN";
    public const string Cancelled = "CANCELLED";
    public const string Archived = "ARCHIVED";
}

/// <summary>Whether a register entry is a document that gets revised, or a record kept as fixed evidence.</summary>
public static class DocumentKinds
{
    public const string Document = "DOCUMENT";
    public const string Record = "RECORD";
}

/// <summary>
/// One issue of a document (rev A, rev B...), with its files and the history of its submissions.
/// Created by <see cref="DocumentService.StartRevisionAsync"/>; stored in the <c>revisions</c> table.
/// </summary>
public sealed class Revision
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid DocumentId { get; set; }
    /// <summary>A, B, C… (design) or 0, 1, 2… (execution). Never reused, never in the number.</summary>
    public required string Value { get; set; }
    /// <summary>The code of the series in the document's revision scheme this value belongs to.</summary>
    public required string Series { get; set; }
    /// <summary>Where the revision is in its life; see <see cref="RevisionStates"/>.</summary>
    public string State { get; set; } = RevisionStates.InPreparation;
    /// <summary>Whether every file has passed scanning: PROCESSING, READY or REJECTED.</summary>
    public string FilesState { get; set; } = FilesStates.Processing;
    public string? ReasonForRevision { get; set; }
    public string? ChangeDescription { get; set; }
    public Guid AuthoredById { get; set; }
    public required string AuthoredByName { get; set; }
    /// <summary>The party code of the author's organization when the author is from another party; null for our own people.</summary>
    public string? AuthoredByParty { get; set; }
    public Instant CreatedAt { get; set; }
    /// <summary>What the released revision is for (IFC, IFA…), from the organization's status list.</summary>
    public string? StatusCode { get; set; }
    public Instant? ReleasedAt { get; set; }
    public string? ReleasedByName { get; set; }
    public Instant? SupersededAt { get; set; }
    /// <summary>Sent back to its author: kept as submitted, replaced by the next revision.</summary>
    public Instant? ReturnedAt { get; set; }
    public string? ReturnedReason { get; set; }
    /// <summary>
    /// Released, but not for use while an outside approval it turned out to need is
    /// awaited; or for good, where that approval was refused.
    /// </summary>
    public Instant? HeldAt { get; set; }
    public string? HeldReason { get; set; }
    public string? HeldByName { get; set; }
    /// <summary>Voided: released in error, or never reviewed. Who decided it, why, and what was found of the work done from it.</summary>
    public Instant? VoidedAt { get; set; }
    public string? VoidReason { get; set; }
    public string? VoidAuthority { get; set; }
    public string? VoidReassessment { get; set; }
    public Instant? VoidReassessedAt { get; set; }
    /// <summary>
    /// Which set of files is the revision's now. A submission Document Control
    /// returned for a correction is replaced by the next one under the same
    /// revision value; it is kept, never overwritten.
    /// </summary>
    public int Submission { get; set; } = 1;
    /// <summary>Document Control's last outcome on it, from the organization's control outcomes. Not a review verdict.</summary>
    public string? ControlOutcome { get; set; }
    /// <summary>Every submission so far, oldest first. Stored as JSON inside the revision's row.</summary>
    public List<SubmissionRecord> Submissions { get; set; } = [];
    /// <summary>
    /// Optimistic concurrency: Postgres' row version. If two people save the same revision at once,
    /// the second save fails instead of silently overwriting the first.
    /// </summary>
    public uint Version { get; set; }
    public List<StoredFile> Files { get; set; } = [];
}

/// <summary>
/// How an organization names revisions: one or more series, each with its own
/// format. A, B, C… then 0, 1, 2… is the recommendation; 1, 2, 3 throughout, or
/// P1, P2 for a phase, A, B for design and CA, CB for the client, are equally valid.
/// </summary>
public sealed class RevisionScheme
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public required string Name { get; set; }
    /// <summary>Used for any deliverable type no routing names.</summary>
    public bool IsDefault { get; set; }
    /// <summary>A document may move to a later series but never back to an earlier one.</summary>
    public bool ForwardOnly { get; set; } = true;
    public List<RevisionSeriesRule> Series { get; set; } = [];
}

/// <summary>One series of a <see cref="RevisionScheme"/>: how its values look and where they start.</summary>
public sealed class RevisionSeriesRule
{
    /// <summary>Stable code stored on each revision: DESIGN, EXECUTION, CLIENT.</summary>
    public required string Code { get; set; }
    public required string Label { get; set; }
    /// <summary>LETTERS (A, B… Z, AA) or NUMBERS (0, 1, 2…).</summary>
    public required string Kind { get; set; }
    /// <summary>Written before every value: "C" gives CA, CB; "P" gives P1, P2.</summary>
    public string Prefix { get; set; } = "";
    /// <summary>The first value without the prefix: "A", "1", "0".</summary>
    public required string Start { get; set; }
    /// <summary>NUMBERS only: pad with zeros to this width, so 3 gives 001.</summary>
    public int Width { get; set; }
    /// <summary>LETTERS only: a, b, c rather than A, B, C.</summary>
    public bool Lowercase { get; set; }
    /// <summary>LETTERS only: letters never used, because they read as digits or as each other.</summary>
    public string[] ExcludedLetters { get; set; } = [];
}

/// <summary>Whether a revision series counts in letters or in numbers.</summary>
public static class SeriesKinds
{
    public const string Letters = "LETTERS";
    public const string Numbers = "NUMBERS";
}

/// <summary>Which revision scheme a deliverable type follows, when it is not the default.</summary>
public sealed class RevisionSchemeRouting
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public required string DeliverableType { get; set; }
    public Guid SchemeId { get; set; }
    public RevisionScheme? Scheme { get; set; }
}

/// <summary>One set of files sent in under a revision, and what Document Control said of it.</summary>
public sealed class SubmissionRecord
{
    public int Number { get; set; }
    public Instant SubmittedAt { get; set; }
    public required string SubmittedByName { get; set; }
    /// <summary>Document Control's outcome on this submission; null until decided.</summary>
    public string? Outcome { get; set; }
    public string? Note { get; set; }
    public string? DecidedByName { get; set; }
    public Instant? DecidedAt { get; set; }
}

/// <summary>The states a <see cref="Revision"/> can be in.</summary>
public static class RevisionStates
{
    /// <summary>Sent in by another organization; Document Control accepts it before anybody reviews it.</summary>
    public const string Received = "RECEIVED";
    /// <summary>Document Control returned it for a correction that changes nothing it says: the same revision comes back.</summary>
    public const string Correcting = "CORRECTING";
    public const string InPreparation = "IN_PREPARATION";
    public const string InReview = "IN_REVIEW";
    public const string Released = "RELEASED";
    /// <summary>Reviewed and sent back to its author; the next revision replaces it.</summary>
    public const string Returned = "RETURNED";
    public const string Superseded = "SUPERSEDED";
    public const string Void = "VOID";

    /// <summary>A revision still being worked on: no second one may start beside it.</summary>
    public static bool InMotion(string state) => state is InPreparation or InReview or Received or Correcting;
}

/// <summary>Whether a revision's current files have all passed scanning. Set by <see cref="FileProcessor"/>.</summary>
public static class FilesStates
{
    public const string Processing = "PROCESSING";
    public const string Ready = "READY";
    public const string Rejected = "REJECTED";
    /// <summary>Started ahead of its files: nothing to scan yet, and nothing to review.</summary>
    public const string None = "NONE";
}

/// <summary>A file in object storage. Its key is never reused, so a stored file is never overwritten.</summary>
public sealed class StoredFile
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    /// <summary>Empty for a file that came in on a transmittal as something unplanned, until it is registered.</summary>
    public Guid? DocumentId { get; set; }
    /// <summary>The unplanned transmittal item the file came in on, if any.</summary>
    public Guid? TransmittalItemId { get; set; }
    /// <summary>The revision the file is attached to; null while it is uploaded but not yet used.</summary>
    public Guid? RevisionId { get; set; }
    /// <summary>Where the bytes are in object storage: tenant id / project id / file id. See <see cref="FileStorage.KeyFor"/>.</summary>
    public required string ObjectKey { get; set; }
    public required string Name { get; set; }
    public required string ContentType { get; set; }
    public long Size { get; set; }
    /// <summary>SHA-256 the uploader declared, lowercase hex. The worker checks the stored bytes against it.</summary>
    public required string Sha256 { get; set; }
    /// <summary>NATIVE (editable source), RENDITION (the PDF people read), or a copy derived from one.</summary>
    public string Kind { get; set; } = FileKinds.Native;
    /// <summary>For a stamped or watermarked copy: the file it was made from, which is never changed.</summary>
    public Guid? DerivedFromId { get; set; }
    /// <summary>Which submission of its revision it belongs to.</summary>
    public int Submission { get; set; } = 1;
    /// <summary>Where the file is in upload and scanning; see <see cref="FileStatuses"/>.</summary>
    public string Status { get; set; } = FileStatuses.AwaitingUpload;
    /// <summary>What the bytes are, from their first bytes rather than the name.</summary>
    public string? DetectedType { get; set; }
    /// <summary>Why the file was rejected or found infected; null otherwise.</summary>
    public string? StatusDetail { get; set; }
    public Guid UploadedById { get; set; }
    public required string UploadedByName { get; set; }
    public Instant CreatedAt { get; set; }
    /// <summary>When the worker finished checking the file; null until then.</summary>
    public Instant? ScannedAt { get; set; }
}

/// <summary>What role a <see cref="StoredFile"/> plays for its revision.</summary>
public static class FileKinds
{
    public const string Native = "NATIVE";
    public const string Rendition = "RENDITION";
    /// <summary>The rendition with the release stamp: number, revision, status, date.</summary>
    public const string Stamped = "STAMPED";
    /// <summary>A stamped copy marked SUPERSEDED once a later revision is released.</summary>
    public const string Superseded = "SUPERSEDED";
    /// <summary>Proof filed against the revision: a party's returned stamped copy, the email that carried it.</summary>
    public const string Evidence = "EVIDENCE";
}

/// <summary>The steps a <see cref="StoredFile"/> goes through: awaiting upload, processing (being scanned), then clean, infected or rejected.</summary>
public static class FileStatuses
{
    public const string AwaitingUpload = "AWAITING_UPLOAD";
    public const string Processing = "PROCESSING";
    public const string Clean = "CLEAN";
    public const string Infected = "INFECTED";
    public const string Rejected = "REJECTED";
}

/// <summary>A person named on a document whose confidentiality restricts it to named readers.</summary>
public sealed class DocumentAccess
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid DocumentId { get; set; }
    public Guid UserId { get; set; }
    /// <summary>The user who gave this person access.</summary>
    public Guid AddedById { get; set; }
    public string? AddedByName { get; set; }
    public string? Reason { get; set; }
    public Instant CreatedAt { get; set; }
}
