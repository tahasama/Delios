using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Delios.Host.Platform;

public static class DatabaseMigrator
{
    public const string Command = "migrate";

    public static async Task ApplyAsync(IServiceProvider services)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
        var logger = scope.ServiceProvider.GetRequiredService<ILogger<DeliosDbContext>>();

        // On a new database EF reads the history table before creating it, and logs
        // that failed read as an error. Creating the table first keeps the log clean.
        logger.LogInformation("Applying migrations");
        await db.GetService<IHistoryRepository>().CreateIfNotExistsAsync();
        await db.Database.MigrateAsync();
        var applied = (await db.Database.GetAppliedMigrationsAsync()).Count();
        logger.LogInformation("Database is up to date with {Count} migration(s)", applied);
    }
}
