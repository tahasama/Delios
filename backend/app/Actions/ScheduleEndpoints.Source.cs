using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Tenancy;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Actions;

public static partial class ScheduleEndpoints
{
    // ── The schedule document ─────────────────────────────────────────────────

    /// <summary>GET /schedule: returns the project's schedule settings (or null) and its 20 latest imports.</summary>
    private static async Task<IResult> SourceAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var source = await db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id, cancellationToken);
        var imports = await db.ScheduleImports.AsNoTracking().Where(i => i.ProjectId == access.Project.Id)
            .OrderByDescending(i => i.ImportedAt).Take(20).ToListAsync(cancellationToken);
        return Results.Ok(new { source, imports });
    }

    /// <summary>Names the project's schedule document and how its export is read.</summary>
    private static async Task<IResult> SetSourceAsync(
        SourceRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "The control function names the schedule document.");
        var document = await db.Documents.AsNoTracking().SingleOrDefaultAsync(d => d.Id == request.DocumentId && d.ProjectId == access.Project.Id, cancellationToken);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (request.DefaultLeadDays is < 0 or > 365 || request.RiskWindowDays is < 0 or > 365)
            return Problems.Invalid("DAYS_INVALID", "Days are between 0 and 365.");
        if (request.Columns is { DateOrder: var order } && order is not ("DMY" or "MDY"))
            return Problems.Invalid("DATE_ORDER_INVALID", "Numeric dates are read day first (DMY) or month first (MDY).");
        var source = await db.ScheduleSources.SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id, cancellationToken);
        // The risk window is the organization's where it keeps it fixed: the project's stays as it was.
        if (request.RiskWindowDays is { } window && window != (source?.RiskWindowDays ?? 7)
            && !await Settings.Liberty.IsFreeAsync(db, "RISK_WINDOW", cancellationToken))
            return Problems.Forbidden("ROOM_FIXED", "The risk window: the organization keeps it the same on every project. An administrator changes it in the organization's Settings.");
        if (source is null)
        {
            source = new ScheduleSource { TenantId = access.Project.TenantId, ProjectId = access.Project.Id, DocumentId = document.Id };
            db.ScheduleSources.Add(source);
        }
        source.DocumentId = document.Id;
        source.Columns = request.Columns ?? source.Columns;
        source.DefaultLeadDays = request.DefaultLeadDays ?? source.DefaultLeadDays;
        source.RiskWindowDays = request.RiskWindowDays ?? source.RiskWindowDays;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "SCHEDULE_SOURCE_SET", "Document", document.Id, document.Number,
            $"The project's schedule; needed {source.DefaultLeadDays} days before an activity unless a need says otherwise.",
            access.Project.Id, cancellationToken);
        return Results.Ok(source);
    }

    /// <summary>
    /// The days around an action (Control room): a document is needed this many days before the action's day unless the
    /// requirements list says otherwise (for needs added after), and an action is at risk from this many days before it
    /// (each document's own window wins). The risk window follows the organization where it keeps it fixed. Every action of
    /// the project is read again.
    /// </summary>
    private static async Task<IResult> SetDaysAsync(
        ScheduleDaysRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, NodaTime.IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "The control function sets the days around an action.");
        if (request.DefaultLeadDays is < 0 or > 365 || request.RiskWindowDays is < 0 or > 365)
            return Problems.Invalid("DAYS_INVALID", "Days are between 0 and 365.");
        var source = await db.ScheduleSources.SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id, cancellationToken);
        if (source is null) return Problems.Conflict("SCHEDULE_NOT_SET", "Name the project's schedule first (Schedule): the days apply to its actions.");
        if (request.RiskWindowDays is { } window && window != source.RiskWindowDays
            && !await Settings.Liberty.IsFreeAsync(db, "RISK_WINDOW", cancellationToken))
            return Problems.Forbidden("ROOM_FIXED", "The risk window: the organization keeps it the same on every project. An administrator changes it in the organization's Settings.");
        var was = $"{source.DefaultLeadDays} / {source.RiskWindowDays}";
        source.DefaultLeadDays = request.DefaultLeadDays ?? source.DefaultLeadDays;
        source.RiskWindowDays = request.RiskWindowDays ?? source.RiskWindowDays;
        await db.SaveChangesAsync(cancellationToken);
        await Readiness.RestateProjectAsync(db, clock, access.Project.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "SCHEDULE_DAYS_SET", "Project", access.Project.Id, access.Project.Code,
            $"Needed {source.DefaultLeadDays} days before an action, at risk from {source.RiskWindowDays} days before (was {was}).",
            access.Project.Id, cancellationToken);
        return Results.Ok(source);
    }

    /// <summary>Reads the schedule's current released revision now: for a schedule named after its release.</summary>
    private static async Task<IResult> ImportAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "The control function reads the schedule in.");
        var source = await db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id, cancellationToken);
        if (source is null) return Problems.Conflict("SCHEDULE_NOT_SET", "Name the schedule document first.");
        var revision = await db.Revisions.AsNoTracking()
            .SingleOrDefaultAsync(r => r.DocumentId == source.DocumentId && r.State == RevisionStates.Released, cancellationToken);
        if (revision is null) return Problems.Conflict("SCHEDULE_NOT_RELEASED", "The schedule has no released revision: it is read once one is released.");
        if (await db.ScheduleImports.AnyAsync(i => i.RevisionId == revision.Id, cancellationToken))
            return Problems.Conflict("SCHEDULE_ALREADY_READ", $"Revision {revision.Value} has already been read.");
        db.Enqueue(ScheduleImportRequested.RoutingKey, new ScheduleImportRequested(revision.TenantId, revision.Id));
        await db.SaveChangesAsync(cancellationToken);
        return Results.Accepted(value: new { revision = revision.Value });
    }
}
