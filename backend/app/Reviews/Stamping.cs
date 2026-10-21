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
/// The worker's part of a release: a copy of each rendition carrying the stamp, the engagement of the review that
/// released it (owner: "stamps only concern reviews", one stamp, the same on every document; released without a review,
/// nothing is stamped), and the marks across the page as they were (superseded, void, on hold). What the stamp shows
/// beyond what it always carries, and where it sits, is the project's choice (<see cref="StampChoices"/>). Originals
/// are never changed: every copy is a new file, derived from the one it was made from. Safe to run twice.
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
        var choices = await StampChoices.ReadAsync(db, project.Id, cancellationToken);
        // The review that released it: it went for review, so it is stamped; released without one, nothing to stamp.
        var review = await db.Reviews.AsNoTracking().Include(r => r.Steps).ThenInclude(s => s.Participants)
            .Where(r => r.RevisionId == revision.Id && r.Verdict != null)
            .OrderByDescending(r => r.ClosedAt).FirstOrDefaultAsync(cancellationToken);
        if (review is not null && choices.All)
        {
            var face = await FaceAsync(review, document, revision, zone, choices, cancellationToken);
            var comments = choices.Comments ? await CommentsAsync(review.Id, cancellationToken) : [];
            foreach (var rendition in revision.Files.Where(f => f.Kind == FileKinds.Rendition && f.Status == FileStatuses.Clean
                && f.Submission == revision.Submission).ToList())
            {
                if (revision.Files.Any(f => f.DerivedFromId == rendition.Id && f.Kind == FileKinds.Stamped)) continue;
                await DeriveAsync(rendition, FileKinds.Stamped, document, revision, bytes => Stamp(bytes, face, choices.Place, comments: comments,
                    commentsTitle: $"{document.Number} rev {revision.Value}: why, the comments of review {review.Number}"), cancellationToken);
            }
        }

        var released = DatePattern.Format((revision.ReleasedAt ?? clock.GetCurrentInstant()).InZone(zone).Date);
        foreach (var oldId in choices.On(FileKinds.Superseded) ? message.SupersededRevisionIds : [])
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
    /// A returned revision is not stamped (the stamp is only for what its review released).
    /// </summary>
    public async Task MarkAsync(RevisionMarked message, CancellationToken cancellationToken)
    {
        tenant.Set(message.TenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var revision = await db.Revisions.Include(r => r.Files).SingleOrDefaultAsync(r => r.Id == message.RevisionId, cancellationToken);
        if (revision is null || message.Mark is not (FileKinds.Void or FileKinds.Held)) return;
        var document = await db.Documents.SingleAsync(d => d.Id == revision.DocumentId, cancellationToken);
        var choices = await StampChoices.ReadAsync(db, revision.ProjectId, cancellationToken);
        if (!choices.On(message.Mark)) { await transaction.CommitAsync(cancellationToken); return; }
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
    /// What the stamp says (owner: the grades given, the most influential standing out, who gave it and when, and
    /// sometimes why): always the standing verdict, larger (the most severe of the deciders', the later of equals, as the
    /// review worked it out), and who gave it and when; then, each as the project chose: every grade given with who and
    /// when, what it is released for, the document and its revision, the review's number.
    /// </summary>
    private async Task<StampFace> FaceAsync(Review review, Document document, Revision revision, DateTimeZone zone, StampChoices choices, CancellationToken cancellationToken)
    {
        string Day(Instant? at) => at is { } i ? DatePattern.Format(i.InZone(zone).Date) : "";
        var labels = await db.ValueEntries.AsNoTracking()
            .Where(v => v.SetKey == review.VerdictSet || v.SetKey == ReviewSets.Advice)
            .Select(v => new { v.SetKey, v.Code, v.Label }).ToListAsync(cancellationToken);
        string Grade(string set, string? code) =>
            code is null ? "" : $"{code} {labels.FirstOrDefault(l => l.SetKey == set && l.Code == code)?.Label}".Trim();
        var steps = review.Steps.OrderBy(s => s.Index).ToList();
        // Who gave the standing verdict: on the last deciding step that gave it, whoever of its people answered so.
        var standingStep = steps.LastOrDefault(s => s.Deciding && s.Answer == review.Verdict);
        var standingBy = standingStep?.Participants.Where(p => p.Answer == review.Verdict && p.AnsweredAt is not null)
            .OrderBy(p => p.AnsweredAt).LastOrDefault();
        var lines = new List<string>();
        if (standingBy is not null)
            lines.Add($"by {standingBy.UserName}, {Day(standingBy.AnsweredAt)}");
        if (choices.Shows("STEPS"))
        {
            foreach (var step in steps)
            {
                foreach (var one in step.Participants.Where(p => p.AnsweredAt is not null && p.Answer is not null).OrderBy(p => p.AnsweredAt))
                    lines.Add($"{step.Index + 1}. {step.Title}: {Grade(step.Deciding ? review.VerdictSet : ReviewSets.Advice, one.Answer)}, {one.UserName}, {Day(one.AnsweredAt)}");
                if (step.ByProxy && step.ForeignAnswer is { } theirs)
                    lines.Add($"{step.Index + 1}. {step.Title}: {theirs}, {step.PartyName}, {Day(step.CompletedAt)}");
            }
        }
        if (choices.Shows("STATUS") && review.GrantedStatus is { } status) lines.Add($"Released for {status}");
        if (choices.Shows("DOCUMENT")) lines.Add($"{document.Number}  rev {revision.Value}");
        if (choices.Shows("REVIEW")) lines.Add($"Review {review.Number}");
        return new StampFace("RELEASED", Grade(review.VerdictSet, review.Verdict), lines);
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
    /// A box in a corner of every page (<paramref name="place"/>, top right unless the project chose another): RELEASED,
    /// the standing verdict larger, then the face's lines; with comments, a line saying so and a last page listing them.
    /// A line too long for the box is cut with an ellipsis (the review keeps it whole in the app).
    /// </summary>
    public static byte[] Stamp(byte[] pdf, StampFace face, string place = StampChoices.TopRight, IReadOnlyList<string>? comments = null, string? commentsTitle = null)
    {
        using var input = new MemoryStream(pdf);
        using var document = PdfReader.Open(input, PdfDocumentOpenMode.Modify);
        var word = new XFont(EmbeddedFonts.Family, 8, XFontStyleEx.Bold);
        var verdict = new XFont(EmbeddedFonts.Family, 11, XFontStyleEx.Bold);
        var regular = new XFont(EmbeddedFonts.Family, 7.5, XFontStyleEx.Regular);
        var colour = XColor.FromArgb(255, 20, 90, 50);
        var ink = new XSolidBrush(colour);
        var border = new XPen(colour, 1.2);
        var withComments = comments is { Count: > 0 };
        var lines = withComments ? [.. face.Lines, $"Why: {comments!.Count} comment{(comments.Count == 1 ? "" : "s")}, on the last page"] : face.Lines.ToList();
        const double width = 230, pad = 6;
        var height = 30 + (face.Verdict.Length > 0 ? 14 : 0) + lines.Count * 10 + 2;
        var pages = document.Pages.Cast<PdfPage>().ToList();
        foreach (var page in pages)
        {
            using var gfx = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
            string Fit(string text, XFont font)
            {
                if (gfx.MeasureString(text, font).Width <= width - 2 * pad) return text;
                while (text.Length > 1 && gfx.MeasureString(text + "…", font).Width > width - 2 * pad) text = text[..^1];
                return text + "…";
            }
            var box = new XRect(place.EndsWith("LEFT") ? 18 : page.Width.Point - width - 18,
                place.StartsWith("BOTTOM") ? page.Height.Point - height - 18 : 18, width, height);
            gfx.DrawRectangle(border, XBrushes.White, box);
            gfx.DrawString(face.Title, word, ink, box.X + pad, box.Y + 12);
            var y = box.Y + 12;
            if (face.Verdict.Length > 0) { y += 15; gfx.DrawString(Fit(face.Verdict, verdict), verdict, ink, box.X + pad, y); }
            y += 4;
            foreach (var line in lines) { y += 10; gfx.DrawString(Fit(line, regular), regular, ink, box.X + pad, y); }
        }
        if (withComments) AppendComments(document, commentsTitle ?? "Comments", comments!);
        using var output = new MemoryStream();
        document.Save(output);
        return output.ToArray();
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
}

/// <summary>What the stamp says: its word, the standing verdict, and the lines under it.</summary>
public sealed record StampFace(string Title, string Verdict, IReadOnlyList<string> Lines);

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
/// What the project asked (the Control room): stamped at all (<c>POLICY_PDF_STAMP</c>); the stamp's other lines
/// (<c>STAMP_SHOW:STEPS</c> ON unless set OFF; <c>STATUS</c>, <c>DOCUMENT</c>, <c>REVIEW</c> OFF unless set ON), why: the
/// comments on a last page (<c>STAMP_COMMENTS</c> = ON), where it sits (<c>STAMP_PLACE</c>, top right by default); and
/// the marks across the page (<c>STAMP:SUPERSEDED</c>, <c>STAMP:VOID</c>, <c>STAMP:HELD</c>; each ON unless set OFF).
/// </summary>
public sealed record StampChoices(bool All, IReadOnlyDictionary<string, string> Answers)
{
    public const string TopRight = "TOP_RIGHT";
    private static readonly string[] Places = [TopRight, "TOP_LEFT", "BOTTOM_RIGHT", "BOTTOM_LEFT"];
    public bool On(string kind) => All && Answers.GetValueOrDefault($"STAMP:{kind}") != "OFF";
    public bool Shows(string what) => Answers.GetValueOrDefault($"STAMP_SHOW:{what}") is { } set ? set == "ON" : what == "STEPS";
    public bool Comments => All && Answers.GetValueOrDefault("STAMP_COMMENTS") == "ON";
    public string Place => Answers.GetValueOrDefault("STAMP_PLACE") is { } place && Places.Contains(place) ? place : TopRight;

    public static async Task<StampChoices> ReadAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken)
    {
        var answers = await Settings.ProjectAnswers.AnswersAsync(db, projectId, cancellationToken);
        return new StampChoices(answers.GetValueOrDefault("POLICY_PDF_STAMP") != "OFF", answers);
    }
}
