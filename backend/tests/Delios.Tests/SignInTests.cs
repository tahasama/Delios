using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Delios.Host.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Delios.Tests;

/// <summary>Two-step sign-in and single sign-on, as an organization switches them on.</summary>
public sealed class SignInTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static string CodeFor(string secret, int stepsAhead = 0) =>
        Totp.Code(Totp.FromBase32(secret), Totp.StepAt(DateTimeOffset.UtcNow) + stepsAhead);

    private static Task<HttpResponseMessage> PasswordAsync(HttpClient client, string email) =>
        client.PostAsJsonAsync("/api/auth/sign-in", new { email, password = "demo1234" });

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        return text.Length == 0 ? default : JsonDocument.Parse(text).RootElement;
    }

    [Fact]
    public async Task Someone_who_turned_on_two_step_sign_in_needs_a_code_after_the_password()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var (_, setup) = await Flow.PostAsync(engineer, "/api/me/mfa/setup", new { });
        var secret = setup.GetProperty("secret").GetString()!;
        Assert.StartsWith("otpauth://totp/", setup.GetProperty("uri").GetString());
        var (wrong, _) = await Flow.PostAsync(engineer, "/api/me/mfa/confirm", new { code = "000000" });
        Assert.Equal(HttpStatusCode.Unauthorized, wrong);
        var (_, confirmed) = await Flow.PostAsync(engineer, "/api/me/mfa/confirm", new { code = CodeFor(secret) });
        var recovery = confirmed.GetProperty("recoveryCodes").EnumerateArray().Select(c => c.GetString()!).ToList();
        Assert.Equal(10, recovery.Count);

        // The password alone is no longer enough.
        var client = app.Factory.CreateClient();
        using var first = await PasswordAsync(client, "engineer@demo.local");
        var step = await JsonAsync(first);
        Assert.Equal("MFA_CODE", step.GetProperty("next").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me")).StatusCode);
        var challenge = step.GetProperty("challenge").GetString();

        // The code already used to confirm does not work twice.
        var (replayed, replayedBody) = await Flow.PostAsync(client, "/api/auth/mfa", new { challenge, code = CodeFor(secret) });
        Assert.Equal((HttpStatusCode.Unauthorized, "MFA_CODE_WRONG"), (replayed, Flow.Code(replayedBody)));
        var (ok, _) = await Flow.PostAsync(client, "/api/auth/mfa", new { challenge, code = CodeFor(secret, stepsAhead: 1) });
        Assert.Equal(HttpStatusCode.NoContent, ok);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me")).StatusCode);

        // A recovery code stands in for a lost phone, once.
        var other = app.Factory.CreateClient();
        var otherChallenge = (await JsonAsync(await PasswordAsync(other, "engineer@demo.local"))).GetProperty("challenge").GetString();
        Assert.Equal(HttpStatusCode.NoContent, (await Flow.PostAsync(other, "/api/auth/mfa", new { challenge = otherChallenge, code = recovery[0] })).Status);
        var third = app.Factory.CreateClient();
        var thirdChallenge = (await JsonAsync(await PasswordAsync(third, "engineer@demo.local"))).GetProperty("challenge").GetString();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Flow.PostAsync(third, "/api/auth/mfa", new { challenge = thirdChallenge, code = recovery[0] })).Status);

        // A made-up challenge is refused.
        var (forged, forgedBody) = await Flow.PostAsync(third, "/api/auth/mfa", new { challenge = "nonsense", code = "123456" });
        Assert.Equal((HttpStatusCode.Unauthorized, "MFA_CHALLENGE_INVALID"), (forged, Flow.Code(forgedBody)));
    }

    [Fact]
    public async Task An_organization_that_requires_two_step_sign_in_has_everyone_enrol_at_their_next_sign_in()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var (notAdmin, notAdminBody) = await Flow.PostAsync(engineer, "/api/admin/security", new { });
        Assert.True(notAdmin is HttpStatusCode.Forbidden or HttpStatusCode.MethodNotAllowed, notAdminBody.ToString());
        using (var put = await engineer.PutAsJsonAsync("/api/admin/security", new { mfaRequired = true }))
            Assert.Equal(HttpStatusCode.Forbidden, put.StatusCode);
        var admin = await app.SignedInAsync("admin@demo.local");
        using (var put = await admin.PutAsJsonAsync("/api/admin/security", new { mfaRequired = true }))
            Assert.Equal(HttpStatusCode.NoContent, put.StatusCode);

        var client = app.Factory.CreateClient();
        var step = await JsonAsync(await PasswordAsync(client, "approver@demo.local"));
        Assert.Equal("MFA_SETUP", step.GetProperty("next").GetString());
        var challenge = step.GetProperty("challenge").GetString();
        var (_, setup) = await Flow.PostAsync(client, "/api/auth/mfa/setup", new { challenge });
        var (confirmed, body) = await Flow.PostAsync(client, "/api/auth/mfa/confirm",
            new { challenge, code = CodeFor(setup.GetProperty("secret").GetString()!) });
        Assert.True(confirmed == HttpStatusCode.OK, body.ToString());
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me")).StatusCode);

        var (off, offBody) = await Flow.PostAsync(client, "/api/me/mfa/disable", new { code = "123456" });
        Assert.Equal((HttpStatusCode.Forbidden, "MFA_REQUIRED_BY_ORGANIZATION"), (off, Flow.Code(offBody)));
        using var policy = await admin.GetAsync("/api/admin/security");
        Assert.Equal(1, (await JsonAsync(policy)).GetProperty("mfaEnrolled").GetProperty("enrolled").GetInt32());
    }

    [Fact]
    public async Task People_sign_in_through_the_organizations_identity_provider_and_only_to_accounts_that_exist()
    {
        var idp = new FakeIdentityProvider();
        await using var app = await TestApp.StartAsync(infrastructure, services: s =>
            s.AddHttpClient(OidcClient.HttpClientName).ConfigurePrimaryHttpMessageHandler(() => idp));
        var admin = await app.SignedInAsync("admin@demo.local");

        using (var early = await admin.PutAsJsonAsync("/api/admin/security", new { passwordSignIn = false }))
            Assert.Equal(HttpStatusCode.Conflict, early.StatusCode);
        using (var configured = await admin.PutAsJsonAsync("/api/admin/security/sso", new
        {
            name = "Demo Engineering SSO",
            authority = FakeIdentityProvider.Issuer,
            clientId = "delios",
            clientSecret = "s3cret",
            allowedDomains = new[] { "demo.local" },
        }))
        {
            Assert.Equal(HttpStatusCode.NoContent, configured.StatusCode);
        }
        var shown = await app.Factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/auth/sso?tenant=demo");
        Assert.Equal("Demo Engineering SSO", shown.GetProperty("name").GetString());
        using (var secretHidden = await admin.GetAsync("/api/admin/security"))
            Assert.DoesNotContain("s3cret", await secretHidden.Content.ReadAsStringAsync());

        // Through the provider and back, signed in, landing where they were going.
        var (browser, landing) = await SignInThroughProviderAsync(app, idp, "engineer@demo.local", "/documents");
        Assert.Equal("/documents", landing);
        var me = await browser.GetFromJsonAsync<JsonElement>("/api/me");
        Assert.Equal("Eli Engineer", me.GetProperty("user").GetProperty("name").GetString());

        Assert.Equal("/sign-in?sso_error=SSO_NO_ACCOUNT", (await SignInThroughProviderAsync(app, idp, "stranger@demo.local")).Landing);
        Assert.Equal("/sign-in?sso_error=SSO_DOMAIN_NOT_ALLOWED", (await SignInThroughProviderAsync(app, idp, "supplier@acme.local")).Landing);
        Assert.Equal("/sign-in?sso_error=SSO_STATE_INVALID",
            (await SignInThroughProviderAsync(app, idp, "engineer@demo.local", otherBrowserFinishes: true)).Landing);
        Assert.Equal("/", (await SignInThroughProviderAsync(app, idp, "engineer@demo.local", "https://evil.example/")).Landing);

        // Passwords off: people use the provider; administrators keep a way in.
        using (var off = await admin.PutAsJsonAsync("/api/admin/security", new { passwordSignIn = false }))
            Assert.Equal(HttpStatusCode.NoContent, off.StatusCode);
        using var refused = await PasswordAsync(app.Factory.CreateClient(), "engineer@demo.local");
        Assert.Equal((HttpStatusCode.Forbidden, "PASSWORD_SIGN_IN_OFF"), (refused.StatusCode, Flow.Code(await JsonAsync(refused))));
        // The same answer with a wrong password: it never tells whether a password was right.
        using var guessed = await app.Factory.CreateClient().PostAsJsonAsync("/api/auth/sign-in",
            new { email = "engineer@demo.local", password = "not-it" });
        Assert.Equal((HttpStatusCode.Forbidden, "PASSWORD_SIGN_IN_OFF"), (guessed.StatusCode, Flow.Code(await JsonAsync(guessed))));
        await app.SignedInAsync("admin@demo.local");
    }

    private static async Task<(HttpClient Browser, string Landing)> SignInThroughProviderAsync(
        TestApp app, FakeIdentityProvider idp, string email, string returnUrl = "/", bool otherBrowserFinishes = false)
    {
        var browser = app.Factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        using var start = await browser.GetAsync($"/api/auth/sso/start?tenant=demo&returnUrl={Uri.EscapeDataString(returnUrl)}");
        Assert.Equal(HttpStatusCode.Redirect, start.StatusCode);
        var authorize = start.Headers.Location!;
        Assert.StartsWith(FakeIdentityProvider.Issuer + "/authorize", authorize.ToString());
        var query = QueryHelpers.ParseQuery(authorize.Query);
        Assert.Equal("S256", query["code_challenge_method"].ToString());
        Assert.Equal("delios", query["client_id"].ToString());

        // What the provider does after the person signs in there: a code, back to us.
        var code = idp.Issue(email, query["nonce"]!, query["code_challenge"]!);
        var finishing = otherBrowserFinishes ? app.Factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false }) : browser;
        using var callback = await finishing.GetAsync(
            $"/api/auth/sso/callback?code={code}&state={Uri.EscapeDataString(query["state"]!)}");
        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        return (finishing, callback.Headers.Location!.OriginalString);
    }
}

/// <summary>A minimal OpenID Connect provider: discovery, keys, and a token endpoint that checks PKCE.</summary>
public sealed class FakeIdentityProvider : HttpMessageHandler
{
    public const string Issuer = "https://idp.test";
    private readonly RSA _rsa = RSA.Create(2048);
    private readonly ConcurrentDictionary<string, (string Email, string Nonce, string Challenge)> _codes = new();

    public string Issue(string email, string nonce, string challenge)
    {
        var code = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        _codes[code] = (email, nonce, challenge);
        return code;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri!.AbsolutePath;
        if (path == "/.well-known/openid-configuration")
        {
            return Json(new Dictionary<string, object>
            {
                ["issuer"] = Issuer,
                ["authorization_endpoint"] = Issuer + "/authorize",
                ["token_endpoint"] = Issuer + "/token",
                ["jwks_uri"] = Issuer + "/jwks",
                ["id_token_signing_alg_values_supported"] = new[] { "RS256" },
            });
        }
        if (path == "/jwks")
        {
            var key = JsonWebKeyConverter.ConvertFromRSASecurityKey(new RsaSecurityKey(_rsa.ExportParameters(false)) { KeyId = "k1" });
            return Json(new { keys = new[] { new { kty = key.Kty, kid = "k1", use = "sig", alg = "RS256", n = key.N, e = key.E } } });
        }
        if (path == "/token")
        {
            var form = QueryHelpers.ParseQuery(await request.Content!.ReadAsStringAsync(cancellationToken));
            if (!_codes.TryRemove(form["code"]!, out var issued) || form["client_secret"] != "s3cret")
                return new HttpResponseMessage(HttpStatusCode.BadRequest);
            var verifier = Base64UrlEncoder.Encode(SHA256.HashData(System.Text.Encoding.ASCII.GetBytes(form["code_verifier"]!)));
            if (verifier != issued.Challenge) return new HttpResponseMessage(HttpStatusCode.BadRequest);
            var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
            {
                Issuer = Issuer,
                Audience = "delios",
                Expires = DateTime.UtcNow.AddMinutes(5),
                Claims = new Dictionary<string, object> { ["email"] = issued.Email, ["email_verified"] = true, ["nonce"] = issued.Nonce, ["sub"] = issued.Email },
                SigningCredentials = new SigningCredentials(new RsaSecurityKey(_rsa) { KeyId = "k1" }, SecurityAlgorithms.RsaSha256),
            });
            return Json(new { id_token = token, token_type = "Bearer" });
        }
        return new HttpResponseMessage(HttpStatusCode.NotFound);
    }

    private static HttpResponseMessage Json(object body) => new(HttpStatusCode.OK) { Content = JsonContent.Create(body) };
}
