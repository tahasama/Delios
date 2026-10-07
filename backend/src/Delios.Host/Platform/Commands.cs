using Delios.Host.Seeding;

namespace Delios.Host.Platform;

/// <summary>
/// One-shot commands run with the same build and settings as the app:
/// <c>migrate</c>, <c>create-tenant</c>, <c>seed-demo</c>, <c>reindex</c>.
/// </summary>
public static class Commands
{
    public static bool IsCommand(string[] args) =>
        args.Length > 0 && args[0] is DatabaseMigrator.Command or "create-tenant" or "seed-demo" or "reindex";

    public static async Task<int> RunAsync(WebApplication app, string[] args)
    {
        await using var scope = app.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        switch (args[0])
        {
            case DatabaseMigrator.Command:
                await DatabaseMigrator.ApplyAsync(app.Services);
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

            default:
                await Console.Error.WriteLineAsync(
                    "Usage: migrate | create-tenant <slug> <name> <admin-email> <admin-name> | seed-demo | reindex");
                return 2;
        }
    }
}
