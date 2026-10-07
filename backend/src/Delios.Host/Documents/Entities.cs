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
    public string Series { get; set; } = RevisionSeries.Design;
    public string State { get; set; } = RevisionStates.InPreparation;
    /// <summary>Whether every file has passed scanning: PROCESSING, READY or REJECTED.</summary>
    public string FilesState { get; set; } = FilesStates.Processing;
    public string? ReasonForRevision { get; set; }
    public string? ChangeDescription { get; set; }
    public Guid AuthoredById { get; set; }
    public required string AuthoredByName { get; set; }
    public string? AuthoredByParty { get; set; }
    public Instant CreatedAt { get; set; }
    public uint Version { get; set; }
    public List<StoredFile> Files { get; set; } = [];
}

public static class RevisionSeries
{
    public const string Design = "DESIGN";
    public const string Execution = "EXECUTION";
}

public static class RevisionStates
{
    public const string InPreparation = "IN_PREPARATION";
    public const string InReview = "IN_REVIEW";
    public const string Released = "RELEASED";
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
    /// <summary>NATIVE (editable source) or RENDITION (the PDF people read).</summary>
    public string Kind { get; set; } = FileKinds.Native;
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
