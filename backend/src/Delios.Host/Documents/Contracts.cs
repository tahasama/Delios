namespace Delios.Host.Documents;

/// <summary>
/// The JSON body a client sends to register a new document (POST /documents). Coded fields hold codes from the
/// organization's published lists; optional fields may be required by the deliverable type.
/// </summary>
public sealed record RegisterDocumentRequest(
    string? Title, string? DeliverableType, string? DocType, string? Discipline,
    string? Originator = null, string? Subproject = null, string? ContractRef = null,
    string? Criticality = null, string? Confidentiality = null, string? RetentionClass = null,
    DateOnly? ReceivedDate = null, DateOnly? PlannedDate = null, string? Kind = null);

/// <summary>The JSON body a client sends to ask for an upload link: the file's name, size in bytes, content type and SHA-256.</summary>
public sealed record UploadRequest(string? FileName, long Size, string? ContentType, string? Sha256);

/// <summary>
/// The JSON body for starting a new revision, or for resubmitting a returned one: the uploaded files to attach
/// and, optionally, why the revision was made and what changed.
/// </summary>
/// <param name="Series">A series of the document's revision scheme; empty continues the latest one.</param>
public sealed record StartRevisionRequest(
    Guid[]? FileIds, string? ReasonForRevision = null, string? ChangeDescription = null, string? Series = null);

/// <summary>One row of the document register list, as returned by GET /documents.</summary>
public sealed record DocumentSummary(
    Guid Id, string Number, string Title, string DeliverableType, string DocType, string Discipline,
    string? Originator, string State, string Kind, bool IsPlaceholder, string? Confidentiality,
    string? LatestRevision, string? LatestRevisionState, DateTimeOffset UpdatedAt);

/// <summary>A file of a revision as the API shows it. <c>Submission</c> is the submission of the revision it was sent with.</summary>
public sealed record FileView(
    Guid Id, string Name, string Kind, string ContentType, long Size, string Sha256, string Status,
    string? StatusDetail, string? DetectedType, DateTimeOffset CreatedAt, Guid? DerivedFromId, int Submission);

/// <summary>One set of files sent in under a revision, and Document Control's outcome on it.</summary>
public sealed record SubmissionView(int Number, DateTimeOffset SubmittedAt, string SubmittedBy, string? Outcome, string? Note,
    string? DecidedBy, DateTimeOffset? DecidedAt);

/// <summary>A revision as the API shows it, with its submissions and files.</summary>
public sealed record RevisionView(
    Guid Id, string Value, string Series, string State, string FilesState, string? ReasonForRevision,
    string? ChangeDescription, string AuthoredByName, DateTimeOffset CreatedAt, string? StatusCode,
    DateTimeOffset? ReleasedAt, DateTimeOffset? SupersededAt, string? ReturnedReason, int Submission, string? ControlOutcome,
    IReadOnlyList<SubmissionView> Submissions, IReadOnlyList<FileView> Files, Guid AuthoredById, string? AuthoredByParty,
    string? ReleasedByName, DateTimeOffset? ReturnedAt);

/// <summary>A full document as the API shows it, with every revision; returned by GET /documents/{id} and after changes.</summary>
public sealed record DocumentView(
    Guid Id, string Number, string Title, string DeliverableType, string DocType, string Discipline,
    string? Originator, string? Subproject, string? ContractRef, string? Criticality, string? Confidentiality,
    string? RetentionClass, string State, string Kind, bool IsPlaceholder, DateOnly? ReceivedDate, DateOnly? PlannedDate,
    string CreatedByName, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, IReadOnlyList<RevisionView> Revisions, Guid CreatedById);

/// <summary>One page of the register. <c>Next</c> is the value to pass as <c>after</c> for the next page; null on the last page.</summary>
public sealed record DocumentPage(IReadOnlyList<DocumentSummary> Items, string? Next);

/// <summary>
/// What the client needs to upload a file straight to object storage: the new file's id, the HTTP method,
/// a signed URL, the headers to send, and when the link stops working.
/// </summary>
public sealed record UploadTicket(Guid FileId, string Method, string Url, IReadOnlyDictionary<string, string> Headers, DateTimeOffset ExpiresAt);

/// <summary>A short-lived signed URL the browser uses to download a file directly from object storage.</summary>
public sealed record DownloadTicket(string Url, DateTimeOffset ExpiresAt);
