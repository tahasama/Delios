using System.Net;
using Delios.Host.Platform;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using System.Text.Json;

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

public sealed class ReadinessTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task Api_is_ready_when_postgres_redis_and_rabbitmq_answer()
    {
        await using var factory = new DeliosFactory(await infrastructure.SettingsAsync());
        using var response = await factory.CreateClient().GetAsync(new Uri("/health/ready", UriKind.Relative));
        var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var checks = body.GetProperty("checks").EnumerateObject().Select(c => c.Name).Order();
        Assert.Equal(["postgres", "postgres-role", "rabbitmq", "redis"], checks);
    }

    [Fact]
    public async Task Api_is_not_ready_when_rabbitmq_is_missing()
    {
        var settings = await infrastructure.SettingsAsync();
        settings["ConnectionStrings:RabbitMq"] = "amqp://x:x@127.0.0.1:1/";
        await using var factory = new DeliosFactory(settings);
        using var response = await factory.CreateClient().GetAsync(new Uri("/health/ready", UriKind.Relative));

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task Api_is_not_ready_when_connected_as_a_superuser()
    {
        var settings = await infrastructure.SettingsAsync();
        settings["ConnectionStrings:Postgres"] = infrastructure.Postgres.GetConnectionString();
        await using var factory = new DeliosFactory(settings);
        using var response = await factory.CreateClient().GetAsync(new Uri("/health/ready", UriKind.Relative));
        var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("Unhealthy", body.GetProperty("checks").GetProperty("postgres-role").GetString());
    }
}
