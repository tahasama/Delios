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
    /// <summary>Which kind of message this is (for example <c>file.uploaded</c>); RabbitMQ uses it to pick the queue.</summary>
    public required string RoutingKey { get; set; }
    /// <summary>The message body, serialized as JSON.</summary>
    public required string Payload { get; set; }
    /// <summary>When the message was written; set by the database.</summary>
    public Instant CreatedAt { get; set; }
    /// <summary>When the relay sent it to RabbitMQ; null means not sent yet.</summary>
    public Instant? SentAt { get; set; }
}
