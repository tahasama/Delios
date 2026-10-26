using System.Text;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Microsoft.Extensions.Options;

namespace Delios.Host.Documents;

/// <summary>Where files are turned into something the page shows, from the <c>Previews</c> section of configuration.</summary>
public sealed class PreviewOptions
{
    public const string Section = "Previews";
    /// <summary>Office files to PDF (Gotenberg, LibreOffice inside). Empty: not installed, office files are downloaded.</summary>
    public string? OfficeUrl { get; set; }
    /// <summary>DWG to DXF (LibreDWG, deploy/dwg). Empty: not installed, DWG files are downloaded.</summary>
    public string? DwgUrl { get; set; }
    /// <summary>How long a conversion may take, in seconds.</summary>
    public int TimeoutSeconds { get; set; } = 120;
}

/// <summary>
/// The Preview of files the page cannot draw by itself (owner: "build all including the dwg workaround"): Word,
/// PowerPoint and their kin turned into a PDF (faithful, by LibreOffice), a DWG drawing into DXF (by LibreDWG, then drawn
/// in the page; the free route, its quality depends on the drawing), and plain text read as text. Each result is kept
/// in storage beside the file (<c>previews/…</c>), made once, the first time it is opened. Nothing in a file runs.
/// </summary>
public static class Previews
{
    public const string HttpClientName = "previews";

    /// <summary>Office files LibreOffice turns into a PDF.</summary>
    private static readonly string[] Office = [".doc", ".docx", ".docm", ".odt", ".rtf", ".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".odp", ".vsd", ".vsdx", ".odg"];
    /// <summary>Plain text, shown as it is.</summary>
    private static readonly string[] Text = [".txt", ".log", ".json", ".xml", ".md", ".ini", ".cfg", ".conf", ".yaml", ".yml", ".tsv"];
    private const long MaxText = 2 * 1024 * 1024;
    /// <summary>Raised whenever the DWG converter reads drawings better (v2: multi-line texts mended, deploy/dwg/server.py).</summary>
    private const string DxfVersion = "v2";

    private static bool Is(string name, string[] extensions) => extensions.Contains(Path.GetExtension(name).ToLowerInvariant());
    private static string KeyOf(StoredFile file, string extension) => $"previews/{file.TenantId}/{file.ProjectId}/{file.Id}{extension}";

    public static void Map(RouteGroupBuilder project)
    {
        project.MapGet("/files/{fileId:guid}/as-pdf", AsPdfAsync);
        project.MapGet("/files/{fileId:guid}/as-dxf", AsDxfAsync);
        project.MapGet("/files/{fileId:guid}/text", TextAsync);
        project.MapGet("/files/{fileId:guid}/page.png", FirstPageAsync);
    }

    /// <summary><c>GET /files/{fileId}/as-pdf</c>: a Word, PowerPoint or other office file as a PDF, made once.</summary>
    private static async Task<IResult> AsPdfAsync(Guid fileId, HttpContext http, DeliosDbContext db, Transmittals.TransmittalService transmittals,
        FileStorage storage, IHttpClientFactory clients, IOptions<PreviewOptions> options, CancellationToken cancellationToken)
    {
        var (file, refused) = await DocumentEndpoints.ReadableAsync(fileId, ProjectAccessFilter.Of(http), db, transmittals, cancellationToken);
        if (file is null) return refused!;
        if (!Is(file.Name, Office)) return Problems.Invalid("NOT_AN_OFFICE_FILE", $"{file.Name} is not a Word or PowerPoint file: download it to open it.");
        if (await Viewers.OffRefusalAsync(db, ProjectAccessFilter.Of(http).Project.Id, Viewers.Office, file.Name, options.Value, cancellationToken) is { } off) return off;
        var key = KeyOf(file, ".pdf");
        if (await storage.SizeAsync(key, cancellationToken) is null)
        {
            if (string.IsNullOrWhiteSpace(options.Value.OfficeUrl))
                return Problems.Invalid("PREVIEW_NOT_INSTALLED", $"Word and PowerPoint files are not shown in the page here: their PDF is the revision's; download {file.Name} to open it.");
            byte[] pdf;
            try
            {
                using var form = new MultipartFormDataContent();
                await using var source = await storage.OpenReadAsync(file.ObjectKey, cancellationToken);
                form.Add(new StreamContent(source), "files", SafeName(file.Name));
                using var client = clients.CreateClient(HttpClientName);
                using var answer = await client.PostAsync($"{options.Value.OfficeUrl!.TrimEnd('/')}/forms/libreoffice/convert", form, cancellationToken);
                if (!answer.IsSuccessStatusCode)
                    return Problems.Invalid("PREVIEW_FAILED", $"{file.Name} could not be turned into a PDF (it may be damaged or protected by a password): download it to open it.");
                pdf = await answer.Content.ReadAsByteArrayAsync(cancellationToken);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
            {
                return Problems.Invalid("PREVIEW_UNREACHABLE", $"The converter did not answer: download {file.Name} to open it, or try again in a moment.");
            }
            await storage.PutAsync(key, pdf, "application/pdf", cancellationToken);
        }
        var content = await storage.OpenReadAsync(key, cancellationToken);
        return Results.File(content, "application/pdf", Path.ChangeExtension(file.Name, ".pdf"));
    }

    /// <summary><c>GET /files/{fileId}/as-dxf</c>: a drawing as DXF, the page's drawing viewer reads it: a DXF as it is, a DWG converted once.</summary>
    private static async Task<IResult> AsDxfAsync(Guid fileId, HttpContext http, DeliosDbContext db, Transmittals.TransmittalService transmittals,
        FileStorage storage, IHttpClientFactory clients, IOptions<PreviewOptions> options, CancellationToken cancellationToken,
        bool minimal = false)
    {
        var (file, refused) = await DocumentEndpoints.ReadableAsync(fileId, ProjectAccessFilter.Of(http), db, transmittals, cancellationToken);
        if (file is null) return refused!;
        var extension = Path.GetExtension(file.Name).ToLowerInvariant();
        if (extension is ".dxf" or ".dwg"
            && await Viewers.OffRefusalAsync(db, ProjectAccessFilter.Of(http).Project.Id, extension == ".dxf" ? Viewers.Dxf : Viewers.Dwg, file.Name, options.Value, cancellationToken) is { } off)
            return off;
        if (extension == ".dxf") return Results.File(await storage.OpenReadAsync(file.ObjectKey, cancellationToken), "application/dxf", file.Name);
        if (extension != ".dwg") return Problems.Invalid("NOT_A_DRAWING", $"{file.Name} is not a DWG or DXF drawing: download it to open it.");
        // Minimal: only the drawing's entities, asked when the viewer could not draw the full DXF (each kept apart).
        // The converter's version is in the name, so a drawing read before it mended broken texts is read again.
        var key = KeyOf(file, minimal ? $".{DxfVersion}.min.dxf" : $".{DxfVersion}.dxf");
        if (await storage.SizeAsync(key, cancellationToken) is null)
        {
            if (string.IsNullOrWhiteSpace(options.Value.DwgUrl))
                return Problems.Invalid("PREVIEW_NOT_INSTALLED", $"DWG drawings are not shown here yet (the converter is not installed): download {file.Name} to open it.");
            byte[] dxf;
            try
            {
                // Sent whole, with its length: the converter reads exactly as many bytes as it is told (a stream from
                // storage went without one, and every drawing arrived empty).
                using var drawing = new MemoryStream();
                await using (var source = await storage.OpenReadAsync(file.ObjectKey, cancellationToken))
                    await source.CopyToAsync(drawing, cancellationToken);
                // Its own buffer, not a copy of it: a drawing runs to hundreds of megabytes.
                using var body = new ByteArrayContent(drawing.GetBuffer(), 0, (int)drawing.Length);
                body.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                using var client = clients.CreateClient(HttpClientName);
                using var answer = await client.PostAsync($"{options.Value.DwgUrl!.TrimEnd('/')}/convert{(minimal ? "?minimal=1" : "")}", body, cancellationToken);
                if (answer.StatusCode == System.Net.HttpStatusCode.ServiceUnavailable)
                    return Problems.Invalid("PREVIEW_BUSY", $"The converter is busy with other drawings: try again in a minute, or download {file.Name} to open it.");
                if (!answer.IsSuccessStatusCode)
                    return Problems.Invalid("PREVIEW_FAILED", $"{file.Name} could not be read (a DWG version or content the free reader does not know): download it to open it.");
                dxf = await answer.Content.ReadAsByteArrayAsync(cancellationToken);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
            {
                return Problems.Invalid("PREVIEW_UNREACHABLE", $"The converter did not answer: download {file.Name} to open it, or try again in a moment.");
            }
            await storage.PutAsync(key, dxf, "application/dxf", cancellationToken);
        }
        return Results.File(await storage.OpenReadAsync(key, cancellationToken), "application/dxf", Path.ChangeExtension(file.Name, ".dxf"));
    }

    /// <summary><c>GET /files/{fileId}/text</c>: a plain text file as text (its first 2 MB, said when cut). Shown, never run.</summary>
    private static async Task<IResult> TextAsync(Guid fileId, HttpContext http, DeliosDbContext db, Transmittals.TransmittalService transmittals,
        FileStorage storage, IOptions<PreviewOptions> options, CancellationToken cancellationToken)
    {
        var (file, refused) = await DocumentEndpoints.ReadableAsync(fileId, ProjectAccessFilter.Of(http), db, transmittals, cancellationToken);
        if (file is null) return refused!;
        if (!Is(file.Name, Text)) return Problems.Invalid("NOT_TEXT", $"{file.Name} is not a text file: download it to open it.");
        if (await Viewers.OffRefusalAsync(db, ProjectAccessFilter.Of(http).Project.Id, Viewers.Text, file.Name, options.Value, cancellationToken) is { } off) return off;
        await using var content = await storage.OpenReadAsync(file.ObjectKey, cancellationToken);
        var buffer = new byte[Math.Min(file.Size, MaxText)];
        var read = 0;
        while (read < buffer.Length)
        {
            var n = await content.ReadAsync(buffer.AsMemory(read), cancellationToken);
            if (n == 0) break;
            read += n;
        }
        string text;
        try { text = new UTF8Encoding(false, true).GetString(buffer, 0, read); }
        catch (DecoderFallbackException) { text = Encoding.Latin1.GetString(buffer, 0, read); }
        return Results.Ok(new { text = text.TrimStart('﻿'), cut = file.Size > MaxText });
    }

    /// <summary>
    /// <c>GET /files/{fileId}/page.png</c>: a PDF's first page as a picture, about 1,400 pixels on its longest side, to
    /// place the review's stamp on it by hand. Drawn by PDFium, nothing in the file runs.
    /// </summary>
    private static async Task<IResult> FirstPageAsync(Guid fileId, HttpContext http, DeliosDbContext db, Transmittals.TransmittalService transmittals,
        FileStorage storage, CancellationToken cancellationToken)
    {
        var (file, refused) = await DocumentEndpoints.ReadableAsync(fileId, ProjectAccessFilter.Of(http), db, transmittals, cancellationToken);
        if (file is null) return refused!;
        if (!file.Name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) && file.ContentType != "application/pdf")
            return Problems.Invalid("NOT_A_PDF", $"{file.Name} is not a PDF.");
        byte[] pdf;
        await using (var source = await storage.OpenReadAsync(file.ObjectKey, cancellationToken))
        using (var buffer = new MemoryStream())
        {
            await source.CopyToAsync(buffer, cancellationToken);
            pdf = buffer.ToArray();
        }
        try
        {
            using var input = new MemoryStream(pdf);
            using var read = PdfSharp.Pdf.IO.PdfReader.Open(input, PdfSharp.Pdf.IO.PdfDocumentOpenMode.Import);
            var longest = Math.Max(read.Pages[0].Width.Point, read.Pages[0].Height.Point);
            if (Reviews.StampPlacement.FirstPage(pdf, Math.Min(2, 1400 / Math.Max(1, longest))) is { } page)
                return Results.File(page.Png, "image/png");
        }
        catch (Exception e) when (e is not OperationCanceledException) { }
        return Problems.Invalid("PAGE_NOT_DRAWN", $"The first page of {file.Name} could not be drawn.");
    }

    /// <summary>A name the converter takes: its letters kept, anything else that could upset a form replaced.</summary>
    private static string SafeName(string name) =>
        new string(name.Select(c => char.IsLetterOrDigit(c) || c is '.' or '-' or '_' or ' ' ? c : '_').ToArray());
}
