using Amazon.Runtime;
using Amazon.S3;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
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

    /// <summary>S3-compatible storage. With no identities configured it accepts any credentials.</summary>
    public IContainer Storage { get; } = new ContainerBuilder("chrislusf/seaweedfs:latest")
        .WithCommand("server", "-dir=/data", "-s3")
        .WithPortBinding(8333, true)
        .WithWaitStrategy(Wait.ForUnixContainer().UntilInternalTcpPortIsAvailable(8333))
        .Build();

    public string StorageEndpoint => $"http://{Storage.Hostname}:{Storage.GetMappedPublicPort(8333)}";

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
        settings["Storage:Endpoint"] = StorageEndpoint;
        return settings;
    }

    public async Task InitializeAsync()
    {
        await Task.WhenAll(Postgres.StartAsync(), Redis.StartAsync(), RabbitMq.StartAsync(), Storage.StartAsync());
        using var s3 = new AmazonS3Client(new BasicAWSCredentials("x", "x"),
            new AmazonS3Config { ServiceURL = StorageEndpoint, ForcePathStyle = true, AuthenticationRegion = "us-east-1" });
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await s3.PutBucketAsync("delios");
                return;
            }
            catch (Exception) when (attempt < 30)
            {
                await Task.Delay(500);
            }
        }
    }

    public async Task DisposeAsync()
    {
        await Postgres.DisposeAsync();
        await Redis.DisposeAsync();
        await RabbitMq.DisposeAsync();
        await Storage.DisposeAsync();
    }
}
