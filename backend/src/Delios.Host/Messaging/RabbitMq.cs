using Delios.Host.Platform;
using Microsoft.Extensions.Options;
using RabbitMQ.Client;

namespace Delios.Host.Messaging;

/// <summary>One connection per process, replaced when it drops.</summary>
public sealed class RabbitMqConnection(IOptions<ConnectionStringsOptions> options) : IAsyncDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IConnection? _connection;

    public async Task<IConnection> GetAsync(CancellationToken cancellationToken)
    {
        if (_connection is { IsOpen: true } open) return open;
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_connection is { IsOpen: true } current) return current;
            if (_connection is not null) await _connection.DisposeAsync();
            _connection = await new ConnectionFactory
            {
                Uri = new Uri(options.Value.RabbitMq),
                ClientProvidedName = "delios",
                AutomaticRecoveryEnabled = true,
            }.CreateConnectionAsync(cancellationToken);
            return _connection;
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

/// <summary>
/// Exchanges and queues. A message that fails is dead-lettered to a retry queue,
/// waits there, and comes back; after <see cref="MaxAttempts"/> it is parked in
/// the dead queue for a person to look at.
/// </summary>
public static class Topology
{
    public const string Exchange = "delios";
    public const string RetryExchange = "delios.retry";
    public const string FilesQueue = "delios.files";
    public const string FilesRetryQueue = "delios.files.retry";
    /// <summary>Where a message from any work queue is parked after its last attempt.</summary>
    public const string FilesDeadQueue = "delios.files.dead";
    public const int MaxAttempts = 5;
    public static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(30);

    /// <summary>Scanning uploads and stamping releases: what people wait for.</summary>
    public static readonly WorkQueue Files = new(FilesQueue, FilesRetryQueue,
        [Documents.FileUploaded.RoutingKey, Reviews.RevisionReleased.RoutingKey], Prefetch: 4);

    /// <summary>
    /// Reading text and OCR: slow, and nobody is waiting at a screen. A queue of
    /// its own, one at a time, so a scanned archive never holds up a new upload's scan.
    /// </summary>
    public static readonly WorkQueue Extraction = new("delios.extract", "delios.extract.retry",
        [Host.Extraction.FileExtract.RoutingKey], Prefetch: 1);

    /// <summary>A project's checks and schedule reads: a few seconds to minutes each, never in the way of uploads.</summary>
    public static readonly WorkQueue Checks = new("delios.checks", "delios.checks.retry",
        [Host.Checks.CheckRunRequested.RoutingKey, Host.Schedules.ScheduleImportRequested.RoutingKey], Prefetch: 1);

    public static readonly WorkQueue[] Queues = [Files, Extraction, Checks];

    public static async Task DeclareAsync(IChannel channel, CancellationToken cancellationToken)
    {
        await channel.ExchangeDeclareAsync(Exchange, ExchangeType.Direct, durable: true, cancellationToken: cancellationToken);
        await channel.ExchangeDeclareAsync(RetryExchange, ExchangeType.Direct, durable: true, cancellationToken: cancellationToken);

        foreach (var queue in Queues)
        {
            await channel.QueueDeclareAsync(queue.Name, durable: true, exclusive: false, autoDelete: false,
                arguments: new Dictionary<string, object?> { ["x-dead-letter-exchange"] = RetryExchange },
                cancellationToken: cancellationToken);
            await channel.QueueDeclareAsync(queue.RetryName, durable: true, exclusive: false, autoDelete: false,
                arguments: new Dictionary<string, object?>
                {
                    ["x-message-ttl"] = (int)RetryDelay.TotalMilliseconds,
                    ["x-dead-letter-exchange"] = Exchange,
                },
                cancellationToken: cancellationToken);
            foreach (var key in queue.Keys)
            {
                await channel.QueueBindAsync(queue.Name, Exchange, key, cancellationToken: cancellationToken);
                await channel.QueueBindAsync(queue.RetryName, RetryExchange, key, cancellationToken: cancellationToken);
            }
        }

        await channel.QueueDeclareAsync(FilesDeadQueue, durable: true, exclusive: false, autoDelete: false,
            cancellationToken: cancellationToken);
    }
}

/// <summary>A queue the worker consumes, with its retry queue and the routing keys it carries.</summary>
public sealed record WorkQueue(string Name, string RetryName, string[] Keys, ushort Prefetch);
