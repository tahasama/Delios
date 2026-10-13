using System.Text.RegularExpressions;
using Delios.Host.Platform;

namespace Delios.Host.Documents;

/// <summary>The rules every upload meets, whatever it is for.</summary>
public static partial class Uploads
{
    /// <summary>
    /// The upload as the client described it, after cleaning: a safe file name, the content type,
    /// the SHA-256 in lowercase, and whether it looks like a PDF.
    /// </summary>
    public sealed record Declared(string Name, string ContentType, string Sha256, bool IsPdf);

    /// <summary>
    /// Validates what a client says it is about to upload (name, size, checksum) before any upload link is issued.
    /// Returns the cleaned file description, or a problem response explaining what is wrong.
    /// Called by <see cref="DocumentService.RequestUploadAsync"/> and by the transmittal upload in <c>TransmittalService</c>.
    /// </summary>
    public static (Declared? File, IResult? Problem) Check(UploadRequest request, long maxBytes)
    {
        var name = Path.GetFileName(request.FileName?.Replace('\\', '/') ?? "").Trim();
        if (name.Length is 0 or > 255)
            return (null, Problems.Invalid("FILE_NAME_INVALID", "The file needs a name of up to 255 characters."));
        if (request.Size <= 0 || request.Size > maxBytes)
            return (null, Problems.Invalid("FILE_SIZE_INVALID", "The file is empty or larger than allowed.", new { max = maxBytes }));
        var sha256 = request.Sha256?.Trim().ToLowerInvariant() ?? "";
        if (!Sha256Pattern().IsMatch(sha256))
            return (null, Problems.Invalid("FILE_CHECKSUM_INVALID", "The SHA-256 must be 64 hexadecimal characters."));
        var contentType = string.IsNullOrWhiteSpace(request.ContentType) ? "application/octet-stream" : request.ContentType.Trim();
        if (contentType.Length > 200)
            return (null, Problems.Invalid("CONTENT_TYPE_INVALID", "The content type is longer than 200 characters."));
        var isPdf = contentType == "application/pdf" || name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase);
        return (new Declared(name, contentType, sha256, isPdf), null);
    }

    /// <summary>Null when the bytes are in storage and as many as were declared.</summary>
    public static async Task<IResult?> ArrivedAsync(FileStorage storage, StoredFile file, CancellationToken cancellationToken)
    {
        var stored = await storage.UploadedSizeAsync(file.ObjectKey, cancellationToken);
        if (stored is null)
            return Problems.Invalid("FILE_NOT_UPLOADED", $"{file.Name} has not been uploaded yet.", new { fileId = file.Id });
        if (stored != file.Size)
        {
            return Problems.Invalid("FILE_SIZE_MISMATCH",
                $"{file.Name} was declared as {file.Size} bytes but {stored} arrived.", new { fileId = file.Id });
        }
        return null;
    }

    /// <summary>
    /// Matches exactly 64 lowercase hexadecimal characters, the text form of a SHA-256 hash.
    /// The regular expression code is generated at build time.
    /// </summary>
    [GeneratedRegex("^[0-9a-f]{64}$")]
    private static partial Regex Sha256Pattern();
}
