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
    public const string FilesDeadQueue = "delios.files.dead";
    public const int MaxAttempts = 5;
    public static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(30);

    /// <summary>The kinds of work the files queue carries: scanning uploads, stamping releases.</summary>
    public static readonly string[] WorkKeys = [Documents.FileUploaded.RoutingKey, Reviews.RevisionReleased.RoutingKey];

    public static async Task DeclareAsync(IChannel channel, CancellationToken cancellationToken)
    {
        await channel.ExchangeDeclareAsync(Exchange, ExchangeType.Direct, durable: true, cancellationToken: cancellationToken);
        await channel.ExchangeDeclareAsync(RetryExchange, ExchangeType.Direct, durable: true, cancellationToken: cancellationToken);

        await channel.QueueDeclareAsync(FilesQueue, durable: true, exclusive: false, autoDelete: false,
            arguments: new Dictionary<string, object?> { ["x-dead-letter-exchange"] = RetryExchange },
            cancellationToken: cancellationToken);
        foreach (var key in WorkKeys)
        {
            await channel.QueueBindAsync(FilesQueue, Exchange, key, cancellationToken: cancellationToken);
        }

        await channel.QueueDeclareAsync(FilesRetryQueue, durable: true, exclusive: false, autoDelete: false,
            arguments: new Dictionary<string, object?>
            {
                ["x-message-ttl"] = (int)RetryDelay.TotalMilliseconds,
                ["x-dead-letter-exchange"] = Exchange,
            },
            cancellationToken: cancellationToken);
        foreach (var key in WorkKeys)
        {
            await channel.QueueBindAsync(FilesRetryQueue, RetryExchange, key, cancellationToken: cancellationToken);
        }

        await channel.QueueDeclareAsync(FilesDeadQueue, durable: true, exclusive: false, autoDelete: false,
            cancellationToken: cancellationToken);
    }
}
