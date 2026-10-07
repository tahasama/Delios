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

        // A department is a discipline: the file's names become discipline codes; the rest are listed, not guessed.
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var unmatched = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        string[] Disciplines(string[] names)
        {
            foreach (var name in names.Where(n => catalog.Find(ValueSets.Disciplines, n) is null)) unmatched.Add(name);
            return names.Select(n => catalog.Find(ValueSets.Disciplines, n)).OfType<string>().Distinct().ToArray();
        }
        parsed = parsed.Select(p => p with { Departments = Disciplines(p.Departments) }).ToList();

        // Codes match whatever their letter case: "a100" in one revision is "A100" in the next.
        var existing = (await db.Activities.Where(a => a.ProjectId == revision.ProjectId).ToListAsync(cancellationToken))
            .ToDictionary(a => a.Code, StringComparer.OrdinalIgnoreCase);
        foreach (var row in parsed)
        {
            if (!existing.TryGetValue(row.Code, out var activity))
            {
                db.Activities.Add(new Activity
                {
                    TenantId = revision.TenantId,
                    ProjectId = revision.ProjectId,
                    Code = row.Code,
                    Name = row.Name,
                    Start = row.Start,
                    Finish = row.Finish,
                    Responsible = row.Responsible,
                    Departments = row.Departments,
                    SourceRevisionId = revision.Id,
                    UpdatedAt = now,
                });
                record.Added++;
                record.Changes.Add(Change(row.Code, row.Name, "NEW", null, row));
                continue;
            }
            var moved = activity.Start != row.Start || activity.Finish != row.Finish;
            var changed = activity.Name != row.Name || activity.Responsible != row.Responsible
                || !activity.Departments.SequenceEqual(row.Departments) || activity.State == ActivityStates.Removed;
            if (moved) record.Moved++;
            else if (changed) record.Changed++;
            else record.Unchanged++;
            if (moved || changed) record.Changes.Add(Change(row.Code, row.Name, moved ? "MOVED" : "CHANGED", activity, row));
            activity.Code = row.Code;
            activity.Name = row.Name;
            activity.Start = row.Start;
            activity.Finish = row.Finish;
            activity.Responsible = row.Responsible;
            activity.Departments = row.Departments;
            activity.State = ActivityStates.Active;
            activity.SourceRevisionId = revision.Id;
            activity.UpdatedAt = now;
        }
        var codes = parsed.Select(p => p.Code).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var gone in existing.Values.Where(a => a.State == ActivityStates.Active && !codes.Contains(a.Code)))
        {
            gone.State = ActivityStates.Removed;
            gone.UpdatedAt = now;
            record.Removed++;
            record.Changes.Add(new ActivityChange { Code = gone.Code, Name = gone.Name, Type = "REMOVED", OldStart = gone.Start, OldFinish = gone.Finish });
        }
        record.UnmatchedDepartments = [.. unmatched];
        await db.SaveChangesAsync(cancellationToken);

        // Dates moved: every need counted from them moves too.
        var all = await db.Activities.Where(a => a.ProjectId == revision.ProjectId).Select(a => a.Id).ToListAsync(cancellationToken);
        await Readiness.RestateAsync(db, clock, all, cancellationToken);
        await audit.WriteAsync(Actor.System, "SCHEDULE_READ", "Revision", revision.Id, label,
            $"{parsed.Count} activities from {file.Name}: {record.Added} new, {record.Moved} moved, {record.Changed} changed, {record.Removed} removed."
            + (unmatched.Count > 0 ? $" Not a discipline, left off: {string.Join(", ", unmatched)}." : ""),
            revision.ProjectId, cancellationToken);
        logger.LogInformation("Schedule {Label} read: {Count} activities", label, parsed.Count);
    }

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
