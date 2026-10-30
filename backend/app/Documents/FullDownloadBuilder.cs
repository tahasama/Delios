using System.Globalization;
using System.IO.Compression;
using System.Text;
using ClosedXML.Excel;
using Delios.Host.Identity;
using Delios.Host.Notifications;
using Delios.Host.Packages;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Tenancy;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfSharp.Pdf;

namespace Delios.Host.Documents;

/// <summary>
/// Makes a full download (<see cref="FullDownload"/>) in the worker: what it holds is read in one short transaction,
/// then the zip is written to a temporary file, every file streamed from storage one at a time (never held whole in
/// memory), sealed and kept; the person is told it is ready. A failure is recorded, and the person told, so a download
/// never stays "being made".
/// </summary>
public sealed class FullDownloadBuilder(
    DeliosDbContext db, TenantContext tenant, FileStorage storage, Notifier notifier, IClock clock, ILogger<FullDownloadBuilder> logger)
{
    static FullDownloadBuilder() => GlobalFontSettings.FontResolver ??= new EmbeddedFonts();

    /// <summary>The most audit rows written: an Excel sheet holds a million; past this the sheet says it was cut.</summary>
    private const int AuditLimit = 500_000;

    public static string ZipName(FullDownload download)
    {
        var day = download.RequestedAt.InUtc().Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var what = download.ProjectId is null ? "organization" : download.Scope.Split(" · ")[0];
        return $"DELIOS full download {Safe(what)} {day}.zip";
    }

    public async Task ProcessAsync(FullDownloadRequested message, CancellationToken cancellationToken)
    {
        tenant.Set(message.TenantId);
        FullDownload job;
        Plan plan;
        await using (var read = await db.Database.BeginTransactionAsync(cancellationToken))
        {
            var found = await db.Set<FullDownload>().SingleOrDefaultAsync(d => d.Id == message.DownloadId, cancellationToken);
            if (found is not { Status: FullDownloadStatuses.Queued }) return;
            job = found;
            job.Status = FullDownloadStatuses.Running;
            job.StartedAt = clock.GetCurrentInstant();
            await db.SaveChangesAsync(cancellationToken);
            plan = await PlanAsync(job, cancellationToken);
            await read.CommitAsync(cancellationToken);
        }

        var temp = Path.GetTempFileName();
        try
        {
            int count;
            await using (var file = File.Create(temp))
            using (var zip = new ZipArchive(file, ZipArchiveMode.Create))
                count = await WriteAsync(zip, job, plan, cancellationToken);
            var key = $"{job.TenantId}/downloads/{job.Id}.zip";
            await storage.PutFileAsync(key, temp, cancellationToken);
            var size = new FileInfo(temp).Length;

            List<string> gone;
            await using (var done = await db.Database.BeginTransactionAsync(cancellationToken))
            {
                db.ChangeTracker.Clear();
                var mine = await db.Set<FullDownload>().SingleAsync(d => d.Id == job.Id, cancellationToken);
                mine.Status = FullDownloadStatuses.Done;
                mine.FinishedAt = clock.GetCurrentInstant();
                mine.ObjectKey = key;
                mine.Size = size;
                mine.FileCount = count;
                // A newer one takes the place of the older: its zip is only a copy of what the register holds.
                var older = await db.Set<FullDownload>().Where(d => d.RequestedById == job.RequestedById && d.Id != job.Id
                    && d.Status == FullDownloadStatuses.Done).ToListAsync(cancellationToken);
                gone = older.Where(d => d.ObjectKey is not null).Select(d => d.ObjectKey!).ToList();
                foreach (var one in older) { one.Status = FullDownloadStatuses.Replaced; one.ObjectKey = null; }
                await notifier.NotifyAsync(job.TenantId, job.ProjectId, [job.RequestedById], NotificationKinds.General,
                    $"Your full download is ready: {job.Scope}", $"{count} files, {Megabytes(size)}.", "/full-download", cancellationToken);
                await db.SaveChangesAsync(cancellationToken);
                await done.CommitAsync(cancellationToken);
            }
            foreach (var one in gone) await storage.RemoveAsync(one, cancellationToken);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogError(e, "Full download {DownloadId} failed", job.Id);
            db.ChangeTracker.Clear();
            await using var record = await db.Database.BeginTransactionAsync(cancellationToken);
            var failed = await db.Set<FullDownload>().SingleAsync(d => d.Id == job.Id, cancellationToken);
            failed.Status = FullDownloadStatuses.Failed;
            failed.Error = e.Message.Length > 2000 ? e.Message[..2000] : e.Message;
            failed.FinishedAt = clock.GetCurrentInstant();
            await notifier.NotifyAsync(job.TenantId, job.ProjectId, [job.RequestedById], NotificationKinds.General,
                $"Your full download could not be made: {job.Scope}", "Nothing was lost; ask for it again. If it fails again, write to support.",
                "/full-download", cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            await record.CommitAsync(cancellationToken);
        }
        finally
        {
            File.Delete(temp);
        }
    }

    // ── What goes in ──────────────────────────────────────────────────────────

    private sealed record Item(Document Document, Revision Revision, string Folder, List<StoredFile> Files);

    private sealed record Plan(
        List<Item> Items, Dictionary<Guid, Project> Projects, List<Review> Reviews, Dictionary<Guid, List<ReviewStep>> Steps,
        Dictionary<Guid, List<ReviewParticipant>> Answers, Dictionary<Guid, List<ReviewComment>> Comments,
        List<Transmittal> Transmittals, List<Audit.AuditEvent> Acts, bool AuditCut);

    private async Task<Plan> PlanAsync(FullDownload job, CancellationToken cancellationToken)
    {
        var projects = await db.Projects.AsNoTracking().Where(p => job.ProjectIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, cancellationToken);
        var documents = await db.Documents.AsNoTracking().Where(d => job.DocumentIds.Contains(d.Id)).ToListAsync(cancellationToken);
        // The newest released revision of each, and the files it carries now: its PDF as released (stamped where it
        // was), else its PDF, and its source file, of its newest submission.
        var revisions = (await db.Revisions.AsNoTracking()
                .Where(r => job.DocumentIds.Contains(r.DocumentId) && r.State == RevisionStates.Released).ToListAsync(cancellationToken))
            .GroupBy(r => r.DocumentId).ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.ReleasedAt ?? r.CreatedAt).First());
        var revisionIds = revisions.Values.Select(r => r.Id).ToList();
        var files = (await db.StoredFiles.AsNoTracking()
                .Where(f => f.RevisionId != null && revisionIds.Contains(f.RevisionId.Value) && f.Status == FileStatuses.Clean
                    && (f.Kind == FileKinds.Stamped || f.Kind == FileKinds.Rendition || f.Kind == FileKinds.Native))
                .ToListAsync(cancellationToken))
            .GroupBy(f => f.RevisionId!.Value).ToDictionary(g => g.Key, g =>
            {
                var latest = g.Max(f => f.Submission);
                var stamped = g.Where(f => f.Kind == FileKinds.Stamped).OrderByDescending(f => f.CreatedAt).Take(1).ToList();
                var pdf = stamped.Count > 0 ? stamped : g.Where(f => f.Kind == FileKinds.Rendition && f.Submission == latest).Take(1).ToList();
                return pdf.Concat(g.Where(f => f.Kind == FileKinds.Native && f.Submission == latest)).ToList();
            });

        var folders = await FoldersAsync(job, documents, projects, cancellationToken);
        var items = documents.Where(d => revisions.ContainsKey(d.Id))
            .OrderBy(d => projects.TryGetValue(d.ProjectId, out var p) ? p.Code : "").ThenBy(d => d.Number)
            .Select(d => new Item(d, revisions[d.Id], folders[d.Id], files.GetValueOrDefault(revisions[d.Id].Id) ?? []))
            .ToList();

        var reviews = new List<Review>();
        var steps = new Dictionary<Guid, List<ReviewStep>>();
        var answers = new Dictionary<Guid, List<ReviewParticipant>>();
        var comments = new Dictionary<Guid, List<ReviewComment>>();
        if (job.WithReviews)
        {
            reviews = await db.Reviews.AsNoTracking().Where(r => revisionIds.Contains(r.RevisionId)).OrderBy(r => r.StartedAt).ToListAsync(cancellationToken);
            var reviewIds = reviews.Select(r => r.Id).ToList();
            var allSteps = await db.ReviewSteps.AsNoTracking().Where(s => reviewIds.Contains(s.ReviewId)).OrderBy(s => s.Index).ToListAsync(cancellationToken);
            steps = allSteps.GroupBy(s => s.ReviewId).ToDictionary(g => g.Key, g => g.ToList());
            var stepIds = allSteps.Select(s => s.Id).ToList();
            answers = (await db.ReviewParticipants.AsNoTracking().Where(p => stepIds.Contains(p.StepId)).ToListAsync(cancellationToken))
                .GroupBy(p => p.StepId).ToDictionary(g => g.Key, g => g.ToList());
            // A comment taken back by its author is no longer shown: only what stands.
            comments = (await db.ReviewComments.AsNoTracking()
                    .Where(c => reviewIds.Contains(c.ReviewId) && c.Status != CommentStatuses.Withdrawn).OrderBy(c => c.CreatedAt).ToListAsync(cancellationToken))
                .GroupBy(c => c.ReviewId).ToDictionary(g => g.Key, g => g.ToList());
        }

        var transmittals = job.WithTransmittals
            ? await db.Transmittals.AsNoTracking().Include(t => t.Items).Include(t => t.Recipients)
                .Where(t => job.TransmittalIds.Contains(t.Id)).OrderBy(t => t.IssuedAt).ToListAsync(cancellationToken)
            : [];

        List<Audit.AuditEvent> audit = [];
        var cut = false;
        if (job.WithAudit)
        {
            var query = db.AuditEvents.AsNoTracking().Where(e => job.ProjectId == null || e.ProjectId == job.ProjectId);
            audit = await query.OrderBy(e => e.Id).Take(AuditLimit + 1).ToListAsync(cancellationToken);
            cut = audit.Count > AuditLimit;
            if (cut) audit.RemoveAt(audit.Count - 1);
        }
        return new Plan(items, projects, reviews, steps, answers, comments, transmittals, audit, cut);
    }

    /// <summary>Each document's folder, as the person chose: the package tree, the levels in their order, or flat.</summary>
    private async Task<Dictionary<Guid, string>> FoldersAsync(FullDownload job, List<Document> documents, Dictionary<Guid, Project> projects,
        CancellationToken cancellationToken)
    {
        var several = projects.Count > 1;
        string ProjectFolder(Document d) => projects.TryGetValue(d.ProjectId, out var p) ? Safe(p.Code) : "Project";
        var folders = new Dictionary<Guid, string>();
        switch (job.Layout)
        {
            case FullDownloadLayouts.Flat:
                foreach (var d in documents) folders[d.Id] = several ? ProjectFolder(d) : "";
                break;

            case FullDownloadLayouts.Levels:
            {
                var labels = await LabelsAsync(job, cancellationToken);
                string[] levels = several && !job.Levels.Contains(FullDownloadLevels.Project)
                    ? [FullDownloadLevels.Project, .. job.Levels] : job.Levels;
                string Named(string set, string? code) => code is null or "" ? "None"
                    : labels.TryGetValue((set, code), out var label) && label != code ? Safe($"{code} {label}") : Safe(code);
                foreach (var d in documents)
                    folders[d.Id] = string.Join('/', levels.Select(level => level switch
                    {
                        FullDownloadLevels.Project => ProjectFolder(d),
                        FullDownloadLevels.DeliverableType => Named(ValueSets.DeliverableTypes, d.DeliverableType),
                        FullDownloadLevels.Discipline => Named(ValueSets.Disciplines, d.Discipline),
                        FullDownloadLevels.DocType => Named(ValueSets.DocumentTypes, d.DocType),
                        FullDownloadLevels.Phase => Named(ValueSets.Phases, d.Phase),
                        _ => Named("ORIGINATOR", d.Originator),
                    }));
                break;
            }

            default:
            {
                // The package tree: each package under the one it sits in, by its number and title. A document in two
                // trees (two separate delivery trees may share one) is filed in the first, by package number.
                var ids = documents.Select(d => d.Id).ToList();
                var packages = await db.Packages.AsNoTracking().Where(p => job.ProjectIds.Contains(p.ProjectId)).ToDictionaryAsync(p => p.Id, cancellationToken);
                var members = await db.PackageMembers.AsNoTracking().Where(m => ids.Contains(m.DocumentId)).ToListAsync(cancellationToken);
                string PathOf(Package package)
                {
                    var parts = new List<string>();
                    var seen = new HashSet<Guid>();
                    for (Package? at = package; at is not null && seen.Add(at.Id); at = at.ParentId is { } up ? packages.GetValueOrDefault(up) : null)
                        parts.Insert(0, Safe($"{at.Number} {at.Title}"));
                    return string.Join('/', parts);
                }
                var home = members.Where(m => packages.ContainsKey(m.PackageId)).GroupBy(m => m.DocumentId)
                    .ToDictionary(g => g.Key, g => g.Select(m => packages[m.PackageId]).OrderBy(p => p.Number).First());
                foreach (var d in documents)
                {
                    var within = home.TryGetValue(d.Id, out var package) ? PathOf(package) : "In no package";
                    folders[d.Id] = several ? $"{ProjectFolder(d)}/{within}" : within;
                }
                break;
            }
        }
        return folders;
    }

    /// <summary>The words of each value the levels name, the project's own list first, else the organization's.</summary>
    private async Task<Dictionary<(string Set, string Code), string>> LabelsAsync(FullDownload job, CancellationToken cancellationToken)
    {
        string[] sets = [ValueSets.DeliverableTypes, ValueSets.Disciplines, ValueSets.DocumentTypes, ValueSets.Phases];
        var values = await db.ValueEntries.IgnoreQueryFilters().AsNoTracking()
            .Where(v => sets.Contains(v.SetKey) && (v.ProjectId == null || (job.ProjectId != null && v.ProjectId == job.ProjectId)))
            .Select(v => new { v.SetKey, v.Code, v.Label, v.ProjectId }).ToListAsync(cancellationToken);
        var labels = values.GroupBy(v => (v.SetKey, v.Code))
            .ToDictionary(g => g.Key, g => g.OrderByDescending(v => v.ProjectId != null).First().Label);
        foreach (var party in await db.Parties.AsNoTracking().Select(p => new { p.Code, p.Name }).ToListAsync(cancellationToken))
            labels[("ORIGINATOR", party.Code)] = party.Name;
        return labels;
    }

    // ── Writing it ────────────────────────────────────────────────────────────

    private async Task<int> WriteAsync(ZipArchive zip, FullDownload job, Plan plan, CancellationToken cancellationToken)
    {
        var count = 0;
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string Unique(string path)
        {
            if (used.Add(path)) return path;
            var extension = Path.GetExtension(path);
            var stem = path[..^extension.Length];
            for (var n = 2; ; n++)
                if (used.Add($"{stem} ({n}){extension}")) return $"{stem} ({n}){extension}";
        }
        static string Join(string folder, string name) => folder.Length == 0 ? name : $"{folder}/{name}";

        var where = new Dictionary<Guid, string>();
        foreach (var item in plan.Items)
        {
            var stem = Safe($"{item.Document.Number} rev {item.Revision.Value}");
            foreach (var file in item.Files)
            {
                var extension = Path.GetExtension(file.Name);
                var name = file.Kind == FileKinds.Native ? $"{stem} source{extension}" : $"{stem}.pdf";
                var path = Unique(Join(item.Folder, name));
                var entry = zip.CreateEntry(path, CompressionLevel.Fastest);
                await using (var to = entry.Open())
                await using (var from = await storage.OpenReadAsync(file.ObjectKey, cancellationToken))
                    await from.CopyToAsync(to, cancellationToken);
                count++;
            }
            where[item.Document.Id] = item.Folder.Length == 0 ? "(top)" : item.Folder;

            if (job.WithReviews)
                foreach (var review in plan.Reviews.Where(r => r.RevisionId == item.Revision.Id))
                {
                    var entry = zip.CreateEntry(Unique(Join(item.Folder, Safe($"{stem} review {review.Number}.pdf"))), CompressionLevel.Fastest);
                    await using var to = entry.Open();
                    var pdf = ReviewPdf(item, review, plan);
                    await to.WriteAsync(pdf, cancellationToken);
                    count++;
                }
        }

        if (job.WithTransmittals)
            foreach (var t in plan.Transmittals)
            {
                var project = plan.Projects.TryGetValue(t.ProjectId, out var p) ? p : null;
                var folder = plan.Projects.Count > 1 && project is not null ? $"Transmittals/{Safe(project.Code)}" : "Transmittals";
                var entry = zip.CreateEntry(Unique($"{folder}/{Safe(t.Number)}.pdf"), CompressionLevel.Fastest);
                await using var to = entry.Open();
                await to.WriteAsync(TransmittalPdf(t, project), cancellationToken);
                count++;
            }

        if (job.WithRegister)
        {
            var entry = zip.CreateEntry(Unique("Register.xlsx"), CompressionLevel.Fastest);
            await using var to = entry.Open();
            await to.WriteAsync(RegisterSheet(plan, where), cancellationToken);
            count++;
        }
        if (job.WithAudit)
        {
            var entry = zip.CreateEntry(Unique("Audit trail.xlsx"), CompressionLevel.Fastest);
            await using var to = entry.Open();
            await to.WriteAsync(AuditSheet(plan), cancellationToken);
            count++;
        }

        // What it is, said inside it: who asked, when, what it holds and what it leaves out.
        var note = new StringBuilder();
        note.AppendLine($"DELIOS full download: {job.Scope}");
        note.AppendLine($"Asked by {job.RequestedByName} on {job.RequestedAt.InUtc().ToString("d MMMM yyyy, HH:mm 'UTC'", CultureInfo.InvariantCulture)}.");
        note.AppendLine();
        note.AppendLine($"{plan.Items.Count} documents, each at its newest released revision: its PDF as released (stamped where it was) and its source file.");
        note.AppendLine("Only what the person who asked may read is in it.");
        note.AppendLine(job.Layout switch
        {
            FullDownloadLayouts.Flat => "Folders: none, every document side by side.",
            FullDownloadLayouts.Levels => $"Folders: {string.Join(" / ", job.Levels.Select(l => l.ToLowerInvariant()))}.",
            _ => "Folders: the packages, each inside the one it sits in; documents in no package under \"In no package\".",
        });
        if (job.WithReviews) note.AppendLine("Beside each document: its reviews, with every verdict, advice and comment.");
        if (job.WithTransmittals) note.AppendLine($"Transmittals: {plan.Transmittals.Count}, each as a letter.");
        if (job.WithRegister) note.AppendLine("Register.xlsx: every document in this download, and where it sits in it.");
        if (job.WithAudit) note.AppendLine(plan.AuditCut ? $"Audit trail.xlsx: the first {AuditLimit:N0} acts (there are more)." : "Audit trail.xlsx: every act recorded.");
        if (job.LeftOut.Length > 0)
        {
            note.AppendLine();
            note.AppendLine("Left out:");
            foreach (var one in job.LeftOut) note.AppendLine($"- {one}");
        }
        var readMe = zip.CreateEntry("Read me.txt", CompressionLevel.Fastest);
        await using (var to = readMe.Open())
            await to.WriteAsync(Encoding.UTF8.GetBytes(note.ToString()), cancellationToken);
        return count;
    }

    private static byte[] RegisterSheet(Plan plan, Dictionary<Guid, string> where)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.AddWorksheet("Register");
        string[] head = ["Project", "Document", "Title", "Deliverable type", "Type", "Discipline", "Phase", "Originator", "Revision", "Released for", "Released on", "Released by", "Folder"];
        for (var c = 0; c < head.Length; c++) sheet.Cell(1, c + 1).Value = head[c];
        sheet.Row(1).Style.Font.Bold = true;
        var row = 2;
        foreach (var item in plan.Items)
        {
            var d = item.Document;
            var r = item.Revision;
            object?[] values =
            [
                plan.Projects.TryGetValue(d.ProjectId, out var p) ? p.Code : "", d.Number, d.Title, d.DeliverableType, d.DocType, d.Discipline,
                d.Phase ?? "", d.Originator ?? "", r.Value, r.StatusCode ?? "",
                r.ReleasedAt?.InUtc().Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "", r.ReleasedByName ?? "", where.GetValueOrDefault(d.Id) ?? "",
            ];
            // Kept as text: a value starting with = + - @ never runs as a formula.
            for (var c = 0; c < values.Length; c++) sheet.Cell(row, c + 1).SetValue(values[c]?.ToString() ?? "");
            row++;
        }
        sheet.SheetView.FreezeRows(1);
        sheet.Columns().AdjustToContents(1, Math.Min(row, 200));
        using var output = new MemoryStream();
        workbook.SaveAs(output);
        return output.ToArray();
    }

    private static byte[] AuditSheet(Plan plan)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.AddWorksheet("Audit trail");
        string[] head = ["When (UTC)", "Project", "Who", "Act", "What", "Detail"];
        for (var c = 0; c < head.Length; c++) sheet.Cell(1, c + 1).Value = head[c];
        sheet.Row(1).Style.Font.Bold = true;
        var row = 2;
        foreach (var e in plan.Acts)
        {
            sheet.Cell(row, 1).SetValue(e.At.InUtc().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture));
            sheet.Cell(row, 2).SetValue(e.ProjectId is { } id && plan.Projects.TryGetValue(id, out var p) ? p.Code : "");
            sheet.Cell(row, 3).SetValue(e.ActorName);
            sheet.Cell(row, 4).SetValue(e.Action);
            sheet.Cell(row, 5).SetValue(e.EntityLabel ?? "");
            sheet.Cell(row, 6).SetValue(e.Detail is { Length: > 32_000 } long_ ? long_[..32_000] : e.Detail ?? "");
            row++;
        }
        if (plan.AuditCut) sheet.Cell(row, 1).SetValue($"Cut at {AuditLimit:N0} acts: there are more.");
        sheet.SheetView.FreezeRows(1);
        using var output = new MemoryStream();
        workbook.SaveAs(output);
        return output.ToArray();
    }

    private static byte[] ReviewPdf(Item item, Review review, Plan plan)
    {
        var page = new PdfWriter($"Review {review.Number}");
        page.Title($"Review {review.Number}");
        page.Bold($"{item.Document.Number} rev {item.Revision.Value} · {item.Document.Title}");
        page.Text($"Route: {review.RouteName}. Started by {review.StartedByName} on {Day(review.StartedAt)}.");
        page.Text(review.DecidedAt is { } decided
            ? $"Decided on {Day(decided)}: {review.Verdict ?? "no verdict"}{(review.GrantedStatus is { } s ? $", released for {s}" : "")}."
            : $"Where it stands: {review.State.ToLowerInvariant().Replace('_', ' ')}.");
        if (review.ReturnReason is not null) page.Text($"Sent back: {review.ReturnReason}{(review.ReturnNote is { } n ? $" — {n}" : "")}");
        page.Gap();
        var comments = plan.Comments.GetValueOrDefault(review.Id) ?? [];
        foreach (var step in plan.Steps.GetValueOrDefault(review.Id) ?? [])
        {
            page.Bold($"Step {step.Index + 1} · {step.Title} · {(step.Deciding ? "decides" : "advises")}");
            if (step.PartyName is not null) page.Text($"Answered by {step.PartyName}{(step.ForeignAnswer is { } f ? $": {f}" : "")}{(step.RecordedByName is { } by ? $" (recorded by {by})" : "")}");
            foreach (var answer in (plan.Answers.GetValueOrDefault(step.Id) ?? []).Where(a => a.AnsweredAt is not null).OrderBy(a => a.AnsweredAt))
                page.Text($"{answer.AnsweredByName ?? answer.UserName}, {Day(answer.AnsweredAt!.Value)}: {answer.Answer}{(answer.GrantedStatus is { } g ? $" ({g})" : "")}{(answer.Note is { } note ? $" — {note}" : "")}");
            foreach (var comment in comments.Where(c => c.StepIndex == step.Index))
                page.Text($"{(comment.Blocking ? "Blocking comment" : "Comment")} by {comment.AuthorName}: {comment.Text}{(comment.Status == CommentStatuses.Closed ? $" (settled{(comment.Resolution is { } res ? $": {res}" : "")})" : "")}", indent: 12);
            page.Gap();
        }
        return page.Save();
    }

    private static byte[] TransmittalPdf(Transmittal t, Project? project)
    {
        var page = new PdfWriter($"Transmittal {t.Number}");
        page.Title($"Transmittal {t.Number}");
        if (project is not null) page.Text($"Project {project.Code} · {project.Name}");
        page.Text(t.Direction == TransmittalDirections.Incoming
            ? $"Received {Day(t.IssuedAt)} from {t.FromName ?? t.ToName}, recorded by {t.IssuedByName}{(t.TheirReference is { } r ? $" (their reference {r})" : "")}"
            : $"Sent {Day(t.IssuedAt)} by {t.IssuedByName} to {t.ToName}");
        page.Text($"For: {t.Reason}{(t.ResponseRequired ? $" · an answer is asked{(t.ResponseDue is { } due ? $" by {due.ToString("d MMMM yyyy", CultureInfo.InvariantCulture)}" : "")}" : "")}");
        var to = t.Recipients.Where(r => r.Kind == RecipientKinds.To).Select(r => r.Organization is null ? r.Name : $"{r.Name} ({r.Organization})").ToList();
        var copies = t.Recipients.Where(r => r.Kind != RecipientKinds.To).Select(r => r.Name).ToList();
        if (to.Count > 0) page.Text($"To: {string.Join(", ", to)}");
        if (copies.Count > 0) page.Text($"Copied in: {string.Join(", ", copies)}");
        page.Gap();
        page.Bold(t.Subject.Length > 0 ? t.Subject : "(no subject)");
        if (t.Message is { Length: > 0 } message) foreach (var line in message.Split('\n')) page.Text(line.TrimEnd('\r'));
        if (t.Items.Count > 0)
        {
            page.Gap();
            page.Bold($"What it carried ({t.Items.Count})");
            foreach (var item in t.Items.OrderBy(i => i.DocumentNumber))
                page.Text($"{(item.DocumentNumber.Length > 0 ? item.DocumentNumber + " " : "")}rev {item.RevisionValue}{(item.StatusCode is { } s ? $" · {s}" : "")} · {item.Title}", indent: 12);
        }
        return page.Save();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static string Day(Instant at) => at.InUtc().Date.ToString("d MMMM yyyy", CultureInfo.InvariantCulture);

    private static string Megabytes(long bytes) => bytes < 1024 * 1024 ? $"{Math.Max(1, bytes / 1024)} KB" : $"{bytes / (1024.0 * 1024):0.#} MB";

    /// <summary>A name every computer takes as a folder or file name: no slash, colon or other reserved sign, not too long.</summary>
    private static string Safe(string name)
    {
        var invalid = Path.GetInvalidFileNameChars().Concat(['/', '\\', ':', '*', '?', '"', '<', '>', '|']).ToHashSet();
        var clean = new string(name.Select(c => invalid.Contains(c) || char.IsControl(c) ? '_' : c).ToArray()).Trim().TrimEnd('.');
        if (clean.Length == 0) clean = "_";
        return clean.Length > 120 ? clean[..120].TrimEnd() : clean;
    }

    /// <summary>A plain A4 page of text, wrapped, a new page when full: what the reviews and transmittals are written on.</summary>
    private sealed class PdfWriter
    {
        private readonly PdfDocument pdf = new();
        private readonly XFont title = new(EmbeddedFonts.Family, 14, XFontStyleEx.Bold);
        private readonly XFont bold = new(EmbeddedFonts.Family, 9, XFontStyleEx.Bold);
        private readonly XFont text = new(EmbeddedFonts.Family, 9, XFontStyleEx.Regular);
        private PdfPage page = null!;
        private XGraphics gfx = null!;
        private double y;
        private const double Left = 50;

        public PdfWriter(string name)
        {
            pdf.Info.Title = name;
            NewPage();
        }

        private void NewPage()
        {
            gfx?.Dispose();
            page = pdf.AddPage();
            gfx = XGraphics.FromPdfPage(page);
            y = 50;
        }

        private void Write(string s, XFont font, double indent, double step)
        {
            var width = page.Width.Point - Left * 2 - indent;
            foreach (var line in Wrap(s, font, width))
            {
                if (y > page.Height.Point - 50) NewPage();
                gfx.DrawString(line, font, XBrushes.Black, Left + indent, y);
                y += step;
            }
        }

        private IEnumerable<string> Wrap(string s, XFont font, double width)
        {
            var words = s.Split(' ');
            var line = new StringBuilder();
            foreach (var word in words)
            {
                var tried = line.Length == 0 ? word : $"{line} {word}";
                if (line.Length > 0 && gfx.MeasureString(tried, font).Width > width)
                {
                    yield return line.ToString();
                    line.Clear().Append(word);
                }
                else
                {
                    line.Clear().Append(tried);
                }
            }
            yield return line.ToString();
        }

        public void Title(string s) => Write(s, title, 0, 22);
        public void Bold(string s) => Write(s, bold, 0, 13);
        public void Text(string s, double indent = 0) => Write(s, text, indent, 12);
        public void Gap() => y += 8;

        public byte[] Save()
        {
            gfx.Dispose();
            using var output = new MemoryStream();
            pdf.Save(output);
            pdf.Dispose();
            return output.ToArray();
        }
    }
}
