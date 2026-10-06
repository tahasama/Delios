using System.Net;
using Delios.Host.Platform;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using System.Text.Json;
using Testcontainers.PostgreSql;
using Testcontainers.RabbitMq;
using Testcontainers.Redis;

namespace Delios.Tests;

public sealed class LivenessTests
{
    [Fact]
    public async Task Live_answers_without_any_dependency()
    {
        await using var factory = new DeliosFactory(DeliosFactory.Unreachable());
        using var response = await factory.CreateClient().GetAsync(new Uri("/health/live", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Ready_fails_when_dependencies_are_unreachable()
    {
        await using var factory = new DeliosFactory(DeliosFactory.Unreachable());
        using var response = await factory.CreateClient().GetAsync(new Uri("/health/ready", UriKind.Relative));

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task A_missing_setting_stops_the_start()
    {
        var settings = DeliosFactory.Unreachable();
        settings["ConnectionStrings:Postgres"] = "";

        var error = await Assert.ThrowsAsync<OptionsValidationException>(() => StartAsync(settings));
        Assert.Contains("Postgres", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_unknown_role_stops_the_start()
    {
        var settings = DeliosFactory.Unreachable();
        settings["Delios:Role"] = "both";

        var error = await Assert.ThrowsAsync<OptionsValidationException>(() => StartAsync(settings));
        Assert.Contains("Role", error.Message, StringComparison.Ordinal);
    }

    private static async Task StartAsync(Dictionary<string, string?> settings)
    {
        var builder = WebApplication.CreateBuilder();
        builder.Configuration.AddInMemoryCollection(settings);
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.AddPlatform();
        await using var app = builder.Build();
        await app.StartAsync();
        await app.StopAsync();
    }
}

/// <summary>Real Postgres, Redis and RabbitMQ in containers: needs Docker.</summary>
public sealed class Infrastructure : IAsyncLifetime
{
    public PostgreSqlContainer Postgres { get; } = new PostgreSqlBuilder("postgres:17-alpine").Build();
    public RedisContainer Redis { get; } = new RedisBuilder("valkey/valkey:8-alpine").Build();
    public RabbitMqContainer RabbitMq { get; } = new RabbitMqBuilder("rabbitmq:4-management-alpine").Build();

    public Dictionary<string, string?> Settings()
    {
        var settings = DeliosFactory.Unreachable();
        settings["ConnectionStrings:Postgres"] = Postgres.GetConnectionString();
        settings["ConnectionStrings:Redis"] = Redis.GetConnectionString();
        settings["ConnectionStrings:RabbitMq"] = RabbitMq.GetConnectionString();
        return settings;
    }

    public Task InitializeAsync() =>
        Task.WhenAll(Postgres.StartAsync(), Redis.StartAsync(), RabbitMq.StartAsync());

    public async Task DisposeAsync()
    {
        await Postgres.DisposeAsync();
        await Redis.DisposeAsync();
        await RabbitMq.DisposeAsync();
    }
}

public sealed class ReadinessTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task Api_is_ready_when_postgres_redis_and_rabbitmq_answer()
    {
        await using var factory = new DeliosFactory(infrastructure.Settings());
        using var response = await factory.CreateClient().GetAsync(new Uri("/health/ready", UriKind.Relative));
        var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var checks = body.GetProperty("checks").EnumerateObject().Select(c => c.Name).Order();
        Assert.Equal(["postgres", "rabbitmq", "redis"], checks);
    }

    [Fact]
    public async Task Api_is_not_ready_when_rabbitmq_is_missing()
    {
        var settings = infrastructure.Settings();
        settings["ConnectionStrings:RabbitMq"] = "amqp://x:x@127.0.0.1:1/";
        await using var factory = new DeliosFactory(settings);
        using var response = await factory.CreateClient().GetAsync(new Uri("/health/ready", UriKind.Relative));

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }
}
