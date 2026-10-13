using System.Security.Claims;
using System.Text.Encodings.Web;
using Delios.Host.Audit;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Identity;

/// <summary>
/// Settings for the session cookie, read from the "Auth" section of the configuration (appsettings.json or environment variables).
/// </summary>
public sealed class SessionCookieOptions
{
    /// <summary>Name of the configuration section these settings are read from.</summary>
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
    /// <summary>
    /// Name of this authentication scheme, used when registering it and when building the signed-in identity.
    /// </summary>
    public const string SchemeName = "Session";
    /// <summary>Name of the browser cookie that holds the session token.</summary>
    public const string CookieName = "delios_session";

    /// <summary>
    /// Called by ASP.NET Core on each request. No cookie means "not signed in" (no result); an unknown or ended session fails.
    /// For a valid session it sets the tenant, renews the session and cookie when due, and returns the user's claims (user id, name, tenant, admin flag).
    /// </summary>
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

    /// <summary>
    /// Writes the session cookie to the response: HttpOnly (JavaScript cannot read it), Lax same-site, and Secure unless turned off for local development.
    /// Used after sign-in and when the session is renewed.
    /// </summary>
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

/// <summary>
/// Names of the custom claims put on a signed-in user, plus extension methods to read them back from <c>ClaimsPrincipal</c> (the signed-in user object, <c>HttpContext.User</c>).
/// A claim is one named fact about the user, such as their id or tenant.
/// </summary>
public static class Claims
{
    /// <summary>Claim that holds the user's tenant id.</summary>
    public const string Tenant = "delios:tenant";
    /// <summary>Claim that is "true" when the user is a tenant administrator.</summary>
    public const string Admin = "delios:admin";

    /// <summary>Returns the signed-in user as an audit <c>Actor</c> (id and name), for recording who did something.</summary>
    public static Actor Actor(this ClaimsPrincipal user) => new(user.UserId(), user.Identity?.Name ?? "Unknown");

    /// <summary>Returns the signed-in user's id. Throws when the request is not signed in.</summary>
    public static Guid UserId(this ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? throw new InvalidOperationException("The request is not signed in."));

    /// <summary>Returns the signed-in user's tenant id. Throws when the request is not signed in.</summary>
    public static Guid TenantId(this ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(Tenant) ?? throw new InvalidOperationException("The request is not signed in."));

    /// <summary>True when the signed-in user is a tenant administrator.</summary>
    public static bool IsAdmin(this ClaimsPrincipal user) => user.FindFirstValue(Admin) == "true";
}
