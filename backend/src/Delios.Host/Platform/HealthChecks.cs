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
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IConnection? _connection;

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

    public async ValueTask DisposeAsync()
    {
        if (_connection is not null) await _connection.DisposeAsync();
        _gate.Dispose();
    }
}

public sealed class ObjectStorageHealthCheck(IAmazonS3 s3, IOptions<StorageOptions> options) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            return await AmazonS3Util.DoesS3BucketExistV2Async(s3, options.Value.Bucket)
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("The bucket does not exist");
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
