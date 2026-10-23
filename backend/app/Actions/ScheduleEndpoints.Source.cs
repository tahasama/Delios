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
        // The days around an action in force here (its own, else the organization's), with whose each is.
        var days = await ScheduleDays.ForProjectAsync(db, access.Project.Id, cancellationToken);
        return Results.Ok(new { source, imports, days });
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
        if (source is null)
        {
            source = new ScheduleSource { TenantId = access.Project.TenantId, ProjectId = access.Project.Id, DocumentId = document.Id };
            db.ScheduleSources.Add(source);
        }
        source.DocumentId = document.Id;
        source.Columns = request.Columns ?? source.Columns;
        await db.SaveChangesAsync(cancellationToken);
        // Days sent with it are the project's days around an action, set as the Control room sets them (two levels).
        if (request.DefaultLeadDays is not null || request.RiskWindowDays is not null)
        {
            var clock = http.RequestServices.GetRequiredService<IClock>();
            var set = await ScheduleDays.ProjectPutAsync(new(request.DefaultLeadDays, request.RiskWindowDays), http, db, audit, clock, cancellationToken);
            if (set is IStatusCodeHttpResult { StatusCode: not 200 }) return set;
        }
        var days = await ScheduleDays.ForProjectAsync(db, access.Project.Id, cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "SCHEDULE_SOURCE_SET", "Document", document.Id, document.Number,
            $"The project's schedule; needed {days.Lead} days before an activity unless a need says otherwise.",
            access.Project.Id, cancellationToken);
        return Results.Ok(source);
    }

    /// <summary>
    /// Reads the schedule's current released revision now: for a schedule named after its release. With
    /// <c>again=true</c>, a revision already read is read again at once (its file as released, read as the app reads it
    /// now), by the control function or whoever may upload the schedule.
    /// </summary>
    private static async Task<IResult> ImportAsync(HttpContext http, DeliosDbContext db, ScheduleImporter importer, AuditLog audit,
        CancellationToken cancellationToken, bool again = false)
    {
        var access = ProjectAccessFilter.Of(http);
        if (again ? !(access.Holds(Verbs.Control) || access.Holds(Verbs.Plan)) : !access.Holds(Verbs.Control))
            return Problems.Forbidden("CONTROL_ONLY", again ? "The control function, or a function given Plan, reads the schedule again." : "The control function reads the schedule in.");
        var source = await db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id, cancellationToken);
        if (source is null) return Problems.Conflict("SCHEDULE_NOT_SET", "Name the schedule document first.");
        var revision = await db.Revisions.AsNoTracking().Include(r => r.Files)
            .SingleOrDefaultAsync(r => r.DocumentId == source.DocumentId && r.State == RevisionStates.Released, cancellationToken);
        if (revision is null) return Problems.Conflict("SCHEDULE_NOT_RELEASED", "The schedule has no released revision: it is read once one is released.");
        if (again)
        {
            var (summary, error) = await importer.ReadAgainAsync(source, revision, cancellationToken);
            if (error is not null) return Problems.Invalid("SCHEDULE_NOT_READ", error);
            var number = await db.Documents.AsNoTracking().Where(d => d.Id == revision.DocumentId).Select(d => d.Number).SingleAsync(cancellationToken);
            await audit.WriteAsync(http.User.Actor(), "SCHEDULE_READ_AGAIN", "Revision", revision.Id, $"{number} rev {revision.Value}",
                $"Read again by {access.UserName}: {summary}", access.Project.Id, cancellationToken);
            return Results.Ok(new { revision = revision.Value, summary });
        }
        if (await db.ScheduleImports.AnyAsync(i => i.RevisionId == revision.Id, cancellationToken))
            return Problems.Conflict("SCHEDULE_ALREADY_READ", $"Revision {revision.Value} has already been read.");
        db.Enqueue(ScheduleImportRequested.RoutingKey, new ScheduleImportRequested(revision.TenantId, revision.Id));
        await db.SaveChangesAsync(cancellationToken);
        return Results.Accepted(value: new { revision = revision.Value });
    }
}
