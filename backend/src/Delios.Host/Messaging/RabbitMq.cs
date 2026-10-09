using Delios.Host.Platform;
using Microsoft.Extensions.Options;
using RabbitMQ.Client;

namespace Delios.Host.Messaging;

/// <summary>One connection per process, replaced when it drops.</summary>
public sealed class RabbitMqConnection(IOptions<ConnectionStringsOptions> options) : IAsyncDisposable
{
    /// <summary>Lets only one caller at a time open a new connection.</summary>
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IConnection? _connection;

    /// <summary>
    /// Returns the shared RabbitMQ connection, opening a new one if there is none or the old one has closed.
    /// Called by <see cref="OutboxRelay"/> and <see cref="FileQueueConsumer"/> each time they need a channel.
    /// </summary>
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

    /// <summary>Closes the connection when the process shuts down.</summary>
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
    /// <summary>The main exchange (RabbitMQ's router) that the outbox publishes to; routes by routing key.</summary>
    public const string Exchange = "delios";
    /// <summary>Exchange that failed messages are dead-lettered to; it routes them into the matching retry queue.</summary>
    public const string RetryExchange = "delios.retry";
    public const string FilesQueue = "delios.files";
    public const string FilesRetryQueue = "delios.files.retry";
    /// <summary>Where a message from any work queue is parked after its last attempt.</summary>
    public const string FilesDeadQueue = "delios.files.dead";

    /// <summary>
    /// The header a parked message carries its original routing key in, so a person
    /// knows what kind of work it was and can send it back where it belongs.
    /// </summary>
    public const string RoutingKeyHeader = "x-routing-key";
    /// <summary>How many times a message is tried before it is parked in the dead queue.</summary>
    public const int MaxAttempts = 5;
    /// <summary>How long a failed message waits in the retry queue before it is delivered again.</summary>
    public static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(30);

    /// <summary>Scanning uploads and stamping releases: what people wait for.</summary>
    public static readonly WorkQueue Files = new(FilesQueue, FilesRetryQueue,
        [Documents.FileUploaded.RoutingKey, Reviews.RevisionReleased.RoutingKey, Reviews.RevisionMarked.RoutingKey], Prefetch: 4);

    /// <summary>
    /// Reading text and OCR: slow, and nobody is waiting at a screen. A queue of
    /// its own, one at a time, so a scanned archive never holds up a new upload's scan.
    /// </summary>
    public static readonly WorkQueue Extraction = new("delios.extract", "delios.extract.retry",
        [Host.Extraction.FileExtract.RoutingKey], Prefetch: 1);

    /// <summary>A project's checks and schedule reads: a few seconds to minutes each, never in the way of uploads.</summary>
    public static readonly WorkQueue Checks = new("delios.checks", "delios.checks.retry",
        [Host.Checks.CheckRunRequested.RoutingKey, Host.Schedules.ScheduleImportRequested.RoutingKey, Host.Schedules.RequirementsImportRequested.RoutingKey,
            Host.Schedules.DepartmentsImportRequested.RoutingKey], Prefetch: 1);

    /// <summary>Email: each one to the mail server on its own, apart from every other job.</summary>
    public static readonly WorkQueue Mail = new("delios.mail", "delios.mail.retry",
        [Host.Notifications.EmailRequested.RoutingKey], Prefetch: 4);

    /// <summary>Every work queue; the worker runs one <see cref="FileQueueConsumer"/> per entry.</summary>
    public static readonly WorkQueue[] Queues = [Files, Extraction, Checks, Mail];

    /// <summary>
    /// Creates the exchanges, the work queues with their retry queues and bindings, and the dead queue, if they do not exist yet.
    /// A work queue dead-letters rejected messages to the retry exchange; a retry queue holds them for <see cref="RetryDelay"/>, then dead-letters them back to the main exchange.
    /// Called by the relay and each consumer whenever they open a channel; declaring is safe to repeat.
    /// </summary>
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
