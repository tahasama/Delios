using System.Threading.RateLimiting;
using Amazon.Runtime;
using Amazon.S3;
using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
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
        // Moments and days read and written as ISO text in every answer and request (NodaJson).
        services.ConfigureHttpJsonOptions(o => NodaJson.Add(o.SerializerOptions.Converters));
        services.AddScoped<TenantContext>();
        services.AddScoped<TenantTransactionInterceptor>();
        services.AddScoped<ReadDatabase>();
        // Every save names what the screens keep that it changed (ScreenChanges): on a screen's answer, or posted to them.
        services.AddHttpContextAccessor();
        services.AddOptions<ScreensOptions>().BindConfiguration(ScreensOptions.Section);
        services.AddHttpClient(nameof(ScreensNotifier), c => c.Timeout = TimeSpan.FromSeconds(5))
            // A redirect (to the sign-in page) is a refusal, never the screens' answer.
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
        services.AddSingleton<ScreensNotifier>();
        services.AddHostedService(sp => sp.GetRequiredService<ScreensNotifier>());
        services.AddSingleton<Search.SearchSignal>();
        services.AddScoped<ScreenChanges>();
        services.AddScoped<ScreenChangeWatcher>();
        services.AddScoped<ScreenChangeCommits>();
        services.AddDbContext<DeliosDbContext>((sp, o) => o
            .UseNpgsql(sp.GetRequiredService<IOptions<ConnectionStringsOptions>>().Value.Postgres,
                npgsql => npgsql.UseNodaTime())
            .UseSnakeCaseNamingConvention()
            .AddInterceptors(sp.GetRequiredService<TenantTransactionInterceptor>(), sp.GetRequiredService<ScreenChangeWatcher>(),
                sp.GetRequiredService<ScreenChangeCommits>()));

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
        // Who you are and what you may do, kept in each process until how the organization works changes.
        services.AddSingleton<AccessVersions>();
        services.AddSingleton<Audit.AuditCounts>();

        services.AddScoped<AuditLog>();
        services.AddScoped<SessionStore>();
        services.AddScoped<Mfa>();
        services.AddOptions<SsoOptions>().BindConfiguration("Sso");
        services.AddHttpClient(OidcClient.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(15));
        services.Configure<NewPasswordOptions>(config.GetSection(NewPasswordOptions.Section));
        services.AddHttpClient(PasswordPolicy.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(3));
        services.AddScoped<PasswordPolicy>();
        services.Configure<TurnstileOptions>(config.GetSection(TurnstileOptions.Section));
        services.AddHttpClient(BotCheck.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(5));
        services.AddScoped<BotCheck>();
        services.AddSingleton<OidcClient>();
        services.AddScoped<ProjectAccessLoader>();
        services.AddScoped<Documents.Numbering>();
        services.AddScoped<Documents.DocumentService>();
        services.AddScoped<Organizations.OrganizationService>();
        services.AddScoped<Documents.FileStorage>();
        // The files' key, apart from the files (Storage:EncryptionKey, FILES_KEY in .env): read once, refused at start when missing.
        services.AddSingleton(sp => new Documents.FileCipher(sp.GetRequiredService<IOptions<StorageOptions>>().Value.EncryptionKey));
        // The copier (deploy/file-backup) is told of each file stored; the app holds no key to the copy.
        services.AddSingleton<Documents.FileBackup>();
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
        services.AddScoped<Transmittals.EmailReplies>();
        services.AddScoped<Packages.PackageService>();
        services.AddScoped<Packages.SupplyFiling>();
        services.AddOptions<Search.SearchOptions>().BindConfiguration(Search.SearchOptions.Section);
        services.AddScoped<Search.SearchService>();
        services.AddOptions<Extraction.ExtractionOptions>().BindConfiguration(Extraction.ExtractionOptions.Section);
        services.AddOptions<Documents.PreviewOptions>().BindConfiguration(Documents.PreviewOptions.Section);
        services.AddHttpClient(Documents.Previews.HttpClientName, (sp, c) =>
            c.Timeout = TimeSpan.FromSeconds(sp.GetRequiredService<IOptions<Documents.PreviewOptions>>().Value.TimeoutSeconds));
        services.AddScoped<Extraction.ExtractionProcessor>();
        services.AddScoped<Checks.CheckEngine>();
        services.AddScoped<Actions.ScheduleImporter>();
        services.AddScoped<Actions.RequirementsImporter>();
        services.AddScoped<Actions.DepartmentsImporter>();
        services.AddScoped<Reports.ReportBuilder>();
        services.AddOptions<Notifications.EmailOptions>().BindConfiguration(Notifications.EmailOptions.Section);
        services.AddScoped<Notifications.Notifier>();
        services.AddScoped<Notifications.EmailSender>();
        services.AddScoped<Notifications.PushSender>();
        services.AddSingleton<Notifications.EmailOptionsAccessor>();
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
        services.AddSingleton<Messaging.OutboxWake>();
        services.AddSingleton<Actions.NoticeAlarmBell>();
        // Every process sends what its own acts put in the outbox, woken by them.
        services.AddHostedService<Messaging.OutboxRelay>();
        if (role != Roles.Api)
        {
            foreach (var queue in Messaging.Topology.Queues)
            {
                services.AddSingleton<IHostedService>(sp =>
                    ActivatorUtilities.CreateInstance<Messaging.FileQueueConsumer>(sp, queue));
            }
            if (search.UsesOpenSearch) services.AddHostedService<Search.SearchIndexer>();
            if (config.GetValue("Schedule:Notices", true)) services.AddHostedService<Actions.ActionNotices>();
        }
        services.AddScoped<Seeding.TenantSetup>();
        services.AddScoped<Seeding.DemoSeed>();
        services.AddScoped<Seeding.UnsharePackage>();
        services.AddScoped<Seeding.GrantAll>();
        services.AddScoped<Organizations.MergeOrganizations>();
        services.AddScoped<Organizations.ListProductRequests>();
        services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
        services.AddSingleton<IPasswordHasher<Operators.Operator>, PasswordHasher<Operators.Operator>>();
        services.AddScoped<Operators.CreateOperator>();
        services.AddAuthentication(SessionAuthenticationHandler.SchemeName)
            .AddScheme<AuthenticationSchemeOptions, SessionAuthenticationHandler>(SessionAuthenticationHandler.SchemeName, null);
        // Every endpoint requires a signed-in person unless it says otherwise.
        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
        // Calls per person per minute: every call, and the heavy ones (`RateLimits:PerMinute`, `RateLimits:HeavyPerMinute`).
        var perMinute = Math.Max(1, config.GetValue("RateLimits:PerMinute", 600));
        var heavyPerMinute = Math.Max(1, config.GetValue("RateLimits:HeavyPerMinute", 120));
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
            // Every call, per person (owner, "rate limiting"): generous enough that work never feels it (a page is a
            // dozen calls), close enough that a runaway script or a stolen session is slowed down at once.
            o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http =>
                http.Request.Path.StartsWithSegments("/health") || http.Request.Path.StartsWithSegments("/metrics")
                    ? RateLimitPartition.GetNoLimiter("probe")
                    : RateLimitPartition.GetTokenBucketLimiter(Caller(http), _ => new TokenBucketRateLimiterOptions
                    {
                        TokenLimit = perMinute, TokensPerPeriod = perMinute, ReplenishmentPeriod = TimeSpan.FromMinutes(1), QueueLimit = 0,
                    }));
            // The heavy calls, per person: a file's bytes or its preview, an export, an upload asked, a search. A person
            // reading files one by one never reaches it; a whole project pulled out in a loop does (DownloadWatch still
            // tells the administrators past 200 files in an hour).
            o.AddPolicy("heavy", http => RateLimitPartition.GetTokenBucketLimiter(Caller(http), _ => new TokenBucketRateLimiterOptions
            {
                TokenLimit = heavyPerMinute, TokensPerPeriod = heavyPerMinute, ReplenishmentPeriod = TimeSpan.FromMinutes(1), QueueLimit = 0,
            }));
            // Said in plain words, as every refusal is; the screens show it as it is.
            o.OnRejected = async (context, cancellationToken) =>
            {
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var wait))
                    context.HttpContext.Response.Headers.RetryAfter = ((int)Math.Ceiling(wait.TotalSeconds)).ToString();
                await Problems.Problem(StatusCodes.Status429TooManyRequests, "TOO_MANY_REQUESTS",
                    "Too many requests in a short time. Wait a moment and try again.", null).ExecuteAsync(context.HttpContext);
            };
        });
        // The proxy in front (Caddy, the load balancer) sits on a private network.
        services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            // Two hops of ours (the site's Caddy, the screens, then the API's Caddy): walked back while the address is
            // one of ours, so the person's own address is the one counted (the sign-in limit, known devices).
            o.ForwardLimit = null;
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
        // The screens say which project they are in (X-Delios-Project): the lists are read as that project sees them,
        // also on the calls that are not about one project (the values for a dropdown).
        app.Use(async (http, next) =>
        {
            if (http.User.Identity?.IsAuthenticated == true)
            {
                var db = http.RequestServices.GetRequiredService<DeliosDbContext>();
                var named = Guid.TryParse(http.Request.Headers["X-Delios-Project"].ToString(), out var projectId) ? projectId : (Guid?)null;
                var userId = http.User.UserId();
                // Kept until how the organization works changes (owner: "if that does not create a security
                // vulnerability"): which lists a project reads and how dates read are the same for everyone who asks
                // (nothing here grants anything: access is checked as before); the project opened first is per person.
                var seen = await http.RequestServices.GetRequiredService<AccessVersions>().SharedAsync(http.User.TenantId(),
                    named is { } id ? $"lists-of:{id}" : $"lists-of-first:{userId}", async () =>
                    {
                        // In a transaction of its own: the tenant is set on a transaction, and row-level security shows
                        // nothing outside one (the lists would silently be read as the organization's).
                        await using var look = await db.Database.BeginTransactionAsync(http.RequestAborted);
                        var project = named is { } one
                            ? await db.Projects.AsNoTracking().Where(p => p.Id == one)
                                .Select(p => new ListsOf(p.Id, p.OwnListKeys, p.OwnFunctions)).SingleOrDefaultAsync(http.RequestAborted)
                            // None said: the project the screens open first, as /api/me lists them.
                            : await db.Memberships.AsNoTracking()
                                .Where(m => m.UserId == userId && m.Active && m.Project!.Status == "ACTIVE" && m.Function!.Active)
                                .OrderBy(m => m.Project!.Code).Select(m => new ListsOf(m.Project!.Id, m.Project.OwnListKeys, m.Project.OwnFunctions))
                                .FirstOrDefaultAsync(http.RequestAborted);
                        // How dates read: the organization's, carried on every answer for the screens to draw them so.
                        var dates = await db.Set<Settings.Setting>().AsNoTracking()
                            .Where(s => s.ProjectId == null && s.Key == Settings.DateFormat.Key).Select(s => s.Value).FirstOrDefaultAsync(http.RequestAborted);
                        await look.CommitAsync(http.RequestAborted);
                        return new RequestLists(project, dates);
                    });
                if (seen.Project is { } lists) db.UseListsOf(lists.Id, lists.OwnListKeys, lists.OwnFunctions);
                http.Response.Headers[Settings.DateFormat.Header] = Settings.DateFormat.Codes.Contains(seen.Dates) ? seen.Dates : Settings.DateFormat.Default;
            }
            await next(http);
        });
        // An organization that reads only (not paid, trial ended, contract ended) changes nothing (Operators/Contracts.cs).
        app.Use((http, next) => Operators.Subscriptions.ReadOnlyGateAsync(http, () => next(http)));
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
            Operators.OperatorAuth.MapOperatorAuthEndpoints(app);
            Operators.ConsoleEndpoints.MapConsoleEndpoints(app);
            Operators.ContractEndpoints.MapContractEndpoints(app);
            Operators.BillingEndpoints.MapBillingEndpoints(app);
            Identity.ForgetPerson.MapForgetEndpoints(app);
            app.MapSsoEndpoints();
            app.MapPasswordResetEndpoints();
            app.MapEmailConfirmationEndpoints();
            app.MapAdminEndpoints();
            app.MapDirectoryEndpoints();
            Identity.JoinRequests.MapJoinRequestEndpoints(app);
        Identity.ProjectDirectory.MapProjectDirectoryEndpoints(app);
            Organizations.OrganizationEndpoints.MapOrganizationEndpoints(app);
            Organizations.RegistryEndpoints.MapRegistryEndpoints(app);
            Seeding.SignUpEndpoints.MapSignUpEndpoints(app);
            Notifications.NotificationEndpoints.MapNotificationEndpoints(app);
            Notifications.PushEndpoints.MapPushEndpoints(app);
            Documents.CatalogAdminEndpoints.MapCatalogAdminEndpoints(app);
            Documents.NumberingLevels.MapNumberingEndpoints(app);
            Documents.RevisionSchemeEndpoints.MapRevisionSchemeEndpoints(app);
            Reviews.VerdictListEndpoints.MapVerdictListEndpoints(app);
            Documents.DocumentEndpoints.MapDocumentEndpoints(app);
            Documents.Equivalents.MapEquivalentEndpoints(app);
            Documents.DeliverableImport.MapDeliverableImportEndpoints(app);
            Packages.Intake.MapIntakeEndpoints(app);
            Settings.KeptCopies.MapKeptCopyEndpoints(app);
            Settings.ProjectDifferences.MapProjectDifferenceEndpoints(app);
            Actions.ScheduleDays.MapScheduleDaysEndpoints(app);
            Settings.OrganizationDefaults.MapOrganizationDefaultsEndpoints(app);
            Settings.ProjectPlace.MapProjectPlaceEndpoints(app);
            Organizations.ProductRequests.MapProductRequestEndpoints(app);
            Documents.Viewers.MapViewerEndpoints(app);
            Settings.Calendar.MapCalendarEndpoints(app);
            Identity.ProjectFunctions.MapProjectFunctionEndpoints(app);
            Reviews.ReviewEndpoints.MapReviewEndpoints(app);
            Reviews.StampPlaceEndpoints.MapStampPlaceEndpoints(app);
            Reviews.DelegationEndpoints.MapDelegationEndpoints(app);
            Reviews.StepPeople.MapStepPeopleEndpoints(app);
            Documents.KeepingEndpoints.MapKeepingEndpoints(app);
            Documents.SnapshotEndpoints.MapSnapshotEndpoints(app);
            Documents.GovernanceEndpoints.MapGovernanceEndpoints(app);
            Records.ProjectRecordEndpoints.MapProjectRecordEndpoints(app);
            Transmittals.TransmittalEndpoints.MapTransmittalEndpoints(app);
            Transmittals.EmailReplyEndpoints.MapEmailReplyEndpoints(app);
            Packages.PackageEndpoints.MapPackageEndpoints(app);
            Search.SearchEndpoints.MapSearchEndpoints(app);
            Extraction.ExtractionEndpoints.MapExtractionEndpoints(app);
            Checks.CheckEndpoints.MapCheckEndpoints(app);
            Checks.PlanEndpoints.MapPlanEndpoints(app);
            Documents.ProjectLists.MapProjectListEndpoints(app);
            Actions.ScheduleEndpoints.MapScheduleEndpoints(app);
            Actions.ListUploadEndpoints.MapListUploadEndpoints(app);
            Actions.ListSources.MapListSourceEndpoints(app);
            Documents.SheetGuard.MapSheetGuardEndpoints(app);
            Audit.ActivityEndpoints.MapActivityEndpoints(app);
            Settings.SettingEndpoints.MapSettingEndpoints(app);
            Settings.FormRules.MapFormEndpoints(app);
            Settings.Liberty.MapLibertyEndpoints(app);
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

    /// <summary>Who a limit counts: the person signed in, else the address the request came from (walked back through our proxies).</summary>
    private static string Caller(HttpContext http) =>
        http.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value is { } person
            ? "u:" + person
            : "a:" + (http.Connection.RemoteIpAddress?.ToString() ?? "unknown");
}

/// <summary>Which lists a project reads (its own copies), as every request sets them.</summary>
internal sealed record ListsOf(Guid Id, string[] OwnListKeys, bool OwnFunctions);
/// <summary>What every request reads before its endpoint: the project's lists and how dates read.</summary>
internal sealed record RequestLists(ListsOf? Project, string? Dates);
