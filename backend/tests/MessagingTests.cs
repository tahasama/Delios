using System.Text;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Microsoft.Extensions.DependencyInjection;
using RabbitMQ.Client;

namespace Delios.Tests;

public sealed class MessagingTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task A_message_no_queue_takes_is_parked_with_its_key_and_does_not_block_the_others()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        await using (var scope = app.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            db.Enqueue("nobody.listens", new { hello = "world" });
            await db.SaveChangesAsync();
        }

        // Behind it, ordinary work still flows: an upload is scanned.
        var engineer = await app.SignedInAsync("engineer@demo.local");
        await Flow.RevisionAsync(engineer);

        var factory = new ConnectionFactory { Uri = new Uri(infrastructure.RabbitMq.GetConnectionString()) };
        await using var connection = await factory.CreateConnectionAsync();
        await using var channel = await connection.CreateChannelAsync();
        BasicGetResult? parked = null;
        for (var i = 0; i < 50 && parked is null; i++)
        {
            parked = await channel.BasicGetAsync(Topology.FilesDeadQueue, autoAck: true);
            if (parked is null) await Task.Delay(100);
        }
        Assert.NotNull(parked);
        var key = parked.BasicProperties.Headers![Topology.RoutingKeyHeader];
        Assert.Equal("nobody.listens", Encoding.UTF8.GetString((byte[])key!));
        Assert.Contains("world", Encoding.UTF8.GetString(parked.Body.ToArray()));
    }
}
