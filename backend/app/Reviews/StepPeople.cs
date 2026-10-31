using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Reviews;

/// <summary>
/// Informing people of a review in flow (owner: "inform is the only one that should stay, and no need for obligatory why
/// because mostly it is someone forgotten"): the control function or whoever holds Manage copies people in, as "Copy to
/// (cc)" on Send for review: told now and of what comes of it, never asked to answer. Why is optional. Who answers a step
/// is changed by handing it over (<see cref="DelegationService"/>).
/// </summary>
public static class StepPeople
{
    public sealed record InformRequest(Guid[]? CopyUserIds, string? Reason);

    public static void MapStepPeopleEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}/reviews/{reviewId:guid}/people").WithTags("Reviews")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("", OptionsAsync);
        project.MapPost("", InformAsync);
    }

    private static bool Keeper(ProjectAccess access) => access.IsInternal && (access.Holds(Verbs.Control) || access.Holds(Verbs.Manage));

    /// <summary>Everyone active on the project, any organization, by name.</summary>
    private static async Task<List<(Guid Id, string Name)>> PeopleAsync(DeliosDbContext db, ProjectAccess access, CancellationToken cancellationToken) =>
        (await db.Memberships.AsNoTracking().Where(m => m.ProjectId == access.Project.Id && m.Active)
            .Join(db.Users.Where(u => u.Active), m => m.UserId, u => u.Id, (m, u) => new { u.Id, u.Name })
            .Distinct().OrderBy(u => u.Name).ToListAsync(cancellationToken)).Select(u => (u.Id, u.Name)).ToList();

    /// <summary>What the form offers: the project's people, and who is copied in already.</summary>
    private static async Task<IResult> OptionsAsync(Guid reviewId, HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var review = await db.Reviews.AsNoTracking().SingleOrDefaultAsync(r => r.Id == reviewId && r.ProjectId == access.Project.Id, cancellationToken);
        if (review is null) return Problems.NotFound("REVIEW_NOT_FOUND", "No such review.");
        if (!Keeper(access) || review.State != ReviewStates.InProgress) return Results.Ok(new { open = false });
        var people = await PeopleAsync(db, access, cancellationToken);
        return Results.Ok(new { open = true, People = people.Select(p => new { p.Id, p.Name }), Copied = review.CopyUserIds });
    }

    private static async Task<IResult> InformAsync(Guid reviewId, InformRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        Notifications.Notifier notifier, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!Keeper(access)) return Problems.Forbidden("CONTROL_OR_MANAGE", "The control function or whoever holds Manage adds people in copy on a review in flow.");
        var review = await db.Reviews.SingleOrDefaultAsync(r => r.Id == reviewId && r.ProjectId == access.Project.Id, cancellationToken);
        if (review is null) return Problems.NotFound("REVIEW_NOT_FOUND", "No such review.");
        if (review.State != ReviewStates.InProgress)
            return Problems.Conflict("REVIEW_CLOSED", "The review is no longer in flow: nobody is added in copy now.");
        var why = request.Reason?.Trim() is { Length: > 0 } said ? said : null;
        var copies = (request.CopyUserIds ?? []).Distinct().ToList();
        if (copies.Count == 0) return Problems.Invalid("NOBODY_CHOSEN", "Choose who is added in copy.");
        var people = (await PeopleAsync(db, access, cancellationToken)).ToDictionary(p => p.Id, p => p.Name);
        if (copies.Any(id => !people.ContainsKey(id))) return Problems.Invalid("NOT_ON_PROJECT", "Only people active on the project are added in copy.");
        var copied = copies.Where(id => !review.CopyUserIds.Contains(id)).ToList();
        if (copied.Count == 0) return Problems.Conflict("ALREADY_COPIED", "They are in copy already.");
        review.CopyUserIds = [.. review.CopyUserIds.Concat(copied)];
        await db.SaveChangesAsync(cancellationToken);

        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "REVIEW_PEOPLE_ADDED", "Review", review.Id, review.Number,
            $"Added in copy: {string.Join(", ", copied.Select(id => people[id]))}.{(why is null ? "" : $" {why}")}", review.ProjectId, cancellationToken);
        await notifier.NotifyAsync(review.TenantId, review.ProjectId, copied, Notifications.NotificationKinds.General,
            $"You are in copy of review {review.Number}",
            $"{access.UserName} added you in copy{(why is null ? "." : $": {why}")} You are told what comes of it; nothing is asked of you.", $"/reviews/{review.Id}",
            cancellationToken, Notifications.EmailKinds.Review);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { Copied = copied.Count });
    }
}
