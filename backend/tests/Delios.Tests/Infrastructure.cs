using Npgsql;
using Testcontainers.PostgreSql;
using Testcontainers.RabbitMq;
using Testcontainers.Redis;

namespace Delios.Tests;

/// <summary>Real Postgres, Redis and RabbitMQ in containers, shared by a test class. Needs Docker.</summary>
public sealed class Infrastructure : IAsyncLifetime
{
    public PostgreSqlContainer Postgres { get; } = new PostgreSqlBuilder("postgres:17-alpine").Build();
    public RedisContainer Redis { get; } = new RedisBuilder("valkey/valkey:8-alpine").Build();
    public RabbitMqContainer RabbitMq { get; } = new RabbitMqBuilder("rabbitmq:4-management-alpine").Build();

    /// <summary>
    /// A fresh database owned by an ordinary role. The container's own user is a
    /// superuser, and superusers ignore row-level security.
    /// </summary>
    public async Task<string> NewDatabaseAsync()
    {
        var name = "delios_" + Guid.NewGuid().ToString("N")[..12];
        var result = await Postgres.ExecScriptAsync($"""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'delios_app') THEN
                    CREATE ROLE delios_app LOGIN PASSWORD 'app';
                END IF;
            END $$;
            CREATE DATABASE {name} OWNER delios_app;
            """);
        if (result.ExitCode != 0) throw new InvalidOperationException(result.Stderr);
        return new NpgsqlConnectionStringBuilder(Postgres.GetConnectionString())
        {
            Database = name,
            Username = "delios_app",
            Password = "app",
        }.ToString();
    }

    public async Task<Dictionary<string, string?>> SettingsAsync()
    {
        var settings = DeliosFactory.Unreachable();
        settings["ConnectionStrings:Postgres"] = await NewDatabaseAsync();
        settings["ConnectionStrings:Redis"] = Redis.GetConnectionString();
        settings["ConnectionStrings:RabbitMq"] = RabbitMq.GetConnectionString();
        return settings;
    }

    public Task InitializeAsync() =>
        Task.WhenAll(Postgres.StartAsync(), Redis.StartAsync(), RabbitMq.StartAsync());

    public async Task DisposeAsync()
    {
        await Postgres.DisposeAsync();
        await Redis.DisposeAsync();
        await RabbitMq.DisposeAsync();
    }
}
