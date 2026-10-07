using System.Net.Http.Json;
using Delios.Host.Platform;
using Delios.Host.Seeding;
using Microsoft.Extensions.DependencyInjection;

namespace Delios.Tests;

/// <summary>A migrated database with the demo tenant, and the API in memory.</summary>
public sealed class TestApp : IAsyncDisposable
{
    public required DeliosFactory Factory { get; init; }
    public required Dictionary<string, string?> Settings { get; init; }
    private DeliosFactory? _worker;

    public static async Task<TestApp> StartAsync(Infrastructure infrastructure, Action<Dictionary<string, string?>>? configure = null)
    {
        var settings = await infrastructure.SettingsAsync();
        configure?.Invoke(settings);
        var factory = new DeliosFactory(settings, FakeScanner.Use);
        await DatabaseMigrator.ApplyAsync(factory.Services);
        await using var scope = factory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<DemoSeed>().RunAsync();
        return new TestApp { Factory = factory, Settings = settings };
    }

    /// <summary>Starts a worker on the same database, queue and storage.</summary>
    public void StartWorker()
    {
        var settings = new Dictionary<string, string?>(Settings) { ["Delios:Role"] = "worker" };
        _worker = new DeliosFactory(settings, FakeScanner.Use);
        _ = _worker.Services;
    }

    public async Task<HttpClient> SignedInAsync(string email, string password = DemoSeed.Password, string tenant = DemoSeed.Slug)
    {
        var client = Factory.CreateClient();
        using var response = await client.PostAsJsonAsync("/api/auth/sign-in", new { tenant, email, password });
        response.EnsureSuccessStatusCode();
        return client;
    }

    public T Scoped<T>(IServiceScope scope) where T : notnull => scope.ServiceProvider.GetRequiredService<T>();

    public async ValueTask DisposeAsync()
    {
        if (_worker is not null) await _worker.DisposeAsync();
        await Factory.DisposeAsync();
    }
}
