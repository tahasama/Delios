using Delios.Host.Audit;
using Prometheus;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using NodaTime;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

/// <summary>
/// The HTTP API of the document register: list, read, register, upload files, start and resubmit revisions,
/// and download. Each handler checks access and then hands the work to <see cref="DocumentService"/>.
/// </summary>
public static class DocumentEndpoints
{
    /// <summary>Documents per page when the caller gives no <c>limit</c>.</summary>
    public const int DefaultPageSize = 50;
    /// <summary>The largest <c>limit</c> a caller may ask for; larger values are lowered to this.</summary>
    public const int MaxPageSize = 200;

    /// <summary>
    /// Registers the document routes under <c>/api/projects/{projectId}</c>. Every route runs in one database
    /// transaction and only after the project access check. Called at start-up from <c>PlatformSetup</c>.
    /// </summary>
    public static void MapDocumentEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Documents")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();

        project.MapGet("/documents", ListAsync);
        project.MapGet("/documents/{documentId:guid}", GetAsync);
        project.MapGet("/documents/many", ManyAsync);
        project.MapPost("/documents/{documentId:guid}/viewed", ViewedAsync);
        project.MapPost("/documents", RegisterAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapPost("/documents/check", CheckRegisterAsync);
        project.MapPost("/documents/{documentId:guid}/uploads", RequestUploadAsync);
        project.MapGet("/revisions/{revisionId:guid}", async (Guid revisionId, HttpContext h, DeliosDbContext db, DocumentService documents, CancellationToken c) =>
        {
            // A revision on its own, with the document it belongs to: for screens that hold only a revision's id.
            var access = ProjectAccessFilter.Of(h);
            var revision = await db.Revisions.AsNoTracking().SingleOrDefaultAsync(r => r.Id == revisionId && r.ProjectId == access.Project.Id, c);
            var originator = revision is null ? null : await DocumentQueries.Visible(db, access)
                .Where(d => d.Id == revision.DocumentId).Select(d => new { d.Originator }).SingleOrDefaultAsync(c);
            var visible = originator is not null && (OutsideReading.Whole(access, originator.Originator)
                || await OutsideReading.SentRevisions(db, access).AnyAsync(id => id == revision!.Id, c));
            return visible
                ? Results.Ok(new { revision!.Id, revision.DocumentId, revision.Value, revision.State, revision.StatusCode, revision.AuthoredById, revision.AuthoredByName })
                : Problems.NotFound("REVISION_NOT_FOUND", "No such revision.");
        });
        project.MapPost("/documents/{documentId:guid}/revisions", StartRevisionAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapPost("/documents/{documentId:guid}/revisions/{revisionId:guid}/submissions", ResubmitAsync);
        project.MapPost("/documents/{documentId:guid}/revisions/{revisionId:guid}/files", AttachAsync);
        project.MapPost("/documents/{documentId:guid}/revisions/{revisionId:guid}/update", UpdateFilesAsync);
        project.MapPost("/documents/{documentId:guid}/revisions/{revisionId:guid}/withdraw", WithdrawAsync);
        project.MapPut("/documents/{documentId:guid}", UpdateAsync);
        project.MapPost("/documents/{documentId:guid}/end", EndAsync);
        project.MapPost("/documents/{documentId:guid}/reinstate", ReinstateAsync);
        project.MapGet("/files/{fileId:guid}/download", DownloadAsync);
        project.MapGet("/files/{fileId:guid}/workbook", WorkbookAsync);
        project.MapGet("/files/{fileId:guid}/schedule", ScheduleFileAsync);
        Previews.Map(project);
    }

    /// <summary>
    /// GET /documents: one page of the register the caller may see, filtered and searched by number or title.
    /// Pages are keyed on the document number (<c>after</c>), so later pages are as fast as the first. Runs on the read replica when there is one.
    /// </summary>
    private static async Task<IResult> ListAsync(
        HttpContext http, ReadDatabase reads, DocumentService documents, DeliosDbContext db, CancellationToken cancellationToken,
        string? after = null, int? limit = null, string? q = null,
        string? discipline = null, string? docType = null, string? state = null, string? originator = null)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Read)) return Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register.");
        var size = Math.Clamp(limit ?? DefaultPageSize, 1, MaxPageSize);
        using var timer = AppMetrics.RegisterQuerySeconds.WithLabels(string.IsNullOrWhiteSpace(q) ? "no" : "yes").NewTimer();

        var rows = await reads.ReadAsync(source =>
        {
            var query = DocumentQueries.Visible(source, access).AsNoTracking();
            if (!string.IsNullOrWhiteSpace(q))
            {
                var pattern = "%" + q.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
                query = query.Where(d => EF.Functions.ILike(d.Number, pattern) || EF.Functions.ILike(d.Title, pattern)
                    || source.NumberEquivalents.Any(e => e.DocumentId == d.Id && e.TakenBackAt == null && EF.Functions.ILike(e.Number, pattern)));
            }
            if (discipline is not null) query = query.Where(d => d.Discipline == discipline);
            if (docType is not null) query = query.Where(d => d.DocType == docType);
            if (state is not null) query = query.Where(d => d.State == state);
            if (originator is not null) query = query.Where(d => d.Originator == originator);
            // Keyset paging on the number: page 1000 costs what page 1 costs.
            if (after is not null) query = query.Where(d => string.Compare(d.Number, after) > 0);

            return query.OrderBy(d => d.Number).Take(size + 1)
                .Select(d => new DocumentSummary(d.Id, d.Number, d.Title, d.DeliverableType, d.DocType, d.Discipline,
                    d.Originator, d.State, d.Kind, d.IsPlaceholder, d.Confidentiality, d.LatestRevisionValue,
                    d.LatestRevisionState, d.UpdatedAt.ToDateTimeOffset()))
                .ToListAsync(cancellationToken);
        }, cancellationToken);
        var next = rows.Count > size ? rows[size - 1].Number : null;
        var page = rows.Take(size).ToList();
        if (!access.IsInternal)
        {
            // Another organization reads, of one of our documents, only the newest revision sent to it (OutsideReading).
            var ours = page.Where(r => !OutsideReading.Whole(access, r.Originator)).Select(r => r.Id).ToList();
            var sent = ours.Count == 0 ? [] : (await db.Revisions.AsNoTracking()
                    .Where(v => ours.Contains(v.DocumentId) && OutsideReading.SentRevisions(db, access).Contains(v.Id))
                    .Select(v => new { v.DocumentId, v.Value, v.State, v.CreatedAt }).ToListAsync(cancellationToken))
                .GroupBy(v => v.DocumentId).ToDictionary(g => g.Key, g => g.MaxBy(v => v.CreatedAt)!);
            page = page.Select(r => !ours.Contains(r.Id) ? r : sent.TryGetValue(r.Id, out var v)
                ? r with { LatestRevision = v.Value, LatestRevisionState = v.State } : r with { LatestRevision = null, LatestRevisionState = null }).ToList();
        }
        return Results.Ok(new DocumentPage(page, next));
    }

    /// <summary>GET /documents/{documentId}: one document with all its revisions, submissions and files, if the caller may see it.</summary>
    private static async Task<IResult> GetAsync(
        Guid documentId, HttpContext http, DeliosDbContext db, DocumentService documents, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Read)) return Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register.");
        var document = await DocumentQueries.Visible(db, access)
            .AsNoTracking()
            .Include(d => d.Revisions.OrderBy(r => r.CreatedAt)).ThenInclude(r => r.Files.OrderBy(f => f.Name))
            // One query per collection: a single join would repeat every revision once per file.
            .AsSplitQuery()
            .SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        await RecordViewAsync(http, db, audit, clock, access, documentId, document.Number, cancellationToken);
        // Decided and waiting for release (with what the decider granted), and when each revision first went out.
        var decided = await db.Reviews.AsNoTracking().Where(r => r.DocumentId == documentId && r.State == Reviews.ReviewStates.Decided)
            .Select(r => new { r.RevisionId, r.GrantedStatus }).ToListAsync(cancellationToken);
        var issued = await (from i in db.TransmittalItems
                            join t in db.Transmittals on i.TransmittalId equals t.Id
                            where i.DocumentId == documentId && i.RevisionId != null && t.Direction == Transmittals.TransmittalDirections.Outgoing
                                && t.ReviewStepId == null
                            group t by i.RevisionId into g
                            select new { RevisionId = g.Key!.Value, First = g.Min(t => t.IssuedAt) }).ToDictionaryAsync(x => x.RevisionId, x => x.First, cancellationToken);
        var view = View(document);
        // Clearance is the one confidentiality rule (owner): whoever's function does not reach the document's level reads
        // it only when named on it, so the document page shows who is named, and lets them be named.
        var aboveSome = false;
        if (document.Confidentiality is not null)
        {
            var clearances = await db.Memberships.AsNoTracking().Where(m => m.ProjectId == access.Project.Id && m.Active && m.Function!.Clearance != null)
                .Select(m => m.Function!.Clearance).Distinct().ToListAsync(cancellationToken);
            var ranks = clearances.Count == 0 ? null : await Identity.Clearance.RanksAsync(db, cancellationToken);
            aboveSome = ranks is not null && clearances.Any(c => !Identity.Clearance.Reaches(ranks, c, document.Confidentiality));
        }
        // Another organization reads, of one of our documents, only the revisions sent to it (OutsideReading).
        var readable = await OutsideReading.RevisionsAsync(db, access, document.Id, document.Originator, cancellationToken);
        return Results.Ok(view with
        {
            AboveSomeClearance = aboveSome,
            Revisions = view.Revisions.Where(r => readable is null || readable.Contains(r.Id)).Select(r =>
            {
                var ruling = decided.FirstOrDefault(d => d.RevisionId == r.Id);
                return r with
                {
                    Reading = r.Reading! with
                    {
                        Decided = ruling is not null && r.State is RevisionStates.InReview,
                        Granted = ruling?.GrantedStatus,
                        IssuedAt = issued.TryGetValue(r.Id, out var first) ? first.ToDateTimeOffset() : null,
                    },
                };
            }).ToList(),
        });
    }

    /// <summary>
    /// Who opened it, and when (owner): in the audit trail, once per person and document every half hour, so a page
    /// asking several times reads as one look; only where the organization keeps reading (Settings.Tracking).
    /// </summary>
    private static async Task RecordViewAsync(HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock, ProjectAccess access,
        Guid documentId, string number, CancellationToken cancellationToken)
    {
        var since = clock.GetCurrentInstant() - Duration.FromMinutes(30);
        if (await Settings.Tracking.KeepsReadingAsync(db, cancellationToken)
            && !await db.AuditEvents.AnyAsync(e => e.ActorId == access.UserId && e.EntityId == documentId && e.Action == "DOCUMENT_VIEWED" && e.At > since, cancellationToken))
            await audit.WriteAsync(http.User.Actor(), "DOCUMENT_VIEWED", "Document", documentId, number,
                projectId: access.Project.Id, cancellationToken: cancellationToken);
    }

    /// <summary>
    /// POST /documents/{documentId}/viewed: the document's page was opened. The screens keep the document's answer, so
    /// an opening that did not read it again says so here, after the page is drawn; recorded as an opening once every
    /// half hour, as when it is read.
    /// </summary>
    private static async Task<IResult> ViewedAsync(Guid documentId, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var number = await DocumentQueries.Visible(db, access).Where(d => d.Id == documentId).Select(d => d.Number).SingleOrDefaultAsync(cancellationToken);
        if (number is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        await RecordViewAsync(http, db, audit, clock, access, documentId, number, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// GET /documents/many?ids=…: several documents at once with their revisions and files (a form enclosing them), those
    /// the caller may see, at most 200. In one read, whatever their number; not recorded as opened, nobody opened them.
    /// </summary>
    private static async Task<IResult> ManyAsync(string? ids, HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Read)) return Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register.");
        var wanted = (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(one => Guid.TryParse(one, out var id) ? id : Guid.Empty).Where(id => id != Guid.Empty).Distinct().Take(200).ToList();
        if (wanted.Count == 0) return Results.Ok(Array.Empty<object>());
        var found = await DocumentQueries.Visible(db, access).AsNoTracking().Where(d => wanted.Contains(d.Id))
            .Include(d => d.Revisions.OrderBy(r => r.CreatedAt)).ThenInclude(r => r.Files.OrderBy(f => f.Name))
            .AsSplitQuery().ToListAsync(cancellationToken);
        var sent = access.IsInternal ? null : (await OutsideReading.SentRevisions(db, access).Distinct().ToListAsync(cancellationToken)).ToHashSet();
        return Results.Ok(found.Select(View).Select(v => sent is null || OutsideReading.Whole(access, v.Originator) ? v
            : v with { Revisions = v.Revisions.Where(r => sent.Contains(r.Id)).ToList() }).ToList());
    }

    /// <summary>
    /// POST /documents: registers a new document and returns it with 201 Created. A retried request with the same
    /// <c>Idempotency-Key</c> header gets the first answer back instead of a second document.
    /// </summary>
    private static async Task<IResult> RegisterAsync(
        RegisterDocumentRequest request, HttpContext http, DocumentService documents, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (document, problem) = await documents.RegisterAsync(access, request, cancellationToken);
        return problem ?? Results.Created($"/api/projects/{access.Project.Id}/documents/{document!.Id}", View(document));
    }

    /// <summary>
    /// POST /documents/check: whether this new document would be registered, with every rule registering applies, and
    /// nothing written: 204, or the problem saying what to fix. What a deliverable list is checked with before import.
    /// </summary>
    private static async Task<IResult> CheckRegisterAsync(
        RegisterDocumentRequest request, HttpContext http, DocumentService documents, CancellationToken cancellationToken) =>
        await documents.CheckRegisterAsync(ProjectAccessFilter.Of(http), request, cancellationToken) ?? Results.NoContent();

    /// <summary>POST /documents/{documentId}/uploads: records a file the caller is about to upload and returns a signed upload link.</summary>
    private static async Task<IResult> RequestUploadAsync(
        Guid documentId, UploadRequest request, HttpContext http, DocumentService documents, CancellationToken cancellationToken)
    {
        var (ticket, problem) = await documents.RequestUploadAsync(ProjectAccessFilter.Of(http), documentId, request, cancellationToken);
        return problem ?? Results.Ok(ticket);
    }

    /// <summary>POST /documents/{documentId}/revisions: starts a new revision from files already uploaded, and returns it.</summary>
    private static async Task<IResult> StartRevisionAsync(
        Guid documentId, StartRevisionRequest request, HttpContext http, DocumentService documents,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (revision, problem) = await documents.StartRevisionAsync(access, documentId, request, cancellationToken);
        return problem ?? Results.Created(
            $"/api/projects/{access.Project.Id}/documents/{documentId}", View(revision!));
    }

    /// <summary>POST .../revisions/{revisionId}/submissions: sends corrected files for a revision the control function returned.</summary>
    private static async Task<IResult> ResubmitAsync(
        Guid documentId, Guid revisionId, StartRevisionRequest request, HttpContext http, DocumentService documents,
        CancellationToken cancellationToken)
    {
        var (revision, problem) = await documents.ResubmitAsync(ProjectAccessFilter.Of(http), documentId, revisionId, request,
            cancellationToken);
        return problem ?? Results.Ok(View(revision!));
    }

    /// <summary>PUT /documents/{documentId}: changes the document's metadata, each change audited.</summary>
    private static async Task<IResult> UpdateAsync(
        Guid documentId, UpdateDocumentRequest request, HttpContext http, DocumentService documents, CancellationToken cancellationToken)
    {
        var (_, problem) = await documents.UpdateAsync(ProjectAccessFilter.Of(http), documentId, request, cancellationToken);
        return problem ?? Results.NoContent();
    }

    /// <summary>POST /documents/{documentId}/reinstate: takes a cancellation or withdrawal back, with the reason.</summary>
    private static async Task<IResult> ReinstateAsync(
        Guid documentId, EndDocumentRequest request, HttpContext http, DocumentService documents, CancellationToken cancellationToken)
    {
        var (_, problem) = await documents.ReinstateAsync(ProjectAccessFilter.Of(http), documentId, request, cancellationToken);
        return problem ?? Results.NoContent();
    }

    /// <summary>POST /documents/{documentId}/end: withdraws or cancels the document, with the reason.</summary>
    private static async Task<IResult> EndAsync(
        Guid documentId, EndDocumentRequest request, HttpContext http, DocumentService documents, CancellationToken cancellationToken)
    {
        var (_, problem) = await documents.EndAsync(ProjectAccessFilter.Of(http), documentId, request, cancellationToken);
        return problem ?? Results.NoContent();
    }

    /// <summary>
    /// POST .../revisions/{revisionId}/update: new files for a revision not yet released. One in review is first taken
    /// out of it — the review closes as withdrawn, everyone on it is told, and a reason is required — then the files
    /// come in as a new submission and the revision is sent again from its page.
    /// </summary>
    private static async Task<IResult> UpdateFilesAsync(
        Guid documentId, Guid revisionId, StartRevisionRequest request, HttpContext http, DeliosDbContext db, DocumentService documents,
        Reviews.ReviewService reviews, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var revision = await db.Revisions.AsNoTracking().SingleOrDefaultAsync(r => r.Id == revisionId && r.DocumentId == documentId, cancellationToken);
        if (revision is null) return Problems.NotFound("REVISION_NOT_FOUND", "No such revision.");
        if (revision.AuthoredById != access.UserId && !access.Holds(Verbs.Control))
            return Problems.Forbidden("AUTHOR_OR_CONTROL", "Its author or the control function updates a revision's files.");
        if (revision.State == RevisionStates.InReview)
        {
            var reason = request.ChangeDescription?.Trim() ?? "";
            if (reason.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it is taken out of review: everyone on the route is told.");
            if (await reviews.WithdrawForUpdateAsync(access, revisionId, reason, cancellationToken) is { } refused) return refused;
            await db.SaveChangesAsync(cancellationToken);
        }
        var (updated, problem) = await documents.UpdateFilesAsync(access, documentId, revisionId, request, cancellationToken);
        return problem ?? Results.Ok(View(updated!));
    }

    /// <summary>
    /// POST .../revisions/{revisionId}/withdraw: its author or the control function takes a revision out of its review to
    /// edit it. The review closes as withdrawn, comments kept, everyone on it told; the revision is in preparation again.
    /// </summary>
    private static async Task<IResult> WithdrawAsync(
        Guid documentId, Guid revisionId, StartRevisionRequest request, HttpContext http, DeliosDbContext db,
        Reviews.ReviewService reviews, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var revision = await db.Revisions.AsNoTracking().SingleOrDefaultAsync(r => r.Id == revisionId && r.DocumentId == documentId, cancellationToken);
        if (revision is null) return Problems.NotFound("REVISION_NOT_FOUND", "No such revision.");
        if (revision.State != RevisionStates.InReview)
            return Problems.Conflict("NOT_IN_REVIEW", $"Revision {revision.Value} is not in review.");
        var reason = request.ChangeDescription?.Trim() ?? "";
        if (reason.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it is taken out of review: everyone on the route is told.");
        if (await reviews.WithdrawForUpdateAsync(access, revisionId, reason, cancellationToken) is { } refused) return refused;
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>POST .../revisions/{revisionId}/files: attaches files to a revision still in preparation.</summary>
    private static async Task<IResult> AttachAsync(
        Guid documentId, Guid revisionId, StartRevisionRequest request, HttpContext http, DocumentService documents,
        CancellationToken cancellationToken)
    {
        var (revision, problem) = await documents.AttachAsync(ProjectAccessFilter.Of(http), documentId, revisionId, request,
            cancellationToken);
        return problem ?? Results.Ok(View(revision!));
    }

    /// <summary>
    /// GET /files/{fileId}/download: returns a short-lived download link for a file that passed scanning,
    /// if the caller may see its document. Every download is written to the audit trail.
    /// </summary>
    private static async Task<IResult> DownloadAsync(
        Guid fileId, HttpContext http, DeliosDbContext db, DocumentService documents, Transmittals.TransmittalService transmittals,
        FileStorage storage, AuditLog audit, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (file, refused) = await ReadableAsync(fileId, access, db, transmittals, cancellationToken);
        if (file is null) return refused!;

        var (url, expires) = storage.PresignDownload(file.ObjectKey, file.Name);
        // Kept where the organization keeps reading (Settings.Tracking).
        if (await Settings.Tracking.KeepsReadingAsync(db, cancellationToken))
            await audit.WriteAsync(http.User.Actor(), "DOWNLOAD", "StoredFile", file.Id, file.Name,
            projectId: access.Project.Id, cancellationToken: cancellationToken);
        return Results.Ok(new DownloadTicket(url, expires.ToDateTimeOffset()));
    }

    /// <summary>
    /// The file this person may open, once it passed scanning, else why not. A file of a document is read by whoever
    /// reads the document; one that came on a transmittal and belongs to no document yet (an unplanned item, a covering
    /// letter), by whoever sees that transmittal.
    /// </summary>
    internal static async Task<(StoredFile? File, IResult? Refused)> ReadableAsync(Guid fileId, ProjectAccess access, DeliosDbContext db,
        Transmittals.TransmittalService transmittals, CancellationToken cancellationToken)
    {
        if (!access.Holds(Verbs.Read)) return (null, Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register."));
        var file = await db.StoredFiles.AsNoTracking()
            .SingleOrDefaultAsync(f => f.Id == fileId && f.ProjectId == access.Project.Id, cancellationToken);
        var visible = file is not null && (file.DocumentId is { } documentId
            ? await DocumentQueries.Visible(db, access).Where(d => d.Id == documentId).Select(d => d.Originator).ToListAsync(cancellationToken) is [var originator]
                // Another organization opens, of one of our documents, only the files of a revision sent to it.
                && (OutsideReading.Whole(access, originator)
                    || (file.RevisionId is { } revisionId && await OutsideReading.SentRevisions(db, access).AnyAsync(id => id == revisionId, cancellationToken)))
            : await transmittals.Visible(access).AnyAsync(t => t.ProofFileId == file.Id
                || t.Items.Any(i => i.Id == file.TransmittalItemId), cancellationToken));
        if (file is null || !visible) return (null, Problems.NotFound("FILE_NOT_FOUND", "No such file."));
        if (file.Status != FileStatuses.Clean)
            return (null, Problems.Conflict("FILE_NOT_AVAILABLE", "The file can be downloaded only once it has passed scanning.",
                new { status = file.Status }));
        return (file, null);
    }

    /// <summary>
    /// <c>GET /files/{fileId}/workbook</c>: an Excel workbook (.xlsx, .xlsm) read for the screen (owner: "excel workbook
    /// view"), every sheet as the text its cells show (<see cref="WorkbookView"/>). Nothing in it runs.
    /// </summary>
    private static async Task<IResult> WorkbookAsync(Guid fileId, HttpContext http, DeliosDbContext db, Transmittals.TransmittalService transmittals,
        FileStorage storage, Microsoft.Extensions.Options.IOptions<PreviewOptions> previews, CancellationToken cancellationToken)
    {
        var (file, refused) = await ReadableAsync(fileId, ProjectAccessFilter.Of(http), db, transmittals, cancellationToken);
        if (file is null) return refused!;
        if (!WorkbookView.CanShow(file.Name))
            return Problems.Invalid("NOT_A_WORKBOOK", $"{file.Name} is not an Excel workbook (.xlsx, .xls) or a CSV file: download it to open it.");
        if (await Viewers.OffRefusalAsync(db, ProjectAccessFilter.Of(http).Project.Id, Viewers.Workbooks, file.Name, previews.Value, cancellationToken) is { } off) return off;
        if (file.Size > WorkbookView.MaxBytes)
            return Problems.Invalid("WORKBOOK_TOO_LARGE", $"{file.Name} is larger than {WorkbookView.MaxBytes / 1024 / 1024} MB: download it to open it.");
        await using var content = await storage.OpenReadAsync(file.ObjectKey, cancellationToken);
        if (file.Name.EndsWith(".csv", StringComparison.OrdinalIgnoreCase)) return Results.Ok(WorkbookView.ReadCsv(content, file.Name));
        if (file.Name.EndsWith(".xls", StringComparison.OrdinalIgnoreCase))
        {
            var (old, oldProblem) = WorkbookView.ReadXls(content);
            return old is null ? Problems.Invalid("WORKBOOK_UNREADABLE", $"{file.Name}: {oldProblem} Download it to open it.") : Results.Ok(old);
        }
        var (book, problem) = await WorkbookView.ReadAsync(content, cancellationToken);
        return book is null ? Problems.Invalid("WORKBOOK_UNREADABLE", $"{file.Name}: {problem} Download it to open it.") : Results.Ok(book);
    }

    /// <summary>
    /// <c>GET /files/{fileId}/schedule</c>: a Primavera P6 export (.xer) read for the screen (owner: "can i preview the
    /// xer content too?"), every project with its WBS and activities, as the schedule reads it (<see cref="Actions.XerReader"/>).
    /// </summary>
    private static async Task<IResult> ScheduleFileAsync(Guid fileId, HttpContext http, DeliosDbContext db, Transmittals.TransmittalService transmittals,
        FileStorage storage, Microsoft.Extensions.Options.IOptions<PreviewOptions> previews, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (file, refused) = await ReadableAsync(fileId, access, db, transmittals, cancellationToken);
        if (file is null) return refused!;
        if (!Actions.XerReader.IsXer(file.Name))
            return Problems.Invalid("NOT_A_SCHEDULE", $"{file.Name} is not a Primavera P6 export (.xer): download it to open it.");
        if (await Viewers.OffRefusalAsync(db, access.Project.Id, Viewers.Schedules, file.Name, previews.Value, cancellationToken) is { } off) return off;
        await using var content = await storage.OpenReadAsync(file.ObjectKey, cancellationToken);
        var chosen = (await db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id, cancellationToken))?.Columns.Sheet;
        var reading = Actions.XerReader.Outline(content, chosen ?? access.Project.Code);
        if (reading.Projects.Length == 0) return Problems.Invalid("SCHEDULE_UNREADABLE", $"{file.Name}: {reading.Error} Download it to open it.");
        const int most = 20_000;
        var shown = reading.Projects.Select(p => p.Activities.Length > most ? p with { Activities = p.Activities[..most] } : p).ToArray();
        return Results.Ok(new
        {
            projects = shown,
            cut = reading.Projects.Any(p => p.Activities.Length > most),
            // What the schedule would make of it: read for ours, or why not.
            read = reading.Error,
            // The project the schedule reads, opened first (owner: the preview and the plan must count the same).
            readId = reading.ReadId,
        });
    }

    /// <summary>Turns a document entity (database row) into the shape the API returns.</summary>
    internal static DocumentView View(Document d) => new(
        d.Id, d.Number, d.Title, d.DeliverableType, d.DocType, d.Discipline, d.Originator, d.Subproject, d.ContractRef,
        d.Criticality, d.Confidentiality, d.RetentionClass, d.State, d.Kind, d.IsPlaceholder,
        d.ReceivedDate?.ToDateOnly(), d.PlannedDate?.ToDateOnly(), d.CreatedByName,
        d.CreatedAt.ToDateTimeOffset(), d.UpdatedAt.ToDateTimeOffset(), d.Revisions.Select(View).ToList(), d.CreatedById,
        d.LegalHold, d.LegalHoldReason, d.PreviousNumber, d.LegacyScheme, d.AppVersion,
        d.Extras is null ? null : System.Text.Json.JsonDocument.Parse(d.Extras).RootElement.Clone(), d.ConfirmedAt?.ToDateTimeOffset(),
        d.ConfirmedByName, d.CorrectsId, d.LegalHoldAt?.ToDateTimeOffset(), d.LegalHoldByName,
        Written.Of(d.LegalHoldLiftedAt, d.LegalHoldLiftedByName, d.LegalHoldLiftReason), Written.Of(d.EndedAt, d.EndedByName, d.EndReason),
        Written.Of(d.ReinstatedAt, d.ReinstatedByName, d.ReinstateReason),
        d.WithSupplier, d.Phase, d.AsReceived);

    /// <summary>Turns a revision entity, with its submissions and files, into the shape the API returns.</summary>
    private static RevisionView View(Revision r) => new(
        r.Id, r.Value, r.Series, r.State, r.FilesState, r.ReasonForRevision, r.ChangeDescription, r.AuthoredByName,
        r.CreatedAt.ToDateTimeOffset(), r.StatusCode, r.ReleasedAt?.ToDateTimeOffset(), r.SupersededAt?.ToDateTimeOffset(),
        r.ReturnedReason, r.Submission, r.ControlOutcome,
        r.Submissions.OrderBy(x => x.Number).Select(x => new SubmissionView(x.Number, x.SubmittedAt.ToDateTimeOffset(),
            x.SubmittedByName, x.Outcome, x.Note, x.DecidedByName, x.DecidedAt?.ToDateTimeOffset())).ToList(),
        r.Files.Select(f => new FileView(f.Id, f.Name, f.Kind, f.ContentType, f.Size, f.Sha256, f.Status,
            f.StatusDetail, f.DetectedType, f.CreatedAt.ToDateTimeOffset(), f.DerivedFromId, f.Submission)).ToList(),
        r.AuthoredById, r.AuthoredByParty, r.ReleasedByName, r.ReturnedAt?.ToDateTimeOffset(), r.HeldAt?.ToDateTimeOffset(), r.HeldReason,
        r.HeldByName, r.VoidedAt?.ToDateTimeOffset(), r.VoidReason, r.VoidAuthority, r.VoidReassessment,
        Written.Of(r.UnvoidedAt, r.UnvoidedByName, r.UnvoidReason), Written.Of(r.ResentAt, r.ResentByName, r.ResentNote ?? ""),
        RevisionReading.Of(r), r.Phase, r.TheirStatus, r.TheirOutcome);
}
