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
        if (review is not null && choices.On("RELEASED"))
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
    /// A revision its review returned is stamped RETURNED, unless the project switched it off.
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
    /// A revision its review sent back, unless the project switched it off (<c>STAMP:RETURNED</c> = OFF): the same stamp, RETURNED
    /// in red, the verdict that sent it back leading, then what the stamp is set to show.
    /// </summary>
    private async Task StampReturnedAsync(Revision revision, Document document, Guid? reviewId, StampChoices choices, CancellationToken cancellationToken)
    {
        var review = reviewId is { } id ? await db.Reviews.AsNoTracking().Include(r => r.Steps).ThenInclude(s => s.Participants)
            .SingleOrDefaultAsync(r => r.Id == id, cancellationToken) : null;
        if (review is null) return;
        var project = await db.Projects.AsNoTracking().SingleAsync(p => p.Id == revision.ProjectId, cancellationToken);
        var zone = DateTimeZoneProviders.Tzdb.GetZoneOrNull(project.TimeZone) ?? DateTimeZone.Utc;
        // The same stamp as a release's (owner: "the stamp is unified"): the grade ticked says it was returned.
        var face = await FaceAsync(review, document, revision, zone, choices, cancellationToken);
        var comments = choices.Comments ? await CommentsAsync(review.Id, cancellationToken) : [];
        foreach (var source in revision.Files.Where(f => f.Kind == FileKinds.Rendition && f.Status == FileStatuses.Clean && f.Submission == revision.Submission).ToList())
        {
            if (revision.Files.Any(f => f.DerivedFromId == source.Id && f.Kind == FileKinds.Returned)) continue;
            await DeriveAsync(source, FileKinds.Returned, document, revision, bytes => Stamp(bytes, face, choices.Place, comments: comments,
                commentsTitle: $"{document.Number} rev {revision.Value}: why, the comments of review {review.Number}"), cancellationToken);
        }
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
        string? LabelOf(string? set, string code) => labels.FirstOrDefault(l => l.SetKey == set && l.Code == code)?.Label;
        string Grade(string? set, string? code) => code is null ? "" : StampFace.Grade(code, LabelOf(set, code));

        // Every grade the review could give, in its set's order, the one given ticked (a review stamp's way).
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        // A review that kept no set of its own lists the set its verdict belongs to, never every set of the list.
        var setName = review.Verdicts ?? (review.Verdict is { } v ? catalog.SetNameOf(review.VerdictSet, v) : null);
        var codes = catalog.ActiveIn(review.VerdictSet, setName).ToList();
        if (review.Verdict is { } given && !codes.Contains(given)) codes.Add(given);
        var options = codes.Select(code => new StampOption(code, StampFace.Words(code, LabelOf(review.VerdictSet, code)), code == review.Verdict)).ToList();

        var steps = review.Steps.OrderBy(s => s.Index).ToList();
        // Who gave the standing verdict: on the last deciding step that gave it, whoever of its people answered so.
        var standingStep = steps.LastOrDefault(s => s.Deciding && s.Answer == review.Verdict);
        var standingBy = standingStep?.Participants.Where(p => p.Answer == review.Verdict && p.AnsweredAt is not null)
            .OrderBy(p => p.AnsweredAt).LastOrDefault();
        var fields = new List<StampField>
        {
            new("Reviewed by", standingBy?.UserName ?? (standingStep is { ByProxy: true } ? standingStep.PartyName ?? "" : "")),
            new("Date", Day(standingBy?.AnsweredAt ?? standingStep?.CompletedAt ?? review.DecidedAt)),
        };
        if (choices.Shows("STATUS") && review.GrantedStatus is { } status) fields.Add(new("Released for", status));
        if (choices.Shows("DOCUMENT")) fields.Add(new("Document", $"{document.Number} rev {revision.Value}"));
        if (choices.Shows("REVIEW")) fields.Add(new("Review", review.Number));

        var rows = new List<StampRow>();
        if (choices.Shows("STEPS"))
        {
            foreach (var step in steps)
            {
                foreach (var one in step.Participants.Where(p => p.AnsweredAt is not null && p.Answer is not null).OrderBy(p => p.AnsweredAt))
                    rows.Add(new($"{step.Index + 1}. {step.Title}", Grade(step.Deciding ? review.VerdictSet : ReviewSets.Advice, one.Answer), one.UserName, Day(one.AnsweredAt)));
                if (step.ByProxy && step.ForeignAnswer is { } theirs)
                    rows.Add(new($"{step.Index + 1}. {step.Title}", theirs, step.PartyName ?? "", Day(step.CompletedAt)));
            }
        }
        var organization = await db.Tenants.AsNoTracking().Where(t => t.Id == document.TenantId).Select(t => t.Name).FirstOrDefaultAsync(cancellationToken) ?? "";
        var project = await db.Projects.AsNoTracking().Where(p => p.Id == document.ProjectId).Select(p => p.Code).FirstOrDefaultAsync(cancellationToken) ?? "";
        return new StampFace(organization, project, options, fields, rows, choices.Note);
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
    /// The stamp, one design for every outcome (owner: "the stamp is unified"), drawn as review stamps are (vendor
    /// documents, shop drawings): a double rule in one ink; the reviewing organization and "Document review" with the
    /// project; every grade the review could give, each with its box, the one given ticked and bold; who reviewed it and
    /// when (and, as chosen, what it is released for, the document, the review); every grade given as a small table;
    /// the organization's words at its foot. In a corner of every page (<paramref name="place"/>, top right by default).
    /// Each cell is cut to its width with an ellipsis; the review keeps everything whole in the app.
    /// </summary>
    public static byte[] Stamp(byte[] pdf, StampFace face, string place = StampChoices.TopRight, IReadOnlyList<string>? comments = null, string? commentsTitle = null)
    {
        using var input = new MemoryStream(pdf);
        using var document = PdfReader.Open(input, PdfDocumentOpenMode.Modify);
        var org = new XFont(EmbeddedFonts.Family, 8.5, XFontStyleEx.Bold);
        var caps = new XFont(EmbeddedFonts.Family, 5.8, XFontStyleEx.Bold);
        var option = new XFont(EmbeddedFonts.Family, 7.2, XFontStyleEx.Regular);
        var chosen = new XFont(EmbeddedFonts.Family, 7.6, XFontStyleEx.Bold);
        var value = new XFont(EmbeddedFonts.Family, 7, XFontStyleEx.Regular);
        var cell = new XFont(EmbeddedFonts.Family, 6.2, XFontStyleEx.Regular);
        var foot = new XFont(EmbeddedFonts.Family, 5.6, XFontStyleEx.Regular);
        // One ink, as a rubber stamp: the box ticked says the outcome, never a colour.
        var colour = XColor.FromArgb(255, 28, 52, 110);
        var ink = new XSolidBrush(colour);
        var faint = new XSolidBrush(XColor.FromArgb(200, colour.R, colour.G, colour.B));
        var paper = new XSolidBrush(XColor.FromArgb(235, 255, 255, 255));
        var outer = new XPen(colour, 1.4);
        var inner = new XPen(colour, 0.45);
        var rule = new XPen(colour, 0.4);
        var boxPen = new XPen(colour, 0.6);
        var withComments = comments is { Count: > 0 };

        const double width = 236, pad = 7, optionH = 9.5, fieldH = 9, rowH = 8.5, footH = 7;
        double[] cols = [0.29, 0.27, 0.23, 0.21];
        var fields = withComments ? [.. face.Fields, new StampField("Why", $"{comments!.Count} comment{(comments.Count == 1 ? "" : "s")}, on the last page")] : face.Fields.ToList();

        foreach (var page in document.Pages.Cast<PdfPage>().ToList())
        {
            using var gfx = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
            string Fit(string text, XFont font, double room)
            {
                if (gfx.MeasureString(text, font).Width <= room) return text;
                while (text.Length > 1 && gfx.MeasureString(text + "…", font).Width > room) text = text[..^1];
                return text.TrimEnd() + "…";
            }
            List<string> Wrap(string text, XFont font, double room)
            {
                var lines = new List<string>();
                var line = "";
                foreach (var word in text.Replace("\r", "").Split(' ', '\n'))
                {
                    var candidate = line.Length == 0 ? word : $"{line} {word}";
                    if (gfx.MeasureString(candidate, font).Width > room && line.Length > 0) { lines.Add(line); line = word; }
                    else line = candidate;
                }
                if (line.Length > 0) lines.Add(line);
                return lines.Take(4).ToList();
            }
            var room = width - 2 * pad;
            var footLines = face.Note is { Length: > 0 } note ? Wrap(note, foot, room) : [];
            var height = 4 + 12 + 8 + 5 + face.Options.Count * optionH + 5 + fields.Count * fieldH
                + (face.Rows.Count > 0 ? 5 + 7 + face.Rows.Count * rowH : 0)
                + (footLines.Count > 0 ? 5 + footLines.Count * footH : 0) + pad;

            var x = place.EndsWith("LEFT") ? 18 : page.Width.Point - width - 18;
            var top = place.StartsWith("BOTTOM") ? page.Height.Point - height - 18 : 18;
            gfx.DrawRectangle(outer, paper, new XRect(x, top, width, height));
            gfx.DrawRectangle(inner, new XRect(x + 2.2, top + 2.2, width - 4.4, height - 4.4));
            var left = x + pad;

            // Who reviewed, and what this is.
            var y = top + 4 + 10;
            gfx.DrawString(Fit(face.Organization.ToUpperInvariant(), org, room * 0.62), org, ink, left, y);
            gfx.DrawString("DOCUMENT REVIEW", caps, ink, new XRect(left, y - 7, room, 8), XStringFormats.TopRight);
            y += 8;
            if (face.Project.Length > 0) gfx.DrawString(Fit($"Project {face.Project}", value, room), value, faint, left, y);
            y += 4;
            gfx.DrawLine(rule, left, y, left + room, y);

            // Every grade it could give, the one given ticked.
            y += 3;
            foreach (var one in face.Options)
            {
                y += optionH;
                var box = new XRect(left, y - 6.2, 6.2, 6.2);
                gfx.DrawRectangle(boxPen, box);
                if (one.Given)
                {
                    var tick = new XPen(colour, 1.1);
                    gfx.DrawLine(tick, box.X + 1.1, box.Y + 1.1, box.Right - 1.1, box.Bottom - 1.1);
                    gfx.DrawLine(tick, box.Right - 1.1, box.Y + 1.1, box.X + 1.1, box.Bottom - 1.1);
                }
                var font = one.Given ? chosen : option;
                // A short code people cite (C1, A) stands in its own column; a long one (ACCEPTED) only repeats the words.
                var cited = one.Code.Length <= 4 && !string.Equals(one.Code, one.Words, StringComparison.OrdinalIgnoreCase);
                var codeW = face.Options.Any(o => o.Code.Length <= 4 && !string.Equals(o.Code, o.Words, StringComparison.OrdinalIgnoreCase)) ? 24.0 : 0;
                if (cited) gfx.DrawString(one.Code, font, ink, left + 10, y);
                gfx.DrawString(Fit(one.Words, font, room - 10 - codeW), font, one.Given ? ink : faint, left + 10 + codeW, y);
            }
            y += 4;
            gfx.DrawLine(rule, left, y, left + room, y);

            // Who reviewed it and when, and what was chosen besides.
            foreach (var one in fields)
            {
                y += fieldH;
                gfx.DrawString(one.Label.ToUpperInvariant(), caps, faint, left, y);
                gfx.DrawString(Fit(one.Value, value, room - 52), value, ink, left + 52, y);
            }

            if (face.Rows.Count > 0)
            {
                y += 4;
                gfx.DrawLine(rule, left, y, left + room, y);
                y += 7;
                string[] heads = ["STEP", "GRADE", "BY", "ON"];
                var cx = left;
                for (var i = 0; i < 4; i++) { gfx.DrawString(heads[i], caps, faint, cx, y); cx += cols[i] * room; }
                foreach (var row in face.Rows)
                {
                    y += rowH;
                    string[] cells = [row.Step, row.Grade, row.Who, row.On];
                    cx = left;
                    for (var i = 0; i < 4; i++) { gfx.DrawString(Fit(cells[i], cell, cols[i] * room - 3), cell, ink, cx, y); cx += cols[i] * room; }
                }
            }
            if (footLines.Count > 0)
            {
                y += 4;
                gfx.DrawLine(rule, left, y, left + room, y);
                foreach (var line in footLines) { y += footH; gfx.DrawString(line, foot, faint, left, y); }
            }
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

/// <summary>
/// What the stamp says, one design whatever the outcome: the reviewing organization and the project; every grade the
/// review could give, the one given ticked; its fields (reviewed by, date, and what the project chose to add); every grade
/// given (one row each); the organization's words at its foot.
/// </summary>
public sealed record StampFace(string Organization, string Project, IReadOnlyList<StampOption> Options,
    IReadOnlyList<StampField> Fields, IReadOnlyList<StampRow> Rows, string? Note)
{
    /// <summary>A grade's words: its name, else its code read as words (NO_COMMENT, "No comment"), never the app's code.</summary>
    public static string Words(string code, string? label) => string.IsNullOrWhiteSpace(label)
        ? System.Globalization.CultureInfo.InvariantCulture.TextInfo.ToTitleCase(code.Replace('_', ' ').ToLowerInvariant())
        : label.Trim();

    /// <summary>A grade in a line: its name; a short code people cite (C1, A) goes before it.</summary>
    public static string Grade(string code, string? label)
    {
        var words = Words(code, label);
        return code.Length <= 3 && !string.Equals(code, words, StringComparison.OrdinalIgnoreCase) ? $"{code} — {words}" : words;
    }
}

/// <summary>One grade the review could give: its code, its words, and whether it is the one given.</summary>
public sealed record StampOption(string Code, string Words, bool Given);

/// <summary>A field of the stamp: what it is, and what it says.</summary>
public sealed record StampField(string Label, string Value);

/// <summary>One grade given on the stamp: the step, the grade, who gave it, the day.</summary>
public sealed record StampRow(string Step, string Grade, string Who, string On);

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
/// What is asked of the stamp (owner: a card of its own, Settings → The stamp): the organization's answers are every
/// project's default, a project's own answers (where the organization leaves it free) stand over them. Stamped at all
/// (<c>POLICY_PDF_STAMP</c>); when: released after its review (<c>STAMP:RELEASED</c>, on unless set OFF) and returned by
/// it (<c>STAMP:RETURNED</c>, on unless set OFF); its other lines (<c>STAMP_SHOW:STEPS</c> on unless OFF; <c>STATUS</c>,
/// <c>DOCUMENT</c>, <c>REVIEW</c> off unless ON); why, the comments on a last page (<c>STAMP_COMMENTS</c> = ON); where it
/// sits (<c>STAMP_PLACE</c>, top right by default); and the marks across the page (<c>STAMP:SUPERSEDED</c>,
/// <c>STAMP:VOID</c>, <c>STAMP:HELD</c>; each on unless OFF).
/// </summary>
public sealed record StampChoices(bool All, IReadOnlyDictionary<string, string> Answers)
{
    public const string TopRight = "TOP_RIGHT";
    private static readonly string[] Places = [TopRight, "TOP_LEFT", "BOTTOM_RIGHT", "BOTTOM_LEFT"];
    public bool On(string kind) => All && Answers.GetValueOrDefault($"STAMP:{kind}") != "OFF";
    public bool Shows(string what) => Answers.GetValueOrDefault($"STAMP_SHOW:{what}") is { } set ? set == "ON" : what == "STEPS";
    public bool Comments => All && Answers.GetValueOrDefault("STAMP_COMMENTS") == "ON";
    public string Place => Answers.GetValueOrDefault("STAMP_PLACE") is { } place && Places.Contains(place) ? place : TopRight;
    /// <summary>The organization's words at the stamp's foot (what the review does not relieve the sender of…); none unless written.</summary>
    public string? Note => Answers.GetValueOrDefault("STAMP_NOTE") is { Length: > 0 } note ? note : null;

    private static bool IsStamp(string key) => key is "POLICY_PDF_STAMP" or "STAMP_COMMENTS" or "STAMP_PLACE" or "STAMP_NOTE" || key.StartsWith("STAMP:") || key.StartsWith("STAMP_SHOW:");

    public static async Task<StampChoices> ReadAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken)
    {
        var rows = await db.Set<Settings.Setting>().AsNoTracking().Where(s => s.ProjectId == projectId || s.ProjectId == null)
            .Select(s => new { s.ProjectId, s.Key, s.Value }).ToListAsync(cancellationToken);
        var answers = new Dictionary<string, string>();
        foreach (var row in rows.Where(r => r.ProjectId == null && IsStamp(r.Key))) answers[row.Key] = row.Value;
        foreach (var row in rows.Where(r => r.ProjectId == projectId && IsStamp(r.Key))) answers[row.Key] = row.Value;
        return new StampChoices(answers.GetValueOrDefault("POLICY_PDF_STAMP") != "OFF", answers);
    }
}
