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
    private const string ChallengePurpose = "delios.console.setup";
    public const int RecoveryCodes = 10;

    public sealed record SignInRequest(string? Email, string? Password, string? Code);
    public sealed record SetupRequest(string? Challenge, string? Code);
    /// <summary>
    /// The answer to a sign-in: signed in (with recovery codes, shown once, right after the authenticator is set up), or,
    /// on the first sign-in, the authenticator to set up: its key and the address its QR code holds, and a challenge
    /// that carries who it is for 10 minutes (the password is not sent again).
    /// </summary>
    public sealed record SignInAnswer(string Step, Me? Me = null, string? Secret = null, string? Uri = null, string? Challenge = null,
        IReadOnlyList<string>? RecoveryCodes = null);
    public sealed record Me(Guid Id, string Name, string Email, bool AuthenticatorOff = false);

    /// <summary>
    /// Whether the console asks the authenticator's code (<c>Console:RequireAuthenticator</c>, CONSOLE_AUTHENTICATOR in
    /// .env, on unless set to false): off, for testing only, the password alone signs in, and every console page says so.
    /// </summary>
    public static bool AuthenticatorOn(IConfiguration configuration) => configuration.GetValue("Console:RequireAuthenticator", true);

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
        open.MapPost("/setup", SetupAsync).RequireRateLimiting("sign-in");
        open.MapPost("/sign-out", SignOutAsync);
        app.MapGroup("/api/console").WithTags("Console").AllowAnonymous().AddEndpointFilter(Gate)
            .MapGet("/me", (HttpContext http, IConfiguration configuration) =>
            {
                var o = http.Current();
                return Results.Ok(new Me(o.Id, o.Name, o.Email, !AuthenticatorOn(configuration)));
            });
    }

    private static async Task<IResult> SignInAsync(SignInRequest request, HttpContext http, DeliosDbContext db, IPasswordHasher<Operator> hasher,
        IDataProtectionProvider protection, IClock clock, IOptions<SessionCookieOptions> cookie, IConfiguration configuration, CancellationToken cancellationToken)
    {
        var withCode = AuthenticatorOn(configuration);
        var refused = Problems.Invalid("CONSOLE_SIGN_IN_REFUSED", "That email, password and code do not sign anyone in.");
        var normalized = request.Email?.Trim().ToUpperInvariant() ?? "";
        var now = clock.GetCurrentInstant();
        var who = await db.Set<Operator>().SingleOrDefaultAsync(o => o.NormalizedEmail == normalized && o.Active, cancellationToken);
        if (who is null) return refused;
        if (who.LockedUntil is { } locked && locked > now)
            return Problems.Forbidden("CONSOLE_LOCKED", "Too many wrong tries: this account is locked for a few minutes.");
        var passwordOk = hasher.VerifyHashedPassword(who, who.PasswordHash, request.Password ?? "") != PasswordVerificationResult.Failed;
        // The first sign-in: the password is right and no authenticator is set up yet. A new key is made each time until
        // a code confirms it; its QR code is drawn on the screen.
        // Switched off for testing: the password alone signs in.
        if (!withCode)
        {
            if (!passwordOk)
            {
                await FailedAsync(db, who, now, cancellationToken);
                return refused;
            }
            return await SignedInAsync(http, db, who, now, cookie.Value, null, cancellationToken);
        }
        if (passwordOk && who.MfaEnabledAt is null)
        {
            var secret = Totp.NewSecret();
            who.MfaSecretProtected = Convert.ToBase64String(Secrets(protection).Protect(secret));
            who.MfaLastStep = null;
            await db.SaveChangesAsync(cancellationToken);
            var key = Totp.Base32(secret);
            var challenge = protection.CreateProtector(ChallengePurpose).ToTimeLimitedDataProtector()
                .Protect(who.Id.ToString(), TimeSpan.FromMinutes(10));
            return Results.Ok(new SignInAnswer("SETUP", Secret: key, Uri: UriOf(who.Email, key), Challenge: challenge));
        }
        var ok = passwordOk && Verify(who, request.Code, protection, now);
        if (!ok)
        {
            await FailedAsync(db, who, now, cancellationToken);
            return refused;
        }
        return await SignedInAsync(http, db, who, now, cookie.Value, null, cancellationToken);
    }

    /// <summary>The first code from the app confirms the authenticator: the operator is signed in, and given recovery codes once.</summary>
    private static async Task<IResult> SetupAsync(SetupRequest request, HttpContext http, DeliosDbContext db, IDataProtectionProvider protection,
        IClock clock, IOptions<SessionCookieOptions> cookie, CancellationToken cancellationToken)
    {
        Guid id;
        try
        {
            id = Guid.Parse(protection.CreateProtector(ChallengePurpose).ToTimeLimitedDataProtector().Unprotect(request.Challenge ?? ""));
        }
        catch
        {
            return Problems.Invalid("SETUP_EXPIRED", "That took too long: sign in again to set up the authenticator.");
        }
        var now = clock.GetCurrentInstant();
        var who = await db.Set<Operator>().SingleOrDefaultAsync(o => o.Id == id && o.Active, cancellationToken);
        if (who is null || who.MfaEnabledAt is not null || who.MfaSecretProtected is null)
            return Problems.Invalid("SETUP_EXPIRED", "Sign in again to set up the authenticator.");
        if (who.LockedUntil is { } locked && locked > now)
            return Problems.Forbidden("CONSOLE_LOCKED", "Too many wrong tries: this account is locked for a few minutes.");
        var step = Totp.Verify(Secrets(protection).Unprotect(Convert.FromBase64String(who.MfaSecretProtected)), request.Code, now.ToDateTimeOffset(), null);
        if (step is null)
        {
            await FailedAsync(db, who, now, cancellationToken);
            return Problems.Invalid("CODE_WRONG", "That is not the code the app shows now. Type the 6 digits it shows, before they change.");
        }
        who.MfaLastStep = step;
        who.MfaEnabledAt = now;
        var codes = Enumerable.Range(0, RecoveryCodes)
            .Select(_ => Totp.Base32(RandomNumberGenerator.GetBytes(5)).ToLowerInvariant()).Select(c => $"{c[..4]}-{c[4..]}").ToList();
        who.RecoveryCodeHashes = [.. codes.Select(HashCode)];
        db.Add(new OperatorEvent { OperatorId = who.Id, OperatorName = who.Name, Action = "CONSOLE_MFA_SET_UP", At = now });
        return await SignedInAsync(http, db, who, now, cookie.Value, codes, cancellationToken);
    }

    /// <summary>A code from the app, or one of the recovery codes, which is then spent.</summary>
    private static bool Verify(Operator who, string? code, IDataProtectionProvider protection, Instant now)
    {
        if (who.MfaSecretProtected is null) return false;
        if (Totp.Verify(Secrets(protection).Unprotect(Convert.FromBase64String(who.MfaSecretProtected)), code, now.ToDateTimeOffset(), who.MfaLastStep) is { } step)
        {
            who.MfaLastStep = step;
            return true;
        }
        var hash = HashCode(code ?? "");
        if (!who.RecoveryCodeHashes.Contains(hash)) return false;
        who.RecoveryCodeHashes = [.. who.RecoveryCodeHashes.Where(h => h != hash)];
        return true;
    }

    private static async Task FailedAsync(DeliosDbContext db, Operator who, Instant now, CancellationToken cancellationToken)
    {
        who.FailedSignIns++;
        if (who.FailedSignIns >= 5)
        {
            who.LockedUntil = now + Duration.FromMinutes(15);
            who.FailedSignIns = 0;
        }
        await db.SaveChangesAsync(cancellationToken);
    }

    private static async Task<IResult> SignedInAsync(HttpContext http, DeliosDbContext db, Operator who, Instant now, SessionCookieOptions cookie,
        IReadOnlyList<string>? recoveryCodes, CancellationToken cancellationToken)
    {
        who.FailedSignIns = 0;
        who.LockedUntil = null;
        who.LastSignInAt = now;
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var expires = now + Lifetime;
        db.Add(new OperatorSession { TokenHash = Hash(token), OperatorId = who.Id, CreatedAt = now, ExpiresAt = expires });
        db.Add(new OperatorEvent { OperatorId = who.Id, OperatorName = who.Name, Action = "CONSOLE_SIGNED_IN", Detail = http.Connection.RemoteIpAddress?.ToString(), At = now });
        await db.SaveChangesAsync(cancellationToken);
        http.Response.Cookies.Append(CookieName, token, new CookieOptions
        {
            HttpOnly = true, Secure = cookie.SecureCookie, SameSite = SameSiteMode.Strict, Path = "/", Expires = expires.ToDateTimeOffset(),
        });
        return Results.Ok(new SignInAnswer("SIGNED_IN", new Me(who.Id, who.Name, who.Email), RecoveryCodes: recoveryCodes));
    }

    /// <summary>What the QR code holds: the standard address every authenticator app reads (RFC 6238, 6 digits, 30 seconds).</summary>
    public static string UriOf(string email, string key) =>
        $"otpauth://totp/DELIOS%20console:{Uri.EscapeDataString(email)}?secret={key}&issuer=DELIOS%20console&digits=6&period=30";

    private static string HashCode(string code) =>
        Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(new string(code.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant())));

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
public sealed class CreateOperator(DeliosDbContext db, IPasswordHasher<Operator> hasher, IClock clock)
{
    public async Task<string> RunAsync(string email, string name, string password, CancellationToken cancellationToken = default)
    {
        email = email.Trim().ToLowerInvariant();
        if (!email.Contains('@')) return "That is not an email.";
        if (password.Length < 14) return "Set DELIOS_OPERATOR_PASSWORD (14 characters or more).";
        var normalized = email.ToUpperInvariant();
        var who = await db.Set<Operator>().SingleOrDefaultAsync(o => o.NormalizedEmail == normalized, cancellationToken);
        var isNew = who is null;
        who ??= new Operator { Email = email, NormalizedEmail = normalized, Name = name.Trim(), PasswordHash = "" };
        who.Name = name.Trim();
        who.PasswordHash = hasher.HashPassword(who, password);
        // The authenticator is set up on the next sign-in, by scanning its QR code (a reset asks it again: a lost phone).
        who.MfaSecretProtected = null;
        who.MfaEnabledAt = null;
        who.MfaLastStep = null;
        who.RecoveryCodeHashes = [];
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
        return $"{(isNew ? "Created" : "Reset")} {who.Name} <{email}>.\n"
            + "Now sign in at /console/sign-in with this email and password: the page shows a QR code to scan with an authenticator app "
            + "(Google Authenticator, Microsoft Authenticator), then asks the code it shows, and gives recovery codes once.";
    }
}
