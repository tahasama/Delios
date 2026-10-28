using System.Security.Cryptography;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Operators;

/// <summary>
/// The DELIOS team's sign-in, apart from every organization's: its own accounts (<see cref="Operator"/>), its own cookie
/// (<c>delios_console</c>), always a password and a code from an authenticator app, locked for 15 minutes after 5 wrong
/// tries, 8 hours at most. No organization's account ever opens the console, and no operator account opens an
/// organization's space.
/// </summary>
public static class OperatorAuth
{
    public const string CookieName = "delios_console";
    public static readonly Duration Lifetime = Duration.FromHours(8);
    private const string ItemKey = "delios:operator";
    private const string SecretPurpose = "delios.console.mfa";

    public sealed record SignInRequest(string? Email, string? Password, string? Code);
    public sealed record Me(Guid Id, string Name, string Email);

    public static byte[] Hash(string token) => SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token));

    /// <summary>The operator signed in on this request (set by <see cref="Gate"/>).</summary>
    public static Operator Current(this HttpContext http) => (Operator)http.Items[ItemKey]!;

    public static IDataProtector Secrets(IDataProtectionProvider protection) => protection.CreateProtector(SecretPurpose);

    /// <summary>Every console endpoint but signing in: no valid console session, 401.</summary>
    public static async ValueTask<object?> Gate(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (!http.Request.Cookies.TryGetValue(CookieName, out var token) || string.IsNullOrEmpty(token))
            return Problems.Problem(StatusCodes.Status401Unauthorized, "CONSOLE_SIGN_IN", "Sign in to the console.", null);
        var db = http.RequestServices.GetRequiredService<DeliosDbContext>();
        var now = http.RequestServices.GetRequiredService<IClock>().GetCurrentInstant();
        var hash = Hash(token);
        var who = await (from s in db.Set<OperatorSession>().AsNoTracking()
                         join o in db.Set<Operator>().AsNoTracking() on s.OperatorId equals o.Id
                         where s.TokenHash == hash && s.RevokedAt == null && s.ExpiresAt > now && o.Active
                         select o).SingleOrDefaultAsync(http.RequestAborted);
        if (who is null) return Problems.Problem(StatusCodes.Status401Unauthorized, "CONSOLE_SIGN_IN", "Sign in to the console.", null);
        http.Items[ItemKey] = who;
        return await next(context);
    }

    public static void MapOperatorAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var open = app.MapGroup("/api/console/auth").WithTags("Console").AllowAnonymous();
        open.MapPost("/sign-in", SignInAsync).RequireRateLimiting("sign-in");
        open.MapPost("/sign-out", SignOutAsync);
        app.MapGroup("/api/console").WithTags("Console").AllowAnonymous().AddEndpointFilter(Gate)
            .MapGet("/me", (HttpContext http) => { var o = http.Current(); return Results.Ok(new Me(o.Id, o.Name, o.Email)); });
    }

    private static async Task<IResult> SignInAsync(SignInRequest request, HttpContext http, DeliosDbContext db, IPasswordHasher<Operator> hasher,
        IDataProtectionProvider protection, IClock clock, IOptions<SessionCookieOptions> cookie, CancellationToken cancellationToken)
    {
        var refused = Problems.Invalid("CONSOLE_SIGN_IN_REFUSED", "That email, password and code do not sign anyone in.");
        var normalized = request.Email?.Trim().ToUpperInvariant() ?? "";
        var now = clock.GetCurrentInstant();
        var who = await db.Set<Operator>().SingleOrDefaultAsync(o => o.NormalizedEmail == normalized && o.Active, cancellationToken);
        if (who is null) return refused;
        if (who.LockedUntil is { } locked && locked > now)
            return Problems.Forbidden("CONSOLE_LOCKED", "Too many wrong tries: this account is locked for a few minutes.");
        var passwordOk = hasher.VerifyHashedPassword(who, who.PasswordHash, request.Password ?? "") != PasswordVerificationResult.Failed;
        var step = passwordOk
            ? Totp.Verify(Secrets(protection).Unprotect(Convert.FromBase64String(who.MfaSecretProtected)), request.Code, now.ToDateTimeOffset(), who.MfaLastStep)
            : null;
        if (step is null)
        {
            who.FailedSignIns++;
            if (who.FailedSignIns >= 5)
            {
                who.LockedUntil = now + Duration.FromMinutes(15);
                who.FailedSignIns = 0;
            }
            await db.SaveChangesAsync(cancellationToken);
            return refused;
        }
        who.FailedSignIns = 0;
        who.LockedUntil = null;
        who.MfaLastStep = step;
        who.LastSignInAt = now;
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var expires = now + Lifetime;
        db.Add(new OperatorSession { TokenHash = Hash(token), OperatorId = who.Id, CreatedAt = now, ExpiresAt = expires });
        db.Add(new OperatorEvent { OperatorId = who.Id, OperatorName = who.Name, Action = "CONSOLE_SIGNED_IN", Detail = http.Connection.RemoteIpAddress?.ToString(), At = now });
        await db.SaveChangesAsync(cancellationToken);
        http.Response.Cookies.Append(CookieName, token, new CookieOptions
        {
            HttpOnly = true, Secure = cookie.Value.SecureCookie, SameSite = SameSiteMode.Strict, Path = "/", Expires = expires.ToDateTimeOffset(),
        });
        return Results.Ok(new Me(who.Id, who.Name, who.Email));
    }

    private static async Task<IResult> SignOutAsync(HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        if (http.Request.Cookies.TryGetValue(CookieName, out var token) && !string.IsNullOrEmpty(token))
        {
            var hash = Hash(token);
            var now = clock.GetCurrentInstant();
            await db.Set<OperatorSession>().Where(s => s.TokenHash == hash && s.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, now), cancellationToken);
        }
        http.Response.Cookies.Delete(CookieName);
        return Results.NoContent();
    }
}

/// <summary>
/// <c>create-operator &lt;email&gt; &lt;name&gt;</c> (backend command): a member of the DELIOS team, with the password from
/// <c>DELIOS_OPERATOR_PASSWORD</c> (never in shell history) and a new authenticator secret, printed once to be added to
/// their app. Run again for the same email, it gives a new password and a new secret.
/// </summary>
public sealed class CreateOperator(DeliosDbContext db, IPasswordHasher<Operator> hasher, IDataProtectionProvider protection, IClock clock)
{
    public async Task<string> RunAsync(string email, string name, string password, CancellationToken cancellationToken = default)
    {
        email = email.Trim().ToLowerInvariant();
        if (!email.Contains('@')) return "That is not an email.";
        if (password.Length < 14) return "Set DELIOS_OPERATOR_PASSWORD (14 characters or more).";
        var normalized = email.ToUpperInvariant();
        var secret = Totp.NewSecret();
        var who = await db.Set<Operator>().SingleOrDefaultAsync(o => o.NormalizedEmail == normalized, cancellationToken);
        var isNew = who is null;
        who ??= new Operator { Email = email, NormalizedEmail = normalized, Name = name.Trim(), PasswordHash = "", MfaSecretProtected = "" };
        who.Name = name.Trim();
        who.PasswordHash = hasher.HashPassword(who, password);
        who.MfaSecretProtected = Convert.ToBase64String(OperatorAuth.Secrets(protection).Protect(secret));
        who.MfaLastStep = null;
        who.Active = true;
        who.FailedSignIns = 0;
        who.LockedUntil = null;
        if (isNew) db.Add(who);
        db.Add(new OperatorEvent
        {
            OperatorId = who.Id, OperatorName = who.Name, Action = isNew ? "OPERATOR_CREATED" : "OPERATOR_RESET",
            Detail = "By the backend command create-operator.", At = clock.GetCurrentInstant(),
        });
        await db.SaveChangesAsync(cancellationToken);
        var key = Totp.Base32(secret);
        return $"{(isNew ? "Created" : "Reset")} {who.Name} <{email}>.\nAdd this key to the authenticator app: {key}\n"
            + $"otpauth://totp/DELIOS%20console:{Uri.EscapeDataString(email)}?secret={key}&issuer=DELIOS%20console";
    }
}
