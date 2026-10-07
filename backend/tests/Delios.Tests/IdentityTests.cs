using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Seeding;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Delios.Tests;

public sealed class IdentityTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task Signing_in_gives_a_session_that_reads_who_I_am()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var client = await app.SignedInAsync("engineer@demo.local");

        var me = await client.GetFromJsonAsync<JsonElement>("/api/me");

        Assert.Equal("Eli Engineer", me.GetProperty("user").GetProperty("name").GetString());
        Assert.Equal("demo", me.GetProperty("tenant").GetProperty("slug").GetString());
        var project = me.GetProperty("projects")[0];
        Assert.Equal("P1001", project.GetProperty("code").GetString());
        Assert.Equal("ENG", project.GetProperty("function").GetProperty("code").GetString());
        var verbs = project.GetProperty("verbs").EnumerateArray().Select(v => v.GetString()).Order();
        Assert.Equal(["CREATE", "READ", "REVIEW", "REVISE"], verbs);
    }

    [Fact]
    public async Task Without_a_session_the_api_answers_401()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        using var response = await app.Factory.CreateClient().GetAsync(new Uri("/api/me", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("demo", "engineer@demo.local", "wrong-password")]
    [InlineData("demo", "nobody@demo.local", "demo1234")]
    [InlineData("other", "engineer@demo.local", "demo1234")]
    public async Task A_wrong_tenant_email_or_password_gets_the_same_answer(string tenant, string email, string password)
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        using var response = await app.Factory.CreateClient()
            .PostAsJsonAsync("/api/auth/sign-in", new { tenant, email, password });
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("SIGN_IN_FAILED", problem.GetProperty("code").GetString());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("not json")]
    public async Task Unreadable_input_is_a_bad_request_not_a_server_error(string body)
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        using var content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
        using var response = await app.Factory.CreateClient().PostAsync(new Uri("/api/auth/sign-in", UriKind.Relative), content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Five_failures_lock_the_account_even_against_the_right_password()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var client = app.Factory.CreateClient();
        for (var i = 0; i < IdentityEndpoints.MaxFailedSignIns; i++)
        {
            using var _ = await client.PostAsJsonAsync("/api/auth/sign-in",
                new { tenant = "demo", email = "viewer@demo.local", password = "wrong" });
        }

        using var response = await client.PostAsJsonAsync("/api/auth/sign-in",
            new { tenant = "demo", email = "viewer@demo.local", password = DemoSeed.Password });
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Locked, response.StatusCode);
        Assert.Equal("ACCOUNT_LOCKED", problem.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Signing_out_ends_the_session()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var client = await app.SignedInAsync("engineer@demo.local");

        using var signOut = await client.PostAsync(new Uri("/api/auth/sign-out", UriKind.Relative), null);
        using var me = await client.GetAsync(new Uri("/api/me", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NoContent, signOut.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
    }

    [Fact]
    public async Task A_revoked_party_ends_its_peoples_sign_in()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        await using (var scope = app.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            scope.ServiceProvider.GetRequiredService<TenantContext>()
                .Set(await db.Tenants.Where(t => t.Slug == "demo").Select(t => t.Id).SingleAsync());
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.Parties.Where(p => p.Code == "ACME").ExecuteUpdateAsync(p => p.SetProperty(x => x.Active, false));
            await tx.CommitAsync();
        }

        using var response = await app.Factory.CreateClient().PostAsJsonAsync("/api/auth/sign-in",
            new { tenant = "demo", email = "supplier@acme.local", password = DemoSeed.Password });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}

public sealed class TenantIsolationTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task One_tenant_never_sees_or_writes_another_tenants_rows()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        Guid demo, other;
        await using (var scope = app.Factory.Services.CreateAsyncScope())
        {
            var setup = scope.ServiceProvider.GetRequiredService<TenantSetup>();
            other = (await setup.CreateAsync("other", "Other Ltd", "boss@other.local", "Olga Other", "a-long-password")).Id;
            demo = await scope.ServiceProvider.GetRequiredService<DeliosDbContext>()
                .Tenants.Where(t => t.Slug == "demo").Select(t => t.Id).SingleAsync();
        }

        await using (var scope = app.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            scope.ServiceProvider.GetRequiredService<TenantContext>().Set(other);
            await using var tx = await db.Database.BeginTransactionAsync();

            var emails = await db.Users.Select(u => u.Email).ToListAsync();
            Assert.Equal(["boss@other.local"], emails);

            // Writing a row for another tenant is refused by the database itself.
            db.Parties.Add(new Party { TenantId = demo, Code = "SNEAK", Name = "Sneak" });
            var error = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            Assert.Contains("row-level security", error.InnerException?.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Work_outside_a_tenant_transaction_sees_no_tenant_rows()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        await using var scope = app.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();

        Assert.Equal(0, await db.Users.CountAsync());
        Assert.Equal(1, await db.Tenants.CountAsync());
    }
}

public sealed class AuditTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task The_audit_trail_is_chained_and_cannot_be_changed()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        await app.SignedInAsync("engineer@demo.local");
        await app.SignedInAsync("approver@demo.local");

        await using var scope = app.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
        scope.ServiceProvider.GetRequiredService<TenantContext>()
            .Set(await db.Tenants.Where(t => t.Slug == "demo").Select(t => t.Id).SingleAsync());
        await using var tx = await db.Database.BeginTransactionAsync();

        var actions = await db.AuditEvents.OrderBy(e => e.Id).Select(e => e.Action).ToListAsync();
        Assert.Equal(["TENANT_CREATED", "SIGN_IN", "SIGN_IN"], actions);
        Assert.Null(await scope.ServiceProvider.GetRequiredService<AuditLog>().FirstBrokenLinkAsync());

        var error = await Assert.ThrowsAsync<PostgresException>(() =>
            db.AuditEvents.ExecuteUpdateAsync(e => e.SetProperty(x => x.Detail, "rewritten")));
        Assert.Contains("append-only", error.MessageText, StringComparison.Ordinal);
    }
}
