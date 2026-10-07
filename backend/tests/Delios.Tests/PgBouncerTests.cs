using System.Net.Http.Json;
using Delios.Host.Platform;
using Delios.Host.Seeding;
using Delios.Host.Tenancy;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using DotNet.Testcontainers.Networks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Delios.Tests;

/// <summary>
/// The app behind PgBouncer in transaction mode, as it runs once the pool is
/// switched on: consecutive transactions of one request may land on different
/// server connections, and one server connection serves many tenants.
/// </summary>
public sealed class PgBouncerTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>, IAsyncLifetime
{
    private readonly INetwork _network = new NetworkBuilder().Build();
    private PostgreSqlContainer _postgres = null!;
    private IContainer _pgbouncer = null!;

    public async Task InitializeAsync()
    {
        await _network.CreateAsync();
        _postgres = new PostgreSqlBuilder("postgres:17-alpine").WithNetwork(_network).WithNetworkAliases("pg").Build();
        await _postgres.StartAsync();
        var result = await _postgres.ExecScriptAsync("""
            CREATE ROLE delios_app LOGIN PASSWORD 'app';
            CREATE DATABASE delios OWNER delios_app;
            """);
        if (result.ExitCode != 0) throw new InvalidOperationException(result.Stderr);

        _pgbouncer = new ContainerBuilder("edoburu/pgbouncer:latest")
            .WithNetwork(_network)
            .WithEnvironment("DATABASE_URL", "postgres://delios_app:app@pg:5432/delios")
            .WithEnvironment("AUTH_TYPE", "scram-sha-256")
            .WithEnvironment("POOL_MODE", "transaction")
            .WithEnvironment("DEFAULT_POOL_SIZE", "3")
            .WithEnvironment("MAX_PREPARED_STATEMENTS", "200")
            .WithPortBinding(5432, true)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilInternalTcpPortIsAvailable(5432))
            .Build();
        await _pgbouncer.StartAsync();
    }

    public async Task DisposeAsync()
    {
        await _pgbouncer.DisposeAsync();
        await _postgres.DisposeAsync();
        await _network.DisposeAsync();
    }

    private string Direct() => new NpgsqlConnectionStringBuilder(_postgres.GetConnectionString())
    {
        Database = "delios",
        Username = "delios_app",
        Password = "app",
    }.ToString();

    private string Pooled() => new NpgsqlConnectionStringBuilder
    {
        Host = _pgbouncer.Hostname,
        Port = _pgbouncer.GetMappedPublicPort(5432),
        Database = "delios",
        Username = "delios_app",
        Password = "app",
        NoResetOnClose = true,
    }.ToString();

    private async Task<DeliosFactory> StartAsync()
    {
        var settings = await infrastructure.SettingsAsync();
        settings["ConnectionStrings:Postgres"] = Direct();
        await using (var direct = new DeliosFactory(settings))
        {
            await DatabaseMigrator.ApplyAsync(direct.Services);
            await using (var scope = direct.Services.CreateAsyncScope())
            {
                await scope.ServiceProvider.GetRequiredService<DemoSeed>().RunAsync();
            }
            await using (var scope = direct.Services.CreateAsyncScope())
            {
                await scope.ServiceProvider.GetRequiredService<TenantSetup>()
                    .CreateAsync("other", "Other Ltd", "boss@other.local", "Olga Other", "a-long-password");
            }
        }
        settings["ConnectionStrings:Postgres"] = Pooled();
        return new DeliosFactory(settings);
    }

    [Fact]
    public async Task Tenants_never_see_each_other_through_a_shared_pool()
    {
        await using var factory = await StartAsync();
        var tenants = new Dictionary<string, Guid>();
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            tenants = await db.Tenants.ToDictionaryAsync(t => t.Slug, t => t.Id);
        }

        // 200 transactions, alternating tenants, over 3 server connections.
        var seen = await Task.WhenAll(Enumerable.Range(0, 200).Select(async i =>
        {
            var slug = i % 2 == 0 ? "demo" : "other";
            await using var scope = factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenants[slug]);
            await using var tx = await db.Database.BeginTransactionAsync();
            var emails = await db.Users.Select(u => u.Email).ToListAsync();
            await tx.CommitAsync();
            return (slug, emails);
        }));

        Assert.All(seen.Where(s => s.slug == "other"), s => Assert.Equal(["boss@other.local"], s.emails));
        Assert.All(seen.Where(s => s.slug == "demo"), s => Assert.Equal(6, s.emails.Count));
    }

    [Fact]
    public async Task Registering_works_through_the_pool()
    {
        await using var factory = await StartAsync();
        var client = factory.CreateClient();
        using var signIn = await client.PostAsJsonAsync("/api/auth/sign-in",
            new { tenant = "demo", email = "engineer@demo.local", password = DemoSeed.Password });
        signIn.EnsureSuccessStatusCode();
        var project = await Api.ProjectIdAsync(client);

        var docs = await Task.WhenAll(Enumerable.Range(1, 20)
            .Select(i => Api.RegisterAsync(client, project, Api.Drawing($"Pipe rack section {i}"))));

        Assert.Equal(20, docs.Select(d => d.GetProperty("number").GetString()).Distinct().Count());
    }
}
