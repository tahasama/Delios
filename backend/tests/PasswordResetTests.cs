using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.DependencyInjection;

namespace Delios.Tests;

/// <summary>"Forgot password": a link by email, good once, that says nothing about who has an account.</summary>
public sealed class PasswordResetTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task A_reset_link_sets_a_new_password_once_and_signs_the_old_sessions_out()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var admin = await app.SignedInAsync("admin@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var anonymous = app.Factory.CreateClient();

        // An address with no account gets the same answer, and no email is written.
        using (var unknown = await anonymous.PostAsJsonAsync("/api/auth/password/forgot", new { email = "nobody@demo.local" }))
            Assert.Equal(HttpStatusCode.NoContent, unknown.StatusCode);
        using (var asked = await anonymous.PostAsJsonAsync("/api/auth/password/forgot", new { email = "Engineer@Demo.Local" }))
            Assert.Equal(HttpStatusCode.NoContent, asked.StatusCode);

        var outbox = await admin.GetFromJsonAsync<JsonElement>("/api/admin/emails?kind=ACCOUNT");
        var emails = outbox.GetProperty("rows").EnumerateArray().ToList();
        var email = Assert.Single(emails);
        Assert.Equal("engineer@demo.local", email.GetProperty("toAddress").GetString());
        var token = Uri.UnescapeDataString(Regex.Match(email.GetProperty("body").GetString()!, @"token=(\S+)").Groups[1].Value);

        // Too short is refused before the link is spent.
        var (shortStatus, shortBody) = await Flow.PostAsync(anonymous, "/api/auth/password/reset", new { token, password = "short" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "PASSWORD_TOO_SHORT"), (shortStatus, Flow.Code(shortBody)));

        var (reset, _) = await Flow.PostAsync(anonymous, "/api/auth/password/reset", new { token, password = "a-new-password" });
        Assert.Equal(HttpStatusCode.NoContent, reset);

        // The sessions it had are over; the old password no longer works, the new one does.
        Assert.Equal(HttpStatusCode.Unauthorized, (await engineer.GetAsync("/api/me")).StatusCode);
        using (var old = await anonymous.PostAsJsonAsync("/api/auth/sign-in", new { email = "engineer@demo.local", password = "demo1234" }))
            Assert.Equal(HttpStatusCode.Unauthorized, old.StatusCode);
        var fresh = app.Factory.CreateClient();
        using (var signedIn = await fresh.PostAsJsonAsync("/api/auth/sign-in", new { email = "engineer@demo.local", password = "a-new-password" }))
            Assert.Equal(HttpStatusCode.NoContent, signedIn.StatusCode);

        // The same link does not work twice, and a made-up one never does.
        var (again, againBody) = await Flow.PostAsync(anonymous, "/api/auth/password/reset", new { token, password = "another-password" });
        Assert.Equal((HttpStatusCode.BadRequest, "RESET_LINK_INVALID"), (again, Flow.Code(againBody)));
        var (forged, forgedBody) = await Flow.PostAsync(anonymous, "/api/auth/password/reset", new { token = "nonsense", password = "another-password" });
        Assert.Equal((HttpStatusCode.BadRequest, "RESET_LINK_INVALID"), (forged, Flow.Code(forgedBody)));
    }

    [Fact]
    public async Task A_refused_request_is_recorded_once_an_hour_per_person_and_address()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var admin = await app.SignedInAsync("admin@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        for (var i = 0; i < 3; i++)
        {
            using var refused = await engineer.PutAsJsonAsync("/api/admin/security", new { mfaRequired = true });
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        }

        var audit = await admin.GetFromJsonAsync<JsonElement>("/api/admin/audit?action=ACCESS_REFUSED");
        var row = Assert.Single(audit.GetProperty("rows").EnumerateArray());
        Assert.Contains("PUT /api/admin/security: ADMIN_ONLY", row.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task With_email_on_a_new_organization_confirms_its_email_before_signing_in()
    {
        var transport = new RecordingTransport();
        await using var app = await TestApp.StartAsync(infrastructure,
            settings =>
            {
                settings["SignUp:Enabled"] = "true";
                settings["Email:Enabled"] = "true";
            },
            services => services.AddSingleton<Delios.Host.Notifications.IMailTransport>(transport));
        app.StartWorker();
        var anonymous = app.Factory.CreateClient();
        var (made, madeBody) = await Flow.PostAsync(anonymous, "/api/auth/sign-up", new
        {
            organizationName = "Lakeside Power",
            name = "Lena Lake",
            email = "lena@lakeside.test",
            password = "a-long-password",
        });
        Assert.True(made == HttpStatusCode.Accepted, madeBody.ToString());

        // The password is right, but the address is not proved yet.
        var (waiting, waitingBody) = await Flow.PostAsync(anonymous, "/api/auth/sign-in", new { email = "lena@lakeside.test", password = "a-long-password" });
        Assert.Equal((HttpStatusCode.Forbidden, "EMAIL_NOT_CONFIRMED"), (waiting, Flow.Code(waitingBody)));

        System.Net.Mail.MailMessage? sent = null;
        for (var i = 0; i < 100 && sent is null; i++)
        {
            sent = transport.Sent.FirstOrDefault(m => m.To.Any(t => t.Address == "lena@lakeside.test"));
            if (sent is null) await Task.Delay(200);
        }
        Assert.NotNull(sent);
        var token = Uri.UnescapeDataString(Regex.Match(sent!.Body, @"token=(\S+)").Groups[1].Value);
        var (confirmed, _) = await Flow.PostAsync(anonymous, "/api/auth/confirm-email", new { token });
        Assert.Equal(HttpStatusCode.NoContent, confirmed);
        var (forged, forgedBody) = await Flow.PostAsync(anonymous, "/api/auth/confirm-email", new { token = "nonsense" });
        Assert.Equal((HttpStatusCode.BadRequest, "CONFIRM_LINK_INVALID"), (forged, Flow.Code(forgedBody)));

        using var signedIn = await app.Factory.CreateClient().PostAsJsonAsync("/api/auth/sign-in", new { email = "lena@lakeside.test", password = "a-long-password" });
        Assert.Equal(HttpStatusCode.NoContent, signedIn.StatusCode);
    }

    [Fact]
    public async Task A_sign_in_from_a_new_browser_is_emailed_to_the_person_but_not_the_first_one()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var admin = await app.SignedInAsync("admin@demo.local");
        async Task SignInFrom(string device)
        {
            var client = app.Factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Delios-Device", device);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36");
            using var response = await client.PostAsJsonAsync("/api/auth/sign-in", new { email = "viewer@demo.local", password = "demo1234" });
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        }
        async Task<List<string>> AlertsAsync() =>
            (await admin.GetFromJsonAsync<JsonElement>("/api/admin/emails?kind=ACCOUNT")).GetProperty("rows").EnumerateArray()
                .Where(e => e.GetProperty("subject").GetString() == "New sign-in to your DELIOS account").Select(e => e.GetProperty("body").GetString()!).ToList();

        await SignInFrom("laptop");
        Assert.Empty(await AlertsAsync());
        await SignInFrom("laptop");
        Assert.Empty(await AlertsAsync());
        await SignInFrom("somewhere-else");
        var alert = Assert.Single(await AlertsAsync());
        Assert.Contains("Chrome on Windows", alert);
        Assert.Contains("/forgot-password", alert);
    }
}
