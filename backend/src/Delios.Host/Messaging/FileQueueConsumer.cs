using System.Text.Json;
using Delios.Host.Documents;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace Delios.Host.Messaging;

/// <summary>The worker's loop over one work queue. Acknowledges only after the work committed.</summary>
public sealed class FileQueueConsumer(
    IServiceScopeFactory scopes, RabbitMqConnection rabbit, ILogger<FileQueueConsumer> logger, WorkQueue queue) : BackgroundService
{
    /// <summary>
    /// Runs for the life of the worker: connects to RabbitMQ, declares the queues, and consumes this queue until the channel closes.
    /// Prefetch (how many unacknowledged messages RabbitMQ hands over at once) comes from the queue's settings. On any failure it waits 5 seconds and reconnects.
    /// </summary>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var connection = await rabbit.GetAsync(stoppingToken);
                await using var channel = await connection.CreateChannelAsync(cancellationToken: stoppingToken);
                await Topology.DeclareAsync(channel, stoppingToken);
                await channel.BasicQosAsync(0, queue.Prefetch, global: false, stoppingToken);

                var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                channel.ChannelShutdownAsync += (_, _) => { closed.TrySetResult(); return Task.CompletedTask; };
                var consumer = new AsyncEventingBasicConsumer(channel);
                consumer.ReceivedAsync += (_, delivery) => HandleAsync(channel, delivery, stoppingToken);
                await channel.BasicConsumeAsync(queue.Name, autoAck: false, consumer, stoppingToken);
                logger.LogInformation("Consuming {Queue}", queue.Name);

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

    /// <summary>
    /// Handles one delivered message: picks the handler by routing key, runs it in a fresh service scope, then acknowledges the message.
    /// On failure it rejects the message so it goes to the retry queue, or, after <see cref="Topology.MaxAttempts"/> attempts, copies it to the dead queue (where failed messages are parked for a person) and acknowledges it.
    /// </summary>
    private async Task HandleAsync(IChannel channel, BasicDeliverEventArgs delivery, CancellationToken stoppingToken)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            switch (delivery.RoutingKey)
            {
                case FileUploaded.RoutingKey:
                    await scope.ServiceProvider.GetRequiredService<FileProcessor>().ProcessAsync(
                        Read<FileUploaded>(delivery), stoppingToken);
                    break;
                case Reviews.RevisionReleased.RoutingKey:
                    var released = Read<Reviews.RevisionReleased>(delivery);
                    await scope.ServiceProvider.GetRequiredService<Reviews.Stamping>().ProcessAsync(released, stoppingToken);
                    // Its own scope: stamping's unit of work is finished and committed.
                    await using (var next = scopes.CreateAsyncScope())
                    {
                        await next.ServiceProvider.GetRequiredService<Schedules.ScheduleImporter>().OnReleasedAsync(released, stoppingToken);
                    }
                    break;
                case Schedules.ScheduleImportRequested.RoutingKey:
                    await scope.ServiceProvider.GetRequiredService<Schedules.ScheduleImporter>().OnRequestedAsync(
                        Read<Schedules.ScheduleImportRequested>(delivery), stoppingToken);
                    break;
                case Checks.CheckRunRequested.RoutingKey:
                    await scope.ServiceProvider.GetRequiredService<Checks.CheckEngine>().ProcessAsync(
                        Read<Checks.CheckRunRequested>(delivery), stoppingToken);
                    break;
                case Extraction.FileExtract.RoutingKey:
                    await scope.ServiceProvider.GetRequiredService<Extraction.ExtractionProcessor>().ProcessAsync(
                        Read<Extraction.FileExtract>(delivery), stoppingToken);
                    break;
                default:
                    throw new InvalidOperationException($"No handler for {delivery.RoutingKey}");
            }
            await channel.BasicAckAsync(delivery.DeliveryTag, multiple: false, stoppingToken);
        }
        catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
        {
            var attempt = Attempts(delivery.BasicProperties) + 1;
            if (attempt >= Topology.MaxAttempts)
            {
                logger.LogError(ex, "Message {RoutingKey} failed {Attempts} times; parked in {Queue}", delivery.RoutingKey, attempt, Topology.FilesDeadQueue);
                Platform.AppMetrics.FileMessagesFailed.WithLabels("parked").Inc();
                await channel.BasicPublishAsync("", Topology.FilesDeadQueue, mandatory: false,
                    new BasicProperties
                    {
                        Persistent = true,
                        ContentType = "application/json",
                        Headers = new Dictionary<string, object?>
                        {
                            [Topology.RoutingKeyHeader] = delivery.RoutingKey,
                            ["x-error"] = ex.Message,
                        },
                    },
                    delivery.Body, stoppingToken);
                await channel.BasicAckAsync(delivery.DeliveryTag, multiple: false, stoppingToken);
            }
            else
            {
                logger.LogWarning(ex, "File message failed (attempt {Attempt}); retrying in {Delay}", attempt, Topology.RetryDelay);
                Platform.AppMetrics.FileMessagesFailed.WithLabels("retried").Inc();
                await channel.BasicNackAsync(delivery.DeliveryTag, multiple: false, requeue: false, stoppingToken);
            }
        }
    }

    /// <summary>Turns the message body (JSON) into the given message type; throws if the body is empty.</summary>
    private static T Read<T>(BasicDeliverEventArgs delivery) =>
        JsonSerializer.Deserialize<T>(delivery.Body.Span) ?? throw new InvalidOperationException("Empty message");

    /// <summary>How many times the message has already been rejected from this queue.</summary>
    private int Attempts(IReadOnlyBasicProperties properties)
    {
        if (properties.Headers?.TryGetValue("x-death", out var raw) != true || raw is not IEnumerable<object> deaths) return 0;
        foreach (var death in deaths.OfType<IDictionary<string, object?>>())
        {
            var name = death.TryGetValue("queue", out var q) && q is byte[] bytes ? System.Text.Encoding.UTF8.GetString(bytes) : null;
            if (name == queue.Name && death.TryGetValue("count", out var count) && count is long n) return (int)n;
        }
        return 0;
    }
}
