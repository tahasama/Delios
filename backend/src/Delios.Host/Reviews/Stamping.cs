using System.Reflection;
using System.Security.Cryptography;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using NodaTime.Text;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace Delios.Host.Reviews;

/// <summary>
/// The worker's part of a release: a copy of each rendition carrying the release
/// stamp (number, revision, status, date), and a copy of the previous revision's
/// stamped rendition marked SUPERSEDED. Originals are never changed: every copy
/// is a new file, derived from the one it was made from. Safe to run twice.
/// </summary>
public sealed class Stamping(
    DeliosDbContext db, TenantContext tenant, FileStorage storage, AuditLog audit, IClock clock, ILogger<Stamping> logger)
{
    private static readonly LocalDatePattern DatePattern = LocalDatePattern.CreateWithInvariantCulture("dd MMM yyyy");

    static Stamping() => GlobalFontSettings.FontResolver ??= new EmbeddedFonts();

    public async Task ProcessAsync(RevisionReleased message, CancellationToken cancellationToken)
    {
        tenant.Set(message.TenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var revision = await db.Revisions.Include(r => r.Files).SingleOrDefaultAsync(r => r.Id == message.RevisionId, cancellationToken);
        if (revision is null) return;
        var document = await db.Documents.SingleAsync(d => d.Id == revision.DocumentId, cancellationToken);
        var project = await db.Projects.SingleAsync(p => p.Id == revision.ProjectId, cancellationToken);
        var zone = DateTimeZoneProviders.Tzdb.GetZoneOrNull(project.TimeZone) ?? DateTimeZone.Utc;
        var released = DatePattern.Format((revision.ReleasedAt ?? clock.GetCurrentInstant()).InZone(zone).Date);

        foreach (var rendition in revision.Files.Where(f => f.Kind == FileKinds.Rendition && f.Status == FileStatuses.Clean
            && f.Submission == revision.Submission).ToList())
        {
            if (revision.Files.Any(f => f.DerivedFromId == rendition.Id && f.Kind == FileKinds.Stamped)) continue;
            await DeriveAsync(rendition, FileKinds.Stamped, document, revision, bytes => Stamp(bytes,
                $"{document.Number}", $"Rev {revision.Value}   {revision.StatusCode}", $"Released {released}"), cancellationToken);
        }

        foreach (var oldId in message.SupersededRevisionIds)
        {
            var old = await db.Revisions.Include(r => r.Files).SingleAsync(r => r.Id == oldId, cancellationToken);
            // The copy people were reading: the stamped one where there is one.
            var sources = old.Files.Where(f => f.Kind == FileKinds.Stamped && f.Status == FileStatuses.Clean
                && f.Submission == old.Submission).ToList();
            if (sources.Count == 0)
            {
                sources = old.Files.Where(f => f.Kind == FileKinds.Rendition && f.Status == FileStatuses.Clean
                    && f.Submission == old.Submission).ToList();
            }
            foreach (var source in sources)
            {
                if (old.Files.Any(f => f.DerivedFromId == source.Id && f.Kind == FileKinds.Superseded)) continue;
                await DeriveAsync(source, FileKinds.Superseded, document, old, bytes => Watermark(bytes,
                    $"Superseded by rev {revision.Value} on {released}"), cancellationToken);
            }
        }
        await transaction.CommitAsync(cancellationToken);
    }

    private async Task DeriveAsync(
        StoredFile source, string kind, Document document, Revision revision, Func<byte[], byte[]> transform,
        CancellationToken cancellationToken)
    {
        byte[] original;
        await using (var stream = await storage.OpenReadAsync(source.ObjectKey, cancellationToken))
        using (var buffer = new MemoryStream())
        {
            await stream.CopyToAsync(buffer, cancellationToken);
            original = buffer.ToArray();
        }

        byte[] derived;
        try
        {
            derived = transform(original);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Marking works on bytes already in hand, so a failure here is the PDF
            // itself (damaged, protected, not really a PDF) and would fail on every
            // retry. It is recorded once; the release stands, unstamped.
            logger.LogWarning(ex, "Could not mark {File}", source.Name);
            await audit.WriteAsync(Audit.Actor.System, "STAMP_NOT_POSSIBLE", "StoredFile", source.Id, source.Name,
                $"The PDF could not be marked ({kind.ToLowerInvariant()}): {ex.Message}", document.ProjectId, cancellationToken);
            return;
        }

        var copy = new StoredFile
        {
            TenantId = source.TenantId,
            ProjectId = source.ProjectId,
            DocumentId = source.DocumentId,
            RevisionId = revision.Id,
            ObjectKey = "",
            Name = $"{Path.GetFileNameWithoutExtension(source.Name)} ({kind.ToLowerInvariant()}).pdf",
            ContentType = "application/pdf",
            Size = derived.Length,
            Sha256 = Convert.ToHexStringLower(SHA256.HashData(derived)),
            Kind = kind,
            DerivedFromId = source.Id,
            Submission = source.Submission,
            Status = FileStatuses.Clean,
            DetectedType = "application/pdf",
            UploadedByName = "System",
            ScannedAt = clock.GetCurrentInstant(),
        };
        copy.ObjectKey = FileStorage.KeyFor(copy.TenantId, copy.ProjectId, copy.Id);
        await storage.PutAsync(copy.ObjectKey, derived, copy.ContentType, cancellationToken);
        db.StoredFiles.Add(copy);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Audit.Actor.System, kind == FileKinds.Stamped ? "STAMPED" : "WATERMARKED_SUPERSEDED",
            "StoredFile", copy.Id, copy.Name, $"{document.Number} rev {revision.Value}, made from {source.Name}.",
            document.ProjectId, cancellationToken);
    }

    /// <summary>A box in the top right corner of every page.</summary>
    public static byte[] Stamp(byte[] pdf, string line1, string line2, string line3)
    {
        using var input = new MemoryStream(pdf);
        using var document = PdfReader.Open(input, PdfDocumentOpenMode.Modify);
        var bold = new XFont(EmbeddedFonts.Family, 9, XFontStyleEx.Bold);
        var regular = new XFont(EmbeddedFonts.Family, 8, XFontStyleEx.Regular);
        var ink = new XSolidBrush(XColor.FromArgb(255, 20, 90, 50));
        var border = new XPen(XColor.FromArgb(255, 20, 90, 50), 1.2);
        foreach (var page in document.Pages)
        {
            using var gfx = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
            var width = 190.0;
            var box = new XRect(page.Width.Point - width - 18, 18, width, 46);
            gfx.DrawRectangle(border, XBrushes.White, box);
            gfx.DrawString("RELEASED", bold, ink, box.X + 6, box.Y + 12);
            gfx.DrawString(line1, bold, ink, box.X + 6, box.Y + 24);
            gfx.DrawString(line2, regular, ink, box.X + 6, box.Y + 34);
            gfx.DrawString(line3, regular, ink, box.X + 6, box.Y + 43);
        }
        using var output = new MemoryStream();
        document.Save(output);
        return output.ToArray();
    }

    /// <summary>SUPERSEDED across every page, with what replaced it.</summary>
    public static byte[] Watermark(byte[] pdf, string note)
    {
        using var input = new MemoryStream(pdf);
        using var document = PdfReader.Open(input, PdfDocumentOpenMode.Modify);
        var big = new XFont(EmbeddedFonts.Family, 64, XFontStyleEx.Bold);
        var small = new XFont(EmbeddedFonts.Family, 12, XFontStyleEx.Bold);
        var red = new XSolidBrush(XColor.FromArgb(90, 200, 30, 30));
        foreach (var page in document.Pages)
        {
            using var gfx = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
            var center = new XPoint(page.Width.Point / 2, page.Height.Point / 2);
            var state = gfx.Save();
            gfx.RotateAtTransform(-45, center);
            gfx.DrawString("SUPERSEDED", big, red, center, XStringFormats.Center);
            gfx.DrawString(note, small, red, new XPoint(center.X, center.Y + 46), XStringFormats.Center);
            gfx.Restore(state);
        }
        using var output = new MemoryStream();
        document.Save(output);
        return output.ToArray();
    }
}

/// <summary>DejaVu Sans, shipped inside the assembly (Resources/Fonts, with its licence).</summary>
public sealed class EmbeddedFonts : IFontResolver
{
    public const string Family = "DejaVu Sans";

    public FontResolverInfo? ResolveTypeface(string familyName, bool bold, bool italic) =>
        new(bold ? "DejaVuSans-Bold" : "DejaVuSans");

    public byte[]? GetFont(string faceName)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var name = assembly.GetManifestResourceNames().Single(n => n.EndsWith($".{faceName}.ttf", StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(name)!;
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }
}
