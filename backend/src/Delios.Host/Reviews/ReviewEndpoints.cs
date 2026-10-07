using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Reviews;

public sealed record RouteView(Guid Id, string Name, string? Description, bool IsDefault, IReadOnlyList<RouteStep> Steps);

public sealed record ParticipantView(string Name, string? Answer, string? GrantedStatus, string? Note, DateTimeOffset? AnsweredAt);

public sealed record StepView(int Number, string Title, string? Function, string? Party, string? Participation, string Mode,
    bool Deciding, string State, DateOnly? DueDate, string? Answer, IReadOnlyList<string> GrantsStatuses,
    IReadOnlyList<ParticipantView> Participants, Guid? TransmittalId, DateTimeOffset? DispatchedAt, string? DispatchChannel,
    string? DispatchRef, string? DispatchedBy, string? ForeignAnswer, string? RecordedBy, Guid? EvidenceFileId);

public sealed record CommentView(Guid Id, int Step, string Author, string Text, string Class, bool Blocking,
    string ClosesWith, int? ClosesWithStep, string Status, string? Resolution, string? ClosedBy, DateTimeOffset CreatedAt);

public sealed record ReviewView(Guid Id, string Number, Guid DocumentId, Guid RevisionId, string Route, string State,
    int? CurrentStep, string? Verdict, string? GrantedStatus, string StartedBy, DateTimeOffset StartedAt,
    DateTimeOffset? DecidedAt, DateTimeOffset? ClosedAt, string? ClosedBy, string? ReturnNote,
    IReadOnlyList<StepView> Steps, IReadOnlyList<CommentView> Comments);

public static class ReviewEndpoints
{
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
        project.MapGet("/work", WorkAsync);
    }

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

    private static async Task<IResult> StartAsync(
        Guid revisionId, StartReviewRequest request, HttpContext http, ReviewService reviews, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (review, problem) = await reviews.StartAsync(access, revisionId, request, cancellationToken);
        return problem ?? Results.Created($"/api/projects/{access.Project.Id}/reviews/{review!.Id}", View(review));
    }

    private static async Task<IResult> GetAsync(Guid reviewId, HttpContext http, ReviewService reviews, CancellationToken cancellationToken)
    {
        var review = await reviews.ReadAsync(ProjectAccessFilter.Of(http), reviewId, cancellationToken);
        return review is null ? Problems.NotFound("REVIEW_NOT_FOUND", "No such review.") : Results.Ok(View(review));
    }

    private static async Task<IResult> CommentAsync(
        Guid reviewId, CommentRequest request, HttpContext http, ReviewService reviews, CancellationToken cancellationToken)
    {
        var (comment, problem) = await reviews.CommentAsync(ProjectAccessFilter.Of(http), reviewId, request, cancellationToken);
        return problem ?? Results.Ok(View(comment!));
    }

    private static async Task<IResult> CloseCommentAsync(
        Guid reviewId, Guid commentId, CloseCommentRequest request, HttpContext http, ReviewService reviews,
        CancellationToken cancellationToken) =>
        await reviews.CloseCommentAsync(ProjectAccessFilter.Of(http), reviewId, commentId, request, cancellationToken)
            ?? Results.NoContent();

    private static async Task<IResult> AnswerAsync(
        Guid reviewId, AnswerRequest request, HttpContext http, ReviewService reviews, CancellationToken cancellationToken) =>
        Result(await reviews.AnswerAsync(ProjectAccessFilter.Of(http), reviewId, request, cancellationToken));

    private static async Task<IResult> ReleaseAsync(
        Guid reviewId, ReleaseRequest request, HttpContext http, ReviewService reviews, CancellationToken cancellationToken) =>
        Result(await reviews.ReleaseAsync(ProjectAccessFilter.Of(http), reviewId, request, cancellationToken));

    private static async Task<IResult> ReturnAsync(
        Guid reviewId, ReturnRequest request, HttpContext http, ReviewService reviews, CancellationToken cancellationToken) =>
        Result(await reviews.ReturnAsync(ProjectAccessFilter.Of(http), reviewId, request, cancellationToken));

    private static async Task<IResult> RewindAsync(
        Guid reviewId, RewindRequest request, HttpContext http, ReviewService reviews, CancellationToken cancellationToken) =>
        Result(await reviews.RewindAsync(ProjectAccessFilter.Of(http), reviewId, request, cancellationToken));

    private static async Task<IResult> DispatchAsync(
        Guid reviewId, Transmittals.DispatchRequest request, HttpContext http, ReviewService reviews,
        CancellationToken cancellationToken) =>
        Result(await reviews.DispatchAsync(ProjectAccessFilter.Of(http), reviewId, request, cancellationToken));

    private static async Task<IResult> EvidenceAsync(
        Guid reviewId, UploadRequest request, HttpContext http, ReviewService reviews, CancellationToken cancellationToken)
    {
        var (ticket, problem) = await reviews.EvidenceAsync(ProjectAccessFilter.Of(http), reviewId, request, cancellationToken);
        return problem ?? Results.Ok(ticket);
    }

    private static async Task<IResult> WorkAsync(HttpContext http, ReviewService reviews, CancellationToken cancellationToken) =>
        Results.Ok(await reviews.WorkAsync(ProjectAccessFilter.Of(http), cancellationToken));

    private static IResult Result((Review? Review, IResult? Problem) outcome) =>
        outcome.Problem ?? Results.Ok(View(outcome.Review!));

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

    private static CommentView View(ReviewComment c) => new(
        c.Id, c.StepIndex + 1, c.AuthorName, c.Text, c.Class, c.Blocking, c.ClosesWith, c.ClosesWithStep, c.Status,
        c.Resolution, c.ClosedByName, c.CreatedAt.ToDateTimeOffset());
}
