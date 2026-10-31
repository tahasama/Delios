using Delios.Host.Audit;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Identity;

/// <summary>
/// A person asking to be forgotten (GDPR Article 17), carried out by an administrator of their organization, which
/// decides for its space: the account's name and email are replaced ("Former user 1a2b3c4d"), it is closed, its sign-in
/// name, sessions, devices and pop-up subscriptions go. What they did stays in the records under the name it was done by,
/// since the register has to prove who did what (Article 17(3)(b) and (e)); the screen says so before it is done.
/// </summary>
public static class ForgetPerson
{
    public sealed record ForgetRequest(string? Why);

    public static void MapForgetEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGroup("/api/admin").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(async (context, next) => context.HttpContext.User.IsAdmin() && await Keepers.IsOursAsync(context.HttpContext)
                ? await next(context)
                : Problems.Forbidden("ADMIN_ONLY", "Only an administrator of ours forgets a person."))
            .MapPost("/users/{userId:guid}/forget", ForgetAsync);
    }

    private static async Task<IResult> ForgetAsync(Guid userId, ForgetRequest request, HttpContext http, DeliosDbContext db, SessionStore sessions,
        AuditLog audit, CancellationToken cancellationToken)
    {
        var why = request.Why?.Trim() ?? "";
        if (why.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why: who asked, and when.", new { field = "why" });
        if (userId == http.User.UserId()) return Problems.Conflict("NOT_YOURSELF", "Another administrator forgets you.");
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null) return Problems.NotFound("USER_NOT_FOUND", "No such person.");
        // A linked account is its own organization's person: they ask there.
        if (user.HomeTenantId is not null)
            return Problems.Conflict("LINKED_ACCOUNT", "This person works here from their own organization's DELIOS: it is theirs to forget them.");
        if (user.Email.EndsWith("@forgotten.invalid", StringComparison.Ordinal)) return Problems.Conflict("ALREADY_FORGOTTEN", "Already forgotten.");
        var name = $"Former user {user.Id.ToString("N")[..8]}";
        var email = $"former-{user.Id:N}@forgotten.invalid";
        await db.SignInNames.Where(n => n.NormalizedEmail == user.NormalizedEmail).ExecuteDeleteAsync(cancellationToken);
        await db.Set<KnownDevice>().Where(d => d.UserId == user.Id).ExecuteDeleteAsync(cancellationToken);
        await db.Set<Notifications.PushSubscription>().Where(p => p.UserId == user.Id).ExecuteDeleteAsync(cancellationToken);
        user.Name = name;
        user.Email = email;
        user.NormalizedEmail = email.ToUpperInvariant();
        user.PasswordHash = "";
        user.Active = false;
        user.IsAdmin = false;
        user.HomeFunction = null;
        Mfa.Disable(user);
        await db.SaveChangesAsync(cancellationToken);
        await sessions.ForgetAllAsync(user.Id, revoke: true, cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "PERSON_FORGOTTEN", "User", user.Id, name, why, cancellationToken: cancellationToken);
        return Results.Ok(new { name });
    }
}
