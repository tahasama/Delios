using Amazon.Runtime;
using Amazon.S3;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Prometheus;
using Serilog;
using Serilog.Events;
using Serilog.Formatting.Compact;
using StackExchange.Redis;

namespace Delios.Host.Platform;

public static class PlatformSetup
{
    public static void AddPlatform(this WebApplicationBuilder builder)
    {
        var services = builder.Services;
        var config = builder.Configuration;
        var role = config[$"{DeliosOptions.Section}:Role"] ?? Roles.Api;

        // A missing or malformed setting stops the process at start, not at first use.
        AddValidated<DeliosOptions>(services, DeliosOptions.Section);
        AddValidated<ConnectionStringsOptions>(services, ConnectionStringsOptions.Section);
        AddValidated<StorageOptions>(services, StorageOptions.Section);
        AddValidated<ClamAvOptions>(services, ClamAvOptions.Section);

        // Serilog writes the logs; other providers (Sentry) still receive them, the default console does not.
        builder.Logging.ClearProviders();
        services.AddSerilog((sp, log) => log
            .ReadFrom.Configuration(config)
            .ReadFrom.Services(sp)
            .Enrich.FromLogContext()
            .Enrich.WithProperty("role", role)
            .WriteTo.Console(new RenderedCompactJsonFormatter()),
            writeToProviders: true);

        if (!string.IsNullOrWhiteSpace(config["Sentry:Dsn"]))
        {
            builder.WebHost.UseSentry(o =>
            {
                o.Dsn = config["Sentry:Dsn"];
                o.SendDefaultPii = false;
            });
        }

        services.AddDbContext<DeliosDbContext>((sp, o) => o
            .UseNpgsql(sp.GetRequiredService<IOptions<ConnectionStringsOptions>>().Value.Postgres)
            .UseSnakeCaseNamingConvention());

        services.AddDataProtection()
            .SetApplicationName("delios")
            .PersistKeysToDbContext<DeliosDbContext>();

        services.AddSingleton<IConnectionMultiplexer>(sp =>
        {
            var redis = ConfigurationOptions.Parse(
                sp.GetRequiredService<IOptions<ConnectionStringsOptions>>().Value.Redis);
            redis.AbortOnConnectFail = false;
            return ConnectionMultiplexer.Connect(redis);
        });

        services.AddSingleton<IAmazonS3>(sp =>
        {
            var storage = sp.GetRequiredService<IOptions<StorageOptions>>().Value;
            return new AmazonS3Client(
                new BasicAWSCredentials(storage.AccessKey, storage.SecretKey),
                new AmazonS3Config
                {
                    ServiceURL = storage.Endpoint,
                    AuthenticationRegion = storage.Region,
                    ForcePathStyle = true,
                    // Checksums the AWS SDK adds by default are not accepted by every S3-compatible store.
                    RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
                    ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,
                });
        });

        // Readiness covers what each role cannot work without.
        services.AddSingleton<RabbitMqHealthCheck>();
        services.AddHealthChecks()
            .AddNpgSql(sp => sp.GetRequiredService<IOptions<ConnectionStringsOptions>>().Value.Postgres,
                name: "postgres", tags: [Roles.Api, Roles.Worker])
            .AddRedis(sp => sp.GetRequiredService<IConnectionMultiplexer>(),
                name: "redis", tags: [Roles.Api])
            .Add(new HealthCheckRegistration("rabbitmq",
                sp => sp.GetRequiredService<RabbitMqHealthCheck>(), null, [Roles.Api, Roles.Worker]))
            .AddCheck<ObjectStorageHealthCheck>("storage", tags: [Roles.Worker])
            .AddCheck<ClamAvHealthCheck>("clamav", tags: [Roles.Worker]);

        // Metrics are served on their own port, which is never published through the proxy.
        var metricsPort = config.GetValue("Metrics:Port", 9091);
        if (metricsPort > 0)
        {
            services.AddMetricServer(o => o.Port = (ushort)metricsPort);
        }

        services.AddProblemDetails();
        services.AddOpenApi();
    }

    public static void UsePlatform(this WebApplication app)
    {
        var role = app.Services.GetRequiredService<IOptions<DeliosOptions>>().Value.Role;

        app.UseSerilogRequestLogging(o => o.GetLevel = (http, _, ex) =>
            ex is not null || http.Response.StatusCode >= 500 ? LogEventLevel.Error
            : http.Request.Path.StartsWithSegments("/health") ? LogEventLevel.Verbose
            : LogEventLevel.Information);
        app.UseExceptionHandler();
        app.UseStatusCodePages();
        app.UseHttpMetrics();

        app.MapHealthChecks("/health/live", new HealthCheckOptions
        {
            Predicate = _ => false,
            ResponseWriter = HealthResponse.WriteAsync,
        });
        app.MapHealthChecks("/health/ready", new HealthCheckOptions
        {
            Predicate = check => check.Tags.Contains(role),
            ResponseWriter = HealthResponse.WriteAsync,
        });

        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi("/api/openapi/{documentName}.json");
        }
    }

    private static void AddValidated<T>(IServiceCollection services, string section) where T : class =>
        services.AddOptions<T>().BindConfiguration(section).ValidateDataAnnotations().ValidateOnStart();
}
