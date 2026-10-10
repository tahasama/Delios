using System.Globalization;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Schedules;

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
    /// Reads one schedule revision: picks its .xlsx or .csv file, parses the activities, maps department names to discipline codes,
    /// then adds new activities, updates existing ones, marks missing ones removed, and records the changes in a <see cref="ScheduleImport"/>.
    /// Ends by recomputing the readiness of every activity of the project, since moved dates move the needs.
    /// </summary>
    private async Task ReadAsync(ScheduleSource source, Revision revision, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var record = new ScheduleImport
        {
            TenantId = revision.TenantId,
            ProjectId = revision.ProjectId,
            RevisionId = revision.Id,
            RevisionValue = revision.Value,
            ImportedAt = now,
        };
        db.ScheduleImports.Add(record);
        var document = await db.Documents.AsNoTracking().SingleAsync(d => d.Id == revision.DocumentId, cancellationToken);
        var label = $"{document.Number} rev {revision.Value}";

        // The activity list is the export, not the printed PDF: Excel first, then CSV.
        var file = revision.Files.Where(f => f.Submission == revision.Submission && f.Status == FileStatuses.Clean && ScheduleReader.CanRead(f.Name))
            .OrderBy(f => f.Name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) ? 0 : 1).FirstOrDefault();
        if (file is null)
        {
            Fail(record, "The released revision has no .xlsx or .csv file to read the activities from.");
            await audit.WriteAsync(Actor.System, "SCHEDULE_NOT_READ", "Revision", revision.Id, label, record.Error, revision.ProjectId, cancellationToken);
            return;
        }
        record.FileId = file.Id;
        IReadOnlyList<ParsedActivity>? parsed;
        string? error;
        await using (var content = await storage.OpenReadAsync(file.ObjectKey, cancellationToken))
        {
            (parsed, error) = ScheduleReader.Read(content, file.Name, source.Columns);
        }
        if (parsed is null)
        {
            Fail(record, $"{file.Name}: {error}");
            await audit.WriteAsync(Actor.System, "SCHEDULE_NOT_READ", "Revision", revision.Id, label, record.Error, revision.ProjectId, cancellationToken);
            return;
        }

        var unmatched = await ApplyAsync(revision.TenantId, revision.ProjectId, parsed, revision.Id, record, cancellationToken);
        await audit.WriteAsync(Actor.System, "SCHEDULE_READ", "Revision", revision.Id, label,
            $"{parsed.Count} activities from {file.Name}: {record.Added} new, {record.Moved} moved, {record.Changed} changed, {record.Removed} removed."
            + (unmatched.Count > 0 ? $" Not a discipline, left off: {string.Join(", ", unmatched)}." : ""),
            revision.ProjectId, cancellationToken);
        logger.LogInformation("Schedule {Label} read: {Count} activities", label, parsed.Count);
    }

    /// <summary>
    /// Reads a schedule file uploaded on its own, with no document in the register: the same reading, applied at
    /// once. Returns what changed, or why the file cannot be read. The caller records who did it and why.
    /// </summary>
    public async Task<(string? Summary, string? Error)> ReadUploadAsync(Guid tenantId, Guid projectId, string fileName, byte[] bytes,
        Revision? revision, CancellationToken cancellationToken)
    {
        if (!ScheduleReader.CanRead(fileName)) return (null, "The schedule must be an .xlsx or .csv export.");
        var source = await db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == projectId, cancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"schedule:" + projectId}))", cancellationToken);
        IReadOnlyList<ParsedActivity>? parsed;
        string? error;
        using (var content = new MemoryStream(bytes)) (parsed, error) = ScheduleReader.Read(content, fileName, source?.Columns ?? new ScheduleColumns());
        if (parsed is null) return (null, $"{fileName}: {error}");
        // Counted the way a released revision's read is counted. The released revision the file belongs to keeps the read
        // as its own, the first time; a file with no revision, or read again, is kept among the uploaded lists instead.
        var tally = new ScheduleImport { TenantId = tenantId, ProjectId = projectId, RevisionValue = "-", ImportedAt = clock.GetCurrentInstant() };
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
                tally = earlier;
            }
        }
        var unmatched = await ApplyAsync(tenantId, projectId, parsed, revision?.Id, tally, cancellationToken);
        return ($"{parsed.Count} activities from {fileName}: {tally.Added} new, {tally.Moved} moved, {tally.Changed} changed, {tally.Removed} removed."
            + (unmatched.Count > 0 ? $" Not a discipline, left off: {string.Join(", ", unmatched)}." : ""), null);
    }

    /// <summary>
    /// Makes the project's activities what the parsed schedule says: adds new ones, updates existing ones, marks
    /// missing ones removed, counts it all on <paramref name="record"/>, and restates every activity's readiness,
    /// since moved dates move the needs. Returns the department names that are not disciplines.
    /// </summary>
    private async Task<SortedSet<string>> ApplyAsync(Guid tenantId, Guid projectId, IReadOnlyList<ParsedActivity> parsed, Guid? sourceRevisionId,
        ScheduleImport record, CancellationToken cancellationToken)
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
            activity.ExternalId = row.Code;
            activity.Name = row.Name;
            activity.Start = row.Start;
            activity.Finish = row.Finish;
            activity.Responsible = row.Responsible;
            // A schedule without a departments column leaves the project manager's tags as they are.
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
}
