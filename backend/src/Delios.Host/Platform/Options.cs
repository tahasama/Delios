using System.ComponentModel.DataAnnotations;

namespace Delios.Host.Platform;

/// <summary>The two roles one process can run in, set by <c>Delios:Role</c> in the configuration.</summary>
public static class Roles
{
    /// <summary>Serves HTTP requests.</summary>
    public const string Api = "api";

    /// <summary>Consumes the queues: scanning, stamping, issue, email, scheduled checks.</summary>
    public const string Worker = "worker";
}

/// <summary>The role this process runs in. The same build runs as either.</summary>
public sealed class DeliosOptions
{
    /// <summary>Name of the configuration section these settings are read from.</summary>
    public const string Section = "Delios";

    /// <summary>"api" or "worker" (see <c>Roles</c>). Checked at start-up; any other value stops the app.</summary>
    [Required, AllowedValues(Roles.Api, Roles.Worker)]
    public string Role { get; set; } = Roles.Api;
}

/// <summary>
/// Addresses and credentials of the services the app connects to, read from the "ConnectionStrings" section. Checked at start-up.
/// </summary>
public sealed class ConnectionStringsOptions
{
    /// <summary>Name of the configuration section these settings are read from.</summary>
    public const string Section = "ConnectionStrings";

    /// <summary>The main PostgreSQL database (Npgsql connection string). Required.</summary>
    [Required] public string Postgres { get; set; } = "";
    /// <summary>
    /// A read replica (the standby). When set, register pages read from it; when
    /// empty or unreachable, they read from the primary.
    /// </summary>
    public string? PostgresReadOnly { get; set; }
    /// <summary>Redis, used as the shared cache (for example for session checks). Required.</summary>
    [Required] public string Redis { get; set; } = "";
    /// <summary>RabbitMQ, the message queue between the API and the worker, as an <c>amqp://</c> URI. Required.</summary>
    [Required] public string RabbitMq { get; set; } = "";
}

/// <summary>Any S3-compatible store: Hetzner Object Storage in production, SeaweedFS in development.</summary>
public sealed class StorageOptions : IValidatableObject
{
    /// <summary>Name of the configuration section these settings are read from.</summary>
    public const string Section = "Storage";
    /// <summary>Value of <c>Provider</c> for an S3-compatible store.</summary>
    public const string S3 = "s3";
    /// <summary>Value of <c>Provider</c> for Azure Blob Storage.</summary>
    public const string Azure = "azure";

    /// <summary>s3 (any S3-compatible store: SeaweedFS, Hetzner, AWS, MinIO) or azure (Azure Blob Storage).</summary>
    public string Provider { get; set; } = S3;
    /// <summary>The S3 service address the app uses. Required for S3; not used for Azure.</summary>
    [Url] public string? Endpoint { get; set; }
    /// <summary>
    /// The address browsers use for presigned URLs, when it differs from the one
    /// the app uses (in Docker, the app reaches storage by service name).
    /// </summary>
    [Url] public string? PublicEndpoint { get; set; }
    /// <summary>The largest single upload accepted.</summary>
    [Range(1, 5L * 1024 * 1024 * 1024)] public long MaxFileBytes { get; set; } = 2L * 1024 * 1024 * 1024;
    /// <summary>The bucket, or for Azure the container.</summary>
    [Required] public string Bucket { get; set; } = "";
    /// <summary>S3 access key id. Required for S3.</summary>
    public string? AccessKey { get; set; }
    /// <summary>S3 secret access key. Required for S3.</summary>
    public string? SecretKey { get; set; }
    /// <summary>S3 region name. Many S3-compatible stores accept any value.</summary>
    public string Region { get; set; } = "us-east-1";
    /// <summary>For Azure: the storage account's connection string, with its account key (it signs upload and download links).</summary>
    public string? AzureConnectionString { get; set; }

    /// <summary>True when <c>Provider</c> is "azure".</summary>
    public bool UsesAzure => string.Equals(Provider, Azure, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Checks the settings that depend on the provider (called by the options validation at start-up): Azure needs a connection string,
    /// S3 needs an endpoint and keys, and any other provider is refused.
    /// </summary>
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (UsesAzure)
        {
            if (string.IsNullOrWhiteSpace(AzureConnectionString))
                yield return new ValidationResult("Storage:AzureConnectionString is required for Azure.", [nameof(AzureConnectionString)]);
        }
        else if (!string.Equals(Provider, S3, StringComparison.OrdinalIgnoreCase))
        {
            yield return new ValidationResult("Storage:Provider is s3 or azure.", [nameof(Provider)]);
        }
        else
        {
            if (string.IsNullOrWhiteSpace(Endpoint)) yield return new ValidationResult("Storage:Endpoint is required.", [nameof(Endpoint)]);
            if (string.IsNullOrWhiteSpace(AccessKey) || string.IsNullOrWhiteSpace(SecretKey))
                yield return new ValidationResult("Storage:AccessKey and Storage:SecretKey are required.", [nameof(AccessKey)]);
        }
    }
}

/// <summary>
/// Where to reach clamd, the ClamAV virus scanner service that checks every uploaded file. Read from the "ClamAv" section.
/// </summary>
public sealed class ClamAvOptions
{
    /// <summary>Name of the configuration section these settings are read from.</summary>
    public const string Section = "ClamAv";

    /// <summary>Host name or IP address of clamd. Required.</summary>
    [Required] public string Host { get; set; } = "";
    /// <summary>TCP port of clamd (3310 by default).</summary>
    [Range(1, 65535)] public int Port { get; set; } = 3310;
}
