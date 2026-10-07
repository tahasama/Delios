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
    public string Status { get; set; } = ValueStatus.Active;
    public int Sort { get; set; }
    /// <summary>What a value means for the system, where it means something: a default flag, a mapping.</summary>
    public JsonDocument? Props { get; set; }
}

public static class ValueStatus
{
    public const string Active = "ACTIVE";
    public const string Retired = "RETIRED";
}

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
    public List<SchemeField> Fields { get; set; } = [];
}

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
    public int Next { get; set; }
}

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
    public string State { get; set; } = DocumentStates.Planned;
    /// <summary>DOCUMENT is revised; RECORD is fixed evidence with one revision.</summary>
    public string Kind { get; set; } = DocumentKinds.Document;
    /// <summary>A register entry with no revision yet.</summary>
    public bool IsPlaceholder { get; set; } = true;
    public LocalDate? ReceivedDate { get; set; }
    public LocalDate? PlannedDate { get; set; }
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

    public Identity.DocumentFacts Facts => new(DeliverableType, DocType, Discipline, Criticality, Confidentiality);
}

public static class DocumentStates
{
    public const string Planned = "PLANNED";
    public const string Active = "ACTIVE";
    public const string Withdrawn = "WITHDRAWN";
    public const string Cancelled = "CANCELLED";
    public const string Archived = "ARCHIVED";
}

public static class DocumentKinds
{
    public const string Document = "DOCUMENT";
    public const string Record = "RECORD";
}

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
    public string State { get; set; } = RevisionStates.InPreparation;
    /// <summary>Whether every file has passed scanning: PROCESSING, READY or REJECTED.</summary>
    public string FilesState { get; set; } = FilesStates.Processing;
    public string? ReasonForRevision { get; set; }
    public string? ChangeDescription { get; set; }
    public Guid AuthoredById { get; set; }
    public required string AuthoredByName { get; set; }
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

public static class RevisionStates
{
    public const string InPreparation = "IN_PREPARATION";
    public const string InReview = "IN_REVIEW";
    public const string Released = "RELEASED";
    /// <summary>Reviewed and sent back to its author; the next revision replaces it.</summary>
    public const string Returned = "RETURNED";
    public const string Superseded = "SUPERSEDED";
    public const string Void = "VOID";

    /// <summary>A revision still being worked on: no second one may start beside it.</summary>
    public static bool InMotion(string state) => state is InPreparation or InReview;
}

public static class FilesStates
{
    public const string Processing = "PROCESSING";
    public const string Ready = "READY";
    public const string Rejected = "REJECTED";
}

/// <summary>A file in object storage. Its key is never reused, so a stored file is never overwritten.</summary>
public sealed class StoredFile
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid DocumentId { get; set; }
    public Guid? RevisionId { get; set; }
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
    public string Status { get; set; } = FileStatuses.AwaitingUpload;
    /// <summary>What the bytes are, from their first bytes rather than the name.</summary>
    public string? DetectedType { get; set; }
    public string? StatusDetail { get; set; }
    public Guid UploadedById { get; set; }
    public required string UploadedByName { get; set; }
    public Instant CreatedAt { get; set; }
    public Instant? ScannedAt { get; set; }
}

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
    public Guid AddedById { get; set; }
    public Instant CreatedAt { get; set; }
}
