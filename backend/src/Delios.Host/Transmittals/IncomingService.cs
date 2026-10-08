using System.Globalization;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NodaTime;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfSharp.Pdf;

namespace Delios.Host.Transmittals;

/// <summary>A placeholder filled: its document, the files uploaded for it, and the status the sender proposes.</summary>
public sealed record PlannedItem(Guid DocumentId, Guid[]? FileIds, string? Status);

/// <summary>Something not planned (an RFI, an NCR, minutes…): what it is, its type, the sender's reference, its files.</summary>
public sealed record UnplannedItem(string? Title, string? DocType, string? Reference, Guid[]? FileIds);

/// <summary>
/// Body of an incoming transmittal. <c>Planned</c> fills placeholders; <c>Unplanned</c> sends files that wait for
/// Document Control to register them; <c>RevisionIds</c> attaches revisions of the sender's own documents already
/// here. <c>FromPartyId</c> and <c>ProofFileId</c> are for Document Control recording what an organization working
/// in its own system sent.
/// </summary>
public sealed record IncomingRequest(
    string? Reason, string? Subject = null, string? Message = null, string? TheirReference = null,
    PlannedItem[]? Planned = null, UnplannedItem[]? Unplanned = null, Guid[]? RevisionIds = null,
    Guid? FromPartyId = null, Guid? ProofFileId = null);

/// <summary>Body of an upload link for a file sent without a document: an unplanned item's file, or a covering letter.</summary>
public sealed record LooseUploadRequest(string? FileName, long Size, string? ContentType, string? Sha256, bool Proof = false);

/// <summary>
/// What another organization sends us. Every submission comes on a transmittal, numbered in the sender's series and
/// received the moment it is sent: that moment, with the exact files and their SHA-256, is the receipt. Placeholders
/// filled update our register straight away (Document Control then checks them on arrival); anything unplanned waits
/// on the transmittal until Document Control registers it under our numbering.
/// </summary>
public sealed class IncomingService(
    DeliosDbContext db, DocumentService documents, TransmittalService transmittals, Numbering numbering, FileStorage storage,
    AuditLog audit, IClock clock, IOptions<StorageOptions> storageOptions, Notifications.Notifier notifier)
{
    static IncomingService() => GlobalFontSettings.FontResolver ??= new EmbeddedFonts();

    // ── Sending ───────────────────────────────────────────────────────────────

    /// <summary>
    /// An upload link for a file that belongs to no document yet: an unplanned item's file, sent by another
    /// organization or by Document Control for one; or (<c>Proof</c>) the covering letter Document Control files
    /// when recording what such an organization sent.
    /// </summary>
    public async Task<(UploadTicket? Ticket, IResult? Problem)> UploadAsync(
        ProjectAccess access, LooseUploadRequest request, CancellationToken cancellationToken)
    {
        if (!MaySend(access))
            return (null, Problems.Forbidden("SEND_NOT_ALLOWED", "Only another organization, or Document Control for one, sends to us."));
        var (declared, invalid) = Uploads.Check(new UploadRequest(request.FileName, request.Size, request.ContentType, request.Sha256),
            storageOptions.Value.MaxFileBytes);
        if (invalid is not null) return (null, invalid);
        var (name, contentType, sha256, isPdf) = declared!;
        var file = new StoredFile
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            ObjectKey = "",
            Name = name,
            ContentType = contentType,
            Size = request.Size,
            Sha256 = sha256,
            Kind = request.Proof ? FileKinds.Evidence : isPdf ? FileKinds.Rendition : FileKinds.Native,
            UploadedById = access.UserId,
            UploadedByName = access.UserName,
            CreatedAt = clock.GetCurrentInstant(),
        };
        file.ObjectKey = FileStorage.KeyFor(file.TenantId, file.ProjectId, file.Id);
        db.StoredFiles.Add(file);
        await db.SaveChangesAsync(cancellationToken);
        var link = storage.PresignUpload(file.ObjectKey, contentType);
        return (new UploadTicket(file.Id, "PUT", link.Url, link.Headers, link.ExpiresAt.ToDateTimeOffset()), null);
    }

    /// <summary>
    /// Receives a transmittal from another organization: fills its placeholders (or sends corrections), attaches its
    /// unplanned items and any revisions of its own documents, numbers it in its series and records it as received now.
    /// </summary>
    public async Task<(Transmittal? Transmittal, IResult? Problem)> SendAsync(
        ProjectAccess access, IncomingRequest request, CancellationToken cancellationToken)
    {
        var (party, onBehalf, refused) = await SenderAsync(access, request.FromPartyId, cancellationToken);
        if (refused is not null) return (null, refused);
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var reason = request.Reason?.Trim() ?? "";
        if (!catalog.IsActive(TransmittalSets.Reasons, reason))
            return (null, Problems.Invalid("VALUE_NOT_PUBLISHED", $"{reason} is not a published reason for issue.", new { field = "reason", value = reason }));
        var planned = request.Planned ?? [];
        var unplanned = request.Unplanned ?? [];
        var attached = request.RevisionIds?.Distinct().ToList() ?? [];
        var count = planned.Length + unplanned.Length + attached.Count;
        if (count is 0 or > 200) return (null, Problems.Invalid("ITEMS_REQUIRED", "Send between 1 and 200 items."));
        if (planned.Select(p => p.DocumentId).Distinct().Count() != planned.Length)
            return (null, Problems.Invalid("DOCUMENT_TWICE", "Each placeholder is sent once on a transmittal."));

        var now = clock.GetCurrentInstant();
        var transmittal = new Transmittal
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            Number = "",
            Direction = TransmittalDirections.Incoming,
            Reason = reason,
            Subject = "",
            Message = Blank(request.Message),
            FromPartyId = party!.Id,
            FromName = party.Name,
            TheirReference = Blank(request.TheirReference),
            ToName = "",
            IssuedAt = now,
            IssuedById = access.UserId,
            IssuedByName = onBehalf ? $"{access.UserName}, for {party.Name}" : access.UserName,
        };

        // Placeholders filled, or corrections of what Document Control returned: our register is updated now.
        foreach (var item in planned)
        {
            var status = item.Status?.Trim() ?? "";
            if (!catalog.IsActive(ReviewSets.Statuses, status))
                return (null, Problems.Invalid("STATUS_REQUIRED", "Say the status each document is sent for: for review, for approval, for information…",
                    new { documentId = item.DocumentId, value = status }));
            var document = await db.Documents.AsNoTracking().SingleOrDefaultAsync(d => d.Id == item.DocumentId && d.ProjectId == access.Project.Id, cancellationToken);
            if (document is null || document.Originator != party.Code)
                return (null, Problems.Forbidden("NOT_THEIRS", $"Only {party.Name}'s own placeholders are filled by {party.Name}.", new { documentId = item.DocumentId }));
            var incoming = new Incoming(status, onBehalf ? party.Code : null);
            var files = new StartRevisionRequest(item.FileIds);
            var latest = document.LatestRevisionId is { } latestId
                ? await db.Revisions.AsNoTracking().SingleAsync(r => r.Id == latestId, cancellationToken) : null;
            var (revision, problem) = latest?.State == RevisionStates.Correcting
                ? await documents.ResubmitAsync(access, document.Id, latest.Id, files, cancellationToken, incoming)
                : await documents.StartRevisionAsync(access, document.Id, files, cancellationToken, incoming);
            if (problem is not null) return (null, problem);
            transmittal.Items.Add(Item(transmittal, TransmittalItemKinds.Submission, document, revision!, status, revision!.Submission));
        }

        // Revisions of the sender's own documents, already here.
        if (attached.Count > 0)
        {
            var revisions = await db.Revisions.AsNoTracking().Where(r => attached.Contains(r.Id) && r.ProjectId == access.Project.Id)
                .ToListAsync(cancellationToken);
            var ids = revisions.Select(r => r.DocumentId).ToList();
            var owned = await DocumentQueries.Visible(db, access, catalog.RestrictedLevels())
                .Where(d => ids.Contains(d.Id) && d.Originator == party.Code).ToDictionaryAsync(d => d.Id, cancellationToken);
            if (revisions.Count != attached.Count || revisions.Any(r => !owned.ContainsKey(r.DocumentId)))
                return (null, Problems.Forbidden("NOT_THEIRS", $"Only revisions of {party.Name}'s own documents are attached.", new { revisionIds = attached }));
            foreach (var r in revisions) transmittal.Items.Add(Item(transmittal, TransmittalItemKinds.Revision, owned[r.DocumentId], r, r.StatusCode, null));
        }

        // Unplanned: kept on the transmittal until Document Control registers them.
        foreach (var other in unplanned)
        {
            var title = other.Title?.Trim() ?? "";
            if (title.Length == 0) return (null, Problems.Invalid("TITLE_REQUIRED", "Say what each unplanned item is."));
            var type = Blank(other.DocType);
            if (type is not null && !catalog.IsActive(ValueSets.DocumentTypes, type))
                return (null, Problems.Invalid("VALUE_NOT_PUBLISHED", $"{type} is not a published document type.", new { field = "docType", value = type }));
            var item = new TransmittalItem
            {
                TenantId = transmittal.TenantId,
                TransmittalId = transmittal.Id,
                Kind = TransmittalItemKinds.Unplanned,
                DocumentNumber = Blank(other.Reference) ?? "",
                Title = title,
                RevisionValue = "",
                DocType = type,
            };
            var (files, problem) = await LooseFilesAsync(access, other.FileIds, proof: false, cancellationToken);
            if (problem is not null) return (null, problem);
            foreach (var file in files!)
            {
                file.TransmittalItemId = item.Id;
                Process(file);
            }
            transmittal.Items.Add(item);
        }

        if (request.ProofFileId is { } proofId)
        {
            var (proof, problem) = await LooseFilesAsync(access, [proofId], proof: true, cancellationToken);
            if (problem is not null) return (null, problem);
            Process(proof!.Single());
            transmittal.ProofFileId = proofId;
        }

        var ours = await db.Parties.AsNoTracking().Where(p => p.IsInternal && p.Active).OrderBy(p => p.Code).FirstOrDefaultAsync(cancellationToken);
        transmittal.ToPartyId = ours?.Id;
        transmittal.ToName = ours?.Name ?? "Document Control";
        transmittal.Number = await numbering.RecordAsync(access.Project.TenantId, access.Project.Id, RecordKinds.Transmittal,
            NumberFields.ForRecord(access.Project.Code, party.Code, ours?.Code), "TR", cancellationToken);
        transmittal.Subject = Blank(request.Subject)
            ?? (transmittal.Items.Count == 1 ? $"{Label(transmittal.Items[0])}" : $"{transmittal.Items.Count} items");
        db.Transmittals.Add(transmittal);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "TRANSMITTAL_RECEIVED", "Transmittal", transmittal.Id,
            transmittal.Number,
            $"From {party.Name}{(transmittal.TheirReference is null ? "" : $" (their {transmittal.TheirReference})")}: "
            + string.Join(", ", transmittal.Items.Select(Label)) + ".",
            access.Project.Id, cancellationToken);
        // Document Control checks what arrived.
        await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, await notifier.ControlHoldersAsync(access.Project.Id, cancellationToken),
            Notifications.NotificationKinds.IncomingArrived, $"{transmittal.Number} from {party.Name}: {transmittal.Subject}",
            string.Join("\n", transmittal.Items.Select(i => $"- {Label(i)}")), $"/transmittals/{transmittal.Id}", cancellationToken,
            Notifications.EmailKinds.Transmittal);
        await db.SaveChangesAsync(cancellationToken);
        return (transmittal, null);
    }

    // ── Registering what came unplanned ───────────────────────────────────────

    /// <summary>
    /// Document Control puts an unplanned item in our register: a new document under our numbering, originated by the
    /// sender, whose first revision is the files that came. The item then points at it.
    /// </summary>
    public async Task<(Transmittal? Transmittal, IResult? Problem)> RegisterAsync(
        ProjectAccess access, Guid transmittalId, Guid itemId, RegisterDocumentRequest request, CancellationToken cancellationToken)
    {
        if (!access.IsInternal || !access.Holds(Verbs.Control))
            return (null, Problems.Forbidden("CONTROL_ONLY", "Document Control decides what goes into the register."));
        var transmittal = await transmittals.Visible(access).Include(t => t.Items).Include(t => t.Recipients).AsSplitQuery()
            .SingleOrDefaultAsync(t => t.Id == transmittalId, cancellationToken);
        var item = transmittal?.Items.SingleOrDefault(i => i.Id == itemId);
        if (item is null) return (null, Problems.NotFound("ITEM_NOT_FOUND", "No such item."));
        if (item.Kind != TransmittalItemKinds.Unplanned)
            return (null, Problems.Conflict("NOT_UNPLANNED", "Only an unplanned item is registered; the others are in the register already."));
        if (item.RegisteredAt is not null)
            return (null, Problems.Conflict("ALREADY_REGISTERED", "It is in the register already.", new { documentId = item.DocumentId }));
        var files = await db.StoredFiles.Where(f => f.TransmittalItemId == item.Id).ToListAsync(cancellationToken);
        if (files.Any(f => f.Status != FileStatuses.Clean))
            return (null, Problems.Conflict("FILES_NOT_READY", "Its files are not all scanned and clean."));
        var party = await db.Parties.AsNoTracking().SingleAsync(p => p.Id == transmittal!.FromPartyId, cancellationToken);

        var (document, problem) = await documents.RegisterAsync(access, request with
        {
            Title = string.IsNullOrWhiteSpace(request.Title) ? item.Title : request.Title,
            DocType = string.IsNullOrWhiteSpace(request.DocType) ? item.DocType : request.DocType,
            Originator = party.Code,
            ReceivedDate = request.ReceivedDate ?? transmittal!.IssuedAt.InZone(DateTimeZoneProviders.Tzdb[access.Project.TimeZone]).Date.ToDateOnly(),
        }, cancellationToken);
        if (problem is not null) return (null, problem);
        var (revision, adoptProblem) = await documents.AdoptAsync(access, document!, files, party.Code, item.StatusCode,
            transmittal!.IssuedAt, transmittal.IssuedByName, cancellationToken);
        if (adoptProblem is not null) return (null, adoptProblem);
        item.DocumentId = document!.Id;
        item.RevisionId = revision!.Id;
        item.RevisionValue = revision.Value;
        item.RegisteredAt = clock.GetCurrentInstant();
        item.RegisteredByName = access.UserName;
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "UNPLANNED_REGISTERED", "Transmittal", transmittal.Id,
            transmittal.Number, $"{Label(item)} registered as {document.Number}.", access.Project.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (transmittal, null);
    }

    // ── Receipt ───────────────────────────────────────────────────────────────

    /// <summary>
    /// The receipt of an incoming transmittal as a PDF: its number, when it was received, from whom, and each item
    /// with every file's name, size and SHA-256. Built from the record each time, so it always says the same thing.
    /// Null when it is not an incoming transmittal the caller may see.
    /// </summary>
    public async Task<(string Number, byte[] Pdf)?> ReceiptAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var t = await transmittals.Visible(access).AsNoTracking().Include(x => x.Items)
            .SingleOrDefaultAsync(x => x.Id == id && x.Direction == TransmittalDirections.Incoming, cancellationToken);
        if (t is null) return null;
        var files = await transmittals.ItemFilesAsync(t, cancellationToken);
        var zone = DateTimeZoneProviders.Tzdb.GetZoneOrNull(access.Project.TimeZone) ?? DateTimeZone.Utc;
        var received = t.IssuedAt.InZone(zone);

        using var pdf = new PdfDocument();
        pdf.Info.Title = $"Receipt {t.Number}";
        var title = new XFont(EmbeddedFonts.Family, 15, XFontStyleEx.Bold);
        var bold = new XFont(EmbeddedFonts.Family, 9, XFontStyleEx.Bold);
        var text = new XFont(EmbeddedFonts.Family, 9, XFontStyleEx.Regular);
        var small = new XFont(EmbeddedFonts.Family, 7, XFontStyleEx.Regular);
        PdfPage page = null!;
        XGraphics gfx = null!;
        double y = 0;
        void NewPage()
        {
            gfx?.Dispose();
            page = pdf.AddPage();
            gfx = XGraphics.FromPdfPage(page);
            y = 50;
        }
        void Line(string s, XFont font, double x = 50, double step = 13)
        {
            if (y > page.Height.Point - 60) NewPage();
            gfx.DrawString(s, font, XBrushes.Black, x, y);
            y += step;
        }
        NewPage();
        Line("RECEIPT", title, step: 22);
        Line($"Transmittal {t.Number}", bold);
        Line($"Received {received.ToString("d MMMM yyyy, HH:mm:ss", CultureInfo.InvariantCulture)} ({zone.Id})", text);
        Line($"From {t.FromName}, sent by {t.IssuedByName}", text);
        if (t.TheirReference is not null) Line($"Their reference: {t.TheirReference}", text);
        Line($"To {t.ToName}, for {t.Reason}", text);
        Line($"Project {access.Project.Code} · {access.Project.Name}", text, step: 20);
        Line($"{t.Items.Count} item(s). Each file is identified by its SHA-256: a file with the same fingerprint is the file received.", small, step: 16);
        foreach (var item in t.Items.OrderBy(i => i.DocumentNumber).ThenBy(i => i.Title))
        {
            var kind = item.Kind switch
            {
                TransmittalItemKinds.Submission => $"rev {item.RevisionValue}, submission {item.Submission}, sent for {item.StatusCode}",
                TransmittalItemKinds.Unplanned => $"unplanned{(item.DocType is null ? "" : $" {item.DocType}")}",
                _ => $"rev {item.RevisionValue}{(item.StatusCode is null ? "" : $" · {item.StatusCode}")}",
            };
            Line($"{(item.DocumentNumber.Length > 0 ? item.DocumentNumber + "  " : "")}{Cut(item.Title, 70)}", bold);
            Line(kind, text, 62);
            foreach (var f in TransmittalService.FilesOf(item, files))
            {
                Line($"{Cut(f.Name, 60)} · {f.Size:N0} bytes", text, 62, 11);
                Line($"SHA-256 {f.Sha256}", small, 62, 12);
            }
            y += 4;
        }
        y += 8;
        Line("This receipt records what arrived and when. Document Control's check on arrival follows; what it decides is recorded on each document.", small);
        gfx.Dispose();
        using var output = new MemoryStream();
        pdf.Save(output);
        return (t.Number, output.ToArray());
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>Another organization's people send to us; Document Control may record what one sent outside the system.</summary>
    private static bool MaySend(ProjectAccess access) =>
        access.Holds(Verbs.Read) && (!access.IsInternal || access.Holds(Verbs.Control));

    /// <summary>
    /// Who is sending: the caller's own organization, or, for Document Control recording it, the organization named.
    /// </summary>
    private async Task<(Party? Party, bool OnBehalf, IResult? Problem)> SenderAsync(
        ProjectAccess access, Guid? fromPartyId, CancellationToken cancellationToken)
    {
        if (!MaySend(access))
            return (null, false, Problems.Forbidden("SEND_NOT_ALLOWED", "Only another organization, or Document Control for one, sends to us."));
        if (!access.IsInternal)
        {
            var own = await db.Parties.AsNoTracking().SingleOrDefaultAsync(p => p.Code == access.PartyCode, cancellationToken);
            if (own is null || (fromPartyId is { } other && other != own.Id))
                return (null, false, Problems.Forbidden("NOT_YOUR_ORGANIZATION", "You send for your own organization only."));
            return (own, false, null);
        }
        if (fromPartyId is null)
            return (null, false, Problems.Invalid("SENDER_REQUIRED", "Say which organization sent it."));
        var party = await db.Parties.AsNoTracking().SingleOrDefaultAsync(p => p.Id == fromPartyId && p.Active && !p.IsInternal, cancellationToken);
        return party is null
            ? (null, false, Problems.Invalid("PARTY_UNKNOWN", "That is not an active outside organization."))
            : (party, true, null);
    }

    /// <summary>Uploaded files that belong to no document yet, uploaded by the caller and not used, each arrived.</summary>
    private async Task<(List<StoredFile>? Files, IResult? Problem)> LooseFilesAsync(
        ProjectAccess access, Guid[]? requested, bool proof, CancellationToken cancellationToken)
    {
        var ids = requested?.Distinct().ToList() ?? [];
        if (ids.Count is 0 or > 20) return (null, Problems.Invalid("FILES_REQUIRED", "Each item carries between 1 and 20 files."));
        var files = await db.StoredFiles.Where(f => ids.Contains(f.Id) && f.ProjectId == access.Project.Id && f.DocumentId == null
                && f.RevisionId == null && f.TransmittalItemId == null && f.UploadedById == access.UserId
                && f.Status == FileStatuses.AwaitingUpload && (f.Kind == FileKinds.Evidence) == proof)
            .ToListAsync(cancellationToken);
        if (files.Count != ids.Count)
        {
            return (null, Problems.Invalid("FILE_NOT_AVAILABLE", "Some files were not uploaded by you for this, or are already used.",
                new { fileIds = ids.Except(files.Select(f => f.Id)) }));
        }
        foreach (var file in files)
        {
            if (await Uploads.ArrivedAsync(storage, file, cancellationToken) is { } missing) return (null, missing);
        }
        return (files, null);
    }

    /// <summary>Sends a file for scanning, through the outbox.</summary>
    private void Process(StoredFile file)
    {
        file.Status = FileStatuses.Processing;
        db.Enqueue(FileUploaded.RoutingKey, new FileUploaded(file.TenantId, file.Id));
    }

    /// <summary>A transmittal line for a document's revision.</summary>
    private static TransmittalItem Item(Transmittal t, string kind, Document document, Revision revision, string? status, int? submission) => new()
    {
        TenantId = t.TenantId,
        TransmittalId = t.Id,
        Kind = kind,
        DocumentId = document.Id,
        RevisionId = revision.Id,
        DocumentNumber = document.Number,
        Title = document.Title,
        RevisionValue = revision.Value,
        StatusCode = status,
        Submission = submission,
    };

    /// <summary>How an item is named in the audit trail and the subject.</summary>
    private static string Label(TransmittalItem i) => i.Kind == TransmittalItemKinds.Unplanned
        ? (i.DocumentNumber.Length > 0 ? $"{i.DocumentNumber} {i.Title}" : i.Title)
        : $"{i.DocumentNumber} rev {i.RevisionValue}";

    private static string Cut(string s, int max) => s.Length <= max ? s : s[..(max - 1)] + "…";
    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
