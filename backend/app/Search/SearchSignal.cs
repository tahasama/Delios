using StackExchange.Redis;

namespace Delios.Host.Search;

/// <summary>
/// "This organization's register changed": said by whichever process saved a document (the API or the worker), heard
/// by the search indexer in the worker, which then sends that organization's changes, and nothing else, to the index.
/// Through the app's Redis, so it crosses processes. Best effort: the indexer also catches up once an hour.
/// </summary>
public sealed class SearchSignal(IServiceProvider services, Microsoft.Extensions.Options.IOptions<SearchOptions> options, ILogger<SearchSignal> logger)
{
    private static readonly RedisChannel Channel = RedisChannel.Literal("delios:search");

    /// <summary>Reached only when first used: nothing that saves waits on Redis being there.</summary>
    private IConnectionMultiplexer Redis => services.GetRequiredService<IConnectionMultiplexer>();

    public void Publish(IEnumerable<Guid> tenantIds)
    {
        // No index, nobody listening: nothing is said.
        if (!options.Value.UsesOpenSearch) return;
        foreach (var tenantId in tenantIds.Distinct())
        {
            try { Redis.GetSubscriber().Publish(Channel, tenantId.ToString(), CommandFlags.FireAndForget); }
            catch (Exception e) { logger.LogDebug(e, "Saying the register changed failed; the hourly catch-up sends it"); }
        }
    }

    public Task SubscribeAsync(Action<Guid> heard) =>
        Redis.GetSubscriber().SubscribeAsync(Channel, (_, value) => { if (Guid.TryParse(value.ToString(), out var id)) heard(id); });
}
