using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Records;
using Delios.Host.Reviews;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Schedules;

/// <summary>Sent through the outbox when a disciplines-per-action list is released: the worker reads it.</summary>
public sealed record DepartmentsImportRequested(Guid TenantId, Guid RevisionId)
{
    /// <summary>The queue name (routing key); outbox keys are at most 16 characters.</summary>
    public const string RoutingKey = "depts.import";
}

/// <summary>
/// The project manager's list of which disciplines each activity concerns, as a controlled document. A document
/// whose type is marked as such a list is reviewed like any other; once a revision is released, the spreadsheet
/// attached to it is read: each row names an activity and its disciplines. Activities the list does not name keep
/// what they had. The list is read whole or not at all: one wrong row and nothing changes, and Document Control is
/// told what to fix.
/// </summary>
public sealed class DepartmentsImporter(
    DeliosDbContext db, TenantContext tenant, FileStorage storage, AuditLog audit, IClock clock,
    Notifications.Notifier notifier, ILogger<DepartmentsImporter> logger)
{
    /// <summary>The document type property that marks a disciplines-per-action list.</summary>
    public const string Marker = "readsDepartments";
    /// <summary>How the list is filed among the uploaded lists, so its history reads in one place.</summary>
    public const string Kind = "ACTION_DEPARTMENTS";

    private static readonly string[] ActionHeadings = ["action code", "activity code", "activity id"];
    private static readonly string[] DepartmentHeadings = ["departments", "department", "disciplines", "discipline"];

    /// <summary>Whether a released revision is a disciplines-per-action list, by its document's type.</summary>
    public static async Task<bool> IsListAsync(DeliosDbContext db, Guid documentId, CancellationToken cancellationToken)
    {
        var docType = await db.Documents.AsNoTracking().Where(d => d.Id == documentId).Select(d => d.DocType).SingleOrDefaultAsync(cancellationToken);
        if (docType is null) return false;
        var value = await db.ValueEntries.AsNoTracking().SingleOrDefaultAsync(v => v.SetKey == ValueSets.DocumentTypes && v.Code == docType, cancellationToken);
        return value?.Props?.RootElement.TryGetProperty(Marker, out var p) == true && p.ValueKind == JsonValueKind.True;
    }

    /// <summary>Reads a released disciplines-per-action list, once per revision.</summary>
    public async Task OnRequestedAsync(DepartmentsImportRequested message, CancellationToken cancellationToken)
    {
        tenant.Set(message.TenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var revision = await db.Revisions.Include(r => r.Files).SingleOrDefaultAsync(r => r.Id == message.RevisionId, cancellationToken);
        if (revision is null || revision.State != RevisionStates.Released) return;
        // The schedule and this list both write an activity's disciplines: one at a time per project.
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"schedule:" + revision.ProjectId}))", cancellationToken);
        var document = await db.Documents.AsNoTracking().SingleAsync(d => d.Id == revision.DocumentId, cancellationToken);
        var label = $"{document.Number} rev {revision.Value}";
        if (await db.Set<ControlledVersion>().AnyAsync(v => v.ProjectId == revision.ProjectId && v.Kind == Kind && v.SourceName == label, cancellationToken))
            return;
        var project = await db.Projects.AsNoTracking().SingleAsync(p => p.Id == revision.ProjectId, cancellationToken);

        var file = revision.Files.Where(f => f.Status == FileStatuses.Clean && f.Submission == revision.Submission && ScheduleReader.CanRead(f.Name))
            .OrderBy(f => f.Name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) ? 0 : 1).FirstOrDefault();
        List<string> problems;
        string? summary = null;
        if (file is null)
        {
            problems = ["The released revision has no .xlsx or .csv file to read the list from."];
        }
        else
        {
            List<string[]> rows;
            await using (var content = await storage.OpenReadAsync(file.ObjectKey, cancellationToken))
            {
                try { rows = ScheduleReader.ReadRows(content, file.Name); }
                catch (Exception e) when (e is not OperationCanceledException) { rows = []; logger.LogWarning(e, "Could not read {File}", file.Name); }
            }
            (summary, problems) = await ApplyAsync(project, rows, cancellationToken);
        }

        if (problems.Count > 0)
        {
            // Nothing the list says is applied: the transaction is dropped, and its failure recorded on its own.
            await transaction.RollbackAsync(cancellationToken);
            await RecordAsync(project, document, revision, file, label, null, problems, cancellationToken);
            return;
        }
        await RecordAsync(project, document, revision, file, label, summary, [], cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    /// <summary>
    /// Reads a list uploaded on its own, with no document in the register: the same reading, applied at once, all
    /// or nothing. Returns what changed, or what is wrong. The caller records who did it and why.
    /// </summary>
    public async Task<(string? Summary, List<string> Problems)> ReadUploadAsync(Project project, string fileName, byte[] bytes, CancellationToken cancellationToken)
    {
        if (!ScheduleReader.CanRead(fileName)) return (null, ["The list must be an .xlsx or .csv file."]);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"schedule:" + project.Id}))", cancellationToken);
        List<string[]> rows;
        try { using var content = new MemoryStream(bytes); rows = ScheduleReader.ReadRows(content, fileName); }
        catch (Exception e) when (e is not OperationCanceledException) { return (null, [$"{fileName} could not be read: {e.Message}"]); }
        return await ApplyAsync(project, rows, cancellationToken);
    }

    /// <summary>Tags every activity the list names with its disciplines. Returns a summary, or what is wrong, line by line.</summary>
    private async Task<(string? Summary, List<string> Problems)> ApplyAsync(Project project, List<string[]> rows, CancellationToken cancellationToken)
    {
        static string Normalize(string text) => text.Trim().ToLowerInvariant();
        var header = -1;
        int actionAt = -1, departmentsAt = -1;
        for (var r = 0; r < Math.Min(10, rows.Count) && header < 0; r++)
        {
            var headings = rows[r].Select(Normalize).ToArray();
            actionAt = ActionHeadings.Select(h => Array.IndexOf(headings, h)).FirstOrDefault(i => i >= 0, -1);
            departmentsAt = DepartmentHeadings.Select(h => Array.IndexOf(headings, h)).FirstOrDefault(i => i >= 0, -1);
            if (actionAt >= 0 && departmentsAt >= 0) header = r;
        }
        if (header < 0)
            return (null, ["No heading row with Action Code and Departments was found in the first ten rows. Keep the template's header row."]);

        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var activities = await db.Activities.Where(a => a.ProjectId == project.Id && a.State == ActivityStates.Active)
            .ToDictionaryAsync(a => a.Code, StringComparer.OrdinalIgnoreCase, cancellationToken);
        var problems = new List<string>();
        var tags = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
        for (var r = header + 1; r < rows.Count; r++)
        {
            string Cell(int index) => index < rows[r].Length ? rows[r][index].Trim() : "";
            if (rows[r].All(string.IsNullOrWhiteSpace)) continue;
            var line = r + 1;
            var given = Cell(actionAt);
            if (given.Length == 0) { problems.Add($"Line {line}: Action Code is missing."); continue; }
            // Our number or the planner's ID, either one.
            if (ScheduleImporter.Named(activities.Values, given) is not { } found) { problems.Add($"Line {line}: action {given} is not in the schedule."); continue; }
            var code = found.Code;
            if (tags.ContainsKey(code)) { problems.Add($"Line {line}: action {code} is listed twice."); continue; }
            var named = ScheduleReader.SplitDepartments(Cell(departmentsAt));
            var unknown = named.Where(n => catalog.Find(ValueSets.Disciplines, n) is null).ToList();
            if (unknown.Count > 0) { problems.Add($"Line {line}: {string.Join(", ", unknown)} {(unknown.Count == 1 ? "is not a discipline" : "are not disciplines")}."); continue; }
            tags[code] = named.Select(n => catalog.Find(ValueSets.Disciplines, n)!).Distinct().OrderBy(d => d).ToArray();
        }
        if (problems.Count > 0) return (null, problems);
        if (tags.Count == 0) return (null, ["The list names no action."]);

        var now = clock.GetCurrentInstant();
        int changed = 0, cleared = 0;
        foreach (var (code, departments) in tags)
        {
            var activity = activities[code];
            if (activity.Departments.SequenceEqual(departments)) continue;
            activity.Departments = departments;
            activity.UpdatedAt = now;
            changed++;
            if (departments.Length == 0) cleared++;
        }
        await db.SaveChangesAsync(cancellationToken);
        var untagged = activities.Values.Count(a => a.Departments.Length == 0);
        var parts = new List<string> { $"{tags.Count} action(s) listed", $"{changed} changed" };
        if (cleared > 0) parts.Add($"{cleared} left with no discipline");
        if (untagged > 0) parts.Add($"{untagged} action(s) in the schedule still have no discipline");
        return (string.Join(", ", parts) + ".", []);
    }

    /// <summary>The list's history among the uploaded lists, the audit trail, and Document Control told.</summary>
    private async Task RecordAsync(Project project, Document document, Revision revision, StoredFile? file, string label, string? summary,
        IReadOnlyList<string> problems, CancellationToken cancellationToken)
    {
        var failed = problems.Count > 0;
        // A failure is written in a transaction of its own: what the list said was dropped with the one before.
        await using var own = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(cancellationToken) : null;
        db.ChangeTracker.Clear();
        var now = clock.GetCurrentInstant();
        var shown = string.Join("\n", problems.Take(20)) + (problems.Count > 20 ? $"\n… and {problems.Count - 20} more." : "");
        db.Add(new ControlledVersion
        {
            TenantId = project.TenantId,
            ProjectId = project.Id,
            Kind = Kind,
            Key = "default",
            Title = "Disciplines per action",
            VersionLabel = $"rev {revision.Value}" is { Length: <= 16 } brief ? brief : revision.Value[..Math.Min(16, revision.Value.Length)],
            State = failed ? "REJECTED" : "APPROVED",
            Payload = "[]",
            RowCount = 0,
            SourceName = label,
            SourceSize = file?.Size,
            SourceHash = file?.Sha256,
            Notes = failed ? null : summary,
            CreatedById = revision.AuthoredById,
            CreatedByName = "Released revision",
            CreatedAt = now,
            DecidedByName = "Released revision",
            DecidedAt = now,
            DecisionReason = failed ? shown : null,
        });
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor.System, failed ? "DEPARTMENTS_NOT_READ" : "DEPARTMENTS_READ", "Revision", revision.Id, label,
            failed ? $"The list was not applied: {shown}" : summary, project.Id, cancellationToken);
        await notifier.NotifyAsync(project.TenantId, project.Id, await notifier.ControlHoldersAsync(project.Id, cancellationToken),
            Notifications.NotificationKinds.General,
            failed ? $"{label}: the disciplines list was not read" : $"{label}: the disciplines list is in force",
            failed ? $"Nothing it says was applied. Fix the list and release a new revision.\n{shown}" : summary,
            $"/documents/{document.Id}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        if (own is not null) await own.CommitAsync(cancellationToken);
    }
}
