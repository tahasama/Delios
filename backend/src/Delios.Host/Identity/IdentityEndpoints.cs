using System.ComponentModel.DataAnnotations;
using Delios.Host.Audit;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Identity;

public sealed record SignInRequest([Required] string Tenant, [Required] string Email, [Required] string Password);

public static class IdentityEndpoints
{
    public const int MaxFailedSignIns = 5;
    public static readonly Duration LockoutFor = Duration.FromMinutes(15);

    // Verified against when no such person exists, so a wrong email costs the
    // same time as a wrong password and does not reveal who has an account.
    private static readonly string DummyHash = new PasswordHasher<User>().HashPassword(null!, "not-a-password");

    public static void MapIdentityEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth").WithTags("Auth");
        auth.MapPost("/sign-in", SignInAsync).AllowAnonymous().RequireRateLimiting("sign-in");
        auth.MapPost("/sign-out", SignOutAsync);

        app.MapGet("/api/me", MeAsync).WithTags("Auth").AddEndpointFilter<TransactionFilter>();
    }

    private static async Task<IResult> SignInAsync(
        SignInRequest request, HttpContext http, DeliosDbContext db, TenantContext tenant,
        SessionStore sessions, AuditLog audit, IClock clock, IPasswordHasher<User> hasher,
        IOptions<SessionCookieOptions> cookie, CancellationToken cancellationToken)
    {
        var failed = Problems.Problem(StatusCodes.Status401Unauthorized, "SIGN_IN_FAILED",
            "The organization, email or password is not right.", null);

        var organization = await db.Tenants.AsNoTracking()
            .SingleOrDefaultAsync(t => t.Slug == request.Tenant.Trim().ToLowerInvariant() && t.Active, cancellationToken);
        if (organization is null)
        {
            hasher.VerifyHashedPassword(null!, DummyHash, request.Password);
            return failed;
        }

        tenant.Set(organization.Id);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var normalized = request.Email.Trim().ToUpperInvariant();
        var user = await db.Users.Include(u => u.Party)
            .SingleOrDefaultAsync(u => u.NormalizedEmail == normalized, cancellationToken);
        if (user is null || !user.Active || user.Party is { Active: false })
        {
            hasher.VerifyHashedPassword(null!, DummyHash, request.Password);
            return failed;
        }

        var now = clock.GetCurrentInstant();
        if (user.LockedUntil > now)
        {
            return Problems.Problem(StatusCodes.Status423Locked, "ACCOUNT_LOCKED",
                "Too many failed attempts. Try again later.",
                new { until = user.LockedUntil.Value.ToDateTimeOffset() });
        }

        var verdict = hasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
        var actor = new Actor(user.Id, user.Name);
        if (verdict == PasswordVerificationResult.Failed)
        {
            user.FailedSignIns++;
            var locked = user.FailedSignIns >= MaxFailedSignIns;
            if (locked)
            {
                user.LockedUntil = now + LockoutFor;
                user.FailedSignIns = 0;
            }
            await db.SaveChangesAsync(cancellationToken);
            await audit.WriteAsync(actor, locked ? "ACCOUNT_LOCKED" : "SIGN_IN_FAILED", "User", user.Id, user.Email,
                cancellationToken: cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return failed;
        }

        if (verdict == PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = hasher.HashPassword(user, request.Password);
        }
        user.FailedSignIns = 0;
        user.LockedUntil = null;
        await db.SaveChangesAsync(cancellationToken);

        var (token, expires) = await sessions.CreateAsync(user, cancellationToken);
        await audit.WriteAsync(actor, "SIGN_IN", "User", user.Id, user.Email, cancellationToken: cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        SessionAuthenticationHandler.WriteCookie(http.Response, token, expires, cookie.Value);
        return Results.NoContent();
    }

    private static async Task<IResult> SignOutAsync(HttpContext http, SessionStore sessions, CancellationToken cancellationToken)
    {
        if (http.Request.Cookies.TryGetValue(SessionAuthenticationHandler.CookieName, out var token))
        {
            await sessions.RevokeAsync(token, cancellationToken);
        }
        http.Response.Cookies.Delete(SessionAuthenticationHandler.CookieName);
        return Results.NoContent();
    }

    private static async Task<IResult> MeAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var userId = http.User.UserId();
        var me = await db.Users.AsNoTracking().Where(u => u.Id == userId)
            .Select(u => new
            {
                u.Id,
                u.Name,
                u.Email,
                u.IsAdmin,
                Party = u.Party == null ? null : new { u.Party.Code, u.Party.Name, u.Party.IsInternal },
            })
            .SingleAsync(cancellationToken);
        var organization = await db.Tenants.AsNoTracking()
            .Where(t => t.Id == http.User.TenantId()).Select(t => new { t.Slug, t.Name })
            .SingleAsync(cancellationToken);
        var projects = await db.Memberships.AsNoTracking()
            .Where(m => m.UserId == userId && m.Active && m.Project!.Status == "ACTIVE" && m.Function!.Active)
            .OrderBy(m => m.Project!.Code)
            .Select(m => new
            {
                m.Project!.Id,
                m.Project.Code,
                m.Project.Name,
                m.Project.TimeZone,
                Function = new { m.Function!.Code, m.Function.Name },
                Verbs = m.Function.Rules
                    .Where(r => r.ProjectRole == null || r.ProjectRole == m.Project.ContractRole)
                    .SelectMany(r => r.Verbs).Distinct().ToList(),
            })
            .ToListAsync(cancellationToken);
        return Results.Ok(new { user = me, tenant = organization, projects });
    }
}
