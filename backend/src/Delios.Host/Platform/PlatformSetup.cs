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

/// <summary>
/// The application's wiring, in one place. <c>AddPlatform</c> registers every service before the app is built; <c>UsePlatform</c> sets up the
/// request pipeline and maps the endpoints after it is built. Both are called from Program.cs. Start here to find where something is created or which URL goes where.
/// </summary>
public static class PlatformSetup
{
    /// <summary>
    /// Registers the app's services. This is dependency injection (DI): instead of a class creating what it needs with <c>new</c>, it lists what it needs
    /// in its constructor and ASP.NET Core supplies it. For that, each class is registered here with a lifetime: <c>AddSingleton</c> (one shared instance
    /// for the whole process), <c>AddScoped</c> (one instance per HTTP request or per <c>CreateScope</c>) or <c>AddTransient</c> (a new one every time).
    /// In order, it registers: settings (options) bound from configuration and validated at start-up; Serilog logging and, if configured, Sentry error
    /// reporting; the clock, the tenant context and the database (<c>DeliosDbContext</c> on PostgreSQL with NodaTime dates, snake_case names and the
    /// interceptor that applies the tenant's row-level security); Data Protection keys stored in the database; Redis and the two-level cache;
    /// the identity, document, review, transmittal, search, extraction, check, schedule and report services; file storage (Azure or S3, chosen from
    /// configuration); background services (hosted services: the outbox relay on the API, the queue consumers, search indexer and check scheduler on the worker);
    /// session authentication with a rule that every endpoint needs a signed-in user unless marked <c>AllowAnonymous</c>; rate limits for sign-in and
    /// single sign-on; trust of proxy headers from private networks; the S3 client; health checks tagged by role; the Prometheus metrics server
    /// (Prometheus is the monitoring system that collects the numbers in <c>AppMetrics</c>); and problem details (the standard JSON error format),
    /// request validation and OpenAPI (a machine-readable description of the API). Called once at start-up from Program.cs, for every process role and for one-off commands.
    /// </summary>
    public static void AddPlatform(this WebApplicationBuilder builder)
    {
        var services = builder.Services;
        var config = builder.Configuration;
        var role = config[$"{DeliosOptions.Section}:Role"] ?? Roles.Api;

        // A missing or malformed setting stops the process at start, not at first use.
        AddValidated<DeliosOptions>(services, DeliosOptions.Section);
        AddValidated<ConnectionStringsOptions>(services, ConnectionStringsOptions.Section);
        services.PostConfigure<ConnectionStringsOptions>(o =>
        {
            o.Postgres = ConnectionStringsOptions.WithoutKerberos(o.Postgres);
            o.PostgresReadOnly = ConnectionStringsOptions.WithoutKerberos(o.PostgresReadOnly);
        });
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
        services.AddScoped<Mfa>();
        services.AddOptions<SsoOptions>().BindConfiguration("Sso");
        services.AddHttpClient(OidcClient.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(15));
        services.AddSingleton<OidcClient>();
        services.AddScoped<ProjectAccessLoader>();
        services.AddScoped<Documents.Numbering>();
        services.AddScoped<Documents.DocumentService>();
        services.AddScoped<Documents.FileStorage>();
        if (config.GetSection(StorageOptions.Section).Get<StorageOptions>()?.UsesAzure == true)
        {
            services.AddSingleton<Documents.IObjectStore, Documents.AzureObjectStore>();
        }
        else
        {
            services.AddSingleton<Documents.IObjectStore, Documents.S3ObjectStore>();
        }
        services.AddScoped<Documents.FileProcessor>();
        services.AddScoped<Reviews.ReviewService>();
        services.AddScoped<Reviews.DelegationService>();
        services.AddScoped<Documents.KeepingService>();
        services.AddScoped<Transmittals.Supersession>();
        services.AddScoped<Documents.SnapshotRecorder>();
        services.AddScoped<Reviews.Stamping>();
        services.AddScoped<Reviews.ControlService>();
        services.AddScoped<Transmittals.TransmittalService>();
        services.AddScoped<Transmittals.IncomingService>();
        services.AddScoped<Packages.PackageService>();
        services.AddOptions<Search.SearchOptions>().BindConfiguration(Search.SearchOptions.Section);
        services.AddScoped<Search.SearchService>();
        services.AddOptions<Extraction.ExtractionOptions>().BindConfiguration(Extraction.ExtractionOptions.Section);
        services.AddScoped<Extraction.ExtractionProcessor>();
        services.AddScoped<Checks.CheckEngine>();
        services.AddScoped<Schedules.ScheduleImporter>();
        services.AddScoped<Reports.ReportBuilder>();
        services.AddOptions<Notifications.EmailOptions>().BindConfiguration(Notifications.EmailOptions.Section);
        services.AddScoped<Notifications.Notifier>();
        services.AddScoped<Notifications.EmailSender>();
        services.AddSingleton<Notifications.IMailTransport, Notifications.SmtpTransport>();
        services.AddHttpClient(Extraction.ExtractionProcessor.HttpClientName, (sp, c) =>
            c.Timeout = TimeSpan.FromSeconds(sp.GetRequiredService<IOptions<Extraction.ExtractionOptions>>().Value.TimeoutSeconds));
        services.AddHttpClient<Search.OpenSearchClient>((sp, c) =>
        {
            c.BaseAddress = new Uri(sp.GetRequiredService<IOptions<Search.SearchOptions>>().Value.Url.TrimEnd('/') + "/");
            c.Timeout = TimeSpan.FromSeconds(10);
        });
        var search = config.GetSection(Search.SearchOptions.Section).Get<Search.SearchOptions>() ?? new();
        services.AddSingleton<Documents.IVirusScanner, Documents.ClamAvScanner>();
        services.AddSingleton<Messaging.RabbitMqConnection>();
        if (role == Roles.Api)
        {
            services.AddHostedService<Messaging.OutboxRelay>();
        }
        else
        {
            foreach (var queue in Messaging.Topology.Queues)
            {
                services.AddSingleton<IHostedService>(sp =>
                    ActivatorUtilities.CreateInstance<Messaging.FileQueueConsumer>(sp, queue));
            }
            if (search.UsesOpenSearch) services.AddHostedService<Search.SearchIndexer>();
            if (config.GetValue("Checks:Schedule", true)) services.AddHostedService<Checks.CheckScheduler>();
            if (config.GetValue("Reviews:Warnings", true)) services.AddHostedService<Reviews.ReviewWarnings>();
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
            // Single sign-on is two requests per sign-in and guesses nothing: a looser bound.
            o.AddPolicy("sso", http => RateLimitPartition.GetFixedWindowLimiter(
                http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(1) }));
            // A signed-in person's own two-step codes: counted per person, so a stolen session cannot guess its way to switching them off.
            o.AddPolicy("my-codes", http => RateLimitPartition.GetFixedWindowLimiter(
                http.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
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
        if (search.UsesOpenSearch)
        {
            // Not fatal to the API, which falls back to Postgres; reported so somebody looks.
            services.AddHealthChecks().AddCheck<Search.OpenSearchHealthCheck>("opensearch",
                failureStatus: Microsoft.Extensions.Diagnostics.HealthChecks.HealthStatus.Degraded, tags: [Roles.Worker]);
        }

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

    /// <summary>
    /// Builds the request pipeline (middleware: steps every HTTP request passes through, in this order) and maps the endpoints. In order: read the client's
    /// real address and scheme from the proxy headers; add an <c>X-Delios-Node</c> response header naming the server; log each request; turn exceptions into
    /// problem answers (400 for unreadable input, 500 otherwise); add bodies to bare error status codes; record HTTP metrics; sign the user in from the
    /// session cookie (authentication), then check access (authorization); apply rate limits. Then it maps <c>/health/live</c> (the process is running) and
    /// <c>/health/ready</c> (the services this role needs are reachable), the OpenAPI document in development, and, in the API role only, every feature's
    /// endpoints. Called once from Program.cs after the app is built and when no one-off command was given.
    /// </summary>
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
            app.MapSsoEndpoints();
            app.MapAdminEndpoints();
            app.MapDirectoryEndpoints();
            Seeding.SignUpEndpoints.MapSignUpEndpoints(app);
            Notifications.NotificationEndpoints.MapNotificationEndpoints(app);
            Documents.CatalogAdminEndpoints.MapCatalogAdminEndpoints(app);
            Documents.DocumentEndpoints.MapDocumentEndpoints(app);
            Reviews.ReviewEndpoints.MapReviewEndpoints(app);
            Reviews.DelegationEndpoints.MapDelegationEndpoints(app);
            Documents.KeepingEndpoints.MapKeepingEndpoints(app);
            Documents.SnapshotEndpoints.MapSnapshotEndpoints(app);
            Documents.GovernanceEndpoints.MapGovernanceEndpoints(app);
            Records.ProjectRecordEndpoints.MapProjectRecordEndpoints(app);
            Transmittals.TransmittalEndpoints.MapTransmittalEndpoints(app);
            Packages.PackageEndpoints.MapPackageEndpoints(app);
            Search.SearchEndpoints.MapSearchEndpoints(app);
            Extraction.ExtractionEndpoints.MapExtractionEndpoints(app);
            Checks.CheckEndpoints.MapCheckEndpoints(app);
            Schedules.ScheduleEndpoints.MapScheduleEndpoints(app);
            Audit.ActivityEndpoints.MapActivityEndpoints(app);
            Settings.SettingEndpoints.MapSettingEndpoints(app);
            Identity.HolderEndpoints.MapHolderEndpoints(app);
            Reports.ReportEndpoints.MapReportEndpoints(app);
            Documents.RegisterEndpoints.MapRegisterEndpoints(app);
            Documents.DocumentContextEndpoints.MapDocumentContextEndpoints(app);
            Documents.ValueEndpoints.MapValueEndpoints(app);
            Reviews.ReviewListEndpoints.MapReviewListEndpoints(app);
            Transmittals.TransmittalLogEndpoints.MapTransmittalLogEndpoints(app);
        }
    }

    /// <summary>
    /// Binds a settings class to its configuration section, checks its validation attributes (such as <c>[Required]</c>) and runs that check at start-up,
    /// so a missing or wrong setting stops the app at once instead of failing at first use.
    /// </summary>
    private static void AddValidated<T>(IServiceCollection services, string section) where T : class =>
        services.AddOptions<T>().BindConfiguration(section).ValidateDataAnnotations().ValidateOnStart();
}
