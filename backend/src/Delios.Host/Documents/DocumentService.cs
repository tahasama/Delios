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
            PreviousNumber = Blank(request.PreviousNumber),
            LegacyScheme = Blank(request.LegacyScheme),
            AppVersion = Blank(request.AppVersion),
            Extras = OwnFields.Write(null, request.Extras),
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
    /// Changes a document's metadata. Each change is written to the audit trail with the field, the previous and the
    /// new value. Coded values must be published; the title must say what the document is.
    /// </summary>
    public async Task<(Document? Document, IResult? Problem)> UpdateAsync(
        ProjectAccess access, Guid documentId, UpdateDocumentRequest request, CancellationToken cancellationToken)
    {
        var document = await DocumentQueries.Visible(db, access, await RestrictedAsync(cancellationToken))
            .SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
        if (document is null) return Fail(Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document."));
        if (!access.IsInternal || !(access.Allows(Verbs.Create, document.Facts) || access.Allows(Verbs.Revise, document.Facts)
            || access.Allows(Verbs.Control, document.Facts)))
            return Fail(Problems.Forbidden("EDIT_NOT_ALLOWED", "Your function on this project cannot change this document's details."));
        if (document.State is not (DocumentStates.Planned or DocumentStates.Active))
            return Fail(Problems.Conflict("DOCUMENT_NOT_OPEN", $"The document is {document.State.ToLowerInvariant()}.", new { state = document.State }));

        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var sets = new Dictionary<string, string>
        {
            ["docType"] = ValueSets.DocumentTypes,
            ["discipline"] = ValueSets.Disciplines,
            ["subproject"] = ValueSets.Subprojects,
            ["contractRef"] = ValueSets.PurchaseOrders,
            ["criticality"] = ValueSets.Criticality,
            ["confidentiality"] = ValueSets.Confidentiality,
            ["retentionClass"] = ValueSets.RetentionClasses,
        };
        var changes = new List<string>();
        foreach (var (field, raw) in request.Changes ?? [])
        {
            var value = Blank(raw);
            string? before;
            switch (field)
            {
                case "title":
                    if (value is null) return Fail(Problems.Invalid("TITLE_REQUIRED", "A descriptive title is required."));
                    if (Titles.IsGeneric(value, catalog.GenericTitleWords()))
                        return Fail(Problems.Invalid("TITLE_GENERIC", "The title only repeats the document type. Say what it shows, and of what.", new { title = value }));
                    before = document.Title; document.Title = value; break;
                case "docType" or "discipline":
                    if (value is null) return Fail(Problems.Invalid("FIELD_REQUIRED", $"{field} is required.", new { field }));
                    if (!catalog.IsActive(sets[field], value))
                        return Fail(Problems.Invalid("VALUE_NOT_PUBLISHED", $"{value} is not a published {field}.", new { field, value }));
                    if (field == "docType") { before = document.DocType; document.DocType = value; }
                    else { before = document.Discipline; document.Discipline = value; }
                    break;
                case "subproject" or "contractRef" or "criticality" or "confidentiality" or "retentionClass":
                    if (value is not null && !catalog.IsActive(sets[field], value))
                        return Fail(Problems.Invalid("VALUE_NOT_PUBLISHED", $"{value} is not a published {field}.", new { field, value }));
                    (before, value) = field switch
                    {
                        "subproject" => (document.Subproject, document.Subproject = value),
                        "contractRef" => (document.ContractRef, document.ContractRef = value),
                        "criticality" => (document.Criticality, document.Criticality = value),
                        "confidentiality" => (document.Confidentiality, document.Confidentiality = value ?? catalog.DefaultOf(ValueSets.Confidentiality)),
                        _ => (document.RetentionClass, document.RetentionClass = value),
                    };
                    break;
                case "originator":
                    if (value is not null && !await db.Parties.AnyAsync(p => p.Code == value && p.Active, cancellationToken))
                        return Fail(Problems.Invalid("VALUE_NOT_PUBLISHED", $"{value} is not an active party.", new { field, value }));
                    before = document.Originator; document.Originator = value; break;
                case "receivedDate" or "plannedDate":
                    LocalDate? date = null;
                    if (value is not null)
                    {
                        if (!DateOnly.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var parsed))
                            return Fail(Problems.Invalid("DATE_INVALID", $"{value} is not a date.", new { field, value }));
                        date = LocalDate.FromDateOnly(parsed);
                    }
                    if (field == "receivedDate") { before = document.ReceivedDate?.ToString(); document.ReceivedDate = date; }
                    else { before = document.PlannedDate?.ToString(); document.PlannedDate = date; }
                    value = date?.ToString();
                    break;
                case "previousNumber" or "legacyScheme" or "appVersion":
                    (before, value) = field switch
                    {
                        "previousNumber" => (document.PreviousNumber, document.PreviousNumber = value),
                        "legacyScheme" => (document.LegacyScheme, document.LegacyScheme = value),
                        _ => (document.AppVersion, document.AppVersion = value),
                    };
                    break;
                case var own when own.StartsWith("extra:", StringComparison.Ordinal) && own.Length > 6:
                    before = OwnFields.Read(document.Extras, own[6..]);
                    document.Extras = OwnFields.Write(document.Extras, new() { [own[6..]] = value });
                    break;
                default:
                    return Fail(Problems.Invalid("FIELD_NOT_EDITABLE", $"{field} cannot be changed.", new { field }));
            }
            if (before != value) changes.Add($"{field}: {before ?? "—"} → {value ?? "—"}");
        }
        if (changes.Count == 0) return (document, null);
        document.UpdatedAt = clock.GetCurrentInstant();
        await db.SaveChangesAsync(cancellationToken);
        foreach (var change in changes)
        {
            await audit.WriteAsync(new Actor(access.UserId, access.UserName), "METADATA_CHANGE", "Document", document.Id,
                document.Number, change, document.ProjectId, cancellationToken);
        }
        return (document, null);
    }

    /// <summary>
    /// Ends a document's life: withdrawn (no longer wanted), cancelled (never to be produced) or archived. Recorded
    /// with the reason and who decided. Document Control decides, or whoever registered it.
    /// </summary>
    public async Task<(Document? Document, IResult? Problem)> EndAsync(
        ProjectAccess access, Guid documentId, EndDocumentRequest request, CancellationToken cancellationToken)
    {
        var document = await DocumentQueries.Visible(db, access, await RestrictedAsync(cancellationToken))
            .SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
        if (document is null) return Fail(Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document."));
        if (!access.Allows(Verbs.Control, document.Facts) && document.CreatedById != access.UserId)
            return Fail(Problems.Forbidden("END_NOT_ALLOWED", "Document Control, or whoever registered it, ends a document."));
        var state = request.State?.Trim().ToUpperInvariant();
        if (state is not (DocumentStates.Withdrawn or DocumentStates.Cancelled or DocumentStates.Archived))
            return Fail(Problems.Invalid("END_STATE_INVALID", "A document is withdrawn, cancelled or archived."));
        var reason = Blank(request.Reason);
        if (reason is null)
            return Fail(Problems.Invalid("REASON_REQUIRED", "A reason is required: each end state is recorded with date and authority."));
        if (document.State is not (DocumentStates.Planned or DocumentStates.Active))
            return Fail(Problems.Conflict("DOCUMENT_NOT_OPEN", $"The document is already {document.State.ToLowerInvariant()}.", new { state = document.State }));
        string[] moving = [RevisionStates.InPreparation, RevisionStates.InReview, RevisionStates.Received, RevisionStates.Correcting];
        if (await db.Revisions.AnyAsync(r => r.DocumentId == document.Id && moving.Contains(r.State), cancellationToken)
            && state != DocumentStates.Archived)
            return Fail(Problems.Conflict("REVISION_IN_MOTION", "A revision of it is still in motion: finish it, or send it back, first."));
        var before = document.State;
        document.State = state;
        document.UpdatedAt = clock.GetCurrentInstant();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "STATE_TRANSITION", "Document", document.Id,
            document.Number, $"{before} → {state}: {reason}", document.ProjectId, cancellationToken);
        return (document, null);
    }

    /// <summary>
    /// Records a file someone is about to upload to a document (status awaiting upload) and returns a signed link
    /// the browser uses to send the bytes straight to object storage. The file is attached to a revision later.
    /// </summary>
    public async Task<(UploadTicket? Ticket, IResult? Problem)> RequestUploadAsync(
        ProjectAccess access, Guid documentId, UploadRequest request, CancellationToken cancellationToken)
    {
        // Another organization uploads here and then sends on a transmittal; Document Control may upload what such an
        // organization sent outside the system, to record it for them.
        var (document, problem) = await ContributableAsync(access, documentId, cancellationToken,
            access.IsInternal ? null : new Incoming(null, null));
        if (problem is not null && access.IsInternal && access.Holds(Verbs.Control)
            && await db.Documents.Where(d => d.Id == documentId).Select(d => d.Originator).SingleOrDefaultAsync(cancellationToken) is { } originator
            && await db.Parties.AnyAsync(p => p.Code == originator && !p.IsInternal, cancellationToken))
        {
            (document, problem) = await ContributableAsync(access, documentId, cancellationToken, new Incoming(null, originator));
        }
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
        ProjectAccess access, Guid documentId, StartRevisionRequest request, CancellationToken cancellationToken,
        Incoming? incoming = null)
    {
        var (document, problem) = await ContributableAsync(access, documentId, cancellationToken, incoming);
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

        var later = request.FilesLater && (request.FileIds?.Length ?? 0) == 0;
        var (files, filesProblem) = later
            ? ([], null)
            : await UploadedFilesAsync(access, document, request.FileIds, cancellationToken);
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
            AuthoredByParty = incoming?.OnBehalfOf ?? access.PartyCode,
            CreatedAt = now,
            StatusCode = incoming?.Status,
            State = await NeedsAcceptanceAsync(access, incoming, cancellationToken) ? RevisionStates.Received : RevisionStates.InPreparation,
            FilesState = later ? FilesStates.None : FilesStates.Processing,
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
            $"{document.Number} rev {revision.Value}",
            later ? "Started; its files follow." : $"{files!.Count} file(s) uploaded; scanning before use.",
            document.ProjectId, cancellationToken);
        revision.Files = files!;
        return (revision, null);
    }

    /// <summary>
    /// Attaches files to a revision still in preparation, before it goes anywhere: a revision started ahead of its
    /// files, or one whose author adds the source file to the PDF. They join its current submission and are scanned.
    /// </summary>
    public async Task<(Revision? Revision, IResult? Problem)> AttachAsync(
        ProjectAccess access, Guid documentId, Guid revisionId, StartRevisionRequest request, CancellationToken cancellationToken)
    {
        var (document, problem) = await ContributableAsync(access, documentId, cancellationToken);
        if (problem is not null) return (null, problem);
        var revision = await db.Revisions.Include(r => r.Files)
            .SingleOrDefaultAsync(r => r.Id == revisionId && r.DocumentId == documentId, cancellationToken);
        if (revision is null) return (null, Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        if (revision.State != RevisionStates.InPreparation)
        {
            return (null, Problems.Conflict("REVISION_NOT_IN_PREPARATION",
                $"Files are attached while a revision is in preparation; revision {revision.Value} is {revision.State.ToLowerInvariant().Replace('_', ' ')}. The next revision carries new files.",
                new { state = revision.State }));
        }
        var (files, filesProblem) = await UploadedFilesAsync(access, document!, request.FileIds, cancellationToken);
        if (filesProblem is not null) return (null, filesProblem);
        Bind(files!, revision);
        revision.FilesState = FilesStates.Processing;
        document!.UpdatedAt = clock.GetCurrentInstant();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "FILE_UPLOADED", "Revision", revision.Id,
            $"{document.Number} rev {revision.Value}",
            // Files added to a revision rather than a new one: the uploader's reason is kept with them.
            string.Join(", ", files!.Select(f => f.Name)) + (string.IsNullOrWhiteSpace(request.ChangeDescription) ? "" : $". Why: {request.ChangeDescription.Trim()}"),
            document.ProjectId, cancellationToken);
        return (revision, null);
    }

    /// <summary>
    /// Makes the first revision of a document just registered from files that came in unplanned on a transmittal and
    /// were already scanned. Document Control registered it, so it needs no check on arrival: it is in preparation.
    /// </summary>
    public async Task<(Revision? Revision, IResult? Problem)> AdoptAsync(
        ProjectAccess access, Document document, List<StoredFile> files, string? party, string? status, Instant sentAt, string sentBy,
        CancellationToken cancellationToken)
    {
        var scheme = await RevisionSchemeForAsync(document.DeliverableType, cancellationToken);
        if (scheme is null)
        {
            return (null, Problems.Invalid("NO_REVISION_SCHEME",
                "No revision scheme applies to this deliverable type. An administrator sets one up.",
                new { deliverableType = document.DeliverableType }));
        }
        var value = ((NextValue.Value)RevisionValues.Next(scheme, [], null)).Text;
        var revision = new Revision
        {
            TenantId = document.TenantId,
            ProjectId = document.ProjectId,
            DocumentId = document.Id,
            Value = value,
            Series = scheme.Series[0].Code,
            ReasonForRevision = "First issue",
            ChangeDescription = "Received unplanned on a transmittal",
            AuthoredById = access.UserId,
            AuthoredByName = sentBy,
            AuthoredByParty = party,
            CreatedAt = clock.GetCurrentInstant(),
            StatusCode = status,
            State = RevisionStates.InPreparation,
            FilesState = FilesStates.Ready,
            Submissions = [new SubmissionRecord { Number = 1, SubmittedAt = sentAt, SubmittedByName = sentBy }],
        };
        db.Revisions.Add(revision);
        foreach (var file in files)
        {
            file.DocumentId = document.Id;
            file.RevisionId = revision.Id;
            file.Submission = 1;
        }
        document.IsPlaceholder = false;
        document.LatestRevisionId = revision.Id;
        document.LatestRevisionValue = revision.Value;
        document.LatestRevisionState = revision.State;
        document.UpdatedAt = revision.CreatedAt;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "REVISION_ESTABLISHED", "Revision", revision.Id,
            $"{document.Number} rev {revision.Value}", $"{files.Count} file(s) received unplanned on a transmittal.",
            document.ProjectId, cancellationToken);
        return (revision, null);
    }

    /// <summary>
    /// Send corrected files for a revision Document Control returned without
    /// asking for a new one. The returned submission is kept; this one replaces
    /// it under the same revision value.
    /// </summary>
    public async Task<(Revision? Revision, IResult? Problem)> ResubmitAsync(
        ProjectAccess access, Guid documentId, Guid revisionId, StartRevisionRequest request, CancellationToken cancellationToken,
        Incoming? incoming = null)
    {
        var (document, problem) = await ContributableAsync(access, documentId, cancellationToken, incoming);
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
        revision.State = await NeedsAcceptanceAsync(access, incoming, cancellationToken) ? RevisionStates.Received : RevisionStates.InPreparation;
        if (incoming?.Status is { } proposed) revision.StatusCode = proposed;
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
    private async Task<bool> NeedsAcceptanceAsync(ProjectAccess access, Incoming? incoming, CancellationToken cancellationToken) =>
        (!access.IsInternal || incoming?.OnBehalfOf is not null) && await db.Memberships.AnyAsync(m => m.ProjectId == access.Project.Id && m.Active && m.Function!.Active
            && m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control))
            && db.Users.Any(u => u.Id == m.UserId && u.Active), cancellationToken);

    /// <summary>
    /// Someone may add to a document when their function may create or revise it,
    /// and, for another party, only on documents that party produces.
    /// </summary>
    private async Task<(Document? Document, IResult? Problem)> ContributableAsync(
        ProjectAccess access, Guid documentId, CancellationToken cancellationToken, Incoming? incoming = null)
    {
        var document = await DocumentQueries.Visible(db, access, await RestrictedAsync(cancellationToken))
            .SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
        if (document is null) return (null, Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document."));
        // Another organization sends on a transmittal, so that what came, and when, has a receipt.
        if (!access.IsInternal && incoming is null)
        {
            return (null, Problems.Conflict("SEND_ON_TRANSMITTAL",
                "Send it to us on a transmittal: fill the placeholder there, and you get a receipt."));
        }
        var may = incoming?.OnBehalfOf is { } party
            ? access.Allows(Verbs.Control, document.Facts) && document.Originator == party
            : (access.Allows(Verbs.Create, document.Facts) || access.Allows(Verbs.Revise, document.Facts))
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
/// A revision coming in on an incoming transmittal: the status the sender proposes for it, and, when Document Control
/// records it for an organization that works in its own system, that organization's code.
/// </summary>
public sealed record Incoming(string? Status, string? OnBehalfOf);

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
        // Above your function's clearance, whatever your function: only where you are named on it.
        var aboveClearance = access.AboveClearance;
        if (aboveClearance.Count > 0)
        {
            query = query.Where(d => d.Confidentiality == null || !aboveClearance.Contains(d.Confidentiality)
                || d.CreatedById == me || db.DocumentAccess.Any(a => a.DocumentId == d.Id && a.UserId == me)
                || sentToMe.Contains(d.Id));
        }
        return query;
    }
}

/// <summary>The organization's own fields on a record, kept as one JSON object of name to text.</summary>
public static class OwnFields
{
    /// <summary>The stored fields with these changes made: an empty value removes a field. Null when none is left.</summary>
    public static string? Write(string? stored, Dictionary<string, string?>? changes)
    {
        var fields = stored is null ? new Dictionary<string, string>()
            : System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(stored) ?? [];
        foreach (var (name, value) in changes ?? [])
        {
            var key = name.Trim();
            if (key.Length is 0 or > 100) continue;
            if (string.IsNullOrWhiteSpace(value)) fields.Remove(key);
            else fields[key] = value.Trim().Length > 2000 ? value.Trim()[..2000] : value.Trim();
        }
        return fields.Count == 0 ? null : System.Text.Json.JsonSerializer.Serialize(fields);
    }

    /// <summary>One stored field, or null.</summary>
    public static string? Read(string? stored, string name) =>
        stored is null ? null : (System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(stored) ?? []).GetValueOrDefault(name);
}
