using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Delios.Host.Identity;
using Delios.Host.Operators;
using Microsoft.Extensions.DependencyInjection;

namespace Delios.Tests;

/// <summary>The DELIOS team's console, an organization reading only, and a person forgotten.</summary>
public sealed class ConsoleTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static async Task<(HttpStatusCode Status, JsonElement Body)> PutAsync(HttpClient client, string path, object body)
    {
        using var response = await client.PutAsJsonAsync(path, body);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, text.Length == 0 ? default : JsonDocument.Parse(text).RootElement);
    }

    private static async Task<HttpClient> OperatorAsync(TestApp app)
    {
        await using (var scope = app.Factory.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<CreateOperator>().RunAsync("ops@delios.test", "Olga Ops", "a-long-operator-secret");
        var client = app.Factory.CreateClient();
        // The first sign-in sets up the authenticator: its key (drawn as a QR code), then its first code.
        var (first, setup) = await Flow.PostAsync(client, "/api/console/auth/sign-in", new { email = "ops@delios.test", password = "a-long-operator-secret" });
        Assert.True(first == HttpStatusCode.OK && setup.GetProperty("step").GetString() == "SETUP", setup.ToString());
        Assert.StartsWith("otpauth://totp/", setup.GetProperty("uri").GetString());
        var code = Totp.Code(Totp.FromBase32(setup.GetProperty("secret").GetString()!), Totp.StepAt(DateTimeOffset.UtcNow));
        var (wrong, _) = await Flow.PostAsync(client, "/api/console/auth/setup", new { challenge = setup.GetProperty("challenge").GetString(), code = code == "000000" ? "111111" : "000000" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, wrong);
        var (signed, body) = await Flow.PostAsync(client, "/api/console/auth/setup", new { challenge = setup.GetProperty("challenge").GetString(), code });
        Assert.True(signed == HttpStatusCode.OK, body.ToString());
        Assert.Equal(10, body.GetProperty("recoveryCodes").GetArrayLength());
        // From now on, the password alone does not sign in.
        var (alone, _) = await Flow.PostAsync(app.Factory.CreateClient(), "/api/console/auth/sign-in", new { email = "ops@delios.test", password = "a-long-operator-secret" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, alone);
        return client;
    }

    [Fact]
    public async Task The_team_signs_in_to_its_console_and_an_organization_not_paid_reads_only()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        // An organization's account never opens the console.
        var admin = await app.SignedInAsync("admin@demo.local");
        Assert.Equal(HttpStatusCode.Unauthorized, (await admin.GetAsync("/api/console/organizations")).StatusCode);

        var ops = await OperatorAsync(app);
        var orgs = await ops.GetFromJsonAsync<JsonElement>("/api/console/organizations");
        var demo = orgs.EnumerateArray().Single(o => o.GetProperty("slug").GetString() == "demo");
        Assert.Equal("TRIAL", demo.GetProperty("state").GetString());
        var id = demo.GetProperty("id").GetGuid();

        var (noWhy, noWhyBody) = await PutAsync(ops, $"/api/console/organizations/{id}/subscription", new { state = "READ_ONLY" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "REASON_REQUIRED"), (noWhy, Flow.Code(noWhyBody)));
        var (set, setBody) = await PutAsync(ops, $"/api/console/organizations/{id}/subscription", new { state = "READ_ONLY", why = "Not paid" });
        Assert.True(set == HttpStatusCode.NoContent, setBody.ToString());

        // Reading only: every change refused, reading goes on, every page is told.
        var (refused, refusedBody) = await Flow.PostAsync(admin, "/api/admin/product-requests", new { what = "DWG_READER" });
        Assert.True((refused, Flow.Code(refusedBody)) == (HttpStatusCode.Forbidden, "READ_ONLY"), $"{refused} {refusedBody}");
        var standing = await admin.GetFromJsonAsync<JsonElement>("/api/standing");
        Assert.True(standing.GetProperty("readsOnly").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/organization/contract")).StatusCode);

        var (paid, paidBody) = await PutAsync(ops, $"/api/console/organizations/{id}/subscription",
            new { state = "ACTIVE", paidUntil = DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-dd"), why = "Paid by transfer" });
        Assert.True(paid == HttpStatusCode.NoContent, paidBody.ToString());
        var (asked, askedBody) = await Flow.PostAsync(admin, "/api/admin/product-requests", new { what = "DWG_READER" });
        Assert.True(asked == HttpStatusCode.OK, askedBody.ToString());

        // The legal register lists every matter, and the terms start as the app's text, with parts for a lawyer.
        var legal = await ops.GetFromJsonAsync<JsonElement>("/api/console/legal");
        Assert.Equal(LegalMatters.All.Length, legal.GetProperty("matters").GetArrayLength());
        var terms = await app.Factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/legal/terms");
        Assert.Equal(0, terms.GetProperty("version").GetInt32());
        Assert.True(terms.GetProperty("placeholder").GetBoolean());

        // Support access: none, then granted by an administrator, and the console names its people.
        var before = await ops.GetFromJsonAsync<JsonElement>($"/api/console/organizations/{id}");
        Assert.Equal(JsonValueKind.Null, before.GetProperty("people").ValueKind);
        var (granted, grantedBody) = await Flow.PostAsync(admin, "/api/organization/support", new { days = 3, why = "Help with the numbering" });
        Assert.True(granted == HttpStatusCode.NoContent, grantedBody.ToString());
        var after = await ops.GetFromJsonAsync<JsonElement>($"/api/console/organizations/{id}");
        Assert.True(after.GetProperty("people").GetArrayLength() > 0);

        // Entering as its administrator: a session of "DELIOS support: …", which works there until the access ends.
        var (entered, enteredBody) = await Flow.PostAsync(ops, $"/api/console/organizations/{id}/enter", new { });
        Assert.True(entered == HttpStatusCode.OK, enteredBody.ToString());
        var support = app.Factory.CreateClient();
        support.DefaultRequestHeaders.Add("Cookie", $"delios_session={enteredBody.GetProperty("token").GetString()}");
        var supportMe = await support.GetFromJsonAsync<JsonElement>("/api/me");
        Assert.StartsWith("DELIOS support: ", supportMe.GetProperty("user").GetProperty("name").GetString());
        var grants = await admin.GetFromJsonAsync<JsonElement>("/api/organization/contract");
        var grantId = grants.GetProperty("support").EnumerateArray().First().GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.NoContent, (await Flow.PostAsync(admin, $"/api/organization/support/{grantId}/end", new { })).Status);
        Assert.Equal(HttpStatusCode.Unauthorized, (await support.GetAsync("/api/me")).StatusCode);

        // An invoice issued, paid by transfer: the period it pays for is paid.
        var (issued, issuedBody) = await Flow.PostAsync(ops, $"/api/console/organizations/{id}/invoices", new
        {
            periodFrom = "2027-01-01", periodTo = "2027-12-31", currency = "MAD", taxRate = 20,
            lines = new[] { new { description = "Team plan, per user, a year", quantity = 5, unitPrice = 1000 } },
        });
        Assert.True(issued == HttpStatusCode.OK, issuedBody.ToString());
        Assert.StartsWith("DLS-", issuedBody.GetProperty("number").GetString());
        var invoiceId = issuedBody.GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.OK, (await ops.GetAsync($"/api/console/invoices/{invoiceId}/pdf")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Flow.PostAsync(ops, $"/api/console/invoices/{invoiceId}/paid", new { paidBy = "TRANSFER", reference = "VIR-1" })).Status);
        var contract = await admin.GetFromJsonAsync<JsonElement>("/api/organization/contract");
        Assert.True(contract.GetProperty("paidUntil").ToString().StartsWith("2027-12-31"), contract.ToString());
        var billing = await admin.GetFromJsonAsync<JsonElement>("/api/organization/billing");
        Assert.Equal("PAID", billing.GetProperty("invoices").EnumerateArray().Single().GetProperty("state").GetString());
    }

    [Fact]
    public async Task An_administrator_forgets_a_person_who_asked_and_their_acts_stay()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var admin = await app.SignedInAsync("admin@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var me = await engineer.GetFromJsonAsync<JsonElement>("/api/me");
        var id = me.GetProperty("user").GetProperty("id").GetGuid();

        var (noWhy, noWhyBody) = await Flow.PostAsync(admin, $"/api/admin/users/{id}/forget", new { });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "REASON_REQUIRED"), (noWhy, Flow.Code(noWhyBody)));
        var (forgot, body) = await Flow.PostAsync(admin, $"/api/admin/users/{id}/forget", new { why = "Asked by email on 27 October" });
        Assert.True(forgot == HttpStatusCode.OK, body.ToString());
        Assert.StartsWith("Former user", body.GetProperty("name").GetString());

        using var again = await app.Factory.CreateClient().PostAsJsonAsync("/api/auth/sign-in", new { email = "engineer@demo.local", password = "demo1234" });
        Assert.False(again.IsSuccessStatusCode);
    }
}
