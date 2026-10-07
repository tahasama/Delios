using System.Net;
using System.Threading.RateLimiting;
using Amazon.Runtime;
using Amazon.S3;
using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Caching.StackExchangeRedis;
using Microsoft.Extensions.Options;
using NodaTime;
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
        services.AddOptions<SessionCookieOptions>().BindConfiguration(SessionCookieOptions.Section);

        // Serilog writes the logs; other providers (Sentry) still receive them, the default console does not.
        builder.Logging.ClearProviders();
        services.AddSerilog((sp, log) => log
            .ReadFrom.Configuration(config)
            .ReadFrom.Services(sp)
            .Enrich.FromLogContext()
            .Enrich.WithProperty("role", role)
            .WriteTo.Console(new RenderedCompactJsonFormatter()),
            preserveStaticLogger: true,
            writeToProviders: true);

        if (!string.IsNullOrWhiteSpace(config["Sentry:Dsn"]))
        {
            builder.WebHost.UseSentry(o =>
            {
                o.Dsn = config["Sentry:Dsn"];
                o.SendDefaultPii = false;
            });
        }

        services.AddSingleton<IClock>(NodaTime.SystemClock.Instance);
        services.AddScoped<TenantContext>();
        services.AddScoped<TenantTransactionInterceptor>();
        services.AddScoped<ReadDatabase>();
        services.AddDbContext<DeliosDbContext>((sp, o) => o
            .UseNpgsql(sp.GetRequiredService<IOptions<ConnectionStringsOptions>>().Value.Postgres,
                npgsql => npgsql.UseNodaTime())
            .UseSnakeCaseNamingConvention()
            .AddInterceptors(sp.GetRequiredService<TenantTransactionInterceptor>()));

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

        // Cache: in memory on each node, Redis shared between nodes. Never the source of truth.
        services.AddStackExchangeRedisCache(_ => { });
        services.AddOptions<RedisCacheOptions>().Configure<IServiceProvider>((o, sp) =>
            o.ConnectionMultiplexerFactory = () => Task.FromResult(sp.GetRequiredService<IConnectionMultiplexer>()));
        services.AddHybridCache();

        services.AddScoped<AuditLog>();
        services.AddScoped<SessionStore>();
        services.AddScoped<ProjectAccessLoader>();
        services.AddScoped<Documents.Numbering>();
        services.AddScoped<Documents.DocumentService>();
        services.AddScoped<Documents.FileStorage>();
        services.AddScoped<Documents.FileProcessor>();
        services.AddScoped<Reviews.ReviewService>();
        services.AddScoped<Reviews.Stamping>();
        services.AddSingleton<Documents.IVirusScanner, Documents.ClamAvScanner>();
        services.AddSingleton<Messaging.RabbitMqConnection>();
        if (role == Roles.Api)
        {
            services.AddHostedService<Messaging.OutboxRelay>();
        }
        else
        {
            services.AddHostedService<Messaging.FileQueueConsumer>();
        }
        services.AddScoped<Seeding.TenantSetup>();
        services.AddScoped<Seeding.DemoSeed>();
        services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
        services.AddAuthentication(SessionAuthenticationHandler.SchemeName)
            .AddScheme<AuthenticationSchemeOptions, SessionAuthenticationHandler>(SessionAuthenticationHandler.SchemeName, null);
        // Every endpoint requires a signed-in person unless it says otherwise.
        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.AddPolicy("sign-in", http => RateLimitPartition.GetFixedWindowLimiter(
                http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
        });
        // The proxy in front (Caddy, the load balancer) sits on a private network.
        services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            foreach (var network in new[] { "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16" })
            {
                o.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
            }
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
            .AddCheck<DatabaseRoleHealthCheck>("postgres-role", tags: [Roles.Api, Roles.Worker])
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
        services.AddValidation();
        services.AddOpenApi();
    }

    public static void UsePlatform(this WebApplication app)
    {
        var role = app.Services.GetRequiredService<IOptions<DeliosOptions>>().Value.Role;

        app.UseForwardedHeaders();
        // Which node answered: tells load-balancing problems apart from application ones.
        var node = Environment.MachineName;
        app.Use((http, next) =>
        {
            http.Response.Headers["X-Delios-Node"] = node;
            return next(http);
        });
        app.UseSerilogRequestLogging(o => o.GetLevel = (http, _, ex) =>
            ex is not null || http.Response.StatusCode >= 500 ? LogEventLevel.Error
            : http.Request.Path.StartsWithSegments("/health") ? LogEventLevel.Verbose
            : LogEventLevel.Information);
        // Unreadable input (bad JSON, a wrong type) is the caller's error, not the server's.
        app.UseExceptionHandler(new ExceptionHandlerOptions
        {
            StatusCodeSelector = ex => ex is BadHttpRequestException bad ? bad.StatusCode : StatusCodes.Status500InternalServerError,
        });
        app.UseStatusCodePages();
        app.UseHttpMetrics();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseRateLimiter();

        app.MapHealthChecks("/health/live", new HealthCheckOptions
        {
            Predicate = _ => false,
            ResponseWriter = HealthResponse.WriteAsync,
        }).AllowAnonymous();
        app.MapHealthChecks("/health/ready", new HealthCheckOptions
        {
            Predicate = check => check.Tags.Contains(role),
            ResponseWriter = HealthResponse.WriteAsync,
        }).AllowAnonymous();

        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi("/api/openapi/{documentName}.json").AllowAnonymous();
        }

        if (role == Roles.Api)
        {
            app.MapIdentityEndpoints();
            Documents.DocumentEndpoints.MapDocumentEndpoints(app);
            Reviews.ReviewEndpoints.MapReviewEndpoints(app);
        }
    }

    private static void AddValidated<T>(IServiceCollection services, string section) where T : class =>
        services.AddOptions<T>().BindConfiguration(section).ValidateDataAnnotations().ValidateOnStart();
}
