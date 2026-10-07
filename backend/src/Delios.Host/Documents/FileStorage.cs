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
    SignedLink SignUpload(string key, string contentType, Instant expires);
    string SignDownload(string key, string fileName, Instant expires);
    Task<long?> SizeAsync(string key, CancellationToken cancellationToken);
    Task PutAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken);
    Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken);
    Task<bool> ReachableAsync(CancellationToken cancellationToken);
}

/// <summary>
/// File bytes go between the browser and object storage directly, through
/// short-lived signed links. The API only signs, checks and records. Which store
/// holds them is a setting; nothing above this class knows.
/// </summary>
public sealed class FileStorage(IObjectStore store, IClock clock)
{
    public static readonly Duration UploadWindow = Duration.FromMinutes(15);
    public static readonly Duration DownloadWindow = Duration.FromMinutes(5);

    public static string KeyFor(Guid tenantId, Guid projectId, Guid fileId) => $"{tenantId}/{projectId}/{fileId}";

    public SignedLink PresignUpload(string key, string contentType) =>
        store.SignUpload(key, contentType, clock.GetCurrentInstant() + UploadWindow);

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

    public Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken) => store.OpenReadAsync(key, cancellationToken);

    public static string Attachment(string fileName) => $"attachment; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
}

/// <summary>Any S3-compatible store: SeaweedFS, Hetzner Object Storage, AWS S3, MinIO.</summary>
public sealed class S3ObjectStore(IAmazonS3 s3, IOptions<StorageOptions> options) : IObjectStore
{
    private readonly StorageOptions _options = options.Value;
    private readonly Lazy<AmazonS3Client> _signer = new(() => Signer(options.Value));

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

    public async Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken) =>
        (await s3.GetObjectAsync(_options.Bucket, key, cancellationToken)).ResponseStream;

    public Task<bool> ReachableAsync(CancellationToken cancellationToken) =>
        Amazon.S3.Util.AmazonS3Util.DoesS3BucketExistV2Async(s3, _options.Bucket);

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

    public async Task PutAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken) =>
        // Never overwrites: a key is used once.
        await Container.GetBlobClient(key).UploadAsync(new BinaryData(content), new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders { ContentType = contentType },
            Conditions = new BlobRequestConditions { IfNoneMatch = Azure.ETag.All },
        }, cancellationToken);

    public async Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken) =>
        (await Container.GetBlobClient(key).DownloadStreamingAsync(cancellationToken: cancellationToken)).Value.Content;

    public async Task<bool> ReachableAsync(CancellationToken cancellationToken) =>
        (await Container.ExistsAsync(cancellationToken)).Value;

    /// <summary>The address the browser uses, where it differs from the app's (a local emulator in Docker).</summary>
    private string Public(Uri signed)
    {
        if (string.IsNullOrEmpty(_options.PublicEndpoint)) return signed.ToString();
        var target = new Uri(_options.PublicEndpoint);
        return new UriBuilder(signed) { Scheme = target.Scheme, Host = target.Host, Port = target.Port }.Uri.ToString();
    }
}
