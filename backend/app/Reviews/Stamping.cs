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
    /// <summary>Date and time, for a stamp the project asked to carry the time (<c>STAMP_SHOW:TIME</c>).</summary>
    private static readonly LocalDateTimePattern DateTimePattern = LocalDateTimePattern.CreateWithInvariantCulture("dd MMM yyyy HH:mm");

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
            var face = await FaceAsync(review, document, revision, zone, choices, false, cancellationToken);
            var comments = choices.Comments ? await CommentsAsync(review.Id, cancellationToken) : [];
            foreach (var rendition in revision.Files.Where(f => f.Kind == FileKinds.Rendition && f.Status == FileStatuses.Clean
                && f.Submission == revision.Submission).ToList())
            {
                if (revision.Files.Any(f => f.DerivedFromId == rendition.Id && f.Kind == FileKinds.Stamped)) continue;
                await DeriveAsync(rendition, FileKinds.Stamped, document, revision, bytes => Stamp(bytes, face, choices.Place, scale: choices.Scale, comments: comments,
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
        var face = await FaceAsync(review, document, revision, zone, choices, true, cancellationToken);
        var comments = choices.Comments ? await CommentsAsync(review.Id, cancellationToken) : [];
        foreach (var source in revision.Files.Where(f => f.Kind == FileKinds.Rendition && f.Status == FileStatuses.Clean && f.Submission == revision.Submission).ToList())
        {
            if (revision.Files.Any(f => f.DerivedFromId == source.Id && f.Kind == FileKinds.Returned)) continue;
            await DeriveAsync(source, FileKinds.Returned, document, revision, bytes => Stamp(bytes, face, choices.Place, scale: choices.Scale, comments: comments,
                commentsTitle: $"{document.Number} rev {revision.Value}: why, the comments of review {review.Number}"), cancellationToken);
        }
    }

    /// <summary>
    /// What the stamp says (owner: the grades given, the most influential standing out, who gave it and when, and
    /// sometimes why): always the standing verdict, larger (the most severe of the deciders', the later of equals, as the
    /// review worked it out), and who gave it and when; then, each as the project chose: every grade given with who and
    /// when, what it is released for, the document and its revision, the review's number.
    /// </summary>
    private async Task<StampFace> FaceAsync(Review review, Document document, Revision revision, DateTimeZone zone, StampChoices choices,
        bool returned, CancellationToken cancellationToken)
    {
        // The day, or the day and the time where the project asked for it.
        string Day(Instant? at) => at is not { } i ? ""
            : choices.Shows("TIME") ? DateTimePattern.Format(i.InZone(zone).LocalDateTime) : DatePattern.Format(i.InZone(zone).Date);
        var labels = await db.ValueEntries.AsNoTracking()
            .Where(v => v.SetKey == review.VerdictSet || v.SetKey == ReviewSets.Advice)
            .Select(v => new { v.SetKey, v.Code, v.Label }).ToListAsync(cancellationToken);
        string? LabelOf(string? set, string code) => labels.FirstOrDefault(l => l.SetKey == set && l.Code == code)?.Label;
        string Grade(string? set, string? code) => code is null ? "" : StampFace.Grade(code, LabelOf(set, code));

        var steps = review.Steps.OrderBy(s => s.Index).ToList();
        // Who gave the standing verdict: on the last deciding step that gave it, whoever of its people answered so.
        var standingStep = steps.LastOrDefault(s => s.Deciding && s.Answer == review.Verdict);
        var standingBy = standingStep?.Participants.Where(p => p.Answer == review.Verdict && p.AnsweredAt is not null)
            .OrderBy(p => p.AnsweredAt).LastOrDefault();

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
        // Who decided and when, only where the steps do not already say it (owner: "reviewed by repeats the steps").
        var fields = new List<StampField>();
        if (rows.Count == 0)
        {
            fields.Add(new("Reviewed by", standingBy?.UserName ?? (standingStep is { ByProxy: true } ? standingStep.PartyName ?? "" : "")));
            fields.Add(new("Date", Day(standingBy?.AnsweredAt ?? standingStep?.CompletedAt ?? review.DecidedAt)));
        }
        if (choices.Shows("STATUS") && review.GrantedStatus is { } status) fields.Add(new("Released for", status));
        if (choices.Shows("DOCUMENT")) fields.Add(new("Document", $"{document.Number} rev {revision.Value}"));
        if (choices.Shows("REVIEW")) fields.Add(new("Review", review.Number));

        var organization = await db.Tenants.AsNoTracking().Where(t => t.Id == document.TenantId).Select(t => t.Name).FirstOrDefaultAsync(cancellationToken) ?? "";
        var project = await db.Projects.AsNoTracking().Where(p => p.Id == document.ProjectId).Select(p => p.Code).FirstOrDefaultAsync(cancellationToken) ?? "";
        var outcome = review.Verdict is { } given ? StampFace.Words(given, LabelOf(review.VerdictSet, given)) : "";
        var code = review.Verdict is { Length: <= 4 } shortCode && !string.Equals(shortCode, outcome, StringComparison.OrdinalIgnoreCase) ? shortCode : null;
        return new StampFace(organization, project, code, outcome, returned, fields, rows, choices.Note);
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
    /// The stamp, one design for every outcome (owner: "the stamp is unified"), in the colour its revision's state has in
    /// the register (released emerald, returned rose): a thin rounded border; the reviewing organization and the project;
    /// the outcome alone, in a tinted badge, its words only (owner: "show only the outcome", no tick, no "Document review");
    /// who reviewed it and when, unless every grade given follows as a small table (step, grade, by, on); what the project
    /// chose to add; the organization's words at its foot. In a corner of every page (<paramref name="place"/>).
    /// </summary>
    public static byte[] Stamp(byte[] pdf, StampFace face, string place = StampChoices.TopRight, IReadOnlyList<string>? comments = null,
        string? commentsTitle = null, double scale = 1)
    {
        using var input = new MemoryStream(pdf);
        using var document = PdfReader.Open(input, PdfDocumentOpenMode.Modify);
        var caps = new XFont(EmbeddedFonts.Family, 5.8, XFontStyleEx.Bold);
        var heading = new XFont(EmbeddedFonts.Family, 7.2, XFontStyleEx.Bold);
        var outcome = new XFont(EmbeddedFonts.Family, 8.6, XFontStyleEx.Bold);
        var value = new XFont(EmbeddedFonts.Family, 7, XFontStyleEx.Regular);
        var cell = new XFont(EmbeddedFonts.Family, 6.2, XFontStyleEx.Regular);
        var foot = new XFont(EmbeddedFonts.Family, 5.6, XFontStyleEx.Regular);
        // The register's colours for the state the review left it in: released (emerald 700), returned (rose 700).
        var colour = face.Returned ? XColor.FromArgb(255, 190, 18, 60) : XColor.FromArgb(255, 4, 120, 87);
        var tint = face.Returned ? XColor.FromArgb(255, 255, 241, 242) : XColor.FromArgb(255, 236, 253, 245);
        var ink = new XSolidBrush(colour);
        var text = new XSolidBrush(XColor.FromArgb(255, 30, 41, 59));
        var muted = new XSolidBrush(XColor.FromArgb(255, 100, 116, 139));
        var paper = new XSolidBrush(XColor.FromArgb(240, 255, 255, 255));
        var border = new XPen(colour, 0.9);
        var line = new XPen(XColor.FromArgb(255, 226, 232, 240), 0.5);
        var withComments = comments is { Count: > 0 };
        var fields = withComments ? [.. face.Fields, new StampField("Why", $"{comments!.Count} comment{(comments.Count == 1 ? "" : "s")}, on the last page")] : face.Fields.ToList();

        const double width = 250, pad = 8, fieldH = 9, rowH = 8.6, footH = 6.8, badgeH = 14;
        // Step · grade · by · on; "on" takes more room when it carries the time as well.
        double[] cols = face.Rows.Any(r => r.On.Contains(':')) ? [0.25, 0.24, 0.22, 0.29] : [0.29, 0.26, 0.24, 0.21];

        foreach (var page in document.Pages.Cast<PdfPage>().ToList())
        {
            using var gfx = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
            string Fit(string s, XFont font, double room)
            {
                if (gfx.MeasureString(s, font).Width <= room) return s;
                while (s.Length > 1 && gfx.MeasureString(s + "…", font).Width > room) s = s[..^1];
                return s.TrimEnd() + "…";
            }
            List<string> Wrap(string s, XFont font, double room)
            {
                var lines = new List<string>();
                var current = "";
                foreach (var word in s.Replace("\r", "").Split(' ', '\n'))
                {
                    var candidate = current.Length == 0 ? word : $"{current} {word}";
                    if (gfx.MeasureString(candidate, font).Width > room && current.Length > 0) { lines.Add(current); current = word; }
                    else current = candidate;
                }
                if (current.Length > 0) lines.Add(current);
                return lines.Take(4).ToList();
            }
            var room = width - 2 * pad;
            var footLines = face.Note is { Length: > 0 } note ? Wrap(note, foot, room) : [];
            var height = pad + 8 + 6 + badgeH + (fields.Count > 0 ? 4 + fields.Count * fieldH : 0)
                + (face.Rows.Count > 0 ? 6 + 7 + face.Rows.Count * rowH : 0)
                + (footLines.Count > 0 ? 6 + footLines.Count * footH : 0) + pad;

            // The stamp is drawn at its own size, then scaled as the project chose (frame and words together).
            var atX = place.EndsWith("LEFT") ? 18 : page.Width.Point - width * scale - 18;
            var atY = place.StartsWith("BOTTOM") ? page.Height.Point - height * scale - 18 : 18;
            var state = gfx.Save();
            gfx.TranslateTransform(atX, atY);
            gfx.ScaleTransform(scale);
            const double x = 0, top = 0;
            gfx.DrawRoundedRectangle(border, paper, new XRect(x, top, width, height), new XSize(7, 7));
            var left = x + pad;

            // Who reviewed, on what.
            var y = top + pad + 6;
            var who = face.Project.Length > 0 ? $"{face.Organization} · {face.Project}" : face.Organization;
            gfx.DrawString(Fit(who, heading, room), heading, text, left, y);

            // The outcome alone, in its badge.
            y += 6;
            var badge = new XRect(left, y, room, badgeH);
            gfx.DrawRoundedRectangle(new XSolidBrush(tint), badge, new XSize(5, 5));
            var said = face.Code is { } c ? $"{c} — {face.Outcome}" : face.Outcome;
            gfx.DrawString(Fit(said, outcome, room - 12), outcome, ink, new XRect(badge.X + 6, badge.Y, room - 12, badge.Height), XStringFormats.CenterLeft);
            y = badge.Bottom;

            if (fields.Count > 0)
            {
                y += 4;
                foreach (var one in fields)
                {
                    y += fieldH;
                    gfx.DrawString(one.Label.ToUpperInvariant(), caps, muted, left, y);
                    gfx.DrawString(Fit(one.Value, value, room - 52), value, text, left + 52, y);
                }
            }
            if (face.Rows.Count > 0)
            {
                y += 6;
                gfx.DrawLine(line, left, y - 2, left + room, y - 2);
                y += 5;
                string[] heads = ["STEP", "GRADE", "BY", "ON"];
                var cx = left;
                for (var i = 0; i < 4; i++) { gfx.DrawString(heads[i], caps, muted, cx, y); cx += cols[i] * room; }
                foreach (var row in face.Rows)
                {
                    y += rowH;
                    string[] cells = [row.Step, row.Grade, row.Who, row.On];
                    cx = left;
                    for (var i = 0; i < 4; i++) { gfx.DrawString(Fit(cells[i], cell, cols[i] * room - 3), cell, text, cx, y); cx += cols[i] * room; }
                }
            }
            if (footLines.Count > 0)
            {
                y += 5;
                gfx.DrawLine(line, left, y - 1, left + room, y - 1);
                y += 1;
                foreach (var l in footLines) { y += footH; gfx.DrawString(l, foot, muted, left, y); }
            }
            gfx.Restore(state);
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
/// What the stamp says, one design whatever the outcome: the reviewing organization and the project; the outcome alone
/// (its short code, its words, and whether its review returned the revision, which gives the stamp its colour); its
/// fields; every grade given (one row each); the organization's words at its foot.
/// </summary>
public sealed record StampFace(string Organization, string Project, string? Code, string Outcome, bool Returned,
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
    /// <summary>How large the stamp is drawn (<c>STAMP_SIZE</c>): small, normal (the default), large, larger.</summary>
    public double Scale => Answers.GetValueOrDefault("STAMP_SIZE") switch { "S" => 0.8, "L" => 1.25, "XL" => 1.5, _ => 1 };
    /// <summary>The organization's words at the stamp's foot (what the review does not relieve the sender of…); none unless written.</summary>
    public string? Note => Answers.GetValueOrDefault("STAMP_NOTE") is { Length: > 0 } note ? note : null;

    private static bool IsStamp(string key) => key is "POLICY_PDF_STAMP" or "STAMP_COMMENTS" or "STAMP_PLACE" or "STAMP_NOTE" or "STAMP_SIZE" || key.StartsWith("STAMP:") || key.StartsWith("STAMP_SHOW:");

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
