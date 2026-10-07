using NodaTime;

namespace Delios.Host.Messaging;

/// <summary>
/// A message written in the same transaction as the change that causes it, then
/// relayed to RabbitMQ. If the change rolls back, the message never existed;
/// if the relay is down, it waits here.
/// </summary>
public sealed class OutboxMessage
{
    public long Id { get; set; }
    public required string RoutingKey { get; set; }
    public required string Payload { get; set; }
    public Instant CreatedAt { get; set; }
    public Instant? SentAt { get; set; }
}
