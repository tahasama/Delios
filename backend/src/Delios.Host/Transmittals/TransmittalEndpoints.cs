using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Transmittals;

/// <summary>
/// A project member as shown when choosing who receives a revision: name, project function and organization.
/// </summary>
public sealed record Person(Guid Id, string Name, string Function, string? Organization);
/// <summary>
/// An outside organization (a party) that can be chosen as a recipient, with how it takes part on the project (in the
/// app, or by proxy through one of our people).
/// </summary>
public sealed record PartyChoice(Guid Id, string Code, string Name, string Participation);
/// <summary>
/// Answer of the distribution endpoint: people proposed by the permission matrix, everyone else on the project, and the
/// outside parties that can be chosen.
/// </summary>
public sealed record DistributionView(IReadOnlyList<Person> Proposed, IReadOnlyList<Person> Others, IReadOnlyList<PartyChoice> Parties);

/// <summary>
/// An issue request as returned to the browser, with the numbers of the transmittals that carried it out.
/// </summary>
public sealed record IssueRequestView(Guid Id, Guid RevisionId, string Reason, IReadOnlyList<Guid> UserIds,
    IReadOnlyList<Guid> PartyIds, string? Note, string? OffDistributionReason, string RaisedBy, DateTimeOffset RaisedAt,
    string Status, DateTimeOffset? ClosedAt, string? ClosedBy, IReadOnlyList<string> Transmittals, Guid RaisedById = default,
    IReadOnlyList<Guid>? TransmittalIds = null, bool Delegated = false, Guid? ApproverPartyId = null, string? ApprovalState = null);

/// <summary>
/// Answer after asking for or carrying out an issue request: the request and the numbers of any transmittals raised.
/// </summary>
public sealed record IssueOutcome(IssueRequestView Request, IReadOnlyList<string> Transmittals);

/// <summary>
/// One row of the transmittal list, with counts of items, recipients, acknowledgements and recipients still waiting to
/// be sent it by hand.
/// </summary>
public sealed record TransmittalSummary(Guid Id, string Number, string Reason, string Subject, string To, DateTimeOffset IssuedAt,
    string IssuedBy, DateOnly? ResponseDue, int Items, int Recipients, int Acknowledged, int AwaitingDispatch);

/// <summary>
/// One item of a transmittal as returned to the browser: a revision, a placeholder asked for, a submission received,
/// or something unplanned received. <c>Files</c> are those it carried, each with its SHA-256, the receipt's proof.
/// </summary>
public sealed record TransmittalItemView(Guid Id, string Kind, Guid? DocumentId, Guid? RevisionId, string DocumentNumber, string Title,
    string Revision, string? Status, DateOnly? DueDate, int? Submission, string? DocType, DateTimeOffset? RegisteredAt,
    string? RegisteredBy, IReadOnlyList<ItemFileView> Files);

/// <summary>A file a transmittal item carried.</summary>
public sealed record ItemFileView(Guid Id, string Name, long Size, string Sha256, string Status);

/// <summary>
/// One recipient of a transmittal as returned to the browser. <c>Person</c> is false for an organization that receives
/// by proxy; the dispatch fields record how one of ours sent it outside the system.
/// </summary>
public sealed record RecipientView(Guid Id, string Name, string? Organization, bool Person, DateTimeOffset? OpenedAt,
    DateTimeOffset? AcknowledgedAt, DateTimeOffset? DispatchedAt, string? DispatchChannel, string? DispatchRef,
    string? DispatchedBy, Guid? ProofFileId, string Kind = RecipientKinds.To, Guid? UserId = null, Guid? PartyId = null,
    DateTimeOffset? NotifiedAt = null, int ViewCount = 0, DateTimeOffset? LastViewedAt = null);

/// <summary>Another transmittal of the same exchange, as a transmittal page links to it.</summary>
public sealed record TransmittalRef(Guid Id, string Number, string Subject, DateTimeOffset IssuedAt, string Direction, string? FollowKind,
    int Items, int Recipients, string IssuedBy, string? From);

/// <summary>What a transmittal answers and follows, and what answered and followed it.</summary>
public sealed record TransmittalThread(TransmittalRef? InReplyTo, IReadOnlyList<TransmittalRef> Answers, TransmittalRef? Follows,
    IReadOnlyList<TransmittalRef> FollowedBy);

/// <summary>Body of telling people again: the recipients to tell; none means everybody it is for who has not acknowledged it.</summary>
public sealed record NotifyAgainRequest(Guid[]? RecipientIds = null);

/// <summary>
/// Full detail of one transmittal (a numbered record that documents were sent to someone), as returned to the browser.
/// </summary>
public sealed record TransmittalView(Guid Id, string Number, string Direction, string Reason, string Subject, string? Message,
    string To, bool ResponseRequired, DateOnly? ResponseDue, DateTimeOffset IssuedAt, string IssuedBy, Guid? IssueRequestId,
    Guid? ReviewStepId, IReadOnlyList<TransmittalItemView> Items, IReadOnlyList<RecipientView> Recipients,
    string? From = null, string? TheirReference = null, Guid? ProofFileId = null, Guid? PackageId = null, string State = "ISSUED",
    Guid? IssuedById = null, TransmittalRef? InReplyTo = null, IReadOnlyList<TransmittalRef>? Answers = null, TransmittalRef? Follows = null,
    IReadOnlyList<TransmittalRef>? FollowedBy = null, string? ReceiptNote = null, System.Text.Json.JsonElement? Extras = null,
    string? FollowKind = null);

/// <summary>
/// HTTP endpoints for issuing: distribution, issue requests, transmittals, acknowledgement, dispatch and proof upload.
/// Mapped at startup; all logic lives in <c>TransmittalService</c>.
/// </summary>
public static class TransmittalEndpoints
{
    /// <summary>
    /// Registers the transmittal routes under <c>/api/projects/{projectId}</c>. Every route runs in a database
    /// transaction and checks the caller's access to the project first (endpoint filters).
    /// </summary>
    public static void MapTransmittalEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Transmittals")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();

        project.MapGet("/documents/{documentId:guid}/distribution", DistributionAsync);
        project.MapGet("/revisions/{revisionId:guid}/issue-requests", RequestsAsync);
        project.MapGet("/revisions/{revisionId:guid}/standing", async (Guid revisionId, HttpContext h, TransmittalService s, CancellationToken c) =>
            await s.StandingAsync(ProjectAccessFilter.Of(h), revisionId, c) is { } standing
                ? Results.Ok(standing) : Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        project.MapPost("/revisions/{revisionId:guid}/issue-requests", RequestAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapPost("/issue-requests/{requestId:guid}/carry-out", CarryOutAsync);
        project.MapPost("/issue-requests/{requestId:guid}/cancel", CancelAsync);
        project.MapGet("/not-issued", NotIssuedAsync);
        project.MapGet("/transmittals", ListAsync);
        project.MapPost("/transmittals", ComposeAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapGet("/addressees", AddresseesAsync);
        project.MapGet("/transmittals/{transmittalId:guid}", GetAsync);
        project.MapPost("/transmittals/{transmittalId:guid}/acknowledge", AcknowledgeAsync);
        project.MapGet("/transmittals/drafts", async (HttpContext h, TransmittalService s, CancellationToken c) =>
            Results.Ok((await s.DraftsAsync(ProjectAccessFilter.Of(h), c)).Select(d =>
            {
                var body = System.Text.Json.JsonSerializer.Deserialize<TransmittalService.ComposeRequest>(d.Body)!;
                return new
                {
                    d.Id,
                    d.Subject,
                    CreatedAt = d.CreatedAt.ToDateTimeOffset(),
                    CreatedBy = d.CreatedByName,
                    body.Reason,
                    Documents = body.RevisionIds?.Length ?? 0,
                    People = body.UserIds?.Length ?? 0,
                    Parties = body.PartyIds?.Length ?? 0,
                    Copies = body.CopyUserIds?.Length ?? 0,
                };
            })));
        project.MapPost("/transmittals/{transmittalId:guid}/issue", async (Guid transmittalId, HttpContext h, TransmittalService s, CancellationToken c) =>
        {
            var (sent, problem) = await s.IssueDraftAsync(ProjectAccessFilter.Of(h), transmittalId, c);
            return problem ?? Results.Ok(sent.Select(t => new { t.Id, t.Number, t.ToName }));
        });
        project.MapPost("/transmittals/{transmittalId:guid}/notify-again",
            async (Guid transmittalId, NotifyAgainRequest r, HttpContext h, TransmittalService s, CancellationToken c) =>
            {
                var (t, problem) = await s.NotifyAgainAsync(ProjectAccessFilter.Of(h), transmittalId, r.RecipientIds, c);
                return problem ?? Results.Ok(View(t!, await s.ItemFilesAsync(t!, c)));
            });
        project.MapPost("/transmittals/{transmittalId:guid}/recipients/{recipientId:guid}/dispatch", DispatchAsync);
        project.MapPost("/transmittals/{transmittalId:guid}/evidence", EvidenceAsync);
        project.MapPost("/incoming/uploads", async (LooseUploadRequest r, HttpContext h, IncomingService s, CancellationToken c) =>
        {
            var (ticket, problem) = await s.UploadAsync(ProjectAccessFilter.Of(h), r, c);
            return problem ?? Results.Ok(ticket);
        });
        project.MapPost("/transmittals/incoming", SendIncomingAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapPost("/transmittals/{transmittalId:guid}/items/{itemId:guid}/register", RegisterItemAsync);
        project.MapGet("/transmittals/{transmittalId:guid}/receipt", ReceiptAsync);
    }

    /// <summary>
    /// GET distribution: who should receive a document. Internal users only. Returns 404 when the document is not
    /// visible to the caller.
    /// </summary>
    private static async Task<IResult> DistributionAsync(
        Guid documentId, HttpContext http, DeliosDbContext db, DocumentService documents, TransmittalService transmittals,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal) return Problems.Forbidden("INTERNAL_ONLY", "Distribution is ours to read.");
        var document = await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(cancellationToken))
            .AsNoTracking().SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        return Results.Ok(await transmittals.DistributionAsync(access.Project, document, cancellationToken));
    }

    /// <summary>
    /// GET the issue requests raised for a revision. Returns 404 when the revision is not visible to the caller.
    /// </summary>
    private static async Task<IResult> RequestsAsync(
        Guid revisionId, HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken) =>
        await transmittals.RequestsForAsync(ProjectAccessFilter.Of(http), revisionId, cancellationToken) is { } list
            ? Results.Ok(list)
            : Problems.NotFound("REVISION_NOT_FOUND", "No such revision.");

    /// <summary>
    /// POST a new issue request (ask for a revision to be sent). May be carried out at once when the caller may send
    /// it. Retried POSTs with the same idempotency key are answered once.
    /// </summary>
    private static async Task<IResult> RequestAsync(
        Guid revisionId, IssueAsk ask, HttpContext http, TransmittalService transmittals, Reviews.ReviewService reviews,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (request, sent, problem) = await transmittals.RequestAsync(access, revisionId, ask, cancellationToken);
        if (problem is null && await reviews.OpenApprovalAsync(access, request!, cancellationToken) is { } approval) return approval;
        return problem ?? Results.Created($"/api/projects/{access.Project.Id}/revisions/{revisionId}/issue-requests",
            Outcome(request!, sent));
    }

    /// <summary>POST carry-out: Document Control turns an open issue request into transmittals.</summary>
    private static async Task<IResult> CarryOutAsync(
        Guid requestId, HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var (request, sent, problem) = await transmittals.CarryOutAsync(ProjectAccessFilter.Of(http), requestId, cancellationToken);
        return problem ?? Results.Ok(Outcome(request!, sent));
    }

    /// <summary>
    /// POST cancel: withdraws an open issue request. Allowed to whoever raised it or Document Control.
    /// </summary>
    private static async Task<IResult> CancelAsync(
        Guid requestId, HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var (request, problem) = await transmittals.CancelAsync(ProjectAccessFilter.Of(http), requestId, cancellationToken);
        return problem ?? Results.Ok(TransmittalService.View(request!, []));
    }

    /// <summary>GET not-issued: released revisions nobody has been sent yet. Internal users only.</summary>
    private static async Task<IResult> NotIssuedAsync(HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal) return Problems.Forbidden("INTERNAL_ONLY", "The issue record is ours to read.");
        return Results.Ok(await transmittals.NotIssuedAsync(access, cancellationToken));
    }

    /// <summary><c>POST /transmittals</c>: Document Control issues released revisions directly; one transmittal per destination.</summary>
    private static async Task<IResult> ComposeAsync(
        TransmittalService.ComposeRequest request, HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (request.Draft)
        {
            var (draft, refused) = await transmittals.SaveDraftAsync(access, request, cancellationToken);
            return refused ?? Results.Ok(new[] { new { draft!.Id, Number = "Draft", ToName = draft.Subject } });
        }
        var (sent, problem) = await transmittals.ComposeAsync(access, request, cancellationToken);
        return problem ?? Results.Ok(sent.Select(t => new { t.Id, t.Number, t.ToName }));
    }

    /// <summary><c>GET /addressees</c>: who a transmittal can go to on this project: its active people and the outside parties.</summary>
    private static async Task<IResult> AddresseesAsync(
        HttpContext http, TransmittalService transmittals, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal) return Problems.Forbidden("INTERNAL_ONLY", "Only the project's own people issue transmittals.");
        var members = await transmittals.MembersAsync(access.Project, cancellationToken);
        var parties = await db.Parties.AsNoTracking().Where(p => p.Active && !p.IsInternal).OrderBy(p => p.Name)
            .Select(p => new { p.Id, p.Code, p.Name, p.Participation }).ToListAsync(cancellationToken);
        // Our own organization, for a handover inside it (a package delivered to us).
        var ours = await db.Parties.AsNoTracking().Where(p => p.Active && p.IsInternal).OrderBy(p => p.Code)
            .Select(p => new { p.Id, p.Code, p.Name }).FirstOrDefaultAsync(cancellationToken);
        return Results.Ok(new { people = members.OrderBy(m => m.Name).Select(m => m.View()), parties, ours });
    }

    /// <summary>GET the list of transmittals the caller may see, newest first.</summary>
    private static async Task<IResult> ListAsync(HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken) =>
        Results.Ok(await transmittals.ListAsync(ProjectAccessFilter.Of(http), cancellationToken));

    /// <summary>
    /// POST an incoming transmittal: another organization (or Document Control for one) sends filled placeholders,
    /// corrections and unplanned items. 201 with the transmittal; it is received, and its receipt exists, from now.
    /// </summary>
    private static async Task<IResult> SendIncomingAsync(
        IncomingRequest request, HttpContext http, IncomingService incoming, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (t, problem) = await incoming.SendAsync(access, request, cancellationToken);
        return problem ?? Results.Created($"/api/projects/{access.Project.Id}/transmittals/{t!.Id}",
            View(t, await transmittals.ItemFilesAsync(t, cancellationToken)));
    }

    /// <summary>POST: Document Control puts an unplanned item of an incoming transmittal in the register, under our numbering.</summary>
    private static async Task<IResult> RegisterItemAsync(
        Guid transmittalId, Guid itemId, RegisterDocumentRequest request, HttpContext http, IncomingService incoming,
        TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var (t, problem) = await incoming.RegisterAsync(ProjectAccessFilter.Of(http), transmittalId, itemId, request, cancellationToken);
        return problem ?? Results.Ok(View(t!, await transmittals.ItemFilesAsync(t!, cancellationToken)));
    }

    /// <summary>GET the receipt of an incoming transmittal, as a PDF.</summary>
    private static async Task<IResult> ReceiptAsync(
        Guid transmittalId, HttpContext http, IncomingService incoming, CancellationToken cancellationToken) =>
        await incoming.ReceiptAsync(ProjectAccessFilter.Of(http), transmittalId, cancellationToken) is { } receipt
            ? Results.File(receipt.Pdf, "application/pdf", $"Receipt {receipt.Number}.pdf")
            : Problems.NotFound("TRANSMITTAL_NOT_FOUND", "No such incoming transmittal.");

    /// <summary>GET one transmittal. Reading it records the caller's first opening when they are a recipient.</summary>
    private static async Task<IResult> GetAsync(
        Guid transmittalId, HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (await transmittals.ReadAsync(access, transmittalId, cancellationToken) is { } t)
            return Results.Ok(View(t, await transmittals.ItemFilesAsync(t, cancellationToken), await transmittals.ThreadAsync(access, t, cancellationToken)));
        // A draft has no number yet; whoever wrote it, and Document Control, see it.
        return await transmittals.DraftAsync(access, transmittalId, cancellationToken) is { IssuedAt: null } draft
            ? Results.Ok(await transmittals.DraftViewAsync(access, draft, cancellationToken))
            : Problems.NotFound("TRANSMITTAL_NOT_FOUND", "No such transmittal.");
    }

    /// <summary>POST acknowledge: a recipient confirms they received the transmittal.</summary>
    private static async Task<IResult> AcknowledgeAsync(
        Guid transmittalId, HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var (t, problem) = await transmittals.AcknowledgeAsync(ProjectAccessFilter.Of(http), transmittalId, cancellationToken);
        return problem ?? Results.Ok(View(t!, await transmittals.ItemFilesAsync(t!, cancellationToken)));
    }

    /// <summary>
    /// POST dispatch: one of ours records that a transmittal went to an outside organization by email, portal or by
    /// hand.
    /// </summary>
    private static async Task<IResult> DispatchAsync(
        Guid transmittalId, Guid recipientId, DispatchRequest request, HttpContext http, TransmittalService transmittals,
        CancellationToken cancellationToken)
    {
        var (t, problem) = await transmittals.DispatchAsync(ProjectAccessFilter.Of(http), transmittalId, recipientId, request,
            cancellationToken);
        return problem ?? Results.Ok(View(t!, await transmittals.ItemFilesAsync(t!, cancellationToken)));
    }

    /// <summary>
    /// POST evidence: returns an upload link for proof that a transmittal was sent outside the system.
    /// </summary>
    private static async Task<IResult> EvidenceAsync(
        Guid transmittalId, UploadRequest request, HttpContext http, TransmittalService transmittals,
        CancellationToken cancellationToken)
    {
        var (ticket, problem) = await transmittals.TransmittalEvidenceAsync(ProjectAccessFilter.Of(http), transmittalId, request,
            cancellationToken);
        return problem ?? Results.Ok(ticket);
    }

    /// <summary>Builds the response body for an issue request and the transmittals it produced.</summary>
    private static IssueOutcome Outcome(IssueRequest request, IReadOnlyList<Transmittal> sent)
    {
        var numbers = sent.Select(t => t.Number).ToList();
        return new IssueOutcome(TransmittalService.View(request, numbers), numbers);
    }

    /// <summary>
    /// Turns a <c>Transmittal</c> database entity into the shape returned to the browser, items sorted by document
    /// number and recipients by name. Also used by other modules.
    /// </summary>
    public static TransmittalView View(Transmittal t, IReadOnlyList<StoredFile>? files = null, TransmittalThread? thread = null) => new(
        t.Id, t.Number, t.Direction, t.Reason, t.Subject, t.Message, t.ToName, t.ResponseRequired, t.ResponseDue?.ToDateOnly(),
        t.IssuedAt.ToDateTimeOffset(), t.IssuedByName, t.IssueRequestId, t.ReviewStepId,
        t.Items.OrderBy(i => i.DocumentNumber).ThenBy(i => i.Title).Select(i => new TransmittalItemView(i.Id, i.Kind, i.DocumentId,
            i.RevisionId, i.DocumentNumber, i.Title, i.RevisionValue, i.StatusCode, i.DueDate?.ToDateOnly(), i.Submission, i.DocType,
            i.RegisteredAt?.ToDateTimeOffset(), i.RegisteredByName,
            TransmittalService.FilesOf(i, files ?? []).Select(f => new ItemFileView(f.Id, f.Name, f.Size, f.Sha256, f.Status)).ToList()))
            .ToList(),
        t.Recipients.OrderBy(r => r.Name).Select(r => new RecipientView(r.Id, r.Name, r.Organization, r.UserId is not null,
            r.OpenedAt?.ToDateTimeOffset(), r.AcknowledgedAt?.ToDateTimeOffset(), r.DispatchedAt?.ToDateTimeOffset(),
            r.DispatchChannel, r.DispatchRef, r.DispatchedByName, r.ProofFileId, r.Kind, r.UserId, r.PartyId, r.NotifiedAt?.ToDateTimeOffset(),
            r.ViewCount, r.LastViewedAt?.ToDateTimeOffset())).ToList(),
        t.FromName, t.TheirReference, t.ProofFileId, t.PackageId, "ISSUED", t.IssuedById, thread?.InReplyTo, thread?.Answers ?? [],
        thread?.Follows, thread?.FollowedBy ?? [], t.ReceiptNote,
        t.Extras is null ? null : System.Text.Json.JsonDocument.Parse(t.Extras).RootElement.Clone(), t.FollowKind);
}
