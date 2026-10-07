using System.ComponentModel.DataAnnotations;
using Delios.Host.Audit;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Identity;

/// <summary>Body of <c>POST /api/auth/sign-in</c>: the organization's short name (slug), the email and the password.</summary>
public sealed record SignInRequest([Required] string Tenant, [Required] string Email, [Required] string Password);
/// <summary>
/// Body of the second sign-in step (<c>/api/auth/mfa</c>, <c>/mfa/setup</c>, <c>/mfa/confirm</c>): the challenge from <c>SignInStep</c> and, where needed, the six-digit or recovery code.
/// </summary>
public sealed record MfaRequest(string? Challenge, string? Code = null);
/// <summary>
/// Body of the signed-in user's own MFA endpoints under <c>/api/me/mfa</c>: a code from the authenticator app (or a recovery code).
/// </summary>
public sealed record CodeRequest(string? Code);

/// <summary>The password was right; a second step is needed. NEXT is MFA_CODE, or MFA_SETUP where the organization requires it and the person has none yet.</summary>
public sealed record SignInStep(string Next, string Challenge);

/// <summary>
/// Password sign-in, sign-out, the two-step sign-in (MFA, multi-factor authentication) steps, and <c>/api/me</c> (who am I and which projects am I on).
/// The endpoint handlers are the private static methods below; <c>MapIdentityEndpoints</c> connects them to URLs.
/// </summary>
public static class IdentityEndpoints
{
    /// <summary>Wrong passwords or codes in a row before the account is locked.</summary>
    public const int MaxFailedSignIns = 5;
    /// <summary>How long an account stays locked after too many failures.</summary>
    public static readonly Duration LockoutFor = Duration.FromMinutes(15);

    // Verified against when no such person exists, so a wrong email costs the
    // same time as a wrong password and does not reveal who has an account.
    private static readonly string DummyHash = new PasswordHasher<User>().HashPassword(null!, "not-a-password");

    /// <summary>
    /// Registers the sign-in endpoints under <c>/api/auth</c> (open to anyone, rate limited) and the signed-in user's endpoints under <c>/api/me</c>
    /// (run in a database transaction by <c>TransactionFilter</c>). Called once at start-up from PlatformSetup.
    /// </summary>
    public static void MapIdentityEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth").WithTags("Auth");
        auth.MapPost("/sign-in", SignInAsync).AllowAnonymous().RequireRateLimiting("sign-in");
        auth.MapPost("/sign-out", SignOutAsync);
        auth.MapPost("/mfa", MfaCodeAsync).AllowAnonymous().RequireRateLimiting("sign-in");
        auth.MapPost("/mfa/setup", MfaSetupAsync).AllowAnonymous().RequireRateLimiting("sign-in");
        auth.MapPost("/mfa/confirm", MfaConfirmAsync).AllowAnonymous().RequireRateLimiting("sign-in");

        app.MapGet("/api/me", MeAsync).WithTags("Auth").AddEndpointFilter<TransactionFilter>();
        var me = app.MapGroup("/api/me/mfa").WithTags("Auth").AddEndpointFilter<TransactionFilter>();
        me.MapPost("/setup", MyMfaSetupAsync);
        me.MapPost("/confirm", MyMfaConfirmAsync);
        me.MapPost("/disable", MyMfaDisableAsync);
    }

    /// <summary>
    /// <c>POST /api/auth/sign-in</c>: checks the organization, email and password. Wrong answers count towards a 15-minute lockout and are audited.
    /// When the password is right: refuses non-administrators if the organization allows single sign-on only; asks for the second step
    /// (<c>SignInStep</c>) when two-step sign-in is on or required; otherwise starts a session and sets the cookie.
    /// </summary>
    private static async Task<IResult> SignInAsync(
        SignInRequest request, HttpContext http, DeliosDbContext db, TenantContext tenant,
        SessionStore sessions, AuditLog audit, IClock clock, IPasswordHasher<User> hasher, Mfa mfa,
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

        // An organization that signs in through its own provider keeps passwords for administrators only.
        if (!organization.PasswordSignIn && !user.IsAdmin)
        {
            await transaction.CommitAsync(cancellationToken);
            return Problems.Problem(StatusCodes.Status403Forbidden, "PASSWORD_SIGN_IN_OFF",
                "Your organization signs in through its own identity provider.", null);
        }
        if (user.MfaEnabledAt is not null || organization.MfaRequired)
        {
            await transaction.CommitAsync(cancellationToken);
            return Results.Ok(new SignInStep(user.MfaEnabledAt is not null ? "MFA_CODE" : "MFA_SETUP", mfa.Challenge(user)));
        }

        await IssueAsync(http, user, "SIGN_IN", sessions, audit, cookie.Value, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>A session for someone who has proved who they are, by whatever means.</summary>
    public static async Task IssueAsync(HttpContext http, User user, string action, SessionStore sessions, AuditLog audit,
        SessionCookieOptions cookie, CancellationToken cancellationToken)
    {
        var (token, expires) = await sessions.CreateAsync(user, cancellationToken);
        await audit.WriteAsync(new Actor(user.Id, user.Name), action, "User", user.Id, user.Email, cancellationToken: cancellationToken);
        SessionAuthenticationHandler.WriteCookie(http.Response, token, expires, cookie);
    }

    // ── Second step ───────────────────────────────────────────────────────────

    /// <summary>
    /// <c>POST /api/auth/mfa</c>: second sign-in step for someone who has two-step sign-in set up. A right code (or recovery code) starts a session.
    /// </summary>
    private static async Task<IResult> MfaCodeAsync(
        MfaRequest request, HttpContext http, DeliosDbContext db, TenantContext tenant, Mfa mfa, SessionStore sessions,
        AuditLog audit, IClock clock, IOptions<SessionCookieOptions> cookie, CancellationToken cancellationToken) =>
        await WithChallengeAsync(request.Challenge, mfa, db, tenant, clock, cancellationToken, async (user, _) =>
        {
            if (user.MfaEnabledAt is null) return (false, ChallengeInvalid());
            if (!mfa.Verify(user, request.Code)) return (false, CodeWrong());
            await IssueAsync(http, user, "SIGN_IN_MFA", sessions, audit, cookie.Value, cancellationToken);
            return (true, Results.NoContent());
        }, audit);

    /// <summary>
    /// <c>POST /api/auth/mfa/setup</c>: during sign-in, for someone whose organization requires two-step sign-in but who has not set it up yet.
    /// Returns a new secret and the <c>otpauth://</c> address to show as a QR code. A failure here does not count towards the lockout.
    /// </summary>
    private static async Task<IResult> MfaSetupAsync(
        MfaRequest request, DeliosDbContext db, TenantContext tenant, Mfa mfa, AuditLog audit, IClock clock,
        CancellationToken cancellationToken) =>
        await WithChallengeAsync(request.Challenge, mfa, db, tenant, clock, cancellationToken, (user, organization) =>
        {
            if (user.MfaEnabledAt is not null) return Task.FromResult((false, ChallengeInvalid()));
            var (secret, uri) = mfa.Enrol(user, $"DELIOS {organization.Name}");
            return Task.FromResult((true, Results.Ok(new { secret, uri })));
        }, audit, countsAsFailure: false);

    /// <summary>
    /// <c>POST /api/auth/mfa/confirm</c>: finishes set-up during sign-in. A right code switches two-step sign-in on, starts a session
    /// and returns the recovery codes (shown only this once).
    /// </summary>
    private static async Task<IResult> MfaConfirmAsync(
        MfaRequest request, HttpContext http, DeliosDbContext db, TenantContext tenant, Mfa mfa, SessionStore sessions,
        AuditLog audit, IClock clock, IOptions<SessionCookieOptions> cookie, CancellationToken cancellationToken) =>
        await WithChallengeAsync(request.Challenge, mfa, db, tenant, clock, cancellationToken, async (user, _) =>
        {
            if (mfa.Confirm(user, request.Code) is not { } codes) return (false, CodeWrong());
            await audit.WriteAsync(new Actor(user.Id, user.Name), "MFA_ENABLED", "User", user.Id, user.Email,
                cancellationToken: cancellationToken);
            await IssueAsync(http, user, "SIGN_IN_MFA", sessions, audit, cookie.Value, cancellationToken);
            return (true, Results.Ok(new { recoveryCodes = codes }));
        }, audit);

    /// <summary>
    /// Runs a second-step act for the person a challenge names. A wrong code
    /// counts towards the same lockout as a wrong password.
    /// </summary>
    private static async Task<IResult> WithChallengeAsync(
        string? challenge, Mfa mfa, DeliosDbContext db, TenantContext tenant, IClock clock, CancellationToken cancellationToken,
        Func<User, Tenant, Task<(bool Ok, IResult Result)>> act, AuditLog audit, bool countsAsFailure = true)
    {
        if (mfa.ReadChallenge(challenge) is not { } who) return ChallengeInvalid();
        tenant.Set(who.TenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var organization = await db.Tenants.AsNoTracking().SingleOrDefaultAsync(t => t.Id == who.TenantId && t.Active, cancellationToken);
        var user = await db.Users.Include(u => u.Party).SingleOrDefaultAsync(u => u.Id == who.UserId, cancellationToken);
        if (organization is null || user is null || !user.Active || user.Party is { Active: false }) return ChallengeInvalid();
        var now = clock.GetCurrentInstant();
        if (user.LockedUntil > now)
        {
            return Problems.Problem(StatusCodes.Status423Locked, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later.",
                new { until = user.LockedUntil.Value.ToDateTimeOffset() });
        }
        var (ok, result) = await act(user, organization);
        if (!ok && countsAsFailure)
        {
            user.FailedSignIns++;
            if (user.FailedSignIns >= MaxFailedSignIns)
            {
                user.LockedUntil = now + LockoutFor;
                user.FailedSignIns = 0;
            }
            await audit.WriteAsync(new Actor(user.Id, user.Name), "MFA_FAILED", "User", user.Id, user.Email,
                cancellationToken: cancellationToken);
        }
        else if (ok)
        {
            user.FailedSignIns = 0;
        }
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return result;
    }

    /// <summary>The 401 answer when the challenge is missing, expired, or the person can no longer sign in.</summary>
    private static IResult ChallengeInvalid() => Problems.Problem(StatusCodes.Status401Unauthorized, "MFA_CHALLENGE_INVALID",
        "Sign in again: that step has expired.", null);
    /// <summary>The 401 answer for a wrong authenticator or recovery code.</summary>
    private static IResult CodeWrong() => Problems.Problem(StatusCodes.Status401Unauthorized, "MFA_CODE_WRONG",
        "That code is not right.", null);

    // ── Your own second step ──────────────────────────────────────────────────

    /// <summary>
    /// <c>POST /api/me/mfa/setup</c>: a signed-in user starts setting up two-step sign-in. Returns the new secret and <c>otpauth://</c> address.
    /// </summary>
    private static async Task<IResult> MyMfaSetupAsync(HttpContext http, DeliosDbContext db, Mfa mfa, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleAsync(u => u.Id == http.User.UserId(), cancellationToken);
        if (user.MfaEnabledAt is not null) return Problems.Conflict("MFA_ALREADY_ON", "Two-step sign-in is already on.");
        var organization = await db.Tenants.AsNoTracking().SingleAsync(t => t.Id == user.TenantId, cancellationToken);
        var (secret, uri) = mfa.Enrol(user, $"DELIOS {organization.Name}");
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { secret, uri });
    }

    /// <summary>
    /// <c>POST /api/me/mfa/confirm</c>: a signed-in user confirms set-up with a code; returns the recovery codes, shown only this once.
    /// </summary>
    private static async Task<IResult> MyMfaConfirmAsync(
        CodeRequest request, HttpContext http, DeliosDbContext db, Mfa mfa, AuditLog audit, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleAsync(u => u.Id == http.User.UserId(), cancellationToken);
        if (mfa.Confirm(user, request.Code) is not { } codes) return CodeWrong();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "MFA_ENABLED", "User", user.Id, user.Email, cancellationToken: cancellationToken);
        return Results.Ok(new { recoveryCodes = codes });
    }

    /// <summary>
    /// <c>POST /api/me/mfa/disable</c>: a signed-in user turns two-step sign-in off after giving a valid code. Refused when the organization requires it.
    /// </summary>
    private static async Task<IResult> MyMfaDisableAsync(
        CodeRequest request, HttpContext http, DeliosDbContext db, Mfa mfa, AuditLog audit, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleAsync(u => u.Id == http.User.UserId(), cancellationToken);
        var organization = await db.Tenants.AsNoTracking().SingleAsync(t => t.Id == user.TenantId, cancellationToken);
        if (organization.MfaRequired)
            return Problems.Forbidden("MFA_REQUIRED_BY_ORGANIZATION", "Your organization requires two-step sign-in.");
        if (!mfa.Verify(user, request.Code)) return CodeWrong();
        Mfa.Disable(user);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "MFA_DISABLED", "User", user.Id, user.Email, cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// <c>POST /api/auth/sign-out</c>: ends the session in the database (on every server) and deletes the session cookie.
    /// </summary>
    private static async Task<IResult> SignOutAsync(HttpContext http, SessionStore sessions, CancellationToken cancellationToken)
    {
        if (http.Request.Cookies.TryGetValue(SessionAuthenticationHandler.CookieName, out var token))
        {
            await sessions.RevokeAsync(token, cancellationToken);
        }
        http.Response.Cookies.Delete(SessionAuthenticationHandler.CookieName);
        return Results.NoContent();
    }

    /// <summary>
    /// <c>GET /api/me</c>: who the signed-in user is, their organization, and the active projects they are on with their function and verbs there.
    /// </summary>
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
