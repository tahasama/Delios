using System.Threading.Channels;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;

namespace Delios.Host.Documents;

/// <summary>
/// The second copy of the files (owner: "the changes are the ones who tell us"): where it is kept, the same place the
/// weekly full comparison writes to (deploy/file-backup, rclone): a folder (local) or an S3 bucket and path (s3).
/// </summary>
public sealed class BackupOptions
{
    public const string Section = "Backup";
    /// <summary>local (a folder) or s3; anything else: no copy made here (the weekly comparison still runs).</summary>
    public string? Target { get; set; }
    /// <summary>The folder (local), or "bucket/path" (s3).</summary>
    public string? Path { get; set; }
    public string? Endpoint { get; set; }
    public string? Region { get; set; }
    public string? AccessKey { get; set; }
    public string? SecretKey { get; set; }
}

/// <summary>
/// Copies each file to the second place as soon as it is stored (an upload kept after its check, a stamped or marked
/// copy, a file carried into a new submission), never overwriting what is there and never deleting: nothing asks the
/// stores what is new. Best effort in the process that stored it; what a stop loses, the weekly full comparison copies.
/// </summary>
public sealed class FileBackup(IObjectStore store, IOptions<BackupOptions> options, ILogger<FileBackup> logger) : BackgroundService
{
    private readonly Channel<string> queue = Channel.CreateUnbounded<string>();
    private AmazonS3Client? s3;

    private bool Enabled => options.Value.Target is "local" or "s3" && !string.IsNullOrWhiteSpace(options.Value.Path);

    /// <summary>A file was stored under this key: it is copied in the background.</summary>
    public void Post(string key)
    {
        if (Enabled && !key.StartsWith("incoming/", StringComparison.Ordinal)) queue.Writer.TryWrite(key);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var key in queue.Reader.ReadAllAsync(stoppingToken))
        {
            try { await CopyAsync(key, stoppingToken); }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "Copying {Key} to the second place failed; the weekly comparison copies it", key);
            }
        }
    }

    private async Task CopyAsync(string key, CancellationToken cancellationToken)
    {
        var o = options.Value;
        if (o.Target == "local")
        {
            var path = System.IO.Path.Combine(o.Path!, key);
            if (File.Exists(path)) return;
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!);
            var partial = path + ".part";
            await using (var from = await store.OpenReadAsync(key, cancellationToken))
            await using (var to = File.Create(partial))
                await from.CopyToAsync(to, cancellationToken);
            File.Move(partial, path, overwrite: false);
            return;
        }
        var (bucket, prefix) = Split(o.Path!);
        var name = string.IsNullOrEmpty(prefix) ? key : $"{prefix}/{key}";
        var client = s3 ??= new AmazonS3Client(new BasicAWSCredentials(o.AccessKey, o.SecretKey), new AmazonS3Config
        {
            ServiceURL = string.IsNullOrWhiteSpace(o.Endpoint) ? null : o.Endpoint,
            AuthenticationRegion = o.Region,
            ForcePathStyle = true,
        });
        try
        {
            await client.GetObjectMetadataAsync(bucket, name, cancellationToken);
            return;
        }
        catch (AmazonS3Exception e) when (e.StatusCode == System.Net.HttpStatusCode.NotFound) { }
        // Through a file of our own: the store's stream does not say its length, which an upload asks.
        var temp = System.IO.Path.GetTempFileName();
        try
        {
            await using (var from = await store.OpenReadAsync(key, cancellationToken))
            await using (var to = File.Create(temp))
                await from.CopyToAsync(to, cancellationToken);
            await client.PutObjectAsync(new PutObjectRequest { BucketName = bucket, Key = name, FilePath = temp }, cancellationToken);
        }
        finally { File.Delete(temp); }
    }

    private static (string Bucket, string Prefix) Split(string path)
    {
        var trimmed = path.Trim('/');
        var slash = trimmed.IndexOf('/');
        return slash < 0 ? (trimmed, "") : (trimmed[..slash], trimmed[(slash + 1)..]);
    }
}
