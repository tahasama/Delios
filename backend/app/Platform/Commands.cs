using Microsoft.EntityFrameworkCore;
using Delios.Host.Seeding;

namespace Delios.Host.Platform;

/// <summary>
/// One-shot commands run with the same build and settings as the app:
/// <c>migrate</c>, <c>create-tenant</c>, <c>seed-demo</c>, <c>reindex</c>, <c>grant-all</c>, <c>unshare-package</c>,
/// <c>merge-organizations</c>, <c>requests</c>, <c>rebuild-recorded</c>, <c>create-operator</c>.
/// </summary>
public static class Commands
{
    /// <summary>
    /// True when the first command-line argument names one of these commands. Program.cs then runs the command instead of starting the web server.
    /// </summary>
    public static bool IsCommand(string[] args) =>
        args.Length > 0 && args[0] is DatabaseMigrator.Command or "create-tenant" or "seed-demo" or "reindex" or "grant-all" or "unshare-package" or "merge-organizations"
            or "requests" or "rebuild-recorded" or "create-operator";

    /// <summary>
    /// Runs the command named by the first argument and returns the process exit code (0 success, 2 wrong usage or refused).
    /// Called from Program.cs after the app is built, so every service is available; the web server is not started.
    /// </summary>
    public static async Task<int> RunAsync(WebApplication app, string[] args)
    {
        await using var scope = app.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        switch (args[0])
        {
            case DatabaseMigrator.Command:
                await DatabaseMigrator.ApplyAsync(app.Services);
                await TrainingSpacesAsync(services);
                return 0;

            case "create-tenant" when args.Length == 5:
                // The password comes from the environment so it never sits in shell history.
                var password = Environment.GetEnvironmentVariable("DELIOS_ADMIN_PASSWORD");
                if (string.IsNullOrWhiteSpace(password) || password.Length < 12)
                {
                    await Console.Error.WriteLineAsync("Set DELIOS_ADMIN_PASSWORD (12 characters or more).");
                    return 2;
                }
                var tenant = await services.GetRequiredService<TenantSetup>()
                    .CreateAsync(args[1], args[2], args[3], args[4], password);
                await Console.Out.WriteLineAsync($"Tenant '{tenant.Slug}' created.");
                return 0;

            case "seed-demo" when app.Environment.IsProduction() && !args.Contains("--force"):
                await Console.Error.WriteLineAsync("seed-demo creates known passwords; add --force to run it in Production.");
                return 2;

            case "seed-demo":
                await services.GetRequiredService<DemoSeed>().RunAsync();
                return 0;

            case "reindex":
                // Drops the search index; the worker rebuilds it from the register within minutes.
                var search = services.GetRequiredService<Microsoft.Extensions.Options.IOptions<Search.SearchOptions>>().Value;
                if (!search.UsesOpenSearch)
                {
                    await Console.Error.WriteLineAsync("Search:Provider is postgres; there is no index to rebuild.");
                    return 2;
                }
                await services.GetRequiredService<Search.OpenSearchClient>().DeleteIndexAsync(default);
                await Search.SearchIndexer.ResetAsync(app.Services.GetRequiredService<IServiceScopeFactory>(), default);
                await Console.Out.WriteLineAsync("Search index dropped; the worker rebuilds it from the register.");
                return 0;

            case "grant-all" when args.Length == 2:
                // The new password, when one is wanted, comes from the environment so it never sits in shell history.
                var newPassword = Environment.GetEnvironmentVariable("DELIOS_ADMIN_PASSWORD");
                var said = await services.GetRequiredService<GrantAll>().RunAsync(args[1], string.IsNullOrWhiteSpace(newPassword) ? null : newPassword);
                await Console.Out.WriteLineAsync(said);
                return said.StartsWith("No one") ? 2 : 0;

            case "unshare-package" when args.Length == 3:
                var unshared = await services.GetRequiredService<UnsharePackage>().RunAsync(args[1], args[2]);
                await Console.Out.WriteLineAsync(unshared);
                return unshared.Contains("no longer shared") ? 0 : 2;

            case "merge-organizations" when args.Length <= 2:
                // The app's owner carries out a merge every side agreed to; without an id, lists those waiting.
                var merged = await services.GetRequiredService<Organizations.MergeOrganizations>().RunAsync(args.Length == 2 ? args[1] : null);
                await Console.Out.WriteLineAsync(merged);
                return merged.StartsWith("No such") || merged.StartsWith("One of") ? 2 : 0;

            case "requests" when args.Length == 1:
                // What organizations asked of DELIOS (a certified DWG reader), for the app's owner.
                await Console.Out.WriteLineAsync(await services.GetRequiredService<Organizations.ListProductRequests>().RunAsync());
                return 0;

            case "create-operator" when args.Length == 3:
                // A member of the DELIOS team, for the console; the password from the environment, never in shell history.
                var made = await services.GetRequiredService<Operators.CreateOperator>()
                    .RunAsync(args[1], args[2], Environment.GetEnvironmentVariable("DELIOS_OPERATOR_PASSWORD") ?? "");
                await Console.Out.WriteLineAsync(made);
                return made.StartsWith("Created") || made.StartsWith("Reset") ? 0 : 2;

            case "rebuild-recorded" when args.Length == 1:
                // What the database records as it happens (Recorded), written again from what exists: only if it ever looks wrong.
                var db = services.GetRequiredService<DeliosDbContext>();
                await using (var tx = await db.Database.BeginTransactionAsync())
                {
                    await db.Database.ExecuteSqlRawAsync(Recorded.Rebuild);
                    await tx.CommitAsync();
                }
                await Console.Out.WriteLineAsync("What is recorded as it happens was written again from what exists.");
                return 0;

            default:
                await Console.Error.WriteLineAsync(
                    "Usage: migrate | create-tenant <slug> <name> <admin-email> <admin-name> | seed-demo | reindex | grant-all <email> | unshare-package <email> <package-number> | merge-organizations [<merge-id>] | requests | rebuild-recorded | create-operator <email> <name>");
                return 2;
        }
    }

    /// <summary>
    /// Every organization has its training space (docs/APP-DECISIONS.md §84): one from before it existed gets it here, once.
    /// A failure is said in the log and never stops the update: the app starts all the same.
    /// </summary>
    private static async Task TrainingSpacesAsync(IServiceProvider services)
    {
        var scopes = services.GetRequiredService<IServiceScopeFactory>();
        var log = services.GetRequiredService<ILoggerFactory>().CreateLogger("Delios.Training");
        List<Guid> tenants;
        await using (var scope = scopes.CreateAsyncScope())
            tenants = await scope.ServiceProvider.GetRequiredService<DeliosDbContext>().Tenants.AsNoTracking().Select(t => t.Id).ToListAsync();
        foreach (var tenantId in tenants)
        {
            try
            {
                await Tenancy.TenantScope.RunAsync(scopes, tenantId, (sp, db) =>
                    Organizations.Training.EnsureAsync(db, sp.GetRequiredService<Audit.AuditLog>(), tenantId, Audit.Actor.System, CancellationToken.None),
                    CancellationToken.None);
            }
            catch (Exception e)
            {
                log.LogWarning(e, "The training space of organization {Tenant} could not be opened; it opens on the next update", tenantId);
            }
        }
    }
}
