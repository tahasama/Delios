using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Reviews;

/// <summary>A review route offered for a document, as returned to the client by <c>GET .../documents/{documentId}/routes</c>.</summary>
public sealed record RouteView(Guid Id, string Name, string? Description, bool IsDefault, IReadOnlyList<RouteStep> Steps);

/// <summary>One person's answer on a review step, as shown inside a <see cref="StepView"/>.</summary>
public sealed record ParticipantView(string Name, string? Answer, string? GrantedStatus, string? Note, DateTimeOffset? AnsweredAt);

/// <summary>One step of a review as sent to the client. <c>Number</c> counts from 1; the dispatch and foreign-answer fields are filled only for steps sent to another organization.</summary>
public sealed record StepView(int Number, string Title, string? Function, string? Party, string? Participation, string Mode,
    bool Deciding, string State, DateOnly? DueDate, string? Answer, IReadOnlyList<string> GrantsStatuses,
    IReadOnlyList<ParticipantView> Participants, Guid? TransmittalId, DateTimeOffset? DispatchedAt, string? DispatchChannel,
    string? DispatchRef, string? DispatchedBy, string? ForeignAnswer, string? RecordedBy, Guid? EvidenceFileId);

/// <summary>A review comment as sent to the client. <c>Step</c> and <c>ClosesWithStep</c> count from 1.</summary>
public sealed record CommentView(Guid Id, int Step, string Author, string Text, string Class, bool Blocking,
    string ClosesWith, int? ClosesWithStep, string Status, string? Resolution, string? ClosedBy, DateTimeOffset CreatedAt);

/// <summary>The full review as sent to the client: its state, its steps and its comments. Built by <see cref="ReviewEndpoints.View(Review)"/>.</summary>
public sealed record ReviewView(Guid Id, string Number, Guid DocumentId, Guid RevisionId, string Route, string State,
    int? CurrentStep, string? Verdict, string? GrantedStatus, string StartedBy, DateTimeOffset StartedAt,
    DateTimeOffset? DecidedAt, DateTimeOffset? ClosedAt, string? ClosedBy, string? ReturnNote,
    IReadOnlyList<StepView> Steps, IReadOnlyList<CommentView> Comments);

/// <summary>
/// The HTTP endpoints for reviews: listing routes, starting a review, commenting, answering, releasing, returning, rewinding and dispatching steps.
/// Each handler is thin: it reads the caller's project access and passes the work to <see cref="ReviewService"/> or <see cref="ControlService"/>.
/// </summary>
public static class ReviewEndpoints
{
    /// <summary>
    /// Registers the review URLs under <c>/api/projects/{projectId}</c>. Every request runs in one transaction (<see cref="TransactionFilter"/>) and only for users with access to the project.
    /// Called once at startup from the platform setup.
    /// </summary>
    public static void MapReviewEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Reviews")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();

        project.MapGet("/documents/{documentId:guid}/routes", RoutesAsync);
        project.MapPost("/revisions/{revisionId:guid}/reviews", StartAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapGet("/reviews/{reviewId:guid}", GetAsync);
        project.MapPost("/reviews/{reviewId:guid}/comments", CommentAsync);
        project.MapPost("/reviews/{reviewId:guid}/comments/{commentId:guid}/close", CloseCommentAsync);
        project.MapPost("/reviews/{reviewId:guid}/answer", AnswerAsync);
        project.MapPost("/reviews/{reviewId:guid}/release", ReleaseAsync);
        project.MapPost("/reviews/{reviewId:guid}/return", ReturnAsync);
        project.MapPost("/reviews/{reviewId:guid}/rewind", RewindAsync);
        project.MapPost("/reviews/{reviewId:guid}/dispatch", DispatchAsync);
        project.MapPost("/reviews/{reviewId:guid}/evidence", EvidenceAsync);
        project.MapPost("/revisions/{revisionId:guid}/arrival", ArrivalAsync);
        project.MapGet("/work", WorkAsync);
    }

    /// <summary>GET <c>/documents/{documentId}/routes</c>: the review routes the caller may start on this document. 404 if the document is not visible to them.</summary>
    private static async Task<IResult> RoutesAsync(
        Guid documentId, HttpContext http, DeliosDbContext db, DocumentService documents, ReviewService reviews,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var document = await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(cancellationToken))
            .AsNoTracking().SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        var routes = await reviews.RoutesForAsync(document, cancellationToken);
        return Results.Ok(routes.Select(r => new RouteView(r.Id, r.Name, r.Description, r.IsDefault, r.Steps)));
    }

    /// <summary>
    /// POST <c>/revisions/{revisionId}/reviews</c>: starts a review of a revision and returns 201 with the new review.
    /// The idempotency filter makes a retried request with the same key return the first result instead of starting a second review.
    /// </summary>
    private static async Task<IResult> StartAsync(
        Guid revisionId, StartReviewRequest request, HttpContext http, ReviewService reviews, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (review, problem) = await reviews.StartAsync(access, revisionId, request, cancellationToken);
        return problem ?? Results.Created($"/api/projects/{access.Project.Id}/reviews/{review!.Id}", View(review));
    }

    /// <summary>GET <c>/reviews/{reviewId}</c>: one review with its steps and comments, or 404.</summary>
    private static async Task<IResult> GetAsync(Guid reviewId, HttpContext http, ReviewService reviews, CancellationToken cancellationToken)
    {
        var review = await reviews.ReadAsync(ProjectAccessFilter.Of(http), reviewId, cancellationToken);
        return review is null ? Problems.NotFound("REVIEW_NOT_FOUND", "No such review.") : Results.Ok(View(review));
    }

    /// <summary>POST <c>/reviews/{reviewId}/comments</c>: adds a comment to the current step of a review.</summary>
    private static async Task<IResult> CommentAsync(
        Guid reviewId, CommentRequest request, HttpContext http, ReviewService reviews, CancellationToken cancellationToken)
    {
        var (comment, problem) = await reviews.CommentAsync(ProjectAccessFilter.Of(http), reviewId, request, cancellationToken);
        return problem ?? Results.Ok(View(comment!));
    }

    /// <summary>POST <c>/reviews/{reviewId}/comments/{commentId}/close</c>: closes (resolves) a comment; 204 on success.</summary>
    private static async Task<IResult> CloseCommentAsync(
        Guid reviewId, Guid commentId, CloseCommentRequest request, HttpContext http, ReviewService reviews,
        CancellationToken cancellationToken) =>
        await reviews.CloseCommentAsync(ProjectAccessFilter.Of(http), reviewId, commentId, request, cancellationToken)
            ?? Results.NoContent();

    /// <summary>POST <c>/reviews/{reviewId}/answer</c>: records the caller's answer on the current step.</summary>
    private static async Task<IResult> AnswerAsync(
        Guid reviewId, AnswerRequest request, HttpContext http, ReviewService reviews, CancellationToken cancellationToken) =>
        Result(await reviews.AnswerAsync(ProjectAccessFilter.Of(http), reviewId, request, cancellationToken));

    /// <summary>POST <c>/reviews/{reviewId}/release</c>: Document Control releases the revision after a positive verdict.</summary>
    private static async Task<IResult> ReleaseAsync(
        Guid reviewId, ReleaseRequest request, HttpContext http, ReviewService reviews, CancellationToken cancellationToken) =>
        Result(await reviews.ReleaseAsync(ProjectAccessFilter.Of(http), reviewId, request, cancellationToken));

    /// <summary>POST <c>/reviews/{reviewId}/return</c>: Document Control returns the revision to its author after the verdict.</summary>
    private static async Task<IResult> ReturnAsync(
        Guid reviewId, ReturnRequest request, HttpContext http, ReviewService reviews, CancellationToken cancellationToken) =>
        Result(await reviews.ReturnAsync(ProjectAccessFilter.Of(http), reviewId, request, cancellationToken));

    /// <summary>POST <c>/reviews/{reviewId}/rewind</c>: takes an in-progress review back to an earlier step.</summary>
    private static async Task<IResult> RewindAsync(
        Guid reviewId, RewindRequest request, HttpContext http, ReviewService reviews, CancellationToken cancellationToken) =>
        Result(await reviews.RewindAsync(ProjectAccessFilter.Of(http), reviewId, request, cancellationToken));

    /// <summary>POST <c>/reviews/{reviewId}/dispatch</c>: records that the current step was sent to another organization (by transmittal or another channel).</summary>
    private static async Task<IResult> DispatchAsync(
        Guid reviewId, Transmittals.DispatchRequest request, HttpContext http, ReviewService reviews,
        CancellationToken cancellationToken) =>
        Result(await reviews.DispatchAsync(ProjectAccessFilter.Of(http), reviewId, request, cancellationToken));

    /// <summary>POST <c>/reviews/{reviewId}/evidence</c>: starts an upload of a file that proves another organization's answer; returns the upload ticket.</summary>
    private static async Task<IResult> EvidenceAsync(
        Guid reviewId, UploadRequest request, HttpContext http, ReviewService reviews, CancellationToken cancellationToken)
    {
        var (ticket, problem) = await reviews.EvidenceAsync(ProjectAccessFilter.Of(http), reviewId, request, cancellationToken);
        return problem ?? Results.Ok(ticket);
    }

    /// <summary>POST <c>/revisions/{revisionId}/arrival</c>: Document Control accepts or returns a revision another organization sent in. See <see cref="ControlService.ArrivalAsync"/>.</summary>
    private static async Task<IResult> ArrivalAsync(
        Guid revisionId, ControlRequest request, HttpContext http, ControlService control, CancellationToken cancellationToken)
    {
        var (revision, problem) = await control.ArrivalAsync(ProjectAccessFilter.Of(http), revisionId, request, cancellationToken);
        return problem ?? Results.Ok(new { revision!.Id, revision.Value, revision.State, revision.Submission, revision.ControlOutcome });
    }

    /// <summary>GET <c>/work</c>: the caller's to-do list in this project (review steps, comments and submissions waiting for them).</summary>
    private static async Task<IResult> WorkAsync(HttpContext http, ReviewService reviews, CancellationToken cancellationToken) =>
        Results.Ok(await reviews.WorkAsync(ProjectAccessFilter.Of(http), cancellationToken));

    /// <summary>Turns a service outcome into a response: the problem if there is one, otherwise 200 with the review.</summary>
    private static IResult Result((Review? Review, IResult? Problem) outcome) =>
        outcome.Problem ?? Results.Ok(View(outcome.Review!));

    /// <summary>
    /// Converts a review entity (with its steps and comments loaded) into the <see cref="ReviewView"/> sent to clients.
    /// Step and comment numbers are shifted to count from 1.
    /// </summary>
    public static ReviewView View(Review r) => new(
        r.Id, r.Number, r.DocumentId, r.RevisionId, r.RouteName, r.State,
        r.State == ReviewStates.InProgress ? r.CurrentStep + 1 : null, r.Verdict, r.GrantedStatus, r.StartedByName,
        r.StartedAt.ToDateTimeOffset(), r.DecidedAt?.ToDateTimeOffset(), r.ClosedAt?.ToDateTimeOffset(), r.ClosedByName,
        r.ReturnNote,
        r.Steps.OrderBy(s => s.Index).Select(s => new StepView(s.Index + 1, s.Title, s.FunctionCode, s.PartyName,
            s.Participation, s.Mode, s.Deciding, s.State, s.DueDate?.ToDateOnly(), s.Answer, s.GrantsStatuses,
            s.Participants.OrderBy(p => p.UserName).Select(p => new ParticipantView(p.UserName, p.Answer, p.GrantedStatus,
                p.Note, p.AnsweredAt?.ToDateTimeOffset())).ToList(),
            s.TransmittalId, s.DispatchedAt?.ToDateTimeOffset(), s.DispatchChannel, s.DispatchRef, s.DispatchedByName,
            s.ForeignAnswer, s.RecordedByName, s.EvidenceFileId)).ToList(),
        r.Comments.OrderBy(c => c.CreatedAt).Select(View).ToList());

    /// <summary>Converts a review comment entity into the <see cref="CommentView"/> sent to clients.</summary>
    private static CommentView View(ReviewComment c) => new(
        c.Id, c.StepIndex + 1, c.AuthorName, c.Text, c.Class, c.Blocking, c.ClosesWith, c.ClosesWithStep, c.Status,
        c.Resolution, c.ClosedByName, c.CreatedAt.ToDateTimeOffset());
}
