using System.Text.RegularExpressions;
using Delios.Host.Platform;

namespace Delios.Host.Documents;

/// <summary>The rules every upload meets, whatever it is for.</summary>
public static partial class Uploads
{
    public sealed record Declared(string Name, string ContentType, string Sha256, bool IsPdf);

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
        var isPdf = contentType == "application/pdf" || name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase);
        return (new Declared(name, contentType, sha256, isPdf), null);
    }

    /// <summary>Null when the bytes are in storage and as many as were declared.</summary>
    public static async Task<IResult?> ArrivedAsync(FileStorage storage, StoredFile file, CancellationToken cancellationToken)
    {
        var stored = await storage.SizeAsync(file.ObjectKey, cancellationToken);
        if (stored is null)
            return Problems.Invalid("FILE_NOT_UPLOADED", $"{file.Name} has not been uploaded yet.", new { fileId = file.Id });
        if (stored != file.Size)
        {
            return Problems.Invalid("FILE_SIZE_MISMATCH",
                $"{file.Name} was declared as {file.Size} bytes but {stored} arrived.", new { fileId = file.Id });
        }
        return null;
    }

    [GeneratedRegex("^[0-9a-f]{64}$")]
    private static partial Regex Sha256Pattern();
}
