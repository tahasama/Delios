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
}
