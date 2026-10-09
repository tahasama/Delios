using System.Text;
using System.Text.Json;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using RabbitMQ.Client;
using RabbitMQ.Client.Exceptions;

namespace Delios.Host.Messaging;

/// <summary>
/// Helpers for the outbox: a database table of messages to send, written in the same transaction as the change they describe.
/// Services call <see cref="Enqueue"/>; <see cref="OutboxRelay"/> later sends the rows to RabbitMQ.
/// </summary>
public static class Outbox
{
    /// <summary>Adds a message to the caller's unit of work; it is sent only if that commits.</summary>
    public static void Enqueue(this DeliosDbContext db, string routingKey, object payload) =>
        db.OutboxMessages.Add(new OutboxMessage { RoutingKey = routingKey, Payload = JsonSerializer.Serialize(payload) });
}

/// <summary>
/// Moves committed outbox messages to RabbitMQ, waiting for the broker to confirm
/// each one before marking it sent. Several nodes can run it: each takes rows the
/// others have not locked. A message may be sent twice; consumers are idempotent.
/// </summary>
public sealed class OutboxRelay(
    IServiceScopeFactory scopes, RabbitMqConnection rabbit, IClock clock, ILogger<OutboxRelay> logger)
    : BackgroundService
{
    /// <summary>How long the relay sleeps when it found nothing to send.</summary>
    private static readonly TimeSpan Idle = TimeSpan.FromSeconds(1);
    /// <summary>How often the relay updates the outbox backlog metrics.</summary>
    private static readonly TimeSpan MeasureEvery = TimeSpan.FromSeconds(15);
    /// <summary>The RabbitMQ channel used for publishing, opened on first use and reopened after a failure; null when none is open.</summary>
    private IChannel? _channel;
    private DateTime _measuredAt = DateTime.MinValue;

    /// <summary>
    /// Runs for the life of the process: sends batches until the outbox is empty, then waits a second; refreshes the backlog metrics every 15 seconds.
    /// On failure it drops the channel and retries after 5 seconds.
    /// </summary>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await RelayBatchAsync(stoppingToken) == 0) await Task.Delay(Idle, stoppingToken);
                if (DateTime.UtcNow - _measuredAt > MeasureEvery) await MeasureAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Outbox relay failed; retrying in 5 seconds");
                if (_channel is not null) await _channel.DisposeAsync();
                _channel = null;
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }

    /// <summary>
    /// Sends up to 100 unsent outbox messages to RabbitMQ and marks them sent, all in one transaction. Returns how many were sent.
    /// <c>FOR UPDATE SKIP LOCKED</c> locks the rows it takes and skips rows another node has locked, so two nodes never send the same batch at once.
    /// Called by <see cref="ExecuteAsync"/>.
    /// </summary>
    public async Task<int> RelayBatchAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var batch = await db.OutboxMessages
            .FromSql($"SELECT * FROM outbox_messages WHERE sent_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED")
            .ToListAsync(cancellationToken);
        if (batch.Count == 0) return 0;

        var channel = await ChannelAsync(cancellationToken);
        foreach (var message in batch)
        {
            var body = Encoding.UTF8.GetBytes(message.Payload);
            var id = message.Id.ToString(System.Globalization.CultureInfo.InvariantCulture);
            try
            {
                await channel.BasicPublishAsync(Topology.Exchange, message.RoutingKey, mandatory: true,
                    new BasicProperties { Persistent = true, ContentType = "application/json", MessageId = id },
                    body, cancellationToken);
            }
            catch (PublishException e) when (e.IsReturn)
            {
                // No queue takes this routing key: a programming error. Retrying would block
                // every message behind it, so it is parked for a person, with its key.
                logger.LogError("Outbox message {MessageId} ({RoutingKey}) reached no queue; parked in {Queue}",
                    id, message.RoutingKey, Topology.FilesDeadQueue);
                await channel.BasicPublishAsync("", Topology.FilesDeadQueue, mandatory: true,
                    new BasicProperties
                    {
                        Persistent = true,
                        ContentType = "application/json",
                        MessageId = id,
                        Headers = new Dictionary<string, object?>
                        {
                            [Topology.RoutingKeyHeader] = message.RoutingKey,
                            ["x-error"] = "No queue is bound to this routing key.",
                        },
                    },
                    body, cancellationToken);
            }
            message.SentAt = clock.GetCurrentInstant();
        }
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return batch.Count;
    }

    /// <summary>The backlog, for the alert that says the relay is stuck.</summary>
    private async Task MeasureAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
        var unsent = await db.OutboxMessages.Where(m => m.SentAt == null)
            .GroupBy(_ => 1)
            .Select(g => new { Count = g.Count(), Oldest = g.Min(m => m.CreatedAt) })
            .SingleOrDefaultAsync(cancellationToken);
        AppMetrics.OutboxUnsent.Set(unsent?.Count ?? 0);
        AppMetrics.OutboxOldestUnsentSeconds.Set(
            unsent is null ? 0 : (clock.GetCurrentInstant() - unsent.Oldest).TotalSeconds);
        _measuredAt = DateTime.UtcNow;
    }

    /// <summary>Returns the open publishing channel, or opens a new one with publisher confirms (the broker acknowledges each published message) and declares the exchanges and queues.</summary>
    private async Task<IChannel> ChannelAsync(CancellationToken cancellationToken)
    {
        if (_channel is { IsOpen: true }) return _channel;
        var connection = await rabbit.GetAsync(cancellationToken);
        _channel = await connection.CreateChannelAsync(
            new CreateChannelOptions(publisherConfirmationsEnabled: true, publisherConfirmationTrackingEnabled: true),
            cancellationToken);
        await Topology.DeclareAsync(_channel, cancellationToken);
        return _channel;
    }

    /// <summary>Called by the host at shutdown: stops the loop, then closes the channel.</summary>
    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await base.StopAsync(cancellationToken);
        if (_channel is not null) await _channel.DisposeAsync();
    }
}
