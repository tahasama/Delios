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
        ["Auth:SecureCookie"] = "false",
        ["ConnectionStrings:Postgres"] = "Host=127.0.0.1;Port=1;Database=x;Username=x;Password=x;Timeout=2",
        ["ConnectionStrings:Redis"] = "127.0.0.1:1,connectTimeout=500",
        ["ConnectionStrings:RabbitMq"] = "amqp://x:x@127.0.0.1:1/",
        ["Storage:Endpoint"] = "http://127.0.0.1:1",
        ["Storage:Bucket"] = "delios",
        ["Storage:AccessKey"] = "x",
        ["Storage:SecretKey"] = "x",
        ["ClamAv:Host"] = "127.0.0.1",
        ["ClamAv:Port"] = "1",
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
