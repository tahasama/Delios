using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Transmittals;

public sealed record Person(Guid Id, string Name, string Function, string? Organization);
public sealed record PartyChoice(Guid Id, string Code, string Name, string Participation);
public sealed record DistributionView(IReadOnlyList<Person> Proposed, IReadOnlyList<Person> Others, IReadOnlyList<PartyChoice> Parties);

public sealed record IssueRequestView(Guid Id, Guid RevisionId, string Reason, IReadOnlyList<Guid> UserIds,
    IReadOnlyList<Guid> PartyIds, string? Note, string? OffDistributionReason, string RaisedBy, DateTimeOffset RaisedAt,
    string Status, DateTimeOffset? ClosedAt, string? ClosedBy, IReadOnlyList<string> Transmittals);

public sealed record IssueOutcome(IssueRequestView Request, IReadOnlyList<string> Transmittals);

public sealed record TransmittalSummary(Guid Id, string Number, string Reason, string Subject, string To, DateTimeOffset IssuedAt,
    string IssuedBy, DateOnly? ResponseDue, int Items, int Recipients, int Acknowledged, int AwaitingDispatch);

public sealed record TransmittalItemView(Guid DocumentId, Guid RevisionId, string DocumentNumber, string Title, string Revision,
    string? Status);

public sealed record RecipientView(Guid Id, string Name, string? Organization, bool Person, DateTimeOffset? OpenedAt,
    DateTimeOffset? AcknowledgedAt, DateTimeOffset? DispatchedAt, string? DispatchChannel, string? DispatchRef,
    string? DispatchedBy, Guid? ProofFileId);

public sealed record TransmittalView(Guid Id, string Number, string Direction, string Reason, string Subject, string? Message,
    string To, bool ResponseRequired, DateOnly? ResponseDue, DateTimeOffset IssuedAt, string IssuedBy, Guid? IssueRequestId,
    Guid? ReviewStepId, IReadOnlyList<TransmittalItemView> Items, IReadOnlyList<RecipientView> Recipients);

public static class TransmittalEndpoints
{
    public static void MapTransmittalEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Transmittals")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();

        project.MapGet("/documents/{documentId:guid}/distribution", DistributionAsync);
        project.MapGet("/revisions/{revisionId:guid}/issue-requests", RequestsAsync);
        project.MapPost("/revisions/{revisionId:guid}/issue-requests", RequestAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapPost("/issue-requests/{requestId:guid}/carry-out", CarryOutAsync);
        project.MapPost("/issue-requests/{requestId:guid}/cancel", CancelAsync);
        project.MapGet("/not-issued", NotIssuedAsync);
        project.MapGet("/transmittals", ListAsync);
        project.MapGet("/transmittals/{transmittalId:guid}", GetAsync);
        project.MapPost("/transmittals/{transmittalId:guid}/acknowledge", AcknowledgeAsync);
        project.MapPost("/transmittals/{transmittalId:guid}/recipients/{recipientId:guid}/dispatch", DispatchAsync);
        project.MapPost("/transmittals/{transmittalId:guid}/evidence", EvidenceAsync);
    }

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

    private static async Task<IResult> RequestsAsync(
        Guid revisionId, HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken) =>
        await transmittals.RequestsForAsync(ProjectAccessFilter.Of(http), revisionId, cancellationToken) is { } list
            ? Results.Ok(list)
            : Problems.NotFound("REVISION_NOT_FOUND", "No such revision.");

    private static async Task<IResult> RequestAsync(
        Guid revisionId, IssueAsk ask, HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (request, sent, problem) = await transmittals.RequestAsync(access, revisionId, ask, cancellationToken);
        return problem ?? Results.Created($"/api/projects/{access.Project.Id}/revisions/{revisionId}/issue-requests",
            Outcome(request!, sent));
    }

    private static async Task<IResult> CarryOutAsync(
        Guid requestId, HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var (request, sent, problem) = await transmittals.CarryOutAsync(ProjectAccessFilter.Of(http), requestId, cancellationToken);
        return problem ?? Results.Ok(Outcome(request!, sent));
    }

    private static async Task<IResult> CancelAsync(
        Guid requestId, HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var (request, problem) = await transmittals.CancelAsync(ProjectAccessFilter.Of(http), requestId, cancellationToken);
        return problem ?? Results.Ok(TransmittalService.View(request!, []));
    }

    private static async Task<IResult> NotIssuedAsync(HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal) return Problems.Forbidden("INTERNAL_ONLY", "The issue record is ours to read.");
        return Results.Ok(await transmittals.NotIssuedAsync(access, cancellationToken));
    }

    private static async Task<IResult> ListAsync(HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken) =>
        Results.Ok(await transmittals.ListAsync(ProjectAccessFilter.Of(http), cancellationToken));

    private static async Task<IResult> GetAsync(
        Guid transmittalId, HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken) =>
        await transmittals.ReadAsync(ProjectAccessFilter.Of(http), transmittalId, cancellationToken) is { } t
            ? Results.Ok(View(t))
            : Problems.NotFound("TRANSMITTAL_NOT_FOUND", "No such transmittal.");

    private static async Task<IResult> AcknowledgeAsync(
        Guid transmittalId, HttpContext http, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var (t, problem) = await transmittals.AcknowledgeAsync(ProjectAccessFilter.Of(http), transmittalId, cancellationToken);
        return problem ?? Results.Ok(View(t!));
    }

    private static async Task<IResult> DispatchAsync(
        Guid transmittalId, Guid recipientId, DispatchRequest request, HttpContext http, TransmittalService transmittals,
        CancellationToken cancellationToken)
    {
        var (t, problem) = await transmittals.DispatchAsync(ProjectAccessFilter.Of(http), transmittalId, recipientId, request,
            cancellationToken);
        return problem ?? Results.Ok(View(t!));
    }

    private static async Task<IResult> EvidenceAsync(
        Guid transmittalId, UploadRequest request, HttpContext http, TransmittalService transmittals,
        CancellationToken cancellationToken)
    {
        var (ticket, problem) = await transmittals.TransmittalEvidenceAsync(ProjectAccessFilter.Of(http), transmittalId, request,
            cancellationToken);
        return problem ?? Results.Ok(ticket);
    }

    private static IssueOutcome Outcome(IssueRequest request, IReadOnlyList<Transmittal> sent)
    {
        var numbers = sent.Select(t => t.Number).ToList();
        return new IssueOutcome(TransmittalService.View(request, numbers), numbers);
    }

    public static TransmittalView View(Transmittal t) => new(
        t.Id, t.Number, t.Direction, t.Reason, t.Subject, t.Message, t.ToName, t.ResponseRequired, t.ResponseDue?.ToDateOnly(),
        t.IssuedAt.ToDateTimeOffset(), t.IssuedByName, t.IssueRequestId, t.ReviewStepId,
        t.Items.OrderBy(i => i.DocumentNumber).Select(i => new TransmittalItemView(i.DocumentId, i.RevisionId, i.DocumentNumber,
            i.Title, i.RevisionValue, i.StatusCode)).ToList(),
        t.Recipients.OrderBy(r => r.Name).Select(r => new RecipientView(r.Id, r.Name, r.Organization, r.UserId is not null,
            r.OpenedAt?.ToDateTimeOffset(), r.AcknowledgedAt?.ToDateTimeOffset(), r.DispatchedAt?.ToDateTimeOffset(),
            r.DispatchChannel, r.DispatchRef, r.DispatchedByName, r.ProofFileId)).ToList());
}
