using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Delios.Host.Platform;

/// <summary>
/// Brings the database schema up to date by applying Entity Framework Core migrations (generated code files, under Platform/Migrations,
/// that each describe one change to the tables). Run with the <c>migrate</c> command from a one-off container, not on every start.
/// </summary>
public static class DatabaseMigrator
{
    /// <summary>The command-line argument that runs the migrations.</summary>
    public const string Command = "migrate";

    /// <summary>
    /// Applies every migration the database does not have yet, in order, and logs how many are applied in total. Called by <c>Commands.RunAsync</c>.
    /// </summary>
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
