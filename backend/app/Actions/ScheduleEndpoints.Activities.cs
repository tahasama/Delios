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
    // ── Activities ────────────────────────────────────────────────────────────

    /// <summary>
    /// GET /activities: lists the project's activities by start date, at most <see cref="MaxActions"/>, filtered by readiness, start date range, department or a text search on code and name.
    /// Removed activities are left out unless <paramref name="includeRemoved"/> is true.
    /// </summary>
    private static async Task<IResult> ActivitiesAsync(
        HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken,
        string? readiness = null, DateOnly? from = null, DateOnly? to = null, string? department = null, string? q = null,
        bool includeRemoved = false)
    {
        var access = ProjectAccessFilter.Of(http);
        var (today, window) = await TodayAsync(db, clock, access.Project, cancellationToken);
        var query = db.Activities.AsNoTracking().Where(a => a.ProjectId == access.Project.Id);
        if (!includeRemoved) query = query.Where(a => a.State == ActivityStates.Active);
        if (from is { } f) query = query.Where(a => a.Start >= LocalDate.FromDateOnly(f));
        if (to is { } t) query = query.Where(a => a.Start <= LocalDate.FromDateOnly(t));
        if (department is not null)
        {
            var code = (await Catalog.LoadAsync(db, cancellationToken)).Find(ValueSets.Disciplines, department) ?? department;
            query = query.Where(a => a.Departments.Contains(code));
        }
        if (!string.IsNullOrWhiteSpace(q))
        {
            var pattern = "%" + q.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
            query = query.Where(a => EF.Functions.ILike(a.Code, pattern) || EF.Functions.ILike(a.Name, pattern));
        }
        var rows = await query.OrderBy(a => a.Start).ThenBy(a => a.Code).Take(MaxActions).ToListAsync(cancellationToken);
        var views = rows.Select(a => Summary(a, today, window));
        if (readiness is not null) views = views.Where(v => v.Readiness == readiness);
        return Results.Ok(views.ToList());
    }

    /// <summary>GET /activities/{activityId}: one activity with its needs and recorded decisions. Also used by the other endpoints to send back the updated activity.</summary>
    private static async Task<IResult> ActivityAsync(
        Guid activityId, HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var activity = await db.Activities.AsNoTracking().Include(a => a.Requirements)
            .SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, cancellationToken);
        if (activity is null) return NotFound();
        var (today, window) = await TodayAsync(db, clock, access.Project, cancellationToken);
        var decisions = await db.ActivityDecisions.AsNoTracking().Where(d => d.ActivityId == activityId).OrderBy(d => d.RecordedAt)
            .ToListAsync(cancellationToken);
        return Results.Ok(new
        {
            activity = Summary(activity, today, window),
            needs = await NeedViewsAsync(db, activity.Requirements, cancellationToken),
            decisions = decisions.Select(d => new DecisionView(d.Id, d.Decision, d.PlannedStart?.ToDateOnly(), d.ResponsibleName, d.Reason,
                d.DelayOwedBy, d.DelayReason, d.RecordedByName, d.RecordedAt.ToDateTimeOffset(),
                d.ConfirmedByName, d.ConfirmedAt?.ToDateTimeOffset(), d.ConfirmNote, d.ReversedByName, d.ReversedAt?.ToDateTimeOffset(), d.ReversedReason)),
        });
    }
}
