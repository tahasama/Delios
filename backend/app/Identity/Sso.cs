using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Delios.Host.Identity;

/// <summary>Single sign-on settings read from the "Sso" section of the configuration.</summary>
public sealed class SsoOptions
{
    /// <summary>
    /// The address people reach the system at (https://edms.example.com), which the
    /// identity provider sends them back to. Empty: read from the request.
    /// </summary>
    public string? PublicUrl { get; set; }
    /// <summary>Only for a provider on a developer's machine. A real one is always HTTPS.</summary>
    public bool AllowHttp { get; set; }
}

/// <summary>
/// Talks to an organization's identity provider over OpenID Connect: its published
/// configuration and keys (cached, refreshed when a key is unknown), the code
/// exchange, and the check of the ID token it returns.
/// </summary>
public sealed class OidcClient(IHttpClientFactory http, IOptions<SsoOptions> options)
{
    /// <summary>Name of the HTTP client (registered in PlatformSetup) used for all calls to identity providers.</summary>
    public const string HttpClientName = "sso";
    /// <summary>
    /// One cached configuration manager per provider address, so each provider's settings and signing keys are downloaded once and shared.
    /// </summary>
    private readonly ConcurrentDictionary<string, ConfigurationManager<OpenIdConnectConfiguration>> _providers = new();

    /// <summary>
    /// Gets or creates the configuration manager for a provider address. It downloads the provider's discovery document
    /// (<c>/.well-known/openid-configuration</c>) and keys, and requires HTTPS unless <c>AllowHttp</c> is set.
    /// </summary>
    private ConfigurationManager<OpenIdConnectConfiguration> Manager(string authority) =>
        _providers.GetOrAdd(authority.TrimEnd('/'), a => new ConfigurationManager<OpenIdConnectConfiguration>(
            a + "/.well-known/openid-configuration", new OpenIdConnectConfigurationRetriever(),
            new HttpDocumentRetriever(http.CreateClient(HttpClientName)) { RequireHttps = !options.Value.AllowHttp }));

    /// <summary>
    /// Returns the provider's published OpenID Connect configuration (its endpoints and signing keys), from cache when possible.
    /// </summary>
    public Task<OpenIdConnectConfiguration> ConfigurationAsync(string authority, CancellationToken cancellationToken) =>
        Manager(authority).GetConfigurationAsync(cancellationToken);

    /// <summary>The ID token for an authorization code, or why not.</summary>
    public async Task<(string? IdToken, string? Error)> ExchangeAsync(
        OpenIdConnectConfiguration configuration, IdentityProvider provider, string clientSecret, string code,
        string redirectUri, string verifier, CancellationToken cancellationToken)
    {
        using var response = await http.CreateClient(HttpClientName).PostAsync(configuration.TokenEndpoint,
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "authorization_code",
                ["code"] = code,
                ["redirect_uri"] = redirectUri,
                ["client_id"] = provider.ClientId,
                ["client_secret"] = clientSecret,
                ["code_verifier"] = verifier,
            }), cancellationToken);
        if (!response.IsSuccessStatusCode) return (null, $"token endpoint answered {(int)response.StatusCode}");
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        return body.RootElement.TryGetProperty("id_token", out var token) ? (token.GetString(), null) : (null, "no ID token returned");
    }

    /// <summary>Checks signature, issuer, audience and lifetime; a key the provider rotated in is fetched once.</summary>
    public async Task<TokenValidationResult> ValidateAsync(string authority, string idToken, string clientId, CancellationToken cancellationToken)
    {
        var handler = new JsonWebTokenHandler();
        for (var attempt = 0; ; attempt++)
        {
            var configuration = await ConfigurationAsync(authority, cancellationToken);
            var result = await handler.ValidateTokenAsync(idToken, new TokenValidationParameters
            {
                ValidIssuer = configuration.Issuer,
                ValidAudience = clientId,
                IssuerSigningKeys = configuration.SigningKeys,
                ClockSkew = TimeSpan.FromMinutes(2),
            });
            if (result.IsValid || attempt > 0 || result.Exception is not SecurityTokenSignatureKeyNotFoundException) return result;
            Manager(authority).RequestRefresh();
        }
    }
}

/// <summary>
/// Sign-in through the organization's identity provider. The provider says who
/// the person is; whether they have an account here, and what it may do, is ours.
/// Nobody is created by signing in: an administrator adds people first.
/// </summary>
public static class SsoEndpoints
{
    /// <summary>Short-lived cookie that ties a single sign-on attempt to the browser that started it.</summary>
    public const string StateCookie = "delios_sso";
    /// <summary>How long a started single sign-on attempt stays valid (10 minutes).</summary>
    private static readonly TimeSpan StateLifetime = TimeSpan.FromMinutes(10);

    /// <summary>
    /// What is remembered between the start of a single sign-on and the callback. It travels through the provider sealed
    /// (encrypted and signed) in the OIDC <c>state</c> parameter. <c>Verifier</c> is the PKCE secret; <c>Binding</c> must match the state cookie.
    /// </summary>
    private sealed record State(Guid TenantId, string Nonce, string Verifier, string Binding, string ReturnUrl);

    /// <summary>
    /// Registers the public single sign-on endpoints under <c>/api/auth/sso</c> (no sign-in needed; start and callback are rate limited).
    /// Called once at start-up from PlatformSetup.
    /// </summary>
    public static void MapSsoEndpoints(this IEndpointRouteBuilder app)
    {
        var sso = app.MapGroup("/api/auth/sso").WithTags("Auth").AllowAnonymous();
        sso.MapGet("", ProviderAsync);
        sso.MapGet("/start", StartAsync).RequireRateLimiting("sso");
        sso.MapGet("/callback", CallbackAsync).RequireRateLimiting("sso");
    }

    /// <summary>Whether an organization signs in through a provider, and what to call the button.</summary>
    private static async Task<IResult> ProviderAsync(string? tenant, DeliosDbContext db, TenantContext tenants, CancellationToken cancellationToken)
    {
        var (organization, provider) = await FindAsync(tenant, db, tenants, cancellationToken);
        return provider is null ? Problems.NotFound("SSO_NOT_CONFIGURED", "This organization signs in with a password.")
            : Results.Ok(new { name = provider.Name, passwordSignIn = organization!.PasswordSignIn });
    }

    /// <summary>
    /// <c>GET /api/auth/sso/start</c>: begins sign-in through the organization's identity provider by redirecting the browser to it.
    /// Uses OIDC (OpenID Connect, the standard sign-in protocol on top of OAuth 2) with PKCE (Proof Key for Code Exchange: a one-time secret
    /// that proves the same client starts and finishes the sign-in) and a nonce (a random value the provider repeats in its token, to stop replays).
    /// </summary>
    private static async Task<IResult> StartAsync(
        string? tenant, string? returnUrl, HttpContext http, DeliosDbContext db, TenantContext tenants, OidcClient oidc,
        IDataProtectionProvider protection, IOptions<SsoOptions> options, IOptions<SessionCookieOptions> cookie,
        CancellationToken cancellationToken)
    {
        var (organization, provider) = await FindAsync(tenant, db, tenants, cancellationToken);
        if (provider is null) return Problems.NotFound("SSO_NOT_CONFIGURED", "This organization signs in with a password.");
        var configuration = await oidc.ConfigurationAsync(provider.Authority, cancellationToken);

        // The state comes back through the browser; it is sealed, short-lived and
        // tied to this browser by a cookie, so a sign-in cannot be started in one
        // place and finished in another.
        var state = new State(organization!.Id, Random(), Random(48), Random(), SafeReturnUrl(returnUrl));
        var sealedState = Protector(protection).Protect(JsonSerializer.Serialize(state), StateLifetime);
        http.Response.Cookies.Append(StateCookie, state.Binding, new CookieOptions
        {
            HttpOnly = true,
            Secure = cookie.Value.SecureCookie,
            SameSite = SameSiteMode.Lax,
            Path = "/api/auth/sso",
            MaxAge = StateLifetime,
        });
        var challenge = Base64Url(SHA256.HashData(System.Text.Encoding.ASCII.GetBytes(state.Verifier)));
        var query = new Dictionary<string, string?>
        {
            ["response_type"] = "code",
            ["client_id"] = provider.ClientId,
            ["redirect_uri"] = CallbackUrl(http, options.Value),
            ["scope"] = provider.Scopes,
            ["state"] = sealedState,
            ["nonce"] = state.Nonce,
            ["code_challenge"] = challenge,
            ["code_challenge_method"] = "S256",
        };
        return Results.Redirect(Microsoft.AspNetCore.WebUtilities.QueryHelpers.AddQueryString(configuration.AuthorizationEndpoint, query));
    }

    /// <summary>
    /// <c>GET /api/auth/sso/callback</c>: where the identity provider sends the browser back after sign-in. Checks the sealed state and its cookie,
    /// exchanges the code for an ID token, validates it (signature, nonce, verified email, allowed domain), finds the existing active account
    /// with that email and starts a session. Any failure redirects to the sign-in page with an <c>sso_error</c> code and is logged.
    /// </summary>
    private static async Task<IResult> CallbackAsync(
        string? code, string? state, string? error, HttpContext http, DeliosDbContext db, TenantContext tenants, OidcClient oidc,
        IDataProtectionProvider protection, SessionStore sessions, AuditLog audit, IOptions<SsoOptions> options,
        IOptions<SessionCookieOptions> cookie, ILoggerFactory loggers, CancellationToken cancellationToken)
    {
        var logger = loggers.CreateLogger("Delios.Sso");
        http.Response.Cookies.Delete(StateCookie, new CookieOptions { Path = "/api/auth/sso" });
        IResult Fail(string reason, string detail)
        {
            logger.LogWarning("Single sign-on refused: {Reason} ({Detail})", reason, detail);
            return Results.Redirect($"/sign-in?sso_error={reason}");
        }

        State? payload;
        try
        {
            payload = state is null ? null : JsonSerializer.Deserialize<State>(Protector(protection).Unprotect(state));
        }
        catch (Exception e) when (e is CryptographicException or JsonException)
        {
            payload = null;
        }
        if (payload is null) return Fail("SSO_STATE_INVALID", "state missing, expired or tampered with");
        if (!http.Request.Cookies.TryGetValue(StateCookie, out var binding)
            || !CryptographicOperations.FixedTimeEquals(System.Text.Encoding.UTF8.GetBytes(binding), System.Text.Encoding.UTF8.GetBytes(payload.Binding)))
        {
            return Fail("SSO_STATE_INVALID", "started in another browser");
        }
        if (error is not null || code is null) return Fail("SSO_PROVIDER_REFUSED", error ?? "no code");

        tenants.Set(payload.TenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var provider = await db.IdentityProviders.AsNoTracking().SingleOrDefaultAsync(p => p.Enabled, cancellationToken);
        if (provider is null) return Fail("SSO_NOT_CONFIGURED", "provider removed or disabled");

        var configuration = await oidc.ConfigurationAsync(provider.Authority, cancellationToken);
        var secret = SecretProtector(protection).Unprotect(provider.ClientSecretProtected);
        var (idToken, exchangeError) = await oidc.ExchangeAsync(configuration, provider, secret, code,
            CallbackUrl(http, options.Value), payload.Verifier, cancellationToken);
        if (idToken is null) return Fail("SSO_PROVIDER_REFUSED", exchangeError!);
        var validation = await oidc.ValidateAsync(provider.Authority, idToken, provider.ClientId, cancellationToken);
        if (!validation.IsValid) return Fail("SSO_TOKEN_INVALID", validation.Exception?.Message ?? "invalid");
        var claims = validation.Claims;
        if (!claims.TryGetValue("nonce", out var nonce) || nonce as string != payload.Nonce)
            return Fail("SSO_TOKEN_INVALID", "nonce does not match");
        if (claims.TryGetValue("email_verified", out var verified) && verified is false or "false")
            return Fail("SSO_EMAIL_NOT_VERIFIED", "the provider has not verified the email");
        var email = new[] { "email", "preferred_username", "upn" }
            .Select(c => claims.TryGetValue(c, out var v) ? v as string : null).FirstOrDefault(v => v?.Contains('@') == true);
        if (email is null) return Fail("SSO_NO_EMAIL", "no email claim");
        var domain = email[(email.LastIndexOf('@') + 1)..].ToLowerInvariant();
        if (provider.AllowedDomains.Length > 0 && !provider.AllowedDomains.Contains(domain, StringComparer.OrdinalIgnoreCase))
            return Fail("SSO_DOMAIN_NOT_ALLOWED", domain);

        var normalized = email.Trim().ToUpperInvariant();
        var user = await db.Users.Include(u => u.Party).SingleOrDefaultAsync(u => u.NormalizedEmail == normalized, cancellationToken);
        if (user is null || !user.Active || user.Party is { Active: false })
            return Fail("SSO_NO_ACCOUNT", "no active account for that email");

        user.FailedSignIns = 0;
        await db.SaveChangesAsync(cancellationToken);
        await IdentityEndpoints.IssueAsync(http, user, "SIGN_IN_SSO", sessions, audit, cookie.Value, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.Redirect(payload.ReturnUrl);
    }

    /// <summary>
    /// Finds an active organization by its short name (slug) and its enabled identity provider, if any.
    /// Sets the tenant first because the provider row is protected by the tenant's row-level security.
    /// </summary>
    private static async Task<(Tenant? Organization, IdentityProvider? Provider)> FindAsync(
        string? slug, DeliosDbContext db, TenantContext tenants, CancellationToken cancellationToken)
    {
        var organization = await db.Tenants.AsNoTracking()
            .SingleOrDefaultAsync(t => t.Slug == (slug ?? "").Trim().ToLowerInvariant() && t.Active, cancellationToken);
        if (organization is null) return (null, null);
        tenants.Set(organization.Id);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var provider = await db.IdentityProviders.AsNoTracking().SingleOrDefaultAsync(p => p.Enabled, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return (organization, provider);
    }

    /// <summary>
    /// Encrypts and decrypts the stored provider client secret with ASP.NET Core Data Protection. Also used by AdminEndpoints when saving it.
    /// </summary>
    public static IDataProtector SecretProtector(IDataProtectionProvider protection) => protection.CreateProtector("delios.sso.client-secret");
    /// <summary>
    /// Seals the sign-in state with a time limit, so it cannot be read, changed or reused after <c>StateLifetime</c>.
    /// </summary>
    private static ITimeLimitedDataProtector Protector(IDataProtectionProvider protection) =>
        protection.CreateProtector("delios.sso.state").ToTimeLimitedDataProtector();

    /// <summary>
    /// Builds the callback address the provider sends the browser back to: <c>PublicUrl</c> when configured, otherwise this request's own scheme and host.
    /// </summary>
    private static string CallbackUrl(HttpContext http, SsoOptions options) =>
        (string.IsNullOrEmpty(options.PublicUrl) ? $"{http.Request.Scheme}://{http.Request.Host}" : options.PublicUrl.TrimEnd('/'))
        + "/api/auth/sso/callback";

    /// <summary>Only a path on this site: never somewhere else the browser could be sent with a fresh session.</summary>
    private static string SafeReturnUrl(string? url) =>
        url is { Length: > 0 } && url[0] == '/' && !url.StartsWith("//") && !url.StartsWith("/\\") ? url : "/";

    /// <summary>Returns a random URL-safe string made from the given number of random bytes.</summary>
    private static string Random(int bytes = 32) => Base64Url(RandomNumberGenerator.GetBytes(bytes));
    /// <summary>Encodes bytes as Base64 that is safe in URLs (no padding, - and _ instead of + and /).</summary>
    private static string Base64Url(byte[] data) => Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
