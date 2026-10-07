using System.Text;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.Options;
using NodaTime;
using Prometheus;

namespace Delios.Host.Extraction;

/// <summary>The values a project's extraction switch (<c>Project.ContentExtraction</c>) can take.</summary>
public static class ExtractionModes
{
    /// <summary>Files are never read; any text already read is deleted when the switch is turned off.</summary>
    public const string Off = "OFF";
    /// <summary>Files are read only when someone asks, for a revision or the whole project.</summary>
    public const string OnDemand = "ON_DEMAND";
    /// <summary>Every new file is read as soon as the virus scan finds it clean.</summary>
    public const string Automatic = "AUTOMATIC";
    /// <summary>All modes, for validation.</summary>
    public static readonly string[] All = [Off, OnDemand, Automatic];
}

/// <summary>Settings for reading text from files, from the <c>Extraction</c> section of configuration.</summary>
public sealed class ExtractionOptions
{
    public const string Section = "Extraction";
    /// <summary>The extraction service (Apache Tika with Tesseract). Empty: not installed.</summary>
    public string? Url { get; set; }
    /// <summary>Tesseract languages for scanned pages, joined with '+': eng, eng+fra, eng+ara…</summary>
    public string OcrLanguages { get; set; } = "eng";
    /// <summary>Text kept per file; the rest is not searchable.</summary>
    public int MaxChars { get; set; } = 2_000_000;
    /// <summary>How long to wait for the extraction service on one file, in seconds.</summary>
    public int TimeoutSeconds { get; set; } = 300;

    /// <summary>True when a service address is set.</summary>
    public bool Installed => !string.IsNullOrWhiteSpace(Url);
}

/// <summary>The text read from one file: from its text layer, or by OCR where a page is only an image.</summary>
public sealed class FileText
{
    public Guid FileId { get; set; }
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid DocumentId { get; set; }
    /// <summary>The revision the file belongs to; empty for a file not attached to a revision.</summary>
    public Guid? RevisionId { get; set; }
    public required string Text { get; set; }
    /// <summary>Length of <c>Text</c> in characters.</summary>
    public int Chars { get; set; }
    /// <summary>True when the file had more text than <c>MaxChars</c> and the rest was cut off.</summary>
    public bool Truncated { get; set; }
    public Instant ExtractedAt { get; set; }
}

/// <summary>
/// Entity Framework Core (EF Core, the database mapping library) setup for the <c>file_texts</c> table: one row per
/// file, deleted with the file.
/// </summary>
internal sealed class FileTextConfiguration : IEntityTypeConfiguration<FileText>
{
    /// <summary>Called by EF Core when it builds the database model at startup and for migrations.</summary>
    public void Configure(EntityTypeBuilder<FileText> b)
    {
        b.HasKey(x => x.FileId);
        b.HasOne<StoredFile>().WithMany().HasForeignKey(x => x.FileId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne<Identity.Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.DocumentId);
        b.HasIndex(x => x.ProjectId);
        b.HasIndex(x => x.RevisionId);
    }
}

/// <summary>
/// Queue message asking the worker to read the text of one file. Put on the queue by
/// <c>ExtractionProcessor.Enqueue</c>.
/// </summary>
public sealed record FileExtract(Guid TenantId, Guid FileId)
{
    /// <summary>The queue routing key the worker listens on for this message.</summary>
    public const string RoutingKey = "file.extract";
}

/// <summary>
/// Reads the text inside files so they can be searched by what they say. Off
/// unless the organization switches it on: a client who does not want its
/// documents read is never read. Done by the worker, through the extraction
/// service; it never changes a file.
/// </summary>
public sealed class ExtractionProcessor(
    DeliosDbContext db, TenantContext tenant, FileStorage storage, IHttpClientFactory http, IOptions<ExtractionOptions> options,
    AuditLog audit, IClock clock, ILogger<ExtractionProcessor> logger)
{
    /// <summary>Name of the HttpClient registered at startup for the extraction service, with its timeout.</summary>
    public const string HttpClientName = "extraction";

    /// <summary>
    /// Metric for Prometheus (the monitoring system) counting files processed, labelled by outcome: text, empty or
    /// skipped.
    /// </summary>
    public static readonly Counter Extracted = Metrics.CreateCounter(
        "delios_files_extracted_total", "Files whose text was read, by outcome.", new CounterConfiguration { LabelNames = ["outcome"] });

    /// <summary>Metric for Prometheus (the monitoring system) timing how long one file takes to read.</summary>
    public static readonly Histogram Seconds = Metrics.CreateHistogram(
        "delios_extraction_seconds", "Time to read the text of one file, OCR included.",
        new HistogramConfiguration { Buckets = Histogram.ExponentialBuckets(0.1, 2, 13) });

    /// <summary>
    /// Reads the text of one file and stores it. Called by the worker when a file.extract message arrives. Skips the
    /// file when already read, when the project's mode is OFF, when the file is not clean, or when no service is
    /// installed. Sends the file to Apache Tika (a text extraction server), which uses OCR (optical character
    /// recognition) on pages that are only images.
    /// </summary>
    public async Task ProcessAsync(FileExtract message, CancellationToken cancellationToken)
    {
        tenant.Set(message.TenantId);
        StoredFile? file;
        string mode;
        await using (var read = await db.Database.BeginTransactionAsync(cancellationToken))
        {
            file = await db.StoredFiles.AsNoTracking().SingleOrDefaultAsync(f => f.Id == message.FileId, cancellationToken);
            mode = file is null ? ExtractionModes.Off : await db.Projects.Where(p => p.Id == file.ProjectId)
                .Select(p => p.ContentExtraction).SingleAsync(cancellationToken);
            var done = await db.FileTexts.AnyAsync(t => t.FileId == message.FileId, cancellationToken);
            await read.CommitAsync(cancellationToken);
            if (done) return;
        }
        // Switched off since it was asked: nothing is read.
        if (mode == ExtractionModes.Off || file is not { Status: FileStatuses.Clean } || !options.Value.Installed)
        {
            Extracted.WithLabels("skipped").Inc();
            return;
        }

        string text;
        using (Seconds.NewTimer())
        {
            await using var content = await storage.OpenReadAsync(file.ObjectKey, cancellationToken);
            using var request = new HttpRequestMessage(HttpMethod.Put, options.Value.Url!.TrimEnd('/') + "/tika")
            {
                Content = new StreamContent(content),
            };
            request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(file.DetectedType ?? file.ContentType);
            request.Headers.Accept.ParseAdd("text/plain");
            // Pages that already carry text are read as text; only image pages are OCR'd.
            request.Headers.Add("X-Tika-PDFOcrStrategy", "auto");
            request.Headers.Add("X-Tika-OCRLanguage", options.Value.OcrLanguages);
            using var response = await http.CreateClient(HttpClientName).SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if ((int)response.StatusCode is 415 or 422)
            {
                // A format the service cannot read: recorded once, never retried.
                text = "";
            }
            else
            {
                response.EnsureSuccessStatusCode();
                text = await ReadCappedAsync(response, options.Value.MaxChars + 1, cancellationToken);
            }
        }
        var truncated = text.Length > options.Value.MaxChars;
        if (truncated) text = text[..options.Value.MaxChars];
        text = string.Join('\n', text.Split('\n').Select(l => l.TrimEnd()).Where(l => l.Length > 0));

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        if (await db.FileTexts.AnyAsync(t => t.FileId == file.Id, cancellationToken)) return;
        db.FileTexts.Add(new FileText
        {
            FileId = file.Id,
            TenantId = file.TenantId,
            ProjectId = file.ProjectId,
            DocumentId = file.DocumentId,
            RevisionId = file.RevisionId,
            Text = text,
            Chars = text.Length,
            Truncated = truncated,
            ExtractedAt = clock.GetCurrentInstant(),
        });
        // The document changed for search: the index takes the text on its next pass.
        await db.Documents.Where(d => d.Id == file.DocumentId)
            .ExecuteUpdateAsync(d => d.SetProperty(x => x.UpdatedAt, clock.GetCurrentInstant()), cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor.System, "CONTENT_EXTRACTED", "StoredFile", file.Id, file.Name,
            text.Length == 0 ? "No readable text." : $"{text.Length} characters{(truncated ? " (cut at the limit)" : "")}.",
            file.ProjectId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        Extracted.WithLabels(text.Length == 0 ? "empty" : "text").Inc();
        logger.LogInformation("Read {Chars} characters from file {FileId}", text.Length, file.Id);
    }

    /// <summary>
    /// Reads the response body as text, stopping after <c>max</c> characters so a huge file cannot fill memory.
    /// </summary>
    private static async Task<string> ReadCappedAsync(HttpResponseMessage response, int max, CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(await response.Content.ReadAsStreamAsync(cancellationToken), Encoding.UTF8);
        var buffer = new char[16384];
        var text = new StringBuilder();
        int read;
        while (text.Length < max && (read = await reader.ReadAsync(buffer, cancellationToken)) > 0) text.Append(buffer, 0, read);
        return text.Length > max ? text.ToString(0, max) : text.ToString();
    }

    /// <summary>Whether a file is something to read: what was submitted, not proof or stamped copies.</summary>
    public static bool Readable(StoredFile file) =>
        file.Status == FileStatuses.Clean && file.Kind is FileKinds.Native or FileKinds.Rendition;

    /// <summary>
    /// Puts a file.extract message on the queue (saved with the caller's database changes). Called by the extraction
    /// endpoints and by the file scanner when the mode is AUTOMATIC.
    /// </summary>
    public static void Enqueue(DeliosDbContext db, StoredFile file) =>
        db.Enqueue(FileExtract.RoutingKey, new FileExtract(file.TenantId, file.Id));
}
