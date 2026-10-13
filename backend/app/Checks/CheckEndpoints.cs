using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Checks;

/// <summary>Request body carrying a free-text reason. Used when switching a check off and when accepting a defect.</summary>
public sealed record ReasonRequest(string? Reason);

/// <summary>One check as the checks page shows it: its definition, its result in the last finished run, and the reason if the project switched it off.</summary>
public sealed record CheckView(string Id, string Phase, string Condition, string Method, string Severity, string Owner,
    string? Result, int? Failing, string? Note, string? OffBecause);

/// <summary>One check run as returned to the browser: who asked, when, the counts by result, the integrity and coverage scores, and each check's result.</summary>
public sealed record RunView(Guid Id, string Status, string RequestedBy, DateTimeOffset RequestedAt, DateTimeOffset? FinishedAt,
    int Executed, int Passed, int Failed, int NeedsSetup, int Off, decimal Integrity, decimal Coverage, int OpenCritical,
    string? Error, IReadOnlyList<CheckResult> Results);

/// <summary>One defect (a finding a check returned) as the defects list shows it.</summary>
public sealed record DefectView(Guid Id, string CheckId, string Severity, string Owner, string EntityType, Guid? EntityId,
    Guid? DocumentId, string Label, string Description, string Status, DateTimeOffset FirstSeenAt, DateTimeOffset LastSeenAt,
    DateTimeOffset? ClosedAt, string? AcceptedReason, string? AcceptedBy);

/// <summary>The checks a project answers to, their last results, and the defects they found.</summary>
public static class CheckEndpoints
{
    /// <summary>
    /// Registers the check and defect URLs under /api/projects/{projectId}. Only the project's own (internal) people with read access may call them.
    /// Called once at startup from PlatformSetup.
    /// </summary>
    public static void MapCheckEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Checks")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>()
            .AddEndpointFilter(async (context, next) => ProjectAccessFilter.Of(context.HttpContext) is { IsInternal: true } access
                && access.Holds(Verbs.Read)
                ? await next(context)
                : Problems.Forbidden("CHECKS_NOT_ALLOWED", "The checks are read by the project's own people."));
        project.MapGet("/checks", CatalogAsync);
        project.MapPost("/checks/run", RunAsync);
        project.MapGet("/checks/runs/{runId:guid}", GetRunAsync);
        project.MapPut("/checks/{checkId}/opt-out", OptOutAsync);
        project.MapDelete("/checks/{checkId}/opt-out", OptInAsync);
        project.MapGet("/defects", DefectsAsync);
        project.MapPost("/defects/{defectId:guid}/accept", AcceptAsync);
    }

    /// <summary>GET /checks: lists every check with its result from the last finished run and whether the project switched it off.</summary>
    private static async Task<IResult> CatalogAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var last = await db.CheckRuns.AsNoTracking().Where(r => r.ProjectId == access.Project.Id && r.Status == CheckRunStatuses.Done)
            .OrderByDescending(r => r.FinishedAt).FirstOrDefaultAsync(cancellationToken);
        var optOuts = await db.CheckOptOuts.AsNoTracking().Where(o => o.ProjectId == access.Project.Id)
            .ToDictionaryAsync(o => o.CheckId, o => o.Reason, cancellationToken);
        var results = last?.Results.ToDictionary(r => r.CheckId) ?? [];
        return Results.Ok(new
        {
            lastRun = last is null ? null : View(last),
            checks = CheckCatalog.All.Select(c => new CheckView(c.Id, c.Phase, c.Condition, c.Method, c.Severity, c.Owner,
                results.GetValueOrDefault(c.Id)?.Result, results.GetValueOrDefault(c.Id)?.Failing, results.GetValueOrDefault(c.Id)?.Note,
                optOuts.GetValueOrDefault(c.Id))),
        });
    }

    /// <summary>POST /checks/run: queues a check run now (Document Control only). The worker runs it; answers 409 if one is already queued or running.</summary>
    private static async Task<IResult> RunAsync(HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control runs the checks.");
        var run = await CheckScheduler.RequestAsync(db, clock, access.Project.TenantId, access.Project.Id, access.UserName,
            onlyIfDue: false, cancellationToken);
        return run is null
            ? Problems.Conflict("CHECKS_ALREADY_RUNNING", "The checks are already queued or running for this project.")
            : Results.Accepted($"/api/projects/{access.Project.Id}/checks/runs/{run.Id}", View(run));
    }

    /// <summary>GET /checks/runs/{runId}: returns one run, so the page can poll until it is done.</summary>
    private static async Task<IResult> GetRunAsync(Guid runId, HttpContext http, DeliosDbContext db, CancellationToken cancellationToken) =>
        await db.CheckRuns.AsNoTracking().SingleOrDefaultAsync(r => r.Id == runId && r.ProjectId == ProjectAccessFilter.Of(http).Project.Id,
            cancellationToken) is { } run
            ? Results.Ok(View(run))
            : Problems.NotFound("CHECK_RUN_NOT_FOUND", "No such run.");

    /// <summary>The project does not ask this question, for a reason on the record. Its findings close at the next run.</summary>
    private static async Task<IResult> OptOutAsync(
        string checkId, ReasonRequest request, HttpContext http, DeliosDbContext db, IClock clock, Audit.AuditLog audit,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control decides which checks the project answers to.");
        if (CheckCatalog.Find(checkId) is null) return Problems.NotFound("CHECK_NOT_FOUND", "No such check.");
        var reason = request.Reason?.Trim() ?? "";
        if (reason.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why the project does not answer to this check.");
        var existing = await db.CheckOptOuts.SingleOrDefaultAsync(o => o.ProjectId == access.Project.Id && o.CheckId == checkId, cancellationToken);
        if (existing is null)
        {
            db.CheckOptOuts.Add(new CheckOptOut
            {
                TenantId = access.Project.TenantId,
                ProjectId = access.Project.Id,
                CheckId = checkId,
                Reason = reason,
                ByName = access.UserName,
                At = clock.GetCurrentInstant(),
            });
        }
        else
        {
            existing.Reason = reason;
            existing.ByName = access.UserName;
            existing.At = clock.GetCurrentInstant();
        }
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "CHECK_SWITCHED_OFF", "Project", access.Project.Id, checkId, reason,
            access.Project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>DELETE /checks/{checkId}/opt-out: switches a check back on for the project (Document Control only) and records that in the audit trail.</summary>
    private static async Task<IResult> OptInAsync(
        string checkId, HttpContext http, DeliosDbContext db, Audit.AuditLog audit, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control decides which checks the project answers to.");
        var removed = await db.CheckOptOuts.Where(o => o.ProjectId == access.Project.Id && o.CheckId == checkId).ExecuteDeleteAsync(cancellationToken);
        if (removed > 0)
        {
            await audit.WriteAsync(http.User.Actor(), "CHECK_SWITCHED_ON", "Project", access.Project.Id, checkId, null,
                access.Project.Id, cancellationToken);
        }
        return Results.NoContent();
    }

    /// <summary>
    /// GET /defects: lists the project's defects, most serious first, at most 1000. Without a status filter it shows those not closed.
    /// Defects on documents the caller may not see are left out.
    /// </summary>
    private static async Task<IResult> DefectsAsync(
        HttpContext http, DeliosDbContext db, DocumentService documents, CancellationToken cancellationToken,
        string? status = null, string? severity = null, string? checkId = null, Guid? documentId = null)
    {
        var access = ProjectAccessFilter.Of(http);
        var visible = DocumentQueries.Visible(db, access, await documents.RestrictedAsync(cancellationToken)).Select(d => d.Id);
        var query = db.Defects.AsNoTracking().Where(d => d.ProjectId == access.Project.Id
            && (d.DocumentId == null || visible.Contains(d.DocumentId.Value)));
        query = status is null ? query.Where(d => d.Status != DefectStatuses.Closed) : query.Where(d => d.Status == status);
        if (severity is not null) query = query.Where(d => d.Severity == severity);
        if (checkId is not null) query = query.Where(d => d.CheckId == checkId);
        if (documentId is not null) query = query.Where(d => d.DocumentId == documentId);
        var rows = await query.OrderBy(d => d.Severity == Severities.Critical ? 0 : d.Severity == Severities.Major ? 1 : d.Severity == Severities.Minor ? 2 : 3)
            .ThenBy(d => d.FirstSeenAt).Take(1000).ToListAsync(cancellationToken);
        return Results.Ok(rows.Select(View));
    }

    /// <summary>Accepted as it is: the decision and its reason are recorded, and it still counts.</summary>
    private static async Task<IResult> AcceptAsync(
        Guid defectId, ReasonRequest request, HttpContext http, DeliosDbContext db, IClock clock, Audit.AuditLog audit,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control accepts a defect as it is.");
        var defect = await db.Defects.SingleOrDefaultAsync(d => d.Id == defectId && d.ProjectId == access.Project.Id, cancellationToken);
        if (defect is null) return Problems.NotFound("DEFECT_NOT_FOUND", "No such defect.");
        if (defect.Status != DefectStatuses.Open) return Problems.Conflict("DEFECT_NOT_OPEN", "Only an open defect is accepted.", new { status = defect.Status });
        var reason = request.Reason?.Trim() ?? "";
        if (reason.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it is accepted as it is.");
        defect.Status = DefectStatuses.Accepted;
        defect.AcceptedReason = reason;
        defect.AcceptedByName = access.UserName;
        defect.AcceptedAt = clock.GetCurrentInstant();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "DEFECT_ACCEPTED", "Defect", defect.Id, $"{defect.CheckId} {defect.Label}", reason,
            access.Project.Id, cancellationToken);
        return Results.Ok(View(defect));
    }

    /// <summary>Turns a stored check run into the shape sent to the browser. Also used by other endpoints that show the last run.</summary>
    public static RunView View(CheckRun r) => new(r.Id, r.Status, r.RequestedByName, r.RequestedAt.ToDateTimeOffset(),
        r.FinishedAt?.ToDateTimeOffset(), r.Executed, r.Passed, r.Failed, r.NeedsSetup, r.Off, r.Integrity, r.Coverage, r.OpenCritical,
        r.Error, r.Results);

    /// <summary>Turns a stored defect into the shape sent to the browser.</summary>
    private static DefectView View(Defect d) => new(d.Id, d.CheckId, d.Severity, d.Owner, d.EntityType, d.EntityId, d.DocumentId,
        d.Label, d.Description, d.Status, d.FirstSeenAt.ToDateTimeOffset(), d.LastSeenAt.ToDateTimeOffset(), d.ClosedAt?.ToDateTimeOffset(),
        d.AcceptedReason, d.AcceptedByName);
}
