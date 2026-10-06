using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.PostgreSql;

namespace Delios.Tests;

public sealed class MigrationTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine").Build();

    public Task InitializeAsync() => _postgres.StartAsync();
    public Task DisposeAsync() => _postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Migrations_apply_and_match_the_model()
    {
        var settings = DeliosFactory.Unreachable();
        settings["ConnectionStrings:Postgres"] = _postgres.GetConnectionString();
        await using var factory = new DeliosFactory(settings);

        await DatabaseMigrator.ApplyAsync(factory.Services);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
        Assert.False(db.Database.HasPendingModelChanges(), "The model has changes no migration covers");
        Assert.Equal(0, await db.DataProtectionKeys.CountAsync());
    }
}
