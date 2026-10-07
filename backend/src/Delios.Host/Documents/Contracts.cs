namespace Delios.Host.Documents;

public sealed record RegisterDocumentRequest(
    string? Title, string? DeliverableType, string? DocType, string? Discipline,
    string? Originator = null, string? Subproject = null, string? ContractRef = null,
    string? Criticality = null, string? Confidentiality = null, string? RetentionClass = null,
    DateOnly? ReceivedDate = null, DateOnly? PlannedDate = null, string? Kind = null);

public sealed record UploadRequest(string? FileName, long Size, string? ContentType, string? Sha256);

/// <param name="Series">A series of the document's revision scheme; empty continues the latest one.</param>
public sealed record StartRevisionRequest(
    Guid[]? FileIds, string? ReasonForRevision = null, string? ChangeDescription = null, string? Series = null);

public sealed record DocumentSummary(
    Guid Id, string Number, string Title, string DeliverableType, string DocType, string Discipline,
    string? Originator, string State, string Kind, bool IsPlaceholder, string? Confidentiality,
    string? LatestRevision, string? LatestRevisionState, DateTimeOffset UpdatedAt);

public sealed record FileView(
    Guid Id, string Name, string Kind, string ContentType, long Size, string Sha256, string Status,
    string? StatusDetail, string? DetectedType, DateTimeOffset CreatedAt);

public sealed record RevisionView(
    Guid Id, string Value, string Series, string State, string FilesState, string? ReasonForRevision,
    string? ChangeDescription, string AuthoredByName, DateTimeOffset CreatedAt, IReadOnlyList<FileView> Files);

public sealed record DocumentView(
    Guid Id, string Number, string Title, string DeliverableType, string DocType, string Discipline,
    string? Originator, string? Subproject, string? ContractRef, string? Criticality, string? Confidentiality,
    string? RetentionClass, string State, string Kind, bool IsPlaceholder, DateOnly? ReceivedDate, DateOnly? PlannedDate,
    string CreatedByName, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, IReadOnlyList<RevisionView> Revisions);

public sealed record DocumentPage(IReadOnlyList<DocumentSummary> Items, string? Next);

public sealed record UploadTicket(Guid FileId, string Method, string Url, IReadOnlyDictionary<string, string> Headers, DateTimeOffset ExpiresAt);

public sealed record DownloadTicket(string Url, DateTimeOffset ExpiresAt);
