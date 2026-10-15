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
using PdfSharp.Drawing.Layout;
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
    /// <summary>Date format printed on stamps, for example "07 Oct 2026".</summary>
    private static readonly LocalDatePattern DatePattern = LocalDatePattern.CreateWithInvariantCulture("dd MMM yyyy");

    /// <summary>Runs once before the class is first used: tells the PDF library (PdfSharp) to load fonts from <see cref="EmbeddedFonts"/>, unless a resolver is already set.</summary>
    static Stamping() => GlobalFontSettings.FontResolver ??= new EmbeddedFonts();

    /// <summary>
    /// Handles a <see cref="RevisionReleased"/> message: in one transaction for the message's tenant, stamps each clean rendition of the released revision's current submission,
    /// and watermarks the files of each superseded revision. Skips files already done, so a redelivered message does no harm. Called by the worker (<see cref="Messaging.FileQueueConsumer"/>) when a revision.released message arrives.
    /// </summary>
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
        var choices = await StampChoices.ReadAsync(db, project.Id, cancellationToken);
        // Released with comments to take in (accepted with comments): the comments go on a page of their own, if asked.
        var review = await db.Reviews.AsNoTracking().Where(r => r.RevisionId == revision.Id && r.Verdict != null)
            .OrderByDescending(r => r.ClosedAt).FirstOrDefaultAsync(cancellationToken);
        var comments = choices.Comments && review is not null ? await CommentsAsync(review.Id, cancellationToken) : [];

        foreach (var rendition in choices.Released ? revision.Files.Where(f => f.Kind == FileKinds.Rendition && f.Status == FileStatuses.Clean
            && f.Submission == revision.Submission).ToList() : [])
        {
            if (revision.Files.Any(f => f.DerivedFromId == rendition.Id && f.Kind == FileKinds.Stamped)) continue;
            await DeriveAsync(rendition, FileKinds.Stamped, document, revision, bytes => Stamp(bytes,
                $"{document.Number}", $"Rev {revision.Value}   {revision.StatusCode}", $"Released {released}", comments: comments,
                commentsTitle: $"{document.Number} rev {revision.Value}: comments of review {review?.Number} ({review?.Verdict})"), cancellationToken);
        }

        foreach (var oldId in choices.Superseded ? message.SupersededRevisionIds : [])
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

    /// <summary>
    /// Handles a <see cref="RevisionMarked"/> message: the copy people were reading (the stamped one where there is
    /// one) is copied with VOID or ON HOLD across every page. Done once per copy; a redelivered message does no harm.
    /// </summary>
    public async Task MarkAsync(RevisionMarked message, CancellationToken cancellationToken)
    {
        tenant.Set(message.TenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var revision = await db.Revisions.Include(r => r.Files).SingleOrDefaultAsync(r => r.Id == message.RevisionId, cancellationToken);
        if (revision is null || message.Mark is not (FileKinds.Void or FileKinds.Held or FileKinds.Returned)) return;
        var document = await db.Documents.SingleAsync(d => d.Id == revision.DocumentId, cancellationToken);
        var choices = await StampChoices.ReadAsync(db, revision.ProjectId, cancellationToken);
        if (!choices.On(message.Mark)) { await transaction.CommitAsync(cancellationToken); return; }
        if (message.Mark == FileKinds.Returned)
        {
            await StampReturnedAsync(revision, document, Guid.TryParse(message.Note, out var reviewId) ? reviewId : null, choices, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return;
        }
        var sources = revision.Files.Where(f => f.Kind == FileKinds.Stamped && f.Status == FileStatuses.Clean && f.Submission == revision.Submission).ToList();
        if (sources.Count == 0)
            sources = revision.Files.Where(f => f.Kind == FileKinds.Rendition && f.Status == FileStatuses.Clean && f.Submission == revision.Submission).ToList();
        var word = message.Mark == FileKinds.Void ? "VOID" : "ON HOLD";
        foreach (var source in sources)
        {
            if (revision.Files.Any(f => f.DerivedFromId == source.Id && f.Kind == message.Mark)) continue;
            await DeriveAsync(source, message.Mark, document, revision, bytes => Watermark(bytes, message.Note, word), cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
    }

    /// <summary>
    /// A revision the review sent back (rejected): its PDF is stamped RETURNED with the verdict and the day, and, if the
    /// project asks it, the comments that sent it back on a page of their own.
    /// </summary>
    private async Task StampReturnedAsync(Revision revision, Document document, Guid? reviewId, StampChoices choices, CancellationToken cancellationToken)
    {
        var review = reviewId is { } id ? await db.Reviews.AsNoTracking().SingleOrDefaultAsync(r => r.Id == id, cancellationToken) : null;
        var project = await db.Projects.AsNoTracking().SingleAsync(p => p.Id == revision.ProjectId, cancellationToken);
        var zone = DateTimeZoneProviders.Tzdb.GetZoneOrNull(project.TimeZone) ?? DateTimeZone.Utc;
        var day = DatePattern.Format((revision.ReturnedAt ?? clock.GetCurrentInstant()).InZone(zone).Date);
        var verdict = review?.Verdict is { } code
            ? $"{code} {await db.ValueEntries.AsNoTracking().Where(v => v.SetKey == (review.VerdictSet ?? ReviewSets.Verdicts) && v.Code == code).Select(v => v.Label).FirstOrDefaultAsync(cancellationToken)}".Trim()
            : "returned";
        var comments = choices.Comments && review is not null ? await CommentsAsync(review.Id, cancellationToken) : [];
        foreach (var source in revision.Files.Where(f => f.Kind == FileKinds.Rendition && f.Status == FileStatuses.Clean && f.Submission == revision.Submission).ToList())
        {
            if (revision.Files.Any(f => f.DerivedFromId == source.Id && f.Kind == FileKinds.Returned)) continue;
            await DeriveAsync(source, FileKinds.Returned, document, revision, bytes => Stamp(bytes, document.Number, $"Rev {revision.Value}   {verdict}",
                $"Returned {day}", "RETURNED", red: true, comments: comments,
                commentsTitle: $"{document.Number} rev {revision.Value}: comments of review {review?.Number} ({verdict})"), cancellationToken);
        }
    }

    /// <summary>The comments written on a review, as they read (taken back ones left out): who, and what.</summary>
    private async Task<List<string>> CommentsAsync(Guid reviewId, CancellationToken cancellationToken) =>
        (await db.ReviewComments.AsNoTracking().Where(c => c.ReviewId == reviewId && c.Status != CommentStatuses.Withdrawn)
            .OrderBy(c => c.StepIndex).ThenBy(c => c.CreatedAt).Select(c => new { c.AuthorName, c.Text, c.Blocking }).ToListAsync(cancellationToken))
        .Select(c => $"{c.AuthorName}{(c.Blocking ? " (blocking)" : "")}: {c.Text}").ToList();

    /// <summary>
    /// Reads <paramref name="source"/> from storage, applies <paramref name="transform"/> to its bytes, and saves the result as a new file of <paramref name="kind"/> derived from it, with an audit entry.
    /// If the PDF cannot be marked, records STAMP_NOT_POSSIBLE in the audit log and returns without failing, since a retry would fail the same way.
    /// </summary>
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
        await audit.WriteAsync(Audit.Actor.System, kind == FileKinds.Stamped ? "STAMPED" : $"WATERMARKED_{kind}",
            "StoredFile", copy.Id, copy.Name, $"{document.Number} rev {revision.Value}, made from {source.Name}.",
            document.ProjectId, cancellationToken);
    }

    /// <summary>
    /// A box in the top right corner of every page (RELEASED in green, or another word, RETURNED in red); with comments,
    /// a line saying so and a last page listing them.
    /// </summary>
    public static byte[] Stamp(byte[] pdf, string line1, string line2, string line3, string title = "RELEASED", bool red = false,
        IReadOnlyList<string>? comments = null, string? commentsTitle = null)
    {
        using var input = new MemoryStream(pdf);
        using var document = PdfReader.Open(input, PdfDocumentOpenMode.Modify);
        var bold = new XFont(EmbeddedFonts.Family, 9, XFontStyleEx.Bold);
        var regular = new XFont(EmbeddedFonts.Family, 8, XFontStyleEx.Regular);
        var colour = red ? XColor.FromArgb(255, 170, 30, 30) : XColor.FromArgb(255, 20, 90, 50);
        var ink = new XSolidBrush(colour);
        var border = new XPen(colour, 1.2);
        var withComments = comments is { Count: > 0 };
        var pages = document.Pages.Cast<PdfPage>().ToList();
        foreach (var page in pages)
        {
            using var gfx = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
            var width = 190.0;
            var box = new XRect(page.Width.Point - width - 18, 18, width, withComments ? 56 : 46);
            gfx.DrawRectangle(border, XBrushes.White, box);
            gfx.DrawString(title, bold, ink, box.X + 6, box.Y + 12);
            gfx.DrawString(line1, bold, ink, box.X + 6, box.Y + 24);
            gfx.DrawString(line2, regular, ink, box.X + 6, box.Y + 34);
            gfx.DrawString(line3, regular, ink, box.X + 6, box.Y + 43);
            if (withComments) gfx.DrawString($"{comments!.Count} comment{(comments.Count == 1 ? "" : "s")}: see the last page", regular, ink, box.X + 6, box.Y + 52);
        }
        if (withComments) AppendComments(document, commentsTitle ?? "Comments", comments!);
        using var output = new MemoryStream();
        document.Save(output);
        return output.ToArray();
    }

    /// <summary>Pages added at the end listing the comments, one after another, wrapped to the page.</summary>
    private static void AppendComments(PdfDocument document, string title, IReadOnlyList<string> comments)
    {
        var heading = new XFont(EmbeddedFonts.Family, 12, XFontStyleEx.Bold);
        var body = new XFont(EmbeddedFonts.Family, 9, XFontStyleEx.Regular);
        const double margin = 48, lineHeight = 12.5;
        PdfPage NewPage() { var p = document.AddPage(); p.Size = PdfSharp.PageSize.A4; return p; }
        var page = NewPage();
        var gfx = XGraphics.FromPdfPage(page);
        gfx.DrawString(title, heading, XBrushes.Black, margin, margin);
        var y = margin + 24;
        var width = page.Width.Point - 2 * margin;
        foreach (var comment in comments)
        {
            // Words laid out by hand to the width, so a long comment wraps rather than leaving the page.
            var lines = new List<string>();
            var line = "";
            foreach (var word in comment.Replace("\r", "").Split(' ', '\n'))
            {
                var candidate = line.Length == 0 ? word : $"{line} {word}";
                if (gfx.MeasureString(candidate, body).Width > width && line.Length > 0) { lines.Add(line); line = word; }
                else line = candidate;
            }
            if (line.Length > 0) lines.Add(line);
            foreach (var text in lines)
            {
                if (y > page.Height.Point - margin)
                {
                    gfx.Dispose();
                    page = NewPage();
                    gfx = XGraphics.FromPdfPage(page);
                    y = margin;
                }
                gfx.DrawString(text, body, XBrushes.Black, margin, y);
                y += lineHeight;
            }
            y += lineHeight * 0.6;
        }
        gfx.Dispose();
    }

    /// <summary>SUPERSEDED (or another word) across every page, with a note under it.</summary>
    public static byte[] Watermark(byte[] pdf, string note, string word = "SUPERSEDED")
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
            gfx.DrawString(word, big, red, center, XStringFormats.Center);
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

    /// <summary>Called by PdfSharp to pick a font face: always DejaVu Sans, bold or regular (italic is ignored).</summary>
    public FontResolverInfo? ResolveTypeface(string familyName, bool bold, bool italic) =>
        new(bold ? "DejaVuSans-Bold" : "DejaVuSans");

    /// <summary>Called by PdfSharp to get the bytes of a font face, read from the .ttf embedded in this assembly.</summary>
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

/// <summary>
/// What the project asked of the stamps on its PDFs (Settings → How this project works): stamps at all
/// (<c>POLICY_PDF_STAMP</c>), each kind (<c>STAMP:RELEASED</c>, <c>STAMP:SUPERSEDED</c>, <c>STAMP:VOID</c>,
/// <c>STAMP:HELD</c>, <c>STAMP:RETURNED</c>; each ON unless set OFF), and whether a stamp whose verdict carries
/// comments lists them on a last page (<c>STAMP_COMMENTS</c> = ON).
/// </summary>
public sealed record StampChoices(bool All, IReadOnlyDictionary<string, string> Answers)
{
    public bool On(string kind) => All && Answers.GetValueOrDefault($"STAMP:{kind}") != "OFF";
    public bool Released => On("RELEASED");
    public bool Superseded => On(FileKinds.Superseded);
    public bool Comments => All && Answers.GetValueOrDefault("STAMP_COMMENTS") == "ON";

    public static async Task<StampChoices> ReadAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken)
    {
        var answers = await Settings.ProjectAnswers.AnswersAsync(db, projectId, cancellationToken);
        return new StampChoices(answers.GetValueOrDefault("POLICY_PDF_STAMP") != "OFF", answers);
    }
}
