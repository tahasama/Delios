using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Delios.Tests;

/// <summary>
/// Starts the real host in memory. Settings point at nothing unless a test
/// overrides them, so a test that needs a dependency must start one.
/// </summary>
public sealed class DeliosFactory(IDictionary<string, string?> overrides, Action<IServiceCollection>? services = null)
    : WebApplicationFactory<Program>
{
    public static Dictionary<string, string?> Unreachable() => new()
    {
        ["Delios:Role"] = "api",
        ["Metrics:Port"] = "0",
        // Tests ask for their runs; the daily schedule would race them.
        ["Reviews:Warnings"] = "false",
        ["Auth:SecureCookie"] = "false",
        ["ConnectionStrings:Postgres"] = "Host=127.0.0.1;Port=1;Database=x;Username=x;Password=x;Timeout=2",
        ["ConnectionStrings:Redis"] = "127.0.0.1:1,connectTimeout=500",
        ["ConnectionStrings:RabbitMq"] = "amqp://x:x@127.0.0.1:1/",
        ["Storage:Endpoint"] = "http://127.0.0.1:1",
        ["Storage:Bucket"] = "delios",
        ["Storage:AccessKey"] = "x",
        ["Storage:SecretKey"] = "x",
        // Any 32 bytes: tests seal and open their files with it.
        ["Storage:EncryptionKey"] = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
        ["ClamAv:Host"] = "127.0.0.1",
        ["ClamAv:Port"] = "1",
        // Tests never reach the breached-password list on the internet.
        ["Passwords:CheckBreached"] = "false",
        // A test runs many calls as one person within a minute: the per-person limits stay out of its way
        // (the sign-in limit, which tests check, is not one of these).
        ["RateLimits:PerMinute"] = "1000000",
        ["RateLimits:HeavyPerMinute"] = "1000000",
        // The app's own logs stay quiet in tests, but for real faults: thousands of lines a run buried which tests
        // failed and why. A database error is said once, by whoever met it, never again by the database layer.
        ["Serilog:MinimumLevel:Default"] = "Error",
        ["Serilog:MinimumLevel:Override:Microsoft.AspNetCore"] = "Error",
        ["Serilog:MinimumLevel:Override:Microsoft.EntityFrameworkCore"] = "Fatal",
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        foreach (var (key, value) in overrides)
        {
            builder.UseSetting(key, value);
        }
        if (services is not null) builder.ConfigureTestServices(services);
    }
}
