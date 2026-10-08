using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Settings;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Reviews;

/// <summary>Body of a hand-over: who takes the step, the last day it is in force, and why.</summary>
public sealed record DelegateRequest(Guid ToUserId, DateOnly? EndDate, string? Reason = null);
/// <summary>Body of declining a hand-over: why, so the person who asked knows what to do next.</summary>
public sealed record RefuseDelegationRequest(string? Reason);

/// <summary>A hand-over as the review page shows it.</summary>
public sealed record DelegationView(Guid Id, int Step, Guid FromUserId, string FromName, Guid ToUserId, string ToName, string Verb,
    string Status, DateOnly EndDate, string? Reason, string? RefusedReason, string? Flag, string AskedBy, string? GrantedBy,
    DateTimeOffset CreatedAt);

/// <summary>Somebody a step can be handed to. <c>InMatrix</c>: the matrix names them for the act on this document.</summary>
public sealed record DelegationCandidate(Guid Id, string Name, string FunctionName, bool InMatrix);

/// <summary>What the hand-over form needs: who may take it, whether Document Control puts it in force, and whether the matrix binds.</summary>
public sealed record DelegationOptions(IReadOnlyList<DelegationCandidate> Candidates, bool ThroughControl, bool Strict, bool Off);

/// <summary>
/// Handing a review step to somebody else until a date. Whoever sits on the open
/// step hands it over; where Document Control carries this act out (the
/// project's DELEGATE answer) the hand-over waits for them, otherwise it is in
/// force at once. The matrix recommends who: somebody it does not name for the
/// act is flagged, and refused only where the project makes the matrix the only
/// rule (<c>POLICY_MATRIX</c> = STRICT). Document Control and administrators are
/// never offered: they hold every verb for emergencies, not to review.
/// </summary>
public sealed class DelegationService(DeliosDbContext db, AuditLog audit, IClock clock, Notifications.Notifier notifier)
{
    private const string Act = "DELEGATE";

    /// <summary>The hand-overs raised on a review, newest first.</summary>
    public async Task<IReadOnlyList<DelegationView>?> ListAsync(ProjectAccess access, Guid reviewId, CancellationToken cancellationToken)
    {
        if (!await db.Reviews.AnyAsync(r => r.Id == reviewId && r.ProjectId == access.Project.Id, cancellationToken)) return null;
        var rows = await db.Set<ReviewDelegation>().AsNoTracking().Where(d => d.ReviewId == reviewId)
            .OrderByDescending(d => d.CreatedAt).ToListAsync(cancellationToken);
        return rows.Select(View).ToList();
    }

    /// <summary>Who the caller may hand the open step to, and how the hand-over is carried out on this project.</summary>
    public async Task<DelegationOptions?> OptionsAsync(ProjectAccess access, Guid reviewId, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return null;
        var through = await ProjectAnswers.ControlDoesAsync(db, access.Project.Id, Act, cancellationToken);
        var strict = await StrictAsync(access, cancellationToken);
        var off = await ProjectAnswers.IsOffAsync(db, access.Project.Id, Act, cancellationToken);
        var step = review.Steps.SingleOrDefault(s => s.State == StepStates.Open);
        if (off || review.State != ReviewStates.InProgress || step is null || step.PartyId is not null
            || !step.Participants.Any(p => p.UserId == access.UserId && p.AnsweredAt is null))
        {
            return new DelegationOptions([], through, strict, off);
        }
        var candidates = await CandidatesAsync(access, review, step, cancellationToken);
        return new DelegationOptions(strict ? candidates.Where(c => c.InMatrix).ToList() : candidates, through, strict, off);
    }

    /// <summary>The caller hands their seat on the open step to somebody else, until a date.</summary>
    public async Task<(DelegationView? Delegation, IResult? Problem)> DelegateAsync(
        ProjectAccess access, Guid reviewId, DelegateRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, Problems.NotFound("REVIEW_NOT_FOUND", "No such review."));
        if (await ProjectAnswers.IsOffAsync(db, access.Project.Id, Act, cancellationToken))
        {
            return (null, Problems.Conflict("DELEGATION_OFF", "Nobody hands a review over on this project: each step is answered by the person it was given to."));
        }
        var step = review.Steps.SingleOrDefault(s => s.State == StepStates.Open);
        var seat = step?.Participants.SingleOrDefault(p => p.UserId == access.UserId);
        if (review.State != ReviewStates.InProgress || step is null || seat is null)
        {
            return (null, Problems.Forbidden("NOT_ON_OPEN_STEP", "Only the people on the step that is open hand it over."));
        }
        if (step.PartyId is not null) return (null, Problems.Conflict("PARTY_STEP", "A step another organization answers is not handed over."));
        if (seat.AnsweredAt is not null) return (null, Problems.Conflict("ALREADY_ANSWERED", "You have answered this step: there is nothing left to hand over."));
        var today = WorkingCalendar.Today(clock, access.Project.TimeZone);
        if (request.EndDate is not { } endDate) return (null, Problems.Invalid("END_DATE_REQUIRED", "A delegation ends on a date: say when."));
        var ends = LocalDate.FromDateOnly(endDate);
        if (ends < today) return (null, Problems.Invalid("END_DATE_PAST", "A delegation cannot end in the past."));
        if (await db.Set<ReviewDelegation>().AnyAsync(d => d.ReviewId == review.Id && d.StepIndex == step.Index && d.FromUserId == access.UserId
            && (d.Status == DelegationStates.Open || d.Status == DelegationStates.Active) && d.EndDate >= today, cancellationToken))
        {
            return (null, Problems.Conflict("ALREADY_DELEGATED", "This step is already handed over: end that hand-over first."));
        }

        var candidates = await CandidatesAsync(access, review, step, cancellationToken);
        var takes = candidates.SingleOrDefault(c => c.Id == request.ToUserId);
        if (request.ToUserId == access.UserId) return (null, Problems.Invalid("SAME_PERSON", "A step cannot be handed to the person who already holds it."));
        if (takes is null)
        {
            return (null, Problems.Invalid("NOT_A_CANDIDATE",
                "That person cannot take this step: they are not active on the project, already sit on it, or hold Document Control or administration for emergencies."));
        }
        var verb = step.Deciding ? Verbs.Approve : Verbs.Review;
        var act = step.Deciding ? "decide" : "advise";
        if (!takes.InMatrix && await StrictAsync(access, cancellationToken))
        {
            return (null, Problems.Invalid("NOT_IN_MATRIX",
                $"{takes.Name} is not named to {act} on this kind of document. On this project a step may only be handed to somebody the matrix names for it."));
        }

        var through = await ProjectAnswers.ControlDoesAsync(db, access.Project.Id, Act, cancellationToken);
        var now = clock.GetCurrentInstant();
        var row = new ReviewDelegation
        {
            TenantId = review.TenantId,
            ProjectId = review.ProjectId,
            ReviewId = review.Id,
            StepIndex = step.Index,
            FromUserId = access.UserId,
            FromName = access.UserName,
            ToUserId = takes.Id,
            ToName = takes.Name,
            Verb = verb,
            EndDate = ends,
            Reason = request.Reason?.Trim() is { Length: > 0 } why ? why : null,
            Status = through ? DelegationStates.Open : DelegationStates.Active,
            Flag = takes.InMatrix ? null : $"The matrix does not name {takes.Name} to {act} on this kind of document.",
            AskedByName = access.UserName,
            GrantedByName = through ? null : access.UserName,
            GrantedAt = through ? null : now,
            CreatedAt = now,
        };
        db.Add(row);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), through ? "DELEGATION_REQUESTED" : "DELEGATION_GRANTED",
            "Review", review.Id, review.Number,
            $"{access.UserName} → {takes.Name}: {(step.Deciding ? "the decision" : "advice")} on step {step.Index + 1} ({step.Title}), until {ends:yyyy-MM-dd}."
            + (row.Reason is null ? "" : $" {row.Reason}") + (row.Flag is null ? "" : $" Flagged: {row.Flag}"),
            review.ProjectId, cancellationToken);
        if (through)
        {
            await TellAsync(review, await notifier.ControlHoldersAsync(review.ProjectId, cancellationToken),
                $"Delegation asked for on review {review.Number}", $"{access.UserName} asks that {takes.Name} answer in their place.", cancellationToken);
        }
        else
        {
            await TellAsync(review, [takes.Id], $"You answer review {review.Number} for {access.UserName}", $"Until {ends:yyyy-MM-dd}.", cancellationToken);
        }
        await db.SaveChangesAsync(cancellationToken);
        return (View(row), null);
    }

    /// <summary>Document Control puts an asked-for hand-over in force. The matrix is applied as it stands now.</summary>
    public async Task<(DelegationView? Delegation, IResult? Problem)> GrantAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var (row, review, problem) = await AnswerableAsync(access, id, "puts a delegation in force", cancellationToken);
        if (problem is not null) return (null, problem);
        if (await ProjectAnswers.IsOffAsync(db, access.Project.Id, Act, cancellationToken))
        {
            return (null, Problems.Conflict("DELEGATION_OFF", "Hand-overs are no longer used on this project, so this can only be declined."));
        }
        var step = review!.Steps.SingleOrDefault(s => s.Index == row!.StepIndex);
        if (step is null || step.State != StepStates.Open || review.State != ReviewStates.InProgress)
        {
            return (null, Problems.Conflict("STEP_CLOSED", "That step is no longer open: there is nothing left to hand over."));
        }
        var takes = (await CandidatesAsync(access, review, step, cancellationToken, row!.FromUserId)).SingleOrDefault(c => c.Id == row.ToUserId);
        if (takes is null || (!takes.InMatrix && await StrictAsync(access, cancellationToken)))
        {
            return (null, Problems.Conflict("NOT_A_CANDIDATE", $"{row.ToName} can no longer take this step."));
        }
        row.Status = DelegationStates.Active;
        row.GrantedByName = access.UserName;
        row.GrantedAt = clock.GetCurrentInstant();
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "DELEGATION_GRANTED", "Review", review.Id, review.Number,
            $"{row.FromName} → {row.ToName}: put in force by Document Control.", review.ProjectId, cancellationToken);
        await TellAsync(review, [row.ToUserId], $"You answer review {review.Number} for {row.FromName}", $"Until {row.EndDate:yyyy-MM-dd}.", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (View(row), null);
    }

    /// <summary>Document Control declines an asked-for hand-over, saying why.</summary>
    public async Task<(DelegationView? Delegation, IResult? Problem)> RefuseAsync(
        ProjectAccess access, Guid id, RefuseDelegationRequest request, CancellationToken cancellationToken)
    {
        var why = request.Reason?.Trim() ?? "";
        if (why.Length == 0) return (null, Problems.Invalid("REASON_REQUIRED", "Say why, so the person who asked knows what to do next."));
        var (row, review, problem) = await AnswerableAsync(access, id, "answers a delegation request", cancellationToken);
        if (problem is not null) return (null, problem);
        row!.Status = DelegationStates.Refused;
        row.RefusedReason = why;
        row.GrantedByName = access.UserName;
        row.GrantedAt = clock.GetCurrentInstant();
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "DELEGATION_REFUSED", "Review", review!.Id, review.Number,
            $"{row.FromName} → {row.ToName}: declined. {why}", review.ProjectId, cancellationToken);
        await TellAsync(review, [row.FromUserId], "Your delegation was not put in force", why, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (View(row), null);
    }

    /// <summary>The person who gave it, or Document Control, ends a hand-over before its date.</summary>
    public async Task<(DelegationView? Delegation, IResult? Problem)> EndAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var row = await db.Set<ReviewDelegation>().SingleOrDefaultAsync(d => d.Id == id && d.ProjectId == access.Project.Id, cancellationToken);
        if (row is null) return (null, Problems.NotFound("DELEGATION_NOT_FOUND", "No such delegation."));
        if (row.FromUserId != access.UserId && !access.Holds(Verbs.Control))
        {
            return (null, Problems.Forbidden("NOT_YOURS", "Only the person who handed the step over, or Document Control, ends it."));
        }
        if (row.Status is not (DelegationStates.Open or DelegationStates.Active)) return (null, Problems.Conflict("NOT_IN_FORCE", "It is not in force."));
        row.Status = DelegationStates.Withdrawn;
        var review = await db.Reviews.AsNoTracking().SingleAsync(r => r.Id == row.ReviewId, cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "DELEGATION_WITHDRAWN", "Review", review.Id, review.Number,
            $"{row.FromName} → {row.ToName}: ended before its date by {access.UserName}.", review.ProjectId, cancellationToken);
        await TellAsync(review, [row.ToUserId], "A delegation to you was ended", $"{access.UserName} ended it.", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (View(row), null);
    }

    /// <summary>An asked-for hand-over Document Control may answer now.</summary>
    private async Task<(ReviewDelegation? Row, Review? Review, IResult? Problem)> AnswerableAsync(
        ProjectAccess access, Guid id, string act, CancellationToken cancellationToken)
    {
        var row = await db.Set<ReviewDelegation>().SingleOrDefaultAsync(d => d.Id == id && d.ProjectId == access.Project.Id, cancellationToken);
        if (row is null) return (null, null, Problems.NotFound("DELEGATION_NOT_FOUND", "No such delegation."));
        if (!access.Holds(Verbs.Control)) return (null, null, Problems.Forbidden("CONTROL_ONLY", $"Document Control {act}."));
        if (row.Status != DelegationStates.Open) return (null, null, Problems.Conflict("ALREADY_ANSWERED", "That request has already been answered."));
        var review = await LoadAsync(access, row.ReviewId, cancellationToken);
        return (row, review, null);
    }

    /// <summary>
    /// Everybody active on the project who could take this step, the matrix's people first: never the one handing it
    /// over, never somebody already on the step, never a holder of Document Control or administration.
    /// </summary>
    private async Task<List<DelegationCandidate>> CandidatesAsync(
        ProjectAccess access, Review review, ReviewStep step, CancellationToken cancellationToken, Guid? from = null)
    {
        var document = await db.Documents.AsNoTracking().SingleAsync(d => d.Id == review.DocumentId, cancellationToken);
        var verb = step.Deciding ? Verbs.Approve : Verbs.Review;
        var giver = from ?? access.UserId;
        var seated = step.Participants.Select(p => p.UserId).ToHashSet();
        var members = await db.Memberships.AsNoTracking()
            .Where(m => m.ProjectId == access.Project.Id && m.Active && m.Function!.Active)
            .Include(m => m.Function!).ThenInclude(f => f.Rules)
            .Join(db.Users.Where(u => u.Active && (u.Party == null || u.Party.IsInternal)), m => m.UserId, u => u.Id, (m, u) => new { m, u.Name })
            .ToListAsync(cancellationToken);
        return members
            .Where(x => x.m.UserId != giver && !seated.Contains(x.m.UserId))
            .Select(x => new { x, their = ProjectAccess.OfFunction(access.Project, x.m.Function!, x.m.UserId, x.Name) })
            .Where(y => !y.their.Holds(Verbs.Control) && !y.their.Holds(Verbs.Configure))
            .Select(y => new DelegationCandidate(y.x.m.UserId, y.x.Name, y.x.m.Function!.Name, y.their.Allows(verb, document.Facts)))
            .OrderByDescending(c => c.InMatrix).ThenBy(c => c.Name)
            .ToList();
    }

    private async Task<bool> StrictAsync(ProjectAccess access, CancellationToken cancellationToken) =>
        await ProjectAnswers.PolicyAsync(db, access.Project.Id, "POLICY_MATRIX", cancellationToken) == "STRICT";

    private Task<Review?> LoadAsync(ProjectAccess access, Guid reviewId, CancellationToken cancellationToken) =>
        db.Reviews.Include(r => r.Steps).ThenInclude(s => s.Participants).AsSplitQuery()
            .SingleOrDefaultAsync(r => r.Id == reviewId && r.ProjectId == access.Project.Id, cancellationToken);

    private Task TellAsync(Review review, IEnumerable<Guid> userIds, string title, string? body, CancellationToken cancellationToken) =>
        notifier.NotifyAsync(review.TenantId, review.ProjectId, userIds, Notifications.NotificationKinds.Delegation, title, body,
            $"/reviews/{review.Id}", cancellationToken, Notifications.EmailKinds.Review);

    private static DelegationView View(ReviewDelegation d) => new(d.Id, d.StepIndex + 1, d.FromUserId, d.FromName, d.ToUserId, d.ToName,
        d.Verb, d.Status, d.EndDate.ToDateOnly(), d.Reason, d.RefusedReason, d.Flag, d.AskedByName, d.GrantedByName,
        d.CreatedAt.ToDateTimeOffset());
}

/// <summary>The hand-over URLs under <c>/api/projects/{projectId}</c>.</summary>
public static class DelegationEndpoints
{
    public static void MapDelegationEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Reviews")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("/reviews/{reviewId:guid}/delegations", async (Guid reviewId, HttpContext h, DelegationService s, CancellationToken c) =>
            await s.ListAsync(ProjectAccessFilter.Of(h), reviewId, c) is { } rows ? Results.Ok(rows) : Problems.NotFound("REVIEW_NOT_FOUND", "No such review."));
        project.MapGet("/reviews/{reviewId:guid}/delegation-options", async (Guid reviewId, HttpContext h, DelegationService s, CancellationToken c) =>
            await s.OptionsAsync(ProjectAccessFilter.Of(h), reviewId, c) is { } options ? Results.Ok(options) : Problems.NotFound("REVIEW_NOT_FOUND", "No such review."));
        project.MapPost("/reviews/{reviewId:guid}/delegations", async (Guid reviewId, DelegateRequest r, HttpContext h, DelegationService s, CancellationToken c) =>
            Result(await s.DelegateAsync(ProjectAccessFilter.Of(h), reviewId, r, c)));
        project.MapPost("/delegations/{id:guid}/grant", async (Guid id, HttpContext h, DelegationService s, CancellationToken c) =>
            Result(await s.GrantAsync(ProjectAccessFilter.Of(h), id, c)));
        project.MapPost("/delegations/{id:guid}/refuse", async (Guid id, RefuseDelegationRequest r, HttpContext h, DelegationService s, CancellationToken c) =>
            Result(await s.RefuseAsync(ProjectAccessFilter.Of(h), id, r, c)));
        project.MapPost("/delegations/{id:guid}/end", async (Guid id, HttpContext h, DelegationService s, CancellationToken c) =>
            Result(await s.EndAsync(ProjectAccessFilter.Of(h), id, c)));
    }

    private static IResult Result((DelegationView? Delegation, IResult? Problem) outcome) => outcome.Problem ?? Results.Ok(outcome.Delegation);
}
