using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Reviews;

/// <summary>
/// Adding people to a review in flow (owner: "add someone forgotten or cc, a modification mid-flow that touches only
/// steps not done yet"): the control function or whoever holds Manage adds people to the open step or one still to come,
/// or copies people in, always saying why. A step already answered is never touched, nor one another organization
/// answers as itself; nobody is taken off (a step is handed over instead, <see cref="DelegationService"/>). On the open
/// step the person is seated at once (where every one answers, it waits for them too); on a later one they answer once it
/// opens. Each is told; the record says who added whom, and why.
/// </summary>
public static class StepPeople
{
    /// <summary>Step: from 1, or none for copies only.</summary>
    public sealed record AddRequest(int? Step, Guid[]? UserIds, Guid[]? CopyUserIds, string? Reason);

    public static void MapStepPeopleEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}/reviews/{reviewId:guid}/people").WithTags("Reviews")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("", OptionsAsync);
        project.MapPost("", AddAsync);
    }

    private static bool Keeper(ProjectAccess access) => access.IsInternal && (access.Holds(Verbs.Control) || access.Holds(Verbs.Manage));

    private static Task<Review?> LoadAsync(DeliosDbContext db, ProjectAccess access, Guid reviewId, CancellationToken cancellationToken) =>
        db.Reviews.Include(r => r.Steps).ThenInclude(s => s.Participants).AsSplitQuery()
            .SingleOrDefaultAsync(r => r.Id == reviewId && r.ProjectId == access.Project.Id, cancellationToken);

    /// <summary>The steps people may still be added to (not done, not answered by an organization as itself).</summary>
    private static IEnumerable<ReviewStep> Open(Review review) =>
        review.Steps.Where(s => s.State != StepStates.Done && s.PartyId is null).OrderBy(s => s.Index);

    /// <summary>Everyone active on the project, any organization, by name.</summary>
    private static async Task<List<(Guid Id, string Name)>> PeopleAsync(DeliosDbContext db, ProjectAccess access, CancellationToken cancellationToken) =>
        (await db.Memberships.AsNoTracking().Where(m => m.ProjectId == access.Project.Id && m.Active)
            .Join(db.Users.Where(u => u.Active), m => m.UserId, u => u.Id, (m, u) => new { u.Id, u.Name })
            .Distinct().OrderBy(u => u.Name).ToListAsync(cancellationToken)).Select(u => (u.Id, u.Name)).ToList();

    /// <summary>What the form offers: the steps not done, each with who is on it, and the people of the project.</summary>
    private static async Task<IResult> OptionsAsync(Guid reviewId, HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var review = await LoadAsync(db, access, reviewId, cancellationToken);
        if (review is null) return Problems.NotFound("REVIEW_NOT_FOUND", "No such review.");
        if (!Keeper(access) || review.State != ReviewStates.InProgress) return Results.Ok(new { open = false });
        var people = await PeopleAsync(db, access, cancellationToken);
        return Results.Ok(new
        {
            open = true,
            Steps = Open(review).Select(s => new
            {
                Number = s.Index + 1, s.Title, s.State,
                On = (s.State == StepStates.Open ? s.Participants.Select(p => p.UserId) : s.UserIds).ToArray(),
            }),
            People = people.Select(p => new { p.Id, p.Name }),
            Copied = review.CopyUserIds,
        });
    }

    private static async Task<IResult> AddAsync(Guid reviewId, AddRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        Notifications.Notifier notifier, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!Keeper(access)) return Problems.Forbidden("CONTROL_OR_MANAGE", "The control function or whoever holds Manage adds people to a review in flow.");
        var review = await LoadAsync(db, access, reviewId, cancellationToken);
        if (review is null) return Problems.NotFound("REVIEW_NOT_FOUND", "No such review.");
        if (review.State != ReviewStates.InProgress)
            return Problems.Conflict("REVIEW_CLOSED", "The review is no longer in flow: nobody is added to it.");
        var why = request.Reason?.Trim() ?? "";
        if (why.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why they are added: they, and the record, read it.", "reason");
        var adds = (request.UserIds ?? []).Distinct().ToList();
        var copies = (request.CopyUserIds ?? []).Distinct().ToList();
        if (adds.Count == 0 && copies.Count == 0) return Problems.Invalid("NOBODY_CHOSEN", "Choose who is added to the step, or copied in.");
        var people = (await PeopleAsync(db, access, cancellationToken)).ToDictionary(p => p.Id, p => p.Name);
        if (adds.Concat(copies).Any(id => !people.ContainsKey(id)))
            return Problems.Invalid("NOT_ON_PROJECT", "Only people active on the project are added.");

        ReviewStep? step = null;
        var seated = new List<Guid>();
        if (adds.Count > 0)
        {
            step = request.Step is { } n ? review.Steps.SingleOrDefault(s => s.Index == n - 1) : null;
            if (step is null) return Problems.Invalid("STEP_REQUIRED", "Say which step they answer.", "step");
            if (step.State == StepStates.Done) return Problems.Conflict("STEP_DONE", "That step is answered: only steps not done yet change.");
            if (step.PartyId is not null) return Problems.Conflict("PARTY_STEP", "Another organization answers that step as itself: nobody is added to it.");
            var on = step.State == StepStates.Open ? step.Participants.Select(p => p.UserId).ToHashSet() : step.UserIds.ToHashSet();
            seated = adds.Where(id => !on.Contains(id)).ToList();
            if (seated.Count == 0) return Problems.Conflict("ALREADY_ON_STEP", "They are already on that step.");
            step.UserIds = [.. step.UserIds.Concat(seated).Distinct()];
            if (step.State == StepStates.Open)
            {
                foreach (var id in seated)
                    step.Participants.Add(new ReviewParticipant { TenantId = review.TenantId, StepId = step.Id, UserId = id, UserName = people[id] });
            }
        }
        var copied = copies.Where(id => !review.CopyUserIds.Contains(id)).ToList();
        review.CopyUserIds = [.. review.CopyUserIds.Concat(copied)];
        if (seated.Count == 0 && copied.Count == 0) return Problems.Conflict("ALREADY_ON_STEP", "They are already on the review.");
        await db.SaveChangesAsync(cancellationToken);

        string Names(IEnumerable<Guid> ids) => string.Join(", ", ids.Select(id => people[id]));
        var said = string.Join(" ", new[]
        {
            seated.Count > 0 ? $"Added to step {step!.Index + 1} ({step.Title}): {Names(seated)}." : null,
            copied.Count > 0 ? $"Copied in: {Names(copied)}." : null,
        }.Where(s => s is not null));
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "REVIEW_PEOPLE_ADDED", "Review", review.Id, review.Number,
            $"{said} {why}", review.ProjectId, cancellationToken);
        var link = $"/reviews/{review.Id}";
        if (seated.Count > 0)
        {
            var title = step!.State == StepStates.Open ? $"Review {review.Number} is waiting on you: {step.Title}" : $"You answer step {step.Index + 1} of review {review.Number} once it opens";
            await notifier.NotifyAsync(review.TenantId, review.ProjectId, seated, Notifications.NotificationKinds.ReviewStep, title,
                $"{access.UserName} added you: {why}{(step.State == StepStates.Open && step.DueDate is { } due ? $" Due {due:yyyy-MM-dd}." : "")}", link,
                cancellationToken, Notifications.EmailKinds.Review);
        }
        if (copied.Count > 0)
        {
            await notifier.NotifyAsync(review.TenantId, review.ProjectId, copied, Notifications.NotificationKinds.General,
                $"You are copied in on review {review.Number}", $"{access.UserName} copied you in: {why} You are told what comes of it; nothing is asked of you.", link,
                cancellationToken, Notifications.EmailKinds.Review);
        }
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { Seated = seated.Count, Copied = copied.Count });
    }
}
