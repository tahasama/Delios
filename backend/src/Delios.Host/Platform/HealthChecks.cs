using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Amazon.S3;
using Amazon.S3.Util;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using RabbitMQ.Client;

namespace Delios.Host.Platform;

/// <summary>
/// Keeps one connection open between checks rather than opening one every few
/// seconds, and replaces it when it has dropped.
/// </summary>
public sealed class RabbitMqHealthCheck(IOptions<ConnectionStringsOptions> options)
    : IHealthCheck, IAsyncDisposable
{
    /// <summary>Lets only one check at a time open or replace the connection.</summary>
    private readonly SemaphoreSlim _gate = new(1, 1);
    /// <summary>The connection kept open between checks. Null before the first check or after it dropped.</summary>
    private IConnection? _connection;

    /// <summary>
    /// Called by ASP.NET Core's health check system when a health endpoint is asked. Healthy when a RabbitMQ connection is open or can be opened.
    /// </summary>
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_connection is not { IsOpen: true })
            {
                if (_connection is not null) await _connection.DisposeAsync();
                _connection = null;
                var factory = new ConnectionFactory
                {
                    Uri = new Uri(options.Value.RabbitMq),
                    ClientProvidedName = "delios-health",
                };
                _connection = await factory.CreateConnectionAsync(cancellationToken);
            }
            return HealthCheckResult.Healthy();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return HealthCheckResult.Unhealthy("RabbitMQ is unreachable", ex);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Closes the kept connection when the app shuts down.</summary>
    public async ValueTask DisposeAsync()
    {
        if (_connection is not null) await _connection.DisposeAsync();
        _gate.Dispose();
    }
}

/// <summary>
/// Health check for file storage (an S3-compatible bucket or an Azure Blob container): healthy when the bucket can be reached and exists.
/// </summary>
public sealed class ObjectStorageHealthCheck(Documents.IObjectStore store) : IHealthCheck
{
    /// <summary>Asks the object store whether the bucket is reachable. Called by ASP.NET Core's health check system.</summary>
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            return await store.ReachableAsync(cancellationToken)
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("The bucket (or Azure container) does not exist");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return HealthCheckResult.Unhealthy("Object storage is unreachable", ex);
        }
    }
}

/// <summary>Sends clamd's PING and expects PONG.</summary>
public sealed class ClamAvHealthCheck(IOptions<ClamAvOptions> options) : IHealthCheck
{
    /// <summary>
    /// Opens a TCP connection to clamd (the ClamAV virus scanner service), sends PING and is healthy only when it answers PONG.
    /// </summary>
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync(options.Value.Host, options.Value.Port, cancellationToken);
            await using var stream = client.GetStream();
            await stream.WriteAsync("zPING\0"u8.ToArray(), cancellationToken);

            var buffer = new byte[16];
            var read = await stream.ReadAsync(buffer, cancellationToken);
            var reply = Encoding.ASCII.GetString(buffer, 0, read).TrimEnd('\0');
            return reply == "PONG"
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy($"Unexpected reply from clamd: {reply}");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return HealthCheckResult.Unhealthy("ClamAV is unreachable", ex);
        }
    }
}

/// <summary>Status per dependency, without exception details.</summary>
public static class HealthResponse
{
    /// <summary>
    /// Writes the health report as JSON: the overall status and one status per check, such as <c>{"status":"Healthy","checks":{"postgres":"Healthy"}}</c>.
    /// Plugged into the health endpoints in PlatformSetup so that error details never leak to callers.
    /// </summary>
    public static Task WriteAsync(HttpContext context, HealthReport report)
    {
        context.Response.ContentType = "application/json";
        var body = new
        {
            status = report.Status.ToString(),
            checks = report.Entries.ToDictionary(e => e.Key, e => e.Value.Status.ToString()),
        };
        return context.Response.WriteAsync(JsonSerializer.Serialize(body));
    }
}
