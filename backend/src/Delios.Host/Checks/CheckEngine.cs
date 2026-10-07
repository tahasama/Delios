using System.Diagnostics;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Checks;

public sealed record CheckRunRequested(Guid TenantId, Guid RunId)
{
    public const string RoutingKey = "checks.run";
}

/// <summary>
/// Runs every check over a project's register, records each result, and keeps
/// the defect register: a finding opens when a check first returns it, stays open
/// while it keeps returning it, and closes by itself when it stops. A closed one
/// that comes back reopens. In the worker, one run at a time.
/// </summary>
public sealed class CheckEngine(
    DeliosDbContext db, TenantContext tenant, FileStorage storage, AuditLog audit, IClock clock, ILogger<CheckEngine> logger)
{
    public async Task ProcessAsync(CheckRunRequested message, CancellationToken cancellationToken)
    {
        tenant.Set(message.TenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var run = await db.CheckRuns.SingleOrDefaultAsync(r => r.Id == message.RunId, cancellationToken);
        if (run is not { Status: CheckRunStatuses.Queued }) return;
        run.Status = CheckRunStatuses.Running;
        run.StartedAt = clock.GetCurrentInstant();
        try
        {
            await RunAsync(run, cancellationToken);
            run.Status = CheckRunStatuses.Done;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogError(e, "Check run {RunId} failed", run.Id);
            db.ChangeTracker.Clear();
            run = await db.CheckRuns.SingleAsync(r => r.Id == message.RunId, cancellationToken);
            run.Status = CheckRunStatuses.Failed;
            run.Error = e.Message;
        }
        run.FinishedAt = clock.GetCurrentInstant();
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private async Task RunAsync(CheckRun run, CancellationToken cancellationToken)
    {
        var project = await db.Projects.AsNoTracking().SingleAsync(p => p.Id == run.ProjectId, cancellationToken);
        var entries = await db.ValueEntries.AsNoTracking().ToListAsync(cancellationToken);
        var context = new CheckContext
        {
            Db = db,
            Project = project,
            Values = await Catalog.LoadAsync(db, cancellationToken),
            ValueEntries = entries,
            Storage = storage,
            Audit = audit,
            Documents = await db.Documents.AsNoTracking().Where(d => d.ProjectId == project.Id).ToListAsync(cancellationToken),
            Revisions = await db.Revisions.AsNoTracking().Where(r => r.ProjectId == project.Id).ToListAsync(cancellationToken),
            Now = clock.GetCurrentInstant(),
            CancellationToken = cancellationToken,
        };
        var optOuts = await db.CheckOptOuts.AsNoTracking().Where(o => o.ProjectId == project.Id)
            .ToDictionaryAsync(o => o.CheckId, o => o.Reason, cancellationToken);

        var results = new List<CheckResult>();
        var found = new List<(CheckDef Check, Failure Failure)>();
        foreach (var check in CheckCatalog.All)
        {
            if (optOuts.TryGetValue(check.Id, out var why))
            {
                results.Add(new CheckResult { CheckId = check.Id, Result = "OFF", Note = why });
                continue;
            }
            var watch = Stopwatch.StartNew();
            Outcome outcome;
            try
            {
                outcome = await check.Run(context);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // One check that cannot run does not stop the others.
                logger.LogWarning(e, "Check {CheckId} could not run", check.Id);
                results.Add(new CheckResult { CheckId = check.Id, Result = "NOT_EXECUTABLE", Milliseconds = (int)watch.ElapsedMilliseconds, Note = e.Message });
                continue;
            }
            var ms = (int)watch.ElapsedMilliseconds;
            switch (outcome)
            {
                case Outcome.Ran(var failures):
                    results.Add(new CheckResult { CheckId = check.Id, Result = failures.Count == 0 ? "PASS" : "FAIL", Failing = failures.Count, Milliseconds = ms });
                    found.AddRange(failures.DistinctBy(f => f.EntityKey).Select(f => (check, f)));
                    break;
                case Outcome.NeedsSetup(var what):
                    results.Add(new CheckResult { CheckId = check.Id, Result = "NEEDS_SETUP", Milliseconds = ms, Note = what });
                    break;
            }
        }

        await MaintainDefectsAsync(run, results, found, cancellationToken);
        // Saved before the score is taken: the score reads the defect register.
        await db.SaveChangesAsync(cancellationToken);

        var executed = results.Count(r => r.Result is "PASS" or "FAIL");
        var asked = Math.Max(1, results.Count(r => r.Result != "OFF"));
        var open = await db.Defects.Where(d => d.ProjectId == project.Id && d.Status != DefectStatuses.Closed)
            .Select(d => new { d.Severity, d.DocumentId }).ToListAsync(cancellationToken);
        var defective = open.Where(d => d.DocumentId != null && d.Severity is Severities.Critical or Severities.Major)
            .Select(d => d.DocumentId).Distinct().Count();
        var documents = context.Documents.Count;

        run.Results = results;
        run.Executed = executed;
        run.Passed = results.Count(r => r.Result == "PASS");
        run.Failed = results.Count(r => r.Result == "FAIL");
        run.NeedsSetup = results.Count(r => r.Result == "NEEDS_SETUP");
        run.Off = results.Count(r => r.Result == "OFF");
        run.Coverage = Math.Round(100m * executed / asked, 1);
        run.Integrity = documents == 0 ? 100m : Math.Round(100m * (documents - defective) / documents, 1);
        // Accepted Criticals still count: accepting is a decision, not a fix.
        run.OpenCritical = open.Count(d => d.Severity == Severities.Critical);
        await audit.WriteAsync(Actor.System, "CHECK_RUN", "CheckRun", run.Id, project.Code,
            $"{results.Count} checks: {run.Failed} failing, integrity {run.Integrity}%, coverage {run.Coverage}%, {run.OpenCritical} Critical open.",
            project.Id, cancellationToken);
    }

    private async Task MaintainDefectsAsync(
        CheckRun run, List<CheckResult> results, List<(CheckDef Check, Failure Failure)> found, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var existing = await db.Defects.Where(d => d.ProjectId == run.ProjectId).ToListAsync(cancellationToken);
        var byKey = existing.ToDictionary(d => (d.CheckId, d.EntityKey));
        var seen = new HashSet<(string, string)>();
        foreach (var (check, failure) in found)
        {
            seen.Add((check.Id, failure.EntityKey));
            if (byKey.TryGetValue((check.Id, failure.EntityKey), out var defect))
            {
                // Still there. Closed too early? It comes back open.
                if (defect.Status == DefectStatuses.Closed)
                {
                    defect.Status = DefectStatuses.Open;
                    defect.ClosedAt = null;
                    defect.AcceptedReason = null;
                    defect.AcceptedByName = null;
                    defect.AcceptedAt = null;
                }
                defect.LastSeenAt = now;
                defect.Label = Cut(failure.Label, 300);
                defect.Description = Cut(failure.Description ?? check.Condition, 1000);
                continue;
            }
            db.Defects.Add(new Defect
            {
                TenantId = run.TenantId,
                ProjectId = run.ProjectId,
                CheckId = check.Id,
                Severity = check.Severity,
                Owner = check.Owner,
                EntityKey = failure.EntityKey,
                EntityType = failure.EntityType,
                EntityId = failure.EntityId,
                DocumentId = failure.DocumentId,
                Label = Cut(failure.Label, 300),
                Description = Cut(failure.Description ?? check.Condition, 1000),
                FirstSeenAt = now,
                LastSeenAt = now,
            });
        }

        // A check that ran and no longer returns an item closes it. One no longer
        // asked (switched off, or gone from the catalogue) closes all its findings:
        // a question nobody asks can never clear them otherwise.
        var ran = results.Where(r => r.Result is "PASS" or "FAIL").Select(r => r.CheckId).ToHashSet();
        var asked = results.Where(r => r.Result != "OFF").Select(r => r.CheckId).ToHashSet();
        foreach (var defect in existing.Where(d => d.Status != DefectStatuses.Closed))
        {
            var retired = !asked.Contains(defect.CheckId);
            if (retired || (ran.Contains(defect.CheckId) && !seen.Contains((defect.CheckId, defect.EntityKey))))
            {
                defect.Status = DefectStatuses.Closed;
                defect.ClosedAt = now;
            }
        }
    }

    private static string Cut(string text, int max) => text.Length <= max ? text : text[..(max - 1)] + "…";
}
