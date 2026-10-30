using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Packages;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Transmittals;

/// <summary>Body of matching something unplanned that arrived to one of our documents, chosen from the register.</summary>
public sealed record MatchRequest(Guid? DocumentId, string? Number = null);

/// <summary>Body of the check on what came into a package taking documents as they come: accept all, or return all with why.</summary>
public sealed record AsReceivedCheckRequest(bool Return = false, string? Note = null);

/// <summary>
/// What another organization sent that was not asked for by placeholder: matched by hand to one of ours (equivalence),
/// or, into a package taking documents as they come, put in our register as it came once the check accepts it.
/// </summary>
public sealed partial class IncomingService
{
    // ── Matching what arrived to one of ours ──────────────────────────────────

    /// <summary>
    /// Equivalence (owner): something unplanned that arrived is matched by hand to one of our documents. What came
    /// becomes that document's: a new submission of the revision being prepared (the one before is kept), else its next
    /// revision (its first when it has none). Their number is kept beside ours. Not while a revision of it is in review.
    /// When it is none of ours, it is registered instead (<see cref="RegisterAsync"/>).
    /// </summary>
    public async Task<(Transmittal? Transmittal, IResult? Problem)> MatchAsync(
        ProjectAccess access, Guid transmittalId, Guid itemId, MatchRequest request, CancellationToken cancellationToken)
    {
        if (!access.IsInternal || !(access.Holds(Verbs.Control) || await StandIns.ArrivalAsync(db, access, transmittalId, cancellationToken)))
            return (null, Problems.Forbidden("CONTROL_ONLY", "The control function matches what arrived to our documents."));
        var transmittal = await transmittals.Visible(access).Include(t => t.Items).Include(t => t.Recipients).AsSplitQuery()
            .SingleOrDefaultAsync(t => t.Id == transmittalId, cancellationToken);
        var item = transmittal?.Items.SingleOrDefault(i => i.Id == itemId);
        if (item is null || transmittal!.FromPartyId is not { } partyId) return (null, Problems.NotFound("ITEM_NOT_FOUND", "No such item."));
        if (item.Kind != TransmittalItemKinds.Unplanned)
            return (null, Problems.Conflict("NOT_UNPLANNED", "Only something unplanned is matched; the rest is in the register already."));
        if (item.RegisteredAt is not null || item.ReturnedAt is not null)
            return (null, Problems.Conflict("ALREADY_ANSWERED", "It is in the register already, or was returned.", new { documentId = item.DocumentId }));
        if ((await Intake.ReadAsync(db, access.Project.Id, cancellationToken)).Mode == Intake.AsReceived)
            return (null, Problems.Conflict("INTAKE_AS_RECEIVED", "This project takes what others send as it comes: the check accepts it as it is."));
        // Chosen from the register (owner: numbering is never typed), or a number of theirs matched before.
        var written = request.Number?.Trim() ?? "";
        if (request.DocumentId is null && written.Length == 0)
            return (null, Problems.Invalid("DOCUMENT_REQUIRED", "Choose the document of ours it is, from the register.", new { field = "documentId" }));

        var visible = DocumentQueries.Visible(db, access);
        var document = request.DocumentId is { } chosen
            ? await visible.SingleOrDefaultAsync(d => d.Id == chosen, cancellationToken)
            : await visible.SingleOrDefaultAsync(d => d.Number == written, cancellationToken);
        if (document is null && await Equivalents.FindAsync(db, access.Project.Id, partyId, written, cancellationToken) is { } matched)
            document = await visible.SingleOrDefaultAsync(d => d.Id == matched, cancellationToken);
        if (document is null)
            return (null, Problems.Invalid("DOCUMENT_NOT_FOUND", $"No document {written} in our register that you may see. Is it none of ours? Make it a document.", new { field = "number" }));
        if (document.State is DocumentStates.Cancelled or DocumentStates.Withdrawn)
            return (null, Problems.Conflict("DOCUMENT_ENDED", $"{document.Number} was {document.State.ToLowerInvariant()}: reinstate it first."));
        if (document.Kind == DocumentKinds.Record && !document.IsPlaceholder)
            return (null, Problems.Conflict("RECORD_FIXED", $"{document.Number} is a record, fixed once registered."));

        var files = await db.StoredFiles.Where(f => f.TransmittalItemId == item.Id).ToListAsync(cancellationToken);
        if (files.Count == 0) return (null, Problems.Invalid("FILES_REQUIRED", "Nothing came with it to put in the document."));
        if (files.Any(f => f.Status != FileStatuses.Clean))
            return (null, Problems.Conflict("FILES_NOT_READY", "Its files are not all scanned and clean."));
        var party = await db.Parties.AsNoTracking().SingleAsync(p => p.Id == partyId, cancellationToken);

        var latest = await db.Revisions.Where(r => r.DocumentId == document.Id).OrderByDescending(r => r.CreatedAt).FirstOrDefaultAsync(cancellationToken);
        Revision revision;
        if (latest is { State: RevisionStates.InReview or RevisionStates.Received })
            return (null, Problems.Conflict("REVISION_IN_REVIEW", $"{document.Number} rev {latest.Value} is being checked or reviewed: match it once that ends."));
        if (latest is { State: RevisionStates.InPreparation or RevisionStates.Correcting })
        {
            // Being prepared: what came is its newest submission; the one before stays, kept.
            latest.Submission += 1;
            latest.Submissions.Add(new SubmissionRecord
            {
                Number = latest.Submission,
                SubmittedAt = transmittal.IssuedAt,
                SubmittedByName = transmittal.IssuedByName,
                Check = Arrivals.Accepted,
                CheckedByName = access.UserName,
                CheckedAt = clock.GetCurrentInstant(),
            });
            latest.State = RevisionStates.InPreparation;
            latest.FilesState = FilesStates.Ready;
            latest.AuthoredByParty ??= party.Code;
            foreach (var file in files)
            {
                file.DocumentId = document.Id;
                file.RevisionId = latest.Id;
                file.Submission = latest.Submission;
            }
            document.LatestRevisionState = latest.State;
            document.UpdatedAt = clock.GetCurrentInstant();
            revision = latest;
        }
        else
        {
            var (adopted, problem) = await documents.AdoptAsync(access, document, files, party.Code, item.StatusCode, transmittal.IssuedAt,
                transmittal.IssuedByName, cancellationToken, $"Received from {party.Name} on {transmittal.Number}, matched to this document");
            if (problem is not null) return (null, problem);
            revision = adopted!;
        }
        // We hold what came from them, where the document is exchanged with its supplier.
        if (document.WithSupplier is not null) document.WithSupplier = false;
        var kept = await Equivalents.RecordAsync(db, clock, document, party.Id, item.DocumentNumber, EquivalentSources.Matched, access.UserName, cancellationToken);
        if (kept is not null) return (null, kept);
        item.DocumentId = document.Id;
        item.RevisionId = revision.Id;
        item.RevisionValue = revision.Value;
        item.RegisteredAt = clock.GetCurrentInstant();
        item.RegisteredByName = access.UserName;
        item.Matched = true;
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "UNPLANNED_MATCHED", "Transmittal", transmittal.Id, transmittal.Number,
            $"{Label(item)} matched to {document.Number} rev {revision.Value}.", access.Project.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (transmittal, null);
    }

    // ── A package taking documents as they come ───────────────────────────────

    /// <summary>
    /// On a project taking documents as they come (<see cref="Intake"/>), what another organization sends, checked when it
    /// sends: each item with its number and revision, not one of ours by number, and not a revision already in our
    /// register (a returned one comes again under the same revision). Null on a project taking them by placeholder.
    /// </summary>
    private async Task<(IntakeView? Intake, IResult? Problem)> AsReceivedIntakeAsync(
        ProjectAccess access, Party party, UnplannedItem[] items, CancellationToken cancellationToken)
    {
        var intake = await Intake.ReadAsync(db, access.Project.Id, cancellationToken);
        if (intake.Mode != Intake.AsReceived) return (null, null);
        foreach (var item in items)
        {
            // Nothing is asked of what is sent (owner): a file attached from outside has no number; whoever checks
            // returns what came without what it needs. Only what was given is checked here.
            var number = item.Reference?.Trim() ?? "";
            var value = item.Revision?.Trim() ?? "";
            if (number.Length == 0) continue;
            if (number.Length > 200 || value.Length > 32) return (null, Problems.Invalid("TOO_LONG", $"{number}: its number or revision is too long."));
            var documentId = await AsReceivedDocumentAsync(access.Project.Id, party, number, cancellationToken);
            if (documentId is null && await db.Documents.AnyAsync(d => d.ProjectId == access.Project.Id && d.Number == number, cancellationToken))
                return (null, Problems.Conflict("NUMBER_TAKEN", $"{number} is already a number of another document in the register: send it under its own number."));
            if (value.Length == 0) continue;
            if (documentId is { } id && await db.Revisions.AnyAsync(r => r.DocumentId == id && r.Value == value && r.State != RevisionStates.Correcting, cancellationToken))
                return (null, Problems.Conflict("REVISION_EXISTS", $"{number} rev {value} is in the register already: send the next revision."));
            if (documentId is { } busyId && await db.Revisions.AnyAsync(r => r.DocumentId == busyId && r.Value != value
                    && (r.State == RevisionStates.InReview || r.State == RevisionStates.Received), cancellationToken))
                return (null, Problems.Conflict("REVISION_IN_REVIEW", $"{number}: the revision before is in review; send this one once it is decided."));
        }
        return (intake, null);
    }

    /// <summary>The document a number of theirs already stands for: matched before, or taken as it came under that number.</summary>
    private async Task<Guid?> AsReceivedDocumentAsync(Guid projectId, Party party, string number, CancellationToken cancellationToken) =>
        await Equivalents.FindAsync(db, projectId, party.Id, number, cancellationToken)
        ?? await db.Documents.Where(d => d.ProjectId == projectId && d.Number == number && d.AsReceived && d.Originator == party.Code)
            .Select(d => (Guid?)d.Id).FirstOrDefaultAsync(cancellationToken);

    /// <summary>
    /// The check on what came into a package taking documents as they come. Accepted, each is in our register as it came:
    /// under their number (a new document the first time, filed in the package), at their revision, with the status and
    /// review outcome they gave it, ready for our review. Returned, nothing is registered; they are told why.
    /// </summary>
    public async Task<(Transmittal? Transmittal, IResult? Problem)> CheckAsReceivedAsync(
        ProjectAccess access, Guid transmittalId, AsReceivedCheckRequest request, CancellationToken cancellationToken)
    {
        if (!access.IsInternal || !(access.Holds(Verbs.Control) || await StandIns.ArrivalAsync(db, access, transmittalId, cancellationToken)))
            return (null, Problems.Forbidden("CONTROL_ONLY", "The control function checks what arrives."));
        var transmittal = await transmittals.Visible(access).Include(t => t.Items).AsSplitQuery()
            .SingleOrDefaultAsync(t => t.Id == transmittalId, cancellationToken);
        if (transmittal is null || transmittal.Direction != TransmittalDirections.Incoming || transmittal.FromPartyId is not { } partyId)
            return (null, Problems.NotFound("TRANSMITTAL_NOT_FOUND", "No such transmittal from another organization."));
        var intake = await Intake.ReadAsync(db, access.Project.Id, cancellationToken);
        if (intake.Mode != Intake.AsReceived)
            return (null, Problems.Conflict("NOT_AS_RECEIVED", "This project takes documents by placeholder: match each to one of ours, or make it a document."));
        var package = transmittal.PackageId is { } packageId
            ? await db.Packages.Include(p => p.Members).SingleOrDefaultAsync(p => p.Id == packageId, cancellationToken) : null;
        var waiting = transmittal.Items.Where(i => i.Kind == TransmittalItemKinds.Unplanned && i.RegisteredAt is null && i.ReturnedAt is null).ToList();
        if (waiting.Count == 0) return (null, Problems.Conflict("NOTHING_TO_CHECK", "Everything on it was checked already."));
        var party = await db.Parties.AsNoTracking().SingleAsync(p => p.Id == partyId, cancellationToken);
        var now = clock.GetCurrentInstant();
        var actor = new Actor(access.UserId, access.UserName);

        if (request.Return)
        {
            var why = request.Note?.Trim() ?? "";
            if (why.Length == 0) return (null, Problems.Invalid("NOTE_REQUIRED", "Say what is wrong, so they can correct it.", new { field = "notes" }));
            foreach (var item in waiting)
            {
                item.ReturnedAt = now;
                item.ReturnedByName = access.UserName;
                item.ReturnedReason = why;
            }
            await audit.WriteAsync(actor, "RETURNED_TO_SENDER", "Transmittal", transmittal.Id, transmittal.Number,
                $"{waiting.Count} document(s) taken as they come returned: {why}", access.Project.Id, cancellationToken);
            var told = await PartyPeopleAsync(access.Project.Id, party.Id, cancellationToken);
            if (transmittal.IssuedById is { } sender) told.Add(sender);
            told = told.Where(id => id != Guid.Empty && id != access.UserId).Distinct().ToList();
            if (told.Count > 0)
                await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, told, Notifications.NotificationKinds.General,
                    $"{transmittal.Number}: returned to correct", $"{why}\n\nCorrect it and send it again.",
                    $"/transmittals/{transmittal.Id}", cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            return (transmittal, null);
        }

        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var files = await db.StoredFiles.Where(f => f.TransmittalItemId != null && waiting.Select(i => i.Id).Contains(f.TransmittalItemId.Value))
            .ToListAsync(cancellationToken);
        if (files.Any(f => f.Status != FileStatuses.Clean))
            return (null, Problems.Conflict("FILES_NOT_READY", "Its files are not all scanned and clean."));
        // What came without their number or revision cannot go into the register as it came: it is returned, saying so.
        if (waiting.FirstOrDefault(i => string.IsNullOrWhiteSpace(i.DocumentNumber) || string.IsNullOrWhiteSpace(i.RevisionValue)) is { } bare)
            return (null, Problems.Conflict("CAME_WITHOUT_NUMBER",
                $"{bare.Title} came without its number or revision: return it, saying what is missing."));
        foreach (var item in waiting)
        {
            var problem = await TakeAsReceivedAsync(access, transmittal, intake, package, party, item,
                files.Where(f => f.TransmittalItemId == item.Id).ToList(), catalog, cancellationToken);
            if (problem is not null) return (null, problem);
        }
        await db.SaveChangesAsync(cancellationToken);
        return (transmittal, null);
    }

    /// <summary>One document taken as it came: their number, their revision, their status and review outcome.</summary>
    private async Task<IResult?> TakeAsReceivedAsync(ProjectAccess access, Transmittal transmittal, IntakeView intake, Package? package, Party party,
        TransmittalItem item, List<StoredFile> files, Catalog catalog, CancellationToken cancellationToken)
    {
        var number = item.DocumentNumber.Trim();
        var now = clock.GetCurrentInstant();
        var documentId = await AsReceivedDocumentAsync(access.Project.Id, party, number, cancellationToken);
        Document document;
        if (documentId is { } id)
            document = await db.Documents.SingleAsync(d => d.Id == id, cancellationToken);
        else
        {
            if (await db.Documents.AnyAsync(d => d.ProjectId == access.Project.Id && d.Number == number, cancellationToken))
                return Problems.Conflict("NUMBER_TAKEN", $"{number} is already a number of another document in the register.");
            var deliverable = intake.DeliverableType!;
            document = new Document
            {
                TenantId = access.Project.TenantId,
                ProjectId = access.Project.Id,
                Number = number,
                Title = item.Title,
                DeliverableType = deliverable,
                DocType = item.DocType ?? intake.DocType!,
                Discipline = intake.Discipline!,
                Originator = party.Code,
                ContractRef = package?.PurchaseOrder,
                Confidentiality = catalog.LowestOf(ValueSets.Confidentiality, deliverable) ?? catalog.DefaultOf(ValueSets.Confidentiality, deliverable),
                RetentionClass = catalog.RetentionFor(null, deliverable),
                AsReceived = true,
                ReceivedDate = transmittal.IssuedAt.InZone(NodaTime.DateTimeZoneProviders.Tzdb[access.Project.TimeZone]).Date,
                CreatedById = access.UserId,
                CreatedByName = access.UserName,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Documents.Add(document);
            await audit.WriteAsync(new Actor(access.UserId, access.UserName), "REGISTER_ENTRY", "Document", document.Id, document.Number,
                $"Taken as it came from {party.Name} on {transmittal.Number}: their number, not our numbering.", access.Project.Id, cancellationToken);
        }
        // Filed in the package it came into, else in its supplier's (made by itself when there is none).
        if (package is not null)
        {
            if (!package.Members.Any(m => m.DocumentId == document.Id))
                package.Members.Add(new PackageMember { TenantId = package.TenantId, PackageId = package.Id, DocumentId = document.Id, AddedAt = now });
        }
        else if (documentId is null)
        {
            await db.SaveChangesAsync(cancellationToken);
            await filing.FileAsync(access.Project, document, new Actor(access.UserId, access.UserName), cancellationToken);
        }

        var check = new SubmissionRecord
        {
            Number = 1,
            SubmittedAt = transmittal.IssuedAt,
            SubmittedByName = transmittal.IssuedByName,
            Check = Arrivals.Accepted,
            CheckedByName = access.UserName,
            CheckedAt = now,
        };
        var status = item.TheirStatus is { } said && catalog.IsActive(ReviewSets.Statuses, said) ? said : null;
        var revision = await db.Revisions.SingleOrDefaultAsync(r => r.DocumentId == document.Id && r.Value == item.RevisionValue, cancellationToken);
        if (revision is not null)
        {
            if (revision.State != RevisionStates.Correcting)
                return Problems.Conflict("REVISION_EXISTS", $"{number} rev {item.RevisionValue} is in the register already.");
            revision.Submission += 1;
            check.Number = revision.Submission;
            revision.Submissions.Add(check);
            revision.State = RevisionStates.InPreparation;
        }
        else
        {
            // Their next revision replaces one of theirs we never took further; one in our review waits for its decision.
            var open = await db.Revisions.Where(r => r.DocumentId == document.Id && (r.State == RevisionStates.InPreparation
                || r.State == RevisionStates.InReview || r.State == RevisionStates.Received || r.State == RevisionStates.Correcting)).ToListAsync(cancellationToken);
            if (open.FirstOrDefault(r => r.State is RevisionStates.InReview or RevisionStates.Received) is { } busy)
                return Problems.Conflict("REVISION_IN_REVIEW", $"{number} rev {busy.Value} is in our review: its next revision waits for the decision.");
            foreach (var before in open)
            {
                before.State = RevisionStates.Superseded;
                before.SupersededAt = now;
            }
            revision = new Revision
            {
                TenantId = document.TenantId,
                ProjectId = document.ProjectId,
                DocumentId = document.Id,
                Value = item.RevisionValue,
                Series = AsReceivedSeries,
                ReasonForRevision = document.Revisions.Count == 0 && documentId is null ? "First issue" : "Received from another organization",
                ChangeDescription = $"Taken as it came from {party.Name} on {transmittal.Number}",
                AuthoredById = transmittal.IssuedById ?? access.UserId,
                AuthoredByName = transmittal.IssuedByName,
                AuthoredByParty = party.Code,
                CreatedAt = now,
                StatusCode = status,
                State = RevisionStates.InPreparation,
                Submissions = [check],
            };
            db.Revisions.Add(revision);
        }
        revision.TheirStatus = item.TheirStatus;
        revision.TheirOutcome = item.TheirOutcome;
        revision.FilesState = FilesStates.Ready;
        foreach (var file in files)
        {
            file.DocumentId = document.Id;
            file.RevisionId = revision.Id;
            file.Submission = revision.Submission;
        }
        document.IsPlaceholder = false;
        document.LatestRevisionId = revision.Id;
        document.LatestRevisionValue = revision.Value;
        document.LatestRevisionState = revision.State;
        document.UpdatedAt = now;
        var kept = await Equivalents.RecordAsync(db, clock, document, party.Id, number, EquivalentSources.Registered, access.UserName, cancellationToken);
        if (kept is not null) return kept;
        item.DocumentId = document.Id;
        item.RevisionId = revision.Id;
        item.RegisteredAt = now;
        item.RegisteredByName = access.UserName;
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "TAKEN_AS_RECEIVED", "Revision", revision.Id,
            $"{document.Number} rev {revision.Value}",
            $"Taken as it came from {party.Name} on {transmittal.Number}{(item.TheirStatus is null ? "" : $", their status {item.TheirStatus}")}"
            + $"{(item.TheirOutcome is null ? "" : $", their review outcome {item.TheirOutcome}")}.", access.Project.Id, cancellationToken);
        return null;
    }

    /// <summary>The series a revision taken as it came carries: the sender's values, outside our revision scheme.</summary>
    public const string AsReceivedSeries = "AS_RECEIVED";

    /// <summary>The people of an organization on the project.</summary>
    private Task<List<Guid>> PartyPeopleAsync(Guid projectId, Guid partyId, CancellationToken cancellationToken) =>
        (from u in db.Users
         join m in db.Memberships on u.Id equals m.UserId
         where u.PartyId == partyId && u.Active && m.ProjectId == projectId && m.Active && m.PendingSince == null
         select u.Id).Distinct().ToListAsync(cancellationToken);
}
