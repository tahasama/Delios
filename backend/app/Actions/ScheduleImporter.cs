using System.Globalization;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Actions;

/// <summary>Asks the worker to read a released schedule revision into activities.</summary>
public sealed record ScheduleImportRequested(Guid TenantId, Guid RevisionId)
{
    /// <summary>The queue name (routing key) this message is sent under.</summary>
    public const string RoutingKey = "schedule.import";
}

/// <summary>
/// In the worker, after every release: a released revision of the project's
/// schedule document is read into activities; any other release may complete what
/// activities need. A revision is read once; what it changed is kept.
/// </summary>
public sealed class ScheduleImporter(
    DeliosDbContext db, TenantContext tenant, FileStorage storage, AuditLog audit, IClock clock, ILogger<ScheduleImporter> logger)
{
    /// <summary>
    /// The version of the reading. Raised whenever reading a file keeps more than before (1: the WBS and what happened,
    /// from a P6 export): a released revision read by an older version is read again by itself (<see cref="CatchUpAsync"/>),
    /// nobody asked to do it (owner: "users shouldn't have to do that").
    /// </summary>
    public const int ReaderVersion = 1;

    /// <summary>
    /// After any release: activities needing that document are restated; a release of
    /// the project's schedule asks for it to be read, on the checks queue, so reading a
    /// large export never holds up scanning and stamping.
    /// </summary>
    public async Task OnReleasedAsync(RevisionReleased message, CancellationToken cancellationToken)
    {
        tenant.Set(message.TenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var revision = await db.Revisions.AsNoTracking().SingleOrDefaultAsync(r => r.Id == message.RevisionId, cancellationToken);
        if (revision is null) return;
        await Readiness.RestateAsync(db, clock, await Readiness.NeedingAsync(db, revision.DocumentId, cancellationToken), cancellationToken);
        if (await db.ScheduleSources.AnyAsync(s => s.ProjectId == revision.ProjectId && s.DocumentId == revision.DocumentId, cancellationToken))
        {
            db.Enqueue(ScheduleImportRequested.RoutingKey, new ScheduleImportRequested(message.TenantId, revision.Id));
        }
        // A released disciplines-per-action list, and a requirements list, are read the same way, on the same queue.
        if (await DepartmentsImporter.IsListAsync(db, revision.DocumentId, cancellationToken))
        {
            db.Enqueue(DepartmentsImportRequested.RoutingKey, new DepartmentsImportRequested(message.TenantId, revision.Id));
        }
        if (await RequirementsImporter.IsListAsync(db, revision.DocumentId, cancellationToken))
        {
            db.Enqueue(RequirementsImportRequested.RoutingKey, new RequirementsImportRequested(message.TenantId, revision.Id));
        }
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    /// <summary>Reads a released schedule revision into activities, once per revision.</summary>
    public async Task OnRequestedAsync(ScheduleImportRequested message, CancellationToken cancellationToken)
    {
        tenant.Set(message.TenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        // One reader per project at a time: two revisions released close together are read in turn.
        var revision = await db.Revisions.Include(r => r.Files).SingleOrDefaultAsync(r => r.Id == message.RevisionId, cancellationToken);
        if (revision is null) return;
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"schedule:" + revision.ProjectId}))", cancellationToken);

        var source = await db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == revision.ProjectId, cancellationToken);
        var isSchedule = source is not null && source.DocumentId == revision.DocumentId && revision.State == RevisionStates.Released;
        if (isSchedule && !await db.ScheduleImports.AnyAsync(i => i.RevisionId == revision.Id, cancellationToken))
        {
            await ReadAsync(source!, revision, cancellationToken);
        }
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    /// <summary>
    /// In the worker: the schedule's released revision read by an older version of the reading (<see cref="ReaderVersion"/>)
    /// is read again, the same file read as the app reads it now, so what the reading keeps since (the WBS, what happened)
    /// comes in by itself. Only a P6 export is read again (the only file the reading keeps more of), only when that read is
    /// what the activities stand on (no upload since), and never one that failed. Returns whether it read it.
    /// </summary>
    public async Task<bool> CatchUpAsync(Guid projectId, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"schedule:" + projectId}))", cancellationToken);
        var source = await db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == projectId, cancellationToken);
        if (source is null) return false;
        var revision = await db.Revisions.AsNoTracking().Include(r => r.Files)
            .SingleOrDefaultAsync(r => r.DocumentId == source.DocumentId && r.State == RevisionStates.Released, cancellationToken);
        if (revision is null) return false;
        var earlier = await db.ScheduleImports.SingleOrDefaultAsync(i => i.RevisionId == revision.Id, cancellationToken);
        if (earlier is null || earlier.ReadWith >= ReaderVersion || earlier.Status != ScheduleImportStatuses.Done) return false;
        if (!revision.Files.Any(f => f.Submission == revision.Submission && f.Status == FileStatuses.Clean && XerReader.IsXer(f.Name))) return false;
        // A list uploaded since stands: the activities are no longer this read's.
        if (await db.Set<Records.ControlledVersion>().AnyAsync(v => v.ProjectId == projectId && v.Kind == "SCHEDULE" && v.CreatedAt > earlier.ImportedAt, cancellationToken))
        {
            earlier.ReadWith = ReaderVersion;
        }
        else
        {
            await ReadAsync(source, revision, cancellationToken, earlier);
            logger.LogInformation("Schedule rev {Value} of project {Project} read again by the newer reading", revision.Value, projectId);
        }
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    /// <summary>
    /// Reads one schedule revision: picks its .xlsx or .csv file, parses the activities, maps department names to discipline codes,
    /// then adds new activities, updates existing ones, marks missing ones removed, and records the changes in a <see cref="ScheduleImport"/>.
    /// Ends by recomputing the readiness of every activity of the project, since moved dates move the needs.
    /// </summary>
    private async Task ReadAsync(ScheduleSource source, Revision revision, CancellationToken cancellationToken, ScheduleImport? earlier = null)
    {
        var now = clock.GetCurrentInstant();
        var record = earlier ?? new ScheduleImport
        {
            TenantId = revision.TenantId,
            ProjectId = revision.ProjectId,
            RevisionId = revision.Id,
            RevisionValue = revision.Value,
            ImportedAt = now,
        };
        record.ReadWith = ReaderVersion;
        if (earlier is null) db.ScheduleImports.Add(record);
        else
        {
            // Read again: the read of the same revision is counted afresh, from what it says now.
            record.ImportedAt = now;
            record.Status = ScheduleImportStatuses.Done;
            record.Error = null;
            record.Added = record.Moved = record.Changed = record.Removed = record.Unchanged = 0;
            record.Changes = [];
            record.UnmatchedDepartments = [];
        }
        var document = await db.Documents.AsNoTracking().SingleAsync(d => d.Id == revision.DocumentId, cancellationToken);
        var label = $"{document.Number} rev {revision.Value}";

        // The activity list is the export, not the printed PDF: a P6 export (.xer) first, since only it carries the WBS
        // and what happened, then Excel, then CSV.
        var file = revision.Files.Where(f => f.Submission == revision.Submission && f.Status == FileStatuses.Clean && ScheduleReader.CanReadSchedule(f.Name))
            .OrderBy(f => XerReader.IsXer(f.Name) ? 0 : f.Name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) ? 1 : 2).FirstOrDefault();
        if (file is null)
        {
            Fail(record, "The released revision has no .xlsx, .xer or .csv file to read the activities from.");
            await audit.WriteAsync(Actor.System, "SCHEDULE_NOT_READ", "Revision", revision.Id, label, record.Error, revision.ProjectId, cancellationToken);
            return;
        }
        record.FileId = file.Id;
        IReadOnlyList<ParsedActivity>? parsed;
        string? error;
        await using (var content = await storage.OpenReadAsync(file.ObjectKey, cancellationToken))
        {
            var code = await db.Projects.AsNoTracking().Where(p => p.Id == revision.ProjectId).Select(p => p.Code).SingleAsync(cancellationToken);
            (parsed, error) = ScheduleReader.Read(content, file.Name, source.Columns, code);
        }
        if (parsed is null)
        {
            Fail(record, $"{file.Name}: {error}");
            await audit.WriteAsync(Actor.System, "SCHEDULE_NOT_READ", "Revision", revision.Id, label, record.Error, revision.ProjectId, cancellationToken);
            return;
        }

        var unmatched = await ApplyAsync(revision.TenantId, revision.ProjectId, parsed, revision.Id, $"rev {revision.Value}", record, cancellationToken);
        await audit.WriteAsync(Actor.System, "SCHEDULE_READ", "Revision", revision.Id, label,
            $"{parsed.Count} activities from {file.Name}{Span(parsed)}: {record.Added} new, {record.Moved} moved, {record.Changed} changed, {record.Removed} removed."
            + (unmatched.Count > 0 ? $" Not a discipline, left off: {string.Join(", ", unmatched)}." : ""),
            revision.ProjectId, cancellationToken);
        logger.LogInformation("Schedule {Label} read: {Count} activities", label, parsed.Count);
    }

    /// <summary>
    /// Reads a schedule file uploaded on its own, with no document in the register: the same reading, applied at
    /// once. Returns what changed, or why the file cannot be read. The caller records who did it and why.
    /// </summary>
    public async Task<(string? Summary, string? Error)> ReadUploadAsync(Guid tenantId, Guid projectId, string fileName, byte[] bytes,
        Revision? revision, CancellationToken cancellationToken, string? p6Project = null)
    {
        if (!ScheduleReader.CanReadSchedule(fileName)) return (null, "The schedule must be an .xlsx or .csv export, or a Primavera P6 export (.xer).");
        var source = await db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == projectId, cancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"schedule:" + projectId}))", cancellationToken);
        IReadOnlyList<ParsedActivity>? parsed;
        string? error;
        var code = await db.Projects.AsNoTracking().Where(p => p.Id == projectId).Select(p => p.Code).SingleAsync(cancellationToken);
        // The P6 project chosen on the upload is read, and kept for the schedule's next revisions (owner: an export of
        // several projects, its baseline among them).
        var columns = source?.Columns ?? new ScheduleColumns();
        if (p6Project is not null) columns = Copy(columns, p6Project);
        using (var content = new MemoryStream(bytes)) (parsed, error) = ScheduleReader.Read(content, fileName, columns, code);
        if (parsed is null) return (null, $"{fileName}: {error}");
        if (p6Project is not null && source is not null && source.Columns.Sheet != p6Project && XerReader.IsXer(fileName))
        {
            var kept = await db.ScheduleSources.SingleAsync(s => s.Id == source.Id, cancellationToken);
            kept.Columns = Copy(kept.Columns, p6Project);
        }
        // Counted the way a released revision's read is counted. The released revision the file belongs to keeps the read
        // as its own, the first time; a file with no revision, or read again, is kept among the uploaded lists instead.
        var tally = new ScheduleImport { TenantId = tenantId, ProjectId = projectId, RevisionValue = "-", ImportedAt = clock.GetCurrentInstant(), ReadWith = ReaderVersion };
        if (revision is not null)
        {
            // Released with no spreadsheet, its read failed: this file is that read, done now.
            var earlier = await db.ScheduleImports.SingleOrDefaultAsync(i => i.RevisionId == revision.Id, cancellationToken);
            if (earlier is null)
            {
                tally.RevisionId = revision.Id;
                tally.RevisionValue = revision.Value;
                db.ScheduleImports.Add(tally);
            }
            else if (earlier.Status == ScheduleImportStatuses.Failed)
            {
                earlier.Status = ScheduleImportStatuses.Done;
                earlier.Error = null;
                earlier.ImportedAt = tally.ImportedAt;
                earlier.ReadWith = ReaderVersion;
                tally = earlier;
            }
        }
        var unmatched = await ApplyAsync(tenantId, projectId, parsed, revision?.Id, revision is null ? "a direct upload" : $"rev {revision.Value}", tally, cancellationToken);
        return ($"{parsed.Count} activities from {fileName}{Span(parsed)}: {tally.Added} new, {tally.Moved} moved, {tally.Changed} changed, {tally.Removed} removed."
            + (unmatched.Count > 0 ? $" Not a discipline, left off: {string.Join(", ", unmatched)}." : ""), null);
    }

    /// <summary>
    /// Makes the project's activities what the parsed schedule says: adds new ones, updates existing ones, marks
    /// missing ones removed, counts it all on <paramref name="record"/>, and restates every activity's readiness,
    /// since moved dates move the needs. Returns the department names that are not disciplines.
    /// </summary>
    private async Task<SortedSet<string>> ApplyAsync(Guid tenantId, Guid projectId, IReadOnlyList<ParsedActivity> parsed, Guid? sourceRevisionId,
        string readLabel, ScheduleImport record, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        // A department is a discipline: the file's names become discipline codes; the rest are listed, not guessed.
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var unmatched = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        string[]? Disciplines(string[]? names)
        {
            if (names is null) return null;
            foreach (var name in names.Where(n => catalog.Find(ValueSets.Disciplines, n) is null)) unmatched.Add(name);
            return names.Select(n => catalog.Find(ValueSets.Disciplines, n)).OfType<string>().Distinct().ToArray();
        }
        parsed = parsed.Select(p => p with { Departments = Disciplines(p.Departments) }).ToList();

        // The planner's IDs match whatever their letter case: "a100" in one revision is "A100" in the next. Each
        // action keeps our own number, given the first time it is read; the planner's ID is kept beside it.
        var all = await db.Activities.Where(a => a.ProjectId == projectId).ToListAsync(cancellationToken);
        var existing = all.GroupBy(a => a.ExternalId ?? a.Code, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        var next = all.Select(a => a.Code).Where(OurNumber).Select(c => int.Parse(c[1..], CultureInfo.InvariantCulture)).DefaultIfEmpty(0).Max();
        foreach (var row in parsed)
        {
            if (!existing.TryGetValue(row.Code, out var activity))
            {
                var code = $"A{++next:D5}";
                db.Activities.Add(new Activity
                {
                    TenantId = tenantId,
                    ProjectId = projectId,
                    Code = code,
                    ExternalId = row.Code,
                    Name = row.Name,
                    Start = row.Start,
                    Finish = row.Finish,
                    Responsible = row.Responsible,
                    Departments = row.Departments ?? [],
                    StartAchieved = row.StartAchieved,
                    FinishAchieved = row.FinishAchieved,
                    Wbs = row.Wbs ?? [],
                    WbsOrder = row.WbsOrder,
                    SourceRevisionId = sourceRevisionId,
                    UpdatedAt = now,
                });
                record.Added++;
                record.Changes.Add(Change(code, row.Name, "NEW", null, row));
                continue;
            }
            var moved = activity.Start != row.Start || activity.Finish != row.Finish;
            var changed = activity.Name != row.Name || activity.Responsible != row.Responsible
                || (row.Departments is not null && !activity.Departments.SequenceEqual(row.Departments)) || activity.State == ActivityStates.Removed;
            if (moved) record.Moved++;
            else if (changed) record.Changed++;
            else record.Unchanged++;
            if (moved || changed) record.Changes.Add(Change(activity.Code, row.Name, moved ? "MOVED" : "CHANGED", activity, row));
            // The action says it moved, and from where, until a later read leaves it in place.
            if (moved)
            {
                activity.WasStart = activity.Start;
                activity.WasFinish = activity.Finish;
                activity.MovedIn = readLabel;
                activity.MovedAt = now;
            }
            else
            {
                activity.WasStart = null;
                activity.WasFinish = null;
                activity.MovedIn = null;
                activity.MovedAt = null;
            }
            activity.ExternalId = row.Code;
            activity.Name = row.Name;
            activity.Start = row.Start;
            activity.Finish = row.Finish;
            activity.Responsible = row.Responsible;
            // What the planner says happened, and where it sits in the WBS, follow each read as they are.
            activity.StartAchieved = row.StartAchieved;
            activity.FinishAchieved = row.FinishAchieved;
            activity.Wbs = row.Wbs ?? [];
            activity.WbsOrder = row.WbsOrder;
            // A schedule without a departments column leaves the planner's tags as they are.
            if (row.Departments is not null) activity.Departments = row.Departments;
            activity.State = ActivityStates.Active;
            activity.SourceRevisionId = sourceRevisionId;
            activity.UpdatedAt = now;
        }
        var ids = parsed.Select(p => p.Code).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var gone in existing.Values.Where(a => a.State == ActivityStates.Active && !ids.Contains(a.ExternalId ?? a.Code)))
        {
            gone.State = ActivityStates.Removed;
            gone.UpdatedAt = now;
            record.Removed++;
            record.Changes.Add(new ActivityChange { Code = gone.Code, Name = gone.Name, Type = "REMOVED", OldStart = gone.Start, OldFinish = gone.Finish });
        }
        record.UnmatchedDepartments = [.. unmatched];
        await db.SaveChangesAsync(cancellationToken);

        // Dates moved: every need counted from them moves too.
        var ids2 = await db.Activities.Where(a => a.ProjectId == projectId).Select(a => a.Id).ToListAsync(cancellationToken);
        await Readiness.RestateAsync(db, clock, ids2, cancellationToken);
        return unmatched;
    }

    /// <summary>Whether a code is one of our own action numbers: A and five digits.</summary>
    private static bool OurNumber(string code) => code.Length == 6 && code[0] == 'A' && code[1..].All(char.IsAsciiDigit);

    /// <summary>
    /// The action a list names, by our number or by the planner's ID, whatever the letter case; null when the
    /// schedule has no such action. Used by the disciplines and requirements lists.
    /// </summary>
    public static Activity? Named(IEnumerable<Activity> activities, string name) =>
        activities.FirstOrDefault(a => string.Equals(a.Code, name, StringComparison.OrdinalIgnoreCase))
        ?? activities.FirstOrDefault(a => string.Equals(a.ExternalId, name, StringComparison.OrdinalIgnoreCase));

    /// <summary>Marks an import as failed with its reason, cut to 2000 characters to fit the database column.</summary>
    private static void Fail(ScheduleImport record, string error)
    {
        record.Status = ScheduleImportStatuses.Failed;
        record.Error = error.Length > 2000 ? error[..2000] : error;
    }

    /// <summary>Builds one change-list entry for an activity, with its dates before (if it existed) and after.</summary>
    private static ActivityChange Change(string code, string name, string type, Activity? before, ParsedActivity after) => new()
    {
        Code = code,
        Name = name,
        Type = type,
        OldStart = before?.Start,
        OldFinish = before?.Finish,
        NewStart = after.Start,
        NewFinish = after.Finish,
    };

    /// <summary>The same columns, reading another sheet or P6 project.</summary>
    private static ScheduleColumns Copy(ScheduleColumns c, string sheet) => new()
    {
        Sheet = sheet, Code = c.Code, Name = c.Name, Start = c.Start, Finish = c.Finish, Responsible = c.Responsible,
        Departments = c.Departments, DateOrder = c.DateOrder,
    };

    /// <summary>The months the schedule runs, said with its read (owner: "deduce first month and last month"): ", Mar 2022 → Jun 2023".</summary>
    private static string Span(IReadOnlyList<ParsedActivity> parsed)
    {
        var days = parsed.SelectMany(p => new[] { p.Start, p.Finish }).OfType<LocalDate>().ToList();
        if (days.Count == 0) return "";
        string Month(LocalDate d) => d.ToString("MMM yyyy", CultureInfo.InvariantCulture);
        return $", {Month(days.Min())} → {Month(days.Max())}";
    }
}
