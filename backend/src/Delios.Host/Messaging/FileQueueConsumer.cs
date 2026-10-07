using System.Text.Json;
using Delios.Host.Documents;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace Delios.Host.Messaging;

/// <summary>The worker's loop over the files queue. Acknowledges only after the work committed.</summary>
public sealed class FileQueueConsumer(
    IServiceScopeFactory scopes, RabbitMqConnection rabbit, ILogger<FileQueueConsumer> logger) : BackgroundService
{
    private const ushort Prefetch = 4;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var connection = await rabbit.GetAsync(stoppingToken);
                await using var channel = await connection.CreateChannelAsync(cancellationToken: stoppingToken);
                await Topology.DeclareAsync(channel, stoppingToken);
                await channel.BasicQosAsync(0, Prefetch, global: false, stoppingToken);

                var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                channel.ChannelShutdownAsync += (_, _) => { closed.TrySetResult(); return Task.CompletedTask; };
                var consumer = new AsyncEventingBasicConsumer(channel);
                consumer.ReceivedAsync += (_, delivery) => HandleAsync(channel, delivery, stoppingToken);
                await channel.BasicConsumeAsync(Topology.FilesQueue, autoAck: false, consumer, stoppingToken);
                logger.LogInformation("Consuming {Queue}", Topology.FilesQueue);

                await closed.Task.WaitAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "File queue consumer stopped; reconnecting in 5 seconds");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }

    private async Task HandleAsync(IChannel channel, BasicDeliverEventArgs delivery, CancellationToken stoppingToken)
    {
        try
        {
            var message = JsonSerializer.Deserialize<FileUploaded>(delivery.Body.Span)
                ?? throw new InvalidOperationException("Empty message");
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<FileProcessor>().ProcessAsync(message, stoppingToken);
            await channel.BasicAckAsync(delivery.DeliveryTag, multiple: false, stoppingToken);
        }
        catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
        {
            var attempt = Attempts(delivery.BasicProperties) + 1;
            if (attempt >= Topology.MaxAttempts)
            {
                logger.LogError(ex, "File message failed {Attempts} times; parked in {Queue}", attempt, Topology.FilesDeadQueue);
                await channel.BasicPublishAsync("", Topology.FilesDeadQueue, mandatory: false,
                    new BasicProperties
                    {
                        Persistent = true,
                        ContentType = "application/json",
                        Headers = new Dictionary<string, object?> { ["x-error"] = ex.Message },
                    },
                    delivery.Body, stoppingToken);
                await channel.BasicAckAsync(delivery.DeliveryTag, multiple: false, stoppingToken);
            }
            else
            {
                logger.LogWarning(ex, "File message failed (attempt {Attempt}); retrying in {Delay}", attempt, Topology.RetryDelay);
                await channel.BasicNackAsync(delivery.DeliveryTag, multiple: false, requeue: false, stoppingToken);
            }
        }
    }

    /// <summary>How many times the message has already been rejected from the files queue.</summary>
    private static int Attempts(IReadOnlyBasicProperties properties)
    {
        if (properties.Headers?.TryGetValue("x-death", out var raw) != true || raw is not IEnumerable<object> deaths) return 0;
        foreach (var death in deaths.OfType<IDictionary<string, object?>>())
        {
            var queue = death.TryGetValue("queue", out var q) && q is byte[] bytes ? System.Text.Encoding.UTF8.GetString(bytes) : null;
            if (queue == Topology.FilesQueue && death.TryGetValue("count", out var count) && count is long n) return (int)n;
        }
        return 0;
    }
}
