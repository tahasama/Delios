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
    [Required] public string Redis { get; set; } = "";
    [Required] public string RabbitMq { get; set; } = "";
}

/// <summary>Any S3-compatible store: Hetzner Object Storage in production, SeaweedFS in development.</summary>
public sealed class StorageOptions
{
    public const string Section = "Storage";

    [Required, Url] public string Endpoint { get; set; } = "";
    /// <summary>
    /// The address browsers use for presigned URLs, when it differs from the one
    /// the app uses (in Docker, the app reaches storage by service name).
    /// </summary>
    [Url] public string? PublicEndpoint { get; set; }
    /// <summary>The largest single upload accepted.</summary>
    [Range(1, 5L * 1024 * 1024 * 1024)] public long MaxFileBytes { get; set; } = 2L * 1024 * 1024 * 1024;
    [Required] public string Bucket { get; set; } = "";
    [Required] public string AccessKey { get; set; } = "";
    [Required] public string SecretKey { get; set; } = "";
    public string Region { get; set; } = "us-east-1";
}

public sealed class ClamAvOptions
{
    public const string Section = "ClamAv";

    [Required] public string Host { get; set; } = "";
    [Range(1, 65535)] public int Port { get; set; } = 3310;
}
