using StackExchange.Redis;

namespace Delios.Host.Documents;

/// <summary>
/// The second copy of the files (owner: "the changes are the ones who tell us"), made by the copier (deploy/file-backup,
/// rclone), never by the app (owner, security review): the app holds no key to the copy, so nothing that breaks into it
/// can reach or wipe the copy. Each file stored is said, by its key, on a list the copier waits on (Valkey,
/// <see cref="ListKey"/>); it copies each as it comes, never overwriting, never deleting, and its weekly full comparison
/// copies what a stop lost. What it copies is sealed (<see cref="FileCipher"/>): the copy is as unreadable as the store.
/// </summary>
public sealed class FileBackup(IServiceProvider services, ILogger<FileBackup> logger)
{
    /// <summary>The list the copier waits on: one key of a file just stored per entry.</summary>
    public const string ListKey = "files:to-copy";

    /// <summary>A file was stored under this key: the copier is told. Best effort: the weekly comparison catches a miss.</summary>
    public void Post(string key)
    {
        if (key.StartsWith("incoming/", StringComparison.Ordinal)) return;
        try
        {
            services.GetService<IConnectionMultiplexer>()?.GetDatabase().ListLeftPush(ListKey, key, flags: CommandFlags.FireAndForget);
        }
        catch (RedisException e)
        {
            logger.LogWarning(e, "The copier was not told of {Key}; the weekly comparison copies it", key);
        }
    }
}
