using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Delios.Host.Platform;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>
/// File bytes go between the browser and object storage directly, through
/// short-lived presigned URLs. The API only signs, checks and records.
/// </summary>
public sealed class FileStorage(IAmazonS3 s3, IOptions<StorageOptions> options, IClock clock)
{
    public static readonly Duration UploadWindow = Duration.FromMinutes(15);
    public static readonly Duration DownloadWindow = Duration.FromMinutes(5);

    private readonly StorageOptions _options = options.Value;
    private readonly Lazy<AmazonS3Client> _signer = new(() => Signer(options.Value));

    public static string KeyFor(Guid tenantId, Guid projectId, Guid fileId) => $"{tenantId}/{projectId}/{fileId}";

    public (string Url, Instant ExpiresAt) PresignUpload(string key, string contentType)
    {
        var expires = clock.GetCurrentInstant() + UploadWindow;
        var url = _signer.Value.GetPreSignedURL(new GetPreSignedUrlRequest
        {
            BucketName = _options.Bucket,
            Key = key,
            Verb = HttpVerb.PUT,
            ContentType = contentType,
            Expires = expires.ToDateTimeUtc(),
            Protocol = Protocol(_options.PublicEndpoint ?? _options.Endpoint),
        });
        return (url, expires);
    }

    public (string Url, Instant ExpiresAt) PresignDownload(string key, string fileName)
    {
        var expires = clock.GetCurrentInstant() + DownloadWindow;
        var request = new GetPreSignedUrlRequest
        {
            BucketName = _options.Bucket,
            Key = key,
            Verb = HttpVerb.GET,
            Expires = expires.ToDateTimeUtc(),
            Protocol = Protocol(_options.PublicEndpoint ?? _options.Endpoint),
        };
        request.ResponseHeaderOverrides.ContentDisposition =
            $"attachment; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
        return (_signer.Value.GetPreSignedURL(request), expires);
    }

    /// <summary>The stored size, or null when nothing was uploaded under the key.</summary>
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

    /// <summary>Stores a file the system made itself, such as a stamped copy, under a new key.</summary>
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

    public async Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken)
    {
        var response = await s3.GetObjectAsync(_options.Bucket, key, cancellationToken);
        return response.ResponseStream;
    }

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
