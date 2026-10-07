using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>
/// The register's acts: putting a document in it, and establishing a revision
/// with its files. Every rule is checked here, not on the screen: an importer, a
/// script or a stale tab arrives here too.
/// </summary>
public sealed class DocumentService(
    DeliosDbContext db, Numbering numbering, FileStorage storage, AuditLog audit, IClock clock,
    IOptions<StorageOptions> storageOptions)
{
    /// <summary>
    /// Registers a new document: checks the title, the coded values and the fields the deliverable type requires,
    /// checks the person may create it, allocates its number, saves it and writes the audit record.
    /// Returns the document, or a problem response saying what to fix. Called by the POST /documents endpoint.
    /// </summary>
    public async Task<(Document? Document, IResult? Problem)> RegisterAsync(
        ProjectAccess access, RegisterDocumentRequest request, CancellationToken cancellationToken)
    {
        // Values typed or pasted with spaces around them still match the published lists.
        request = request with { DeliverableType = request.DeliverableType?.Trim(), DocType = request.DocType?.Trim(), Discipline = request.Discipline?.Trim() };
        var title = request.Title?.Trim() ?? "";
        if (title.Length == 0)
            return Fail(Problems.Invalid("TITLE_REQUIRED", "A descriptive title is required."));
        if (string.IsNullOrWhiteSpace(request.DeliverableType))
            return Fail(Problems.Invalid("DELIVERABLE_TYPE_REQUIRED", "Deliverable type is required: it picks the numbering scheme."));
        if (string.IsNullOrWhiteSpace(request.DocType))
            return Fail(Problems.Invalid("DOC_TYPE_REQUIRED", "Document type is required."));
        if (string.IsNullOrWhiteSpace(request.Discipline))
            return Fail(Problems.Invalid("DISCIPLINE_REQUIRED", "Exactly one discipline is required."));

        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        if (Titles.IsGeneric(title, catalog.GenericTitleWords()))
            return Fail(Problems.Invalid("TITLE_GENERIC",
                "The title only repeats the document type. Say what it shows, and of what.", new { title }));
        var confidentiality = Blank(request.Confidentiality) ?? catalog.DefaultOf(ValueSets.Confidentiality);
        var facts = new DocumentFacts(request.DeliverableType, request.DocType, request.Discipline,
            Blank(request.Criticality), confidentiality);
        if (!access.IsInternal || !access.Allows(Verbs.Create, facts))
        {
            return Fail(Problems.Forbidden("CREATE_NOT_ALLOWED", access.IsInternal
                ? "Your function on this project cannot register this kind of document."
                : "Another party cannot register documents. Document Control issues a placeholder to your organization first."));
        }

        // Every coded value must be one the organization has published, and still active.
        var coded = new (string Field, string Set, string? Value)[]
        {
            ("deliverableType", ValueSets.DeliverableTypes, request.DeliverableType),
            ("docType", ValueSets.DocumentTypes, request.DocType),
            ("discipline", ValueSets.Disciplines, request.Discipline),
            ("subproject", ValueSets.Subprojects, Blank(request.Subproject)),
            ("contractRef", ValueSets.PurchaseOrders, Blank(request.ContractRef)),
            ("criticality", ValueSets.Criticality, Blank(request.Criticality)),
            ("confidentiality", ValueSets.Confidentiality, confidentiality),
            ("retentionClass", ValueSets.RetentionClasses, Blank(request.RetentionClass)),
        };
        foreach (var (field, set, value) in coded)
        {
            if (value is not null && !catalog.IsActive(set, value))
            {
                return Fail(Problems.Invalid("VALUE_NOT_PUBLISHED",
                    $"{value} is not a published {field}. Choose one from the list, or ask an administrator to publish it.",
                    new { field, value }));
            }
        }

        var originator = Blank(request.Originator);
        if (originator is not null && !await db.Parties.AnyAsync(p => p.Code == originator && p.Active, cancellationToken))
        {
            return Fail(Problems.Invalid("VALUE_NOT_PUBLISHED", $"{originator} is not an active party.",
                new { field = "originator", value = originator }));
        }

        // What this deliverable type insists on: a document from another party
        // says who sent it, under which contract, and when it arrived.
        var given = new Dictionary<string, bool>
        {
            ["originator"] = originator is not null,
            ["contractRef"] = Blank(request.ContractRef) is not null,
            ["receivedDate"] = request.ReceivedDate is not null,
            ["subproject"] = Blank(request.Subproject) is not null,
            ["criticality"] = Blank(request.Criticality) is not null,
            ["plannedDate"] = request.PlannedDate is not null,
        };
        var missing = catalog.RequiredFieldsOf(request.DeliverableType)
            .Where(f => !given.GetValueOrDefault(f)).ToList();
        if (missing.Count > 0)
        {
            return Fail(Problems.Invalid("FIELDS_REQUIRED",
                $"This deliverable type needs {string.Join(" and ", missing)} before it can be registered.",
                new { fields = missing }));
        }

        var kind = request.Kind?.ToUpperInvariant() == DocumentKinds.Record ? DocumentKinds.Record : DocumentKinds.Document;
        var allocation = await numbering.AllocateAsync(access.Project.TenantId, access.Project.Id, request.DeliverableType,
            new NumberFields(access.Project.Code, Blank(request.Subproject), originator, Blank(request.ContractRef),
                request.Discipline, request.DocType), cancellationToken);
        if (allocation is Allocation.NoScheme)
        {
            return Fail(Problems.Invalid("NO_NUMBERING_SCHEME",
                $"No numbering scheme is routed for {request.DeliverableType}.", new { deliverableType = request.DeliverableType }));
        }
        if (allocation is Allocation.MissingField(var label))
        {
            return Fail(Problems.Invalid("NUMBER_FIELD_MISSING",
                $"The number for this kind of document is built from {label.ToLowerInvariant()}, so it has to be chosen first.",
                new { field = label }));
        }

        var now = clock.GetCurrentInstant();
        var document = new Document
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            Number = ((Allocation.Allocated)allocation).Number,
            Title = title,
            DeliverableType = request.DeliverableType,
            DocType = request.DocType,
            Discipline = request.Discipline,
            Originator = originator,
            Subproject = Blank(request.Subproject),
            ContractRef = Blank(request.ContractRef),
            Criticality = Blank(request.Criticality),
            Confidentiality = confidentiality,
            RetentionClass = Blank(request.RetentionClass) ?? catalog.RetentionFor(Blank(request.Criticality)),
            Kind = kind,
            ReceivedDate = request.ReceivedDate is { } received ? LocalDate.FromDateOnly(received) : null,
            PlannedDate = request.PlannedDate is { } planned ? LocalDate.FromDateOnly(planned) : null,
            CreatedById = access.UserId,
            CreatedByName = access.UserName,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Documents.Add(document);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "REGISTER_ENTRY", "Document", document.Id,
            document.Number,
            $"{(kind == DocumentKinds.Record ? "Record, fixed evidence never revised" : "Document, placeholder")}; state Planned. Number allocated by the system.",
            access.Project.Id, cancellationToken);
        return (document, null);
    }

    /// <summary>
    /// Records a file someone is about to upload to a document (status awaiting upload) and returns a signed link
    /// the browser uses to send the bytes straight to object storage. The file is attached to a revision later.
    /// </summary>
    public async Task<(UploadTicket? Ticket, IResult? Problem)> RequestUploadAsync(
        ProjectAccess access, Guid documentId, UploadRequest request, CancellationToken cancellationToken)
    {
        var (document, problem) = await ContributableAsync(access, documentId, cancellationToken);
        if (problem is not null) return (null, problem);

        var (declared, invalid) = Uploads.Check(request, storageOptions.Value.MaxFileBytes);
        if (invalid is not null) return (null, invalid);
        var (name, contentType, sha256, isPdf) = declared!;
        var file = new StoredFile
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            DocumentId = document!.Id,
            ObjectKey = "",
            Name = name,
            ContentType = contentType,
            Size = request.Size,
            Sha256 = sha256,
            Kind = isPdf ? FileKinds.Rendition : FileKinds.Native,
            UploadedById = access.UserId,
            UploadedByName = access.UserName,
        };
        file.ObjectKey = FileStorage.KeyFor(file.TenantId, file.ProjectId, file.Id);
        db.StoredFiles.Add(file);
        await db.SaveChangesAsync(cancellationToken);

        var link = storage.PresignUpload(file.ObjectKey, contentType);
        return (new UploadTicket(file.Id, "PUT", link.Url, link.Headers, link.ExpiresAt.ToDateTimeOffset()), null);
    }

    /// <summary>
    /// Starts the document's next revision from files already uploaded: works out its value from the revision scheme,
    /// attaches the files and queues them for scanning. Refused while an earlier revision is still in motion,
    /// and for a record that already has its one revision.
    /// </summary>
    public async Task<(Revision? Revision, IResult? Problem)> StartRevisionAsync(
        ProjectAccess access, Guid documentId, StartRevisionRequest request, CancellationToken cancellationToken)
    {
        var (document, problem) = await ContributableAsync(access, documentId, cancellationToken);
        if (problem is not null) return (null, problem);

        var existing = await db.Revisions.Where(r => r.DocumentId == document!.Id)
            .OrderBy(r => r.CreatedAt).ToListAsync(cancellationToken);
        if (document!.Kind == DocumentKinds.Record && existing.Count > 0)
            return (null, Problems.Conflict("RECORD_IS_FIXED", "A record is fixed evidence: it has one revision and is never revised."));
        if (existing.LastOrDefault() is { } latest && RevisionStates.InMotion(latest.State))
        {
            return (null, Problems.Conflict("REVISION_IN_MOTION",
                $"Revision {latest.Value} is still {latest.State.ToLowerInvariant().Replace('_', ' ')}; finish it first.",
                new { revision = latest.Value, state = latest.State }));
        }

        var (files, filesProblem) = await UploadedFilesAsync(access, document, request.FileIds, cancellationToken);
        if (filesProblem is not null) return (null, filesProblem);

        var scheme = await RevisionSchemeForAsync(document.DeliverableType, cancellationToken);
        if (scheme is null)
        {
            return (null, Problems.Invalid("NO_REVISION_SCHEME",
                "No revision scheme applies to this deliverable type. An administrator sets one up.",
                new { deliverableType = document.DeliverableType }));
        }
        var next = RevisionValues.Next(scheme, existing.Select(r => (r.Series, r.Value)).ToList(), Blank(request.Series));
        switch (next)
        {
            case NextValue.UnknownSeries(var unknown):
                return (null, Problems.Invalid("REVISION_SERIES_UNKNOWN",
                    $"{unknown} is not a series of the {scheme.Name} revision scheme.",
                    new { series = unknown, available = scheme.Series.Select(x => x.Code) }));
            case NextValue.Backwards(var from, var to):
                return (null, Problems.Conflict("REVISION_SERIES_BACKWARDS",
                    $"The document is already in the {from} series and cannot go back to {to}.", new { from, to }));
        }
        var value = ((NextValue.Value)next).Text;

        var now = clock.GetCurrentInstant();
        var revision = new Revision
        {
            TenantId = document.TenantId,
            ProjectId = document.ProjectId,
            DocumentId = document.Id,
            Value = value,
            Series = Blank(request.Series) ?? existing.LastOrDefault()?.Series ?? scheme.Series[0].Code,
            ReasonForRevision = Blank(request.ReasonForRevision) ?? (existing.Count == 0 ? "First issue" : null),
            ChangeDescription = Blank(request.ChangeDescription) ?? (existing.Count == 0 ? "Initial content" : null),
            AuthoredById = access.UserId,
            AuthoredByName = access.UserName,
            AuthoredByParty = access.PartyCode,
            CreatedAt = now,
            State = await NeedsAcceptanceAsync(access, cancellationToken) ? RevisionStates.Received : RevisionStates.InPreparation,
            Submissions = [new SubmissionRecord { Number = 1, SubmittedAt = now, SubmittedByName = access.UserName }],
        };
        db.Revisions.Add(revision);
        Bind(files!, revision);
        document.IsPlaceholder = false;
        document.LatestRevisionId = revision.Id;
        document.LatestRevisionValue = revision.Value;
        document.LatestRevisionState = revision.State;
        document.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);

        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "REVISION_ESTABLISHED", "Revision", revision.Id,
            $"{document.Number} rev {revision.Value}", $"{files!.Count} file(s) uploaded; scanning before use.",
            document.ProjectId, cancellationToken);
        revision.Files = files!;
        return (revision, null);
    }

    /// <summary>
    /// Send corrected files for a revision Document Control returned without
    /// asking for a new one. The returned submission is kept; this one replaces
    /// it under the same revision value.
    /// </summary>
    public async Task<(Revision? Revision, IResult? Problem)> ResubmitAsync(
        ProjectAccess access, Guid documentId, Guid revisionId, StartRevisionRequest request, CancellationToken cancellationToken)
    {
        var (document, problem) = await ContributableAsync(access, documentId, cancellationToken);
        if (problem is not null) return (null, problem);
        var revision = await db.Revisions.Include(r => r.Files)
            .SingleOrDefaultAsync(r => r.Id == revisionId && r.DocumentId == documentId, cancellationToken);
        if (revision is null) return (null, Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        if (revision.State != RevisionStates.Correcting)
        {
            return (null, Problems.Conflict("NOT_RETURNED_FOR_CORRECTION",
                $"Revision {revision.Value} was not returned for a correction; it is {revision.State.ToLowerInvariant().Replace('_', ' ')}.",
                new { state = revision.State }));
        }
        var (files, filesProblem) = await UploadedFilesAsync(access, document!, request.FileIds, cancellationToken);
        if (filesProblem is not null) return (null, filesProblem);

        var now = clock.GetCurrentInstant();
        revision.Submission++;
        revision.Submissions.Add(new SubmissionRecord { Number = revision.Submission, SubmittedAt = now, SubmittedByName = access.UserName });
        revision.FilesState = FilesStates.Processing;
        revision.State = await NeedsAcceptanceAsync(access, cancellationToken) ? RevisionStates.Received : RevisionStates.InPreparation;
        revision.ReturnedAt = null;
        revision.ReturnedReason = null;
        Bind(files!, revision);
        document!.LatestRevisionState = revision.State;
        document.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "RESUBMITTED", "Revision", revision.Id,
            $"{document.Number} rev {revision.Value}", $"Submission {revision.Submission}: {files!.Count} corrected file(s).",
            document.ProjectId, cancellationToken);
        return (revision, null);
    }

    /// <summary>Files this person uploaded for the document and has not used yet, each arrived and as large as declared.</summary>
    private async Task<(List<StoredFile>? Files, IResult? Problem)> UploadedFilesAsync(
        ProjectAccess access, Document document, Guid[]? requested, CancellationToken cancellationToken)
    {
        var fileIds = requested?.Distinct().ToList() ?? [];
        if (fileIds.Count is 0 or > 20)
            return (null, Problems.Invalid("FILES_REQUIRED", "A revision carries between 1 and 20 files."));
        var files = await db.StoredFiles
            .Where(f => fileIds.Contains(f.Id) && f.DocumentId == document.Id && f.UploadedById == access.UserId
                && f.Status == FileStatuses.AwaitingUpload && f.RevisionId == null)
            .ToListAsync(cancellationToken);
        if (files.Count != fileIds.Count)
        {
            return (null, Problems.Invalid("FILE_NOT_AVAILABLE",
                "Some files were not requested for this document by you, or are already used.",
                new { fileIds = fileIds.Except(files.Select(f => f.Id)) }));
        }
        foreach (var file in files)
        {
            if (await Uploads.ArrivedAsync(storage, file, cancellationToken) is { } missing) return (null, missing);
        }
        return (files, null);
    }

    /// <summary>
    /// Attaches the files to the revision's current submission, marks them as processing, and queues a
    /// <see cref="FileUploaded"/> message for each through the outbox (a table of messages saved in the same
    /// transaction and sent to the queue afterwards, so a message is never lost or sent for a change that rolled back).
    /// </summary>
    private void Bind(List<StoredFile> files, Revision revision)
    {
        foreach (var file in files)
        {
            file.RevisionId = revision.Id;
            file.Submission = revision.Submission;
            file.Status = FileStatuses.Processing;
            db.Enqueue(FileUploaded.RoutingKey, new FileUploaded(file.TenantId, file.Id));
        }
    }

    /// <summary>
    /// What another organization sends in is accepted by Document Control before
    /// anybody reviews it. Where nobody holds that function there is nobody to
    /// accept it, and it goes straight on.
    /// </summary>
    private async Task<bool> NeedsAcceptanceAsync(ProjectAccess access, CancellationToken cancellationToken) =>
        !access.IsInternal && await db.Memberships.AnyAsync(m => m.ProjectId == access.Project.Id && m.Active && m.Function!.Active
            && m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control))
            && db.Users.Any(u => u.Id == m.UserId && u.Active), cancellationToken);

    /// <summary>
    /// Someone may add to a document when their function may create or revise it,
    /// and, for another party, only on documents that party produces.
    /// </summary>
    private async Task<(Document? Document, IResult? Problem)> ContributableAsync(
        ProjectAccess access, Guid documentId, CancellationToken cancellationToken)
    {
        var document = await DocumentQueries.Visible(db, access, await RestrictedAsync(cancellationToken))
            .SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
        if (document is null) return (null, Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document."));
        var may = (access.Allows(Verbs.Create, document.Facts) || access.Allows(Verbs.Revise, document.Facts))
            && (access.IsInternal || document.Originator == access.PartyCode);
        if (!may)
            return (null, Problems.Forbidden("CONTRIBUTE_NOT_ALLOWED", "Your function on this project cannot add to this document."));
        if (document.State is not (DocumentStates.Planned or DocumentStates.Active))
        {
            return (null, Problems.Conflict("DOCUMENT_NOT_OPEN",
                $"The document is {document.State.ToLowerInvariant()}.", new { state = document.State }));
        }
        return (document, null);
    }

    /// <summary>The scheme routed to the deliverable type, else the organization's default.</summary>
    private async Task<RevisionScheme?> RevisionSchemeForAsync(string deliverableType, CancellationToken cancellationToken) =>
        await db.RevisionSchemeRoutings.AsNoTracking().Where(r => r.DeliverableType == deliverableType)
            .Select(r => r.Scheme).SingleOrDefaultAsync(cancellationToken)
        ?? await db.RevisionSchemes.AsNoTracking().SingleOrDefaultAsync(s => s.IsDefault, cancellationToken);

    /// <summary>The confidentiality levels that restrict a document to named readers. Passed to <see cref="DocumentQueries.Visible"/>.</summary>
    public async Task<IReadOnlyList<string>> RestrictedAsync(CancellationToken cancellationToken) =>
        (await Catalog.LoadAsync(db, cancellationToken)).RestrictedLevels();

    /// <summary>The trimmed text, or null when it is null, empty or only spaces.</summary>
    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    /// <summary>Shorthand for returning a problem response with no document.</summary>
    private static (Document?, IResult?) Fail(IResult problem) => (null, problem);
}

/// <summary>
/// Shared database queries for documents. Used by the endpoints and <see cref="DocumentService"/> so that
/// every read applies the same visibility rules.
/// </summary>
public static class DocumentQueries
{
    /// <summary>
    /// The documents of the project this person may read. Another party sees what
    /// it produces, and what was transmitted to its people. A restricted
    /// confidentiality level is read by the people named on the document, its
    /// creator, whoever it was transmitted to, and Document Control.
    /// </summary>
    public static IQueryable<Document> Visible(DeliosDbContext db, ProjectAccess access, IReadOnlyList<string> restricted)
    {
        var query = db.Documents.Where(d => d.ProjectId == access.Project.Id);
        var me = access.UserId;
        // What was sent to you, you can read: a transmittal names its readers.
        var sentToMe = db.TransmittalItems
            .Where(i => db.TransmittalRecipients.Any(r => r.TransmittalId == i.TransmittalId && r.UserId == me))
            .Select(i => i.DocumentId);
        if (!access.IsInternal)
        {
            query = query.Where(d => d.Originator == access.PartyCode || sentToMe.Contains(d.Id));
        }
        if (!access.Holds(Verbs.Control) && restricted.Count > 0)
        {
            query = query.Where(d => d.Confidentiality == null || !restricted.Contains(d.Confidentiality)
                || d.CreatedById == me || db.DocumentAccess.Any(a => a.DocumentId == d.Id && a.UserId == me)
                || sentToMe.Contains(d.Id));
        }
        return query;
    }
}
