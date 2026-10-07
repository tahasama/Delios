using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace Delios.Tests;

public sealed class MigrationTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task Migrations_apply_and_match_the_model()
    {
        await using var factory = new DeliosFactory(await infrastructure.SettingsAsync());

        await DatabaseMigrator.ApplyAsync(factory.Services);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
        Assert.False(db.Database.HasPendingModelChanges(), "The model has changes no migration covers");
    }

    [Fact]
    public async Task Migrations_can_be_rolled_back_to_the_start()
    {
        await using var factory = new DeliosFactory(await infrastructure.SettingsAsync());
        await DatabaseMigrator.ApplyAsync(factory.Services);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
        var migrator = db.GetInfrastructure().GetRequiredService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>();
        await migrator.MigrateAsync("0");

        Assert.Empty(await db.Database.GetAppliedMigrationsAsync());
    }
}
