using System.Security.Claims;
using System.Text.Encodings.Web;
using Delios.Host.Audit;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Identity;

public sealed class SessionCookieOptions
{
    public const string Section = "Auth";

    /// <summary>Send the cookie over HTTPS only. Off only for local development over plain HTTP.</summary>
    public bool SecureCookie { get; set; } = true;
}

/// <summary>Reads the session cookie, checks it against the session store and sets the tenant.</summary>
public sealed class SessionAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder,
    SessionStore sessions, TenantContext tenant, IOptions<SessionCookieOptions> cookie)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Session";
    public const string CookieName = "delios_session";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Cookies.TryGetValue(CookieName, out var token) || string.IsNullOrEmpty(token))
        {
            return AuthenticateResult.NoResult();
        }

        var session = await sessions.FindAsync(token, Context.RequestAborted);
        if (session is null) return AuthenticateResult.Fail("The session has ended");

        tenant.Set(session.TenantId);
        if (await sessions.RenewIfDueAsync(token, session, Context.RequestAborted) is { } renewed)
        {
            WriteCookie(Response, token, renewed, cookie.Value);
        }

        var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, session.UserId.ToString()),
            new Claim(ClaimTypes.Name, session.UserName),
            new Claim(Claims.Tenant, session.TenantId.ToString()),
            new Claim(Claims.Admin, session.IsAdmin ? "true" : "false"),
        ], SchemeName);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }

    public static void WriteCookie(HttpResponse response, string token, Instant expires, SessionCookieOptions options) =>
        response.Cookies.Append(CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = options.SecureCookie,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = expires.ToDateTimeOffset(),
        });
}

public static class Claims
{
    public const string Tenant = "delios:tenant";
    public const string Admin = "delios:admin";

    public static Actor Actor(this ClaimsPrincipal user) => new(user.UserId(), user.Identity?.Name ?? "Unknown");

    public static Guid UserId(this ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? throw new InvalidOperationException("The request is not signed in."));

    public static Guid TenantId(this ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(Tenant) ?? throw new InvalidOperationException("The request is not signed in."));

    public static bool IsAdmin(this ClaimsPrincipal user) => user.FindFirstValue(Admin) == "true";
}
