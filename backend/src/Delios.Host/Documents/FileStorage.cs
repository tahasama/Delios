using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Sas;
using Delios.Host.Platform;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>An upload or download link a browser uses directly, and the headers it must send with it.</summary>
public sealed record SignedLink(string Url, Instant ExpiresAt, IReadOnlyDictionary<string, string> Headers);

/// <summary>Where file bytes live: an S3-compatible store or Azure Blob Storage, chosen by Storage:Provider.</summary>
public interface IObjectStore
{
    /// <summary>Makes a signed link that lets a browser upload (PUT) the bytes for one key until <paramref name="expires"/>.</summary>
    SignedLink SignUpload(string key, string contentType, Instant expires);
    /// <summary>Makes a signed link that lets a browser download one key, saved under <paramref name="fileName"/>, until <paramref name="expires"/>.</summary>
    string SignDownload(string key, string fileName, Instant expires);
    /// <summary>The stored size in bytes, or null when nothing is stored under the key.</summary>
    Task<long?> SizeAsync(string key, CancellationToken cancellationToken);
    /// <summary>Stores bytes the system made itself under a key.</summary>
    Task PutAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken);
    /// <summary>Opens the stored bytes for reading, from the start.</summary>
    Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken);
    /// <summary>True when the store answers and the bucket or container exists. Used by the health check.</summary>
    Task<bool> ReachableAsync(CancellationToken cancellationToken);
    /// <summary>Copies one object to another key inside the storage, without the bytes passing through the application.</summary>
    Task CopyAsync(string from, string to, CancellationToken cancellationToken);
    /// <summary>Deletes an object; nothing happens if it is not there.</summary>
    Task DeleteAsync(string key, CancellationToken cancellationToken);
}

/// <summary>
/// File bytes go between the browser and object storage directly, through
/// short-lived signed links. The API only signs, checks and records. Which store
/// holds them is a setting; nothing above this class knows.
/// </summary>
public sealed class FileStorage(IObjectStore store, IClock clock)
{
    /// <summary>How long an upload link stays valid.</summary>
    public static readonly Duration UploadWindow = Duration.FromMinutes(15);
    /// <summary>How long a download link stays valid.</summary>
    public static readonly Duration DownloadWindow = Duration.FromMinutes(5);

    /// <summary>The object key for a new file: tenant id, project id and file id joined by "/". Each file gets its own key.</summary>
    public static string KeyFor(Guid tenantId, Guid projectId, Guid fileId) => $"{tenantId}/{projectId}/{fileId}";

    /// <summary>
    /// Where a browser uploads a file before it is scanned. The upload link writes
    /// here, never to the file's own key: a link can be used again until it
    /// expires, so the bytes people later download must sit where no link reaches.
    /// </summary>
    public static string IncomingKey(string key) => $"incoming/{key}";

    /// <summary>A signed upload link for the key's incoming place, valid for <see cref="UploadWindow"/>. Called by <see cref="DocumentService.RequestUploadAsync"/>.</summary>
    public SignedLink PresignUpload(string key, string contentType) =>
        store.SignUpload(IncomingKey(key), contentType, clock.GetCurrentInstant() + UploadWindow);

    /// <summary>The size of what was uploaded for this key: still incoming, or already kept. Null when nothing arrived.</summary>
    public async Task<long?> UploadedSizeAsync(string key, CancellationToken cancellationToken) =>
        await store.SizeAsync(IncomingKey(key), cancellationToken) ?? await store.SizeAsync(key, cancellationToken);

    /// <summary>
    /// Moves an upload from its incoming place to the file's own key, which no
    /// upload link can write, before it is scanned. What is scanned is then exactly
    /// what is served. Called by the worker's file processing; safe to repeat.
    /// </summary>
    public async Task KeepAsync(string key, CancellationToken cancellationToken)
    {
        var incoming = IncomingKey(key);
        if (await store.SizeAsync(incoming, cancellationToken) is not null)
        {
            await store.CopyAsync(incoming, key, cancellationToken);
            await store.DeleteAsync(incoming, cancellationToken);
        }
        else if (await store.SizeAsync(key, cancellationToken) is null)
        {
            throw new InvalidOperationException($"Nothing was uploaded for {key}.");
        }
    }

    /// <summary>A signed download link for the key, valid for <see cref="DownloadWindow"/>, and when it expires.</summary>
    public (string Url, Instant ExpiresAt) PresignDownload(string key, string fileName)
    {
        var expires = clock.GetCurrentInstant() + DownloadWindow;
        return (store.SignDownload(key, fileName, expires), expires);
    }

    /// <summary>The stored size, or null when nothing was uploaded under the key.</summary>
    public Task<long?> SizeAsync(string key, CancellationToken cancellationToken) => store.SizeAsync(key, cancellationToken);

    /// <summary>Stores a file the system made itself, such as a stamped copy, under a new key.</summary>
    public Task PutAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken) =>
        store.PutAsync(key, content, contentType, cancellationToken);

    /// <summary>Opens the stored bytes for reading. Used by the worker to scan and check a file.</summary>
    public Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken) => store.OpenReadAsync(key, cancellationToken);

    /// <summary>
    /// The <c>Content-Disposition</c> header value that makes the browser save the file under its own name
    /// (UTF-8 encoded, so any characters work).
    /// </summary>
    public static string Attachment(string fileName) => $"attachment; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
}

/// <summary>Any S3-compatible store: SeaweedFS, Hetzner Object Storage, AWS S3, MinIO.</summary>
public sealed class S3ObjectStore(IAmazonS3 s3, IOptions<StorageOptions> options) : IObjectStore
{
    private readonly StorageOptions _options = options.Value;
    /// <summary>A second S3 client used only to sign links, set to the public address the browser will use.</summary>
    private readonly Lazy<AmazonS3Client> _signer = new(() => Signer(options.Value));

    /// <summary>A pre-signed PUT URL for the key. The browser must send the same <c>Content-Type</c>, which the link returns as a header.</summary>
    public SignedLink SignUpload(string key, string contentType, Instant expires)
    {
        var url = _signer.Value.GetPreSignedURL(new GetPreSignedUrlRequest
        {
            BucketName = _options.Bucket,
            Key = key,
            Verb = HttpVerb.PUT,
            ContentType = contentType,
            Expires = expires.ToDateTimeUtc(),
            Protocol = Protocol(_options.PublicEndpoint ?? _options.Endpoint!),
        });
        return new SignedLink(url, expires, new Dictionary<string, string> { ["Content-Type"] = contentType });
    }

    /// <summary>A pre-signed GET URL for the key that tells the browser to save the file under its own name.</summary>
    public string SignDownload(string key, string fileName, Instant expires)
    {
        var request = new GetPreSignedUrlRequest
        {
            BucketName = _options.Bucket,
            Key = key,
            Verb = HttpVerb.GET,
            Expires = expires.ToDateTimeUtc(),
            Protocol = Protocol(_options.PublicEndpoint ?? _options.Endpoint!),
        };
        request.ResponseHeaderOverrides.ContentDisposition = FileStorage.Attachment(fileName);
        return _signer.Value.GetPreSignedURL(request);
    }

    /// <summary>Asks S3 for the object's metadata (a HEAD request) and returns its size; null when it does not exist.</summary>
    public async Task<long?> SizeAsync(string key, CancellationToken cancellationToken)
    {
        try
        {
            var head = await s3.GetObjectMetadataAsync(_options.Bucket, key, cancellationToken);
            return head.ContentLength;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    /// <summary>Uploads the bytes to the bucket under the key.</summary>
    public async Task PutAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken)
    {
        using var body = new MemoryStream(content);
        await s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = _options.Bucket,
            Key = key,
            InputStream = body,
            ContentType = contentType,
        }, cancellationToken);
    }

    /// <summary>Starts downloading the object and returns its body as a stream; the caller must dispose it.</summary>
    public async Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken) =>
        (await s3.GetObjectAsync(_options.Bucket, key, cancellationToken)).ResponseStream;

    /// <summary>True when the configured bucket exists and answers.</summary>
    public Task<bool> ReachableAsync(CancellationToken cancellationToken) =>
        Amazon.S3.Util.AmazonS3Util.DoesS3BucketExistV2Async(s3, _options.Bucket);

    /// <summary>A server-side copy (files are at most 2 GB, inside the 5 GB a single copy allows).</summary>
    public async Task CopyAsync(string from, string to, CancellationToken cancellationToken) =>
        await s3.CopyObjectAsync(new CopyObjectRequest
        {
            SourceBucket = _options.Bucket,
            SourceKey = from,
            DestinationBucket = _options.Bucket,
            DestinationKey = to,
        }, cancellationToken);

    /// <summary>Deletes an object; S3 answers the same whether it was there or not.</summary>
    public async Task DeleteAsync(string key, CancellationToken cancellationToken) =>
        await s3.DeleteObjectAsync(_options.Bucket, key, cancellationToken);

    /// <summary>HTTP or HTTPS, from how the endpoint address starts.</summary>
    private static Amazon.S3.Protocol Protocol(string endpoint) =>
        endpoint.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ? Amazon.S3.Protocol.HTTP : Amazon.S3.Protocol.HTTPS;

    /// <summary>Signing needs no network; it only has to sign for the address the browser will use.</summary>
    private static AmazonS3Client Signer(StorageOptions storage) => new(
        new BasicAWSCredentials(storage.AccessKey, storage.SecretKey),
        new AmazonS3Config
        {
            ServiceURL = storage.PublicEndpoint ?? storage.Endpoint,
            AuthenticationRegion = storage.Region,
            ForcePathStyle = true,
        });
}

/// <summary>
/// Azure Blob Storage. Links are service SAS URLs signed with the account key, for
/// one blob, one permission, a few minutes. A browser upload must send
/// x-ms-blob-type: BlockBlob, which the ticket says.
/// </summary>
public sealed class AzureObjectStore(IOptions<StorageOptions> options) : IObjectStore
{
    private readonly StorageOptions _options = options.Value;
    private readonly Lazy<BlobContainerClient> _container = new(() =>
        new BlobContainerClient(options.Value.AzureConnectionString, options.Value.Bucket));

    private BlobContainerClient Container => _container.Value;

    /// <summary>
    /// A SAS (shared access signature: a URL carrying its own time-limited permission) for creating and writing one blob.
    /// The browser must also send <c>x-ms-blob-type: BlockBlob</c>, which the link returns as a header.
    /// </summary>
    public SignedLink SignUpload(string key, string contentType, Instant expires)
    {
        var sas = new BlobSasBuilder(BlobSasPermissions.Create | BlobSasPermissions.Write, expires.ToDateTimeOffset())
        {
            BlobContainerName = Container.Name,
            BlobName = key,
            Resource = "b",
        };
        return new SignedLink(Public(Container.GetBlobClient(key).GenerateSasUri(sas)), expires, new Dictionary<string, string>
        {
            ["Content-Type"] = contentType,
            ["x-ms-blob-type"] = "BlockBlob",
        });
    }

    /// <summary>A read-only SAS URL for one blob that tells the browser to save the file under its own name.</summary>
    public string SignDownload(string key, string fileName, Instant expires)
    {
        var sas = new BlobSasBuilder(BlobSasPermissions.Read, expires.ToDateTimeOffset())
        {
            BlobContainerName = Container.Name,
            BlobName = key,
            Resource = "b",
            ContentDisposition = FileStorage.Attachment(fileName),
        };
        return Public(Container.GetBlobClient(key).GenerateSasUri(sas));
    }

    /// <summary>Reads the blob's properties and returns its size; null when it does not exist.</summary>
    public async Task<long?> SizeAsync(string key, CancellationToken cancellationToken)
    {
        try
        {
            return (await Container.GetBlobClient(key).GetPropertiesAsync(cancellationToken: cancellationToken)).Value.ContentLength;
        }
        catch (Azure.RequestFailedException ex) when (ex.Status == 404)
        {
            return null;
        }
    }

    /// <summary>Uploads the bytes as a new blob; fails if a blob already exists under the key.</summary>
    public async Task PutAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken) =>
        // Never overwrites: a key is used once.
        await Container.GetBlobClient(key).UploadAsync(new BinaryData(content), new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders { ContentType = contentType },
            Conditions = new BlobRequestConditions { IfNoneMatch = Azure.ETag.All },
        }, cancellationToken);

    /// <summary>Starts downloading the blob and returns its content as a stream; the caller must dispose it.</summary>
    public async Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken) =>
        (await Container.GetBlobClient(key).DownloadStreamingAsync(cancellationToken: cancellationToken)).Value.Content;

    /// <summary>True when the configured container exists and answers.</summary>
    public async Task<bool> ReachableAsync(CancellationToken cancellationToken) =>
        (await Container.ExistsAsync(cancellationToken)).Value;

    /// <summary>
    /// Copies by streaming the blob through the worker, keeping its content type.
    /// One extra read of each upload; it works the same on Azure and on its emulator,
    /// which cannot fetch its own copy links.
    /// </summary>
    public async Task CopyAsync(string from, string to, CancellationToken cancellationToken)
    {
        var source = Container.GetBlobClient(from);
        var properties = (await source.GetPropertiesAsync(cancellationToken: cancellationToken)).Value;
        await using var content = await source.OpenReadAsync(cancellationToken: cancellationToken);
        await Container.GetBlobClient(to).UploadAsync(content, new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders { ContentType = properties.ContentType },
        }, cancellationToken);
    }

    /// <summary>Deletes a blob if it is there.</summary>
    public async Task DeleteAsync(string key, CancellationToken cancellationToken) =>
        await Container.GetBlobClient(key).DeleteIfExistsAsync(cancellationToken: cancellationToken);

    /// <summary>The address the browser uses, where it differs from the app's (a local emulator in Docker).</summary>
    private string Public(Uri signed)
    {
        if (string.IsNullOrEmpty(_options.PublicEndpoint)) return signed.ToString();
        var target = new Uri(_options.PublicEndpoint);
        return new UriBuilder(signed) { Scheme = target.Scheme, Host = target.Host, Port = target.Port }.Uri.ToString();
    }
}
