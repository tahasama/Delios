using System.IO.Compression;
using System.Text;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;

namespace Delios.Host.Documents;

/// <summary>Body of checking a spreadsheet before it is read: its name and its bytes.</summary>
public sealed record SheetCheckRequest(string? FileName, string? ContentBase64);

/// <summary>
/// Every spreadsheet brought in to be read (the schedule's lists, a deliverable list, a team, the matrix, the Settings
/// lists) passes here first, once, before anything reads it. Documents are scanned on their own way in
/// (<see cref="FileProcessor"/>); a list is read at once, so it is checked at once, and refused when it cannot be:
/// <list type="bullet">
/// <item>it is what its name says: a workbook is a zip, a CSV is text (a program or a renamed file is refused);</item>
/// <item>a workbook unpacks to a sane size and number of parts (a "zip bomb" is refused) and carries no macros;</item>
/// <item>the virus scanner finds nothing; when the scanner cannot be reached, the file waits: it is refused, said so.</item>
/// </list>
/// </summary>
public static class SheetGuard
{
    /// <summary>The largest list read: 20 MB as uploaded.</summary>
    public const int MaxBytes = 20 * 1024 * 1024;
    /// <summary>What a workbook may unpack to, and how many parts it may hold.</summary>
    private const long MaxUnpacked = 200L * 1024 * 1024;
    private const int MaxParts = 5000;
    /// <summary>The most rows and columns a sheet is read to.</summary>
    public const int MaxRows = 100_000;
    public const int MaxColumns = 500;

    /// <summary>Null when the file may be read; else the refusal, in plain words.</summary>
    public static async Task<IResult?> RefusalAsync(string fileName, byte[] bytes, IVirusScanner scanner, CancellationToken cancellationToken)
    {
        if (bytes.Length == 0) return Problems.Invalid("FILE_EMPTY", "The file is empty.");
        if (bytes.Length > MaxBytes) return Problems.Invalid("FILE_TOO_LARGE", "The file is larger than 20 MB.");
        var workbook = fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase);
        var csv = fileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase);
        if (!workbook && !csv) return Problems.Invalid("FILE_TYPE", "Bring the list as a workbook (.xlsx) or a CSV.");

        var kind = FileSniffer.Detect(bytes.AsSpan(0, Math.Min(bytes.Length, 16)));
        if (workbook)
        {
            if (kind != "application/zip")
                return Problems.Invalid("FILE_NOT_WHAT_IT_SAYS", $"{fileName} is not a workbook, whatever its name says. Save it from Excel as .xlsx and try again.");
            if (WorkbookProblem(bytes) is { } problem) return Problems.Invalid("WORKBOOK_REFUSED", problem);
        }
        else if (kind != "application/octet-stream" || LooksBinary(bytes))
        {
            return Problems.Invalid("FILE_NOT_WHAT_IT_SAYS", $"{fileName} is not a text CSV, whatever its name says. Save it as CSV and try again.");
        }

        ScanResult scan;
        try
        {
            using var content = new MemoryStream(bytes, writable: false);
            scan = await scanner.ScanAsync(content, cancellationToken);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return Problems.Problem(StatusCodes.Status503ServiceUnavailable, "SCAN_UNAVAILABLE",
                "The virus check cannot be reached just now, so the file was not read. Try again in a few minutes.", null);
        }
        if (scan.Infected)
            return Problems.Invalid("FILE_INFECTED", $"The virus check found {scan.Signature} in {fileName}. Nothing was read from it.");
        return null;
    }

    /// <summary>A workbook's parts: within size, no macros, and the parts a workbook has.</summary>
    private static string? WorkbookProblem(byte[] bytes)
    {
        try
        {
            using var zip = new ZipArchive(new MemoryStream(bytes, writable: false), ZipArchiveMode.Read);
            if (zip.Entries.Count > MaxParts) return "The workbook holds too many parts to be a list. Save the list on its own and try again.";
            long unpacked = 0;
            var workbook = false;
            foreach (var entry in zip.Entries)
            {
                unpacked += entry.Length;
                if (unpacked > MaxUnpacked) return "The workbook unpacks to far more than a list holds. Save the list on its own and try again.";
                var name = entry.FullName.Replace('\\', '/');
                if (name.Equals("xl/workbook.xml", StringComparison.OrdinalIgnoreCase)) workbook = true;
                if (name.EndsWith("vbaProject.bin", StringComparison.OrdinalIgnoreCase))
                    return "The workbook carries macros. Save it as a plain workbook (.xlsx, without macros) and try again.";
            }
            return workbook ? null : "This zip is not an Excel workbook. Save the list from Excel as .xlsx and try again.";
        }
        catch (InvalidDataException)
        {
            return "The workbook is damaged and cannot be opened. Save it again from Excel and try again.";
        }
    }

    /// <summary>Text has no NUL bytes; a program or an image does, early on.</summary>
    private static bool LooksBinary(byte[] bytes)
    {
        var head = bytes.AsSpan(0, Math.Min(bytes.Length, 8192));
        if (head.IndexOf((byte)0) >= 0) return true;
        // UTF-16 text has NULs, and is refused above; anything else is read as UTF-8 or the Windows code page.
        return head.Length >= 2 && head[0] == (byte)'M' && head[1] == (byte)'Z';
    }

    /// <summary>
    /// <c>POST /api/projects/{projectId}/sheets/check</c>: the same check, for the lists read on the screens (Import &amp;
    /// export, Controlled changes): 204 when the file may be read, else the refusal. Our own organization's people only.
    /// </summary>
    public static void MapSheetGuardEndpoints(this IEndpointRouteBuilder app) =>
        app.MapGroup("/api/projects/{projectId:guid}").WithTags("Files")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>()
            .MapPost("/sheets/check", async (SheetCheckRequest request, HttpContext http, IVirusScanner scanner, CancellationToken cancellationToken) =>
            {
                if (!ProjectAccessFilter.Of(http).IsInternal)
                    return Problems.Forbidden("OURS_ONLY", "Lists are brought in by our own organization's people.");
                byte[] bytes;
                try { bytes = Convert.FromBase64String(request.ContentBase64 ?? ""); }
                catch (FormatException) { return Problems.Invalid("FILE_UNREADABLE", "The file did not arrive whole. Try again."); }
                return await RefusalAsync(Path.GetFileName(request.FileName ?? ""), bytes, scanner, cancellationToken) ?? Results.NoContent();
            });
}
