using System.ComponentModel.DataAnnotations;

namespace Delios.Host.Platform;

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
    public const string Section = "Delios";

    [Required, AllowedValues(Roles.Api, Roles.Worker)]
    public string Role { get; set; } = Roles.Api;
}

public sealed class ConnectionStringsOptions
{
    public const string Section = "ConnectionStrings";

    [Required] public string Postgres { get; set; } = "";
    /// <summary>
    /// A read replica (the standby). When set, register pages read from it; when
    /// empty or unreachable, they read from the primary.
    /// </summary>
    public string? PostgresReadOnly { get; set; }
    [Required] public string Redis { get; set; } = "";
    [Required] public string RabbitMq { get; set; } = "";
}

/// <summary>Any S3-compatible store: Hetzner Object Storage in production, SeaweedFS in development.</summary>
public sealed class StorageOptions : IValidatableObject
{
    public const string Section = "Storage";
    public const string S3 = "s3";
    public const string Azure = "azure";

    /// <summary>s3 (any S3-compatible store: SeaweedFS, Hetzner, AWS, MinIO) or azure (Azure Blob Storage).</summary>
    public string Provider { get; set; } = S3;
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
    public string? AccessKey { get; set; }
    public string? SecretKey { get; set; }
    public string Region { get; set; } = "us-east-1";
    /// <summary>For Azure: the storage account's connection string, with its account key (it signs upload and download links).</summary>
    public string? AzureConnectionString { get; set; }

    public bool UsesAzure => string.Equals(Provider, Azure, StringComparison.OrdinalIgnoreCase);

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

public sealed class ClamAvOptions
{
    public const string Section = "ClamAv";

    [Required] public string Host { get; set; } = "";
    [Range(1, 65535)] public int Port { get; set; } = 3310;
}
