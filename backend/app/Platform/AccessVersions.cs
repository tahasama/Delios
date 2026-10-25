using Microsoft.Extensions.Caching.Memory;
using StackExchange.Redis;

namespace Delios.Host.Platform;

/// <summary>
/// "Who you are, what you may do" is kept until something it rests on changes (owner: "literally static once done and
/// barely rarely updated"): each organization has a number in Redis, raised by every committed change to how things
/// work (people, functions, rights, projects, organizations, settings, lists: what clears <c>all</c> on the screens,
/// <see cref="ScreenChangeWatcher"/>). What is kept is kept under that number, in each process's memory; a raised number
/// leaves the old copies unused. Every request still asks the number (one Redis read) and the backend still checks
/// every act: a copy never outlives the change that touched it. Redis unreachable: nothing is kept, read as before.
/// </summary>
public sealed class AccessVersions(IServiceProvider services, ILogger<AccessVersions> logger)
{
    private IConnectionMultiplexer? Redis => services.GetService<IConnectionMultiplexer>();

    /// <summary>What is kept, in this process's memory, at most 50,000 people's projects (the least used drop first).</summary>
    public Microsoft.Extensions.Caching.Memory.MemoryCache Kept { get; } = new(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions { SizeLimit = 50_000 });

    private static RedisKey Key(Guid tenantId) => $"access:v:{tenantId:N}";

    /// <summary>The organization's number now; null when Redis cannot say (then nothing is kept).</summary>
    public async Task<string?> CurrentAsync(Guid tenantId)
    {
        try
        {
            if (Redis is not { IsConnected: true } redis) return null;
            var value = await redis.GetDatabase().StringGetAsync(Key(tenantId));
            return value.IsNull ? "0" : value.ToString();
        }
        catch (Exception e)
        {
            logger.LogDebug(e, "Reading the access number failed: nothing kept");
            return null;
        }
    }

    /// <summary>After a committed change to how things work: every kept copy of these organizations stops being used.</summary>
    public void Raise(IEnumerable<Guid> tenantIds)
    {
        try
        {
            if (Redis is not { IsConnected: true } redis) return;
            var db = redis.GetDatabase();
            foreach (var tenantId in tenantIds) db.StringIncrement(Key(tenantId), flags: CommandFlags.FireAndForget);
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Raising the access number failed");
        }
    }

    /// <summary>
    /// An answer the same for everyone who may ask it (the organization's lists and values as a project reads them):
    /// read once and given to every one of them until how the organization works changes (owner: "shared reference
    /// data", "one read instead of 200"). Never for an answer that depends on who asks.
    /// </summary>
    public async Task<T> SharedAsync<T>(Guid tenantId, string question, Func<Task<T>> read) where T : notnull
    {
        var version = await CurrentAsync(tenantId);
        if (version is null) return await read();
        var key = $"shared:{tenantId:N}:{version}:{question}";
        if (Kept.TryGetValue(key, out T? kept) && kept is not null) return kept;
        var answer = await read();
        Kept.Set(key, answer, new Microsoft.Extensions.Caching.Memory.MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = Identity.ProjectAccessLoader.KeptAtMost,
            Size = 1,
        });
        return answer;
    }
}
