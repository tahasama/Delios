using System.Text;
using System.Text.Json;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using RabbitMQ.Client;

namespace Delios.Host.Messaging;

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
    private static readonly TimeSpan Idle = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan MeasureEvery = TimeSpan.FromSeconds(15);
    private IChannel? _channel;
    private DateTime _measuredAt = DateTime.MinValue;

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
            await channel.BasicPublishAsync(Topology.Exchange, message.RoutingKey, mandatory: true,
                new BasicProperties
                {
                    Persistent = true,
                    ContentType = "application/json",
                    MessageId = message.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                },
                Encoding.UTF8.GetBytes(message.Payload), cancellationToken);
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

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await base.StopAsync(cancellationToken);
        if (_channel is not null) await _channel.DisposeAsync();
    }
}
