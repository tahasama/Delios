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

namespace Delios.Host.Schedules;

public static partial class ScheduleEndpoints
{
    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>True when the caller may waive or un-waive this need: Document Control, or an active member of the department that owns the need.</summary>
    private static async Task<bool> MayWaiveAsync(DeliosDbContext db, ProjectAccess access, Requirement need, CancellationToken cancellationToken) =>
        access.Holds(Verbs.Control)
        || (need.Department is not null && await db.Memberships.AnyAsync(m => m.ProjectId == access.Project.Id && m.UserId == access.UserId
            && m.Active && m.Department == need.Department, cancellationToken));

    /// <summary>Today's date in the project's time zone, and the project's risk window in days (14 when no schedule is set up).</summary>
    private static async Task<(LocalDate Today, int Window)> TodayAsync(DeliosDbContext db, IClock clock, Project project, CancellationToken cancellationToken)
    {
        var window = await db.ScheduleSources.Where(s => s.ProjectId == project.Id).Select(s => (int?)s.RiskWindowDays).SingleOrDefaultAsync(cancellationToken);
        return (WorkingCalendar.Today(clock, project.TimeZone), window ?? 14);
    }

    /// <summary>Turns a stored activity into the list shape, adding its readiness label.</summary>
    private static ActivitySummary Summary(Activity a, LocalDate today, int window) => new(
        a.Id, a.Code, a.Name, a.Start?.ToDateOnly(), a.Finish?.ToDateOnly(), a.Responsible, a.Departments, a.State,
        ReadinessLabels.Of(a, today, window), a.NeedCount, a.MetCount, a.WaivedCount, a.NextNeededBy?.ToDateOnly(), a.ExternalId,
        a.MovedIn is null || a.MovedAt is null ? null : new ActivityMove(a.WasStart?.ToDateOnly(), a.WasFinish?.ToDateOnly(), a.MovedIn, a.MovedAt.Value.ToDateTimeOffset()));

    /// <summary>Builds the views of an activity's needs, looking up each document and its current released revision, ordered by the day they are needed.</summary>
    private static async Task<List<NeedView>> NeedViewsAsync(DeliosDbContext db, IEnumerable<Requirement> needs, CancellationToken cancellationToken)
    {
        var list = needs.ToList();
        var ids = list.Select(n => n.DocumentId).Distinct().ToList();
        var documents = await db.Documents.AsNoTracking().Where(d => ids.Contains(d.Id)).ToDictionaryAsync(d => d.Id, cancellationToken);
        var current = await db.Revisions.AsNoTracking().Where(r => ids.Contains(r.DocumentId) && r.State == RevisionStates.Released)
            .ToDictionaryAsync(r => r.DocumentId, cancellationToken);
        return list.OrderBy(n => n.NeededBy).Select(n => new NeedView(n.Id, n.DocumentId, documents[n.DocumentId].Number, documents[n.DocumentId].Title,
            current.GetValueOrDefault(n.DocumentId)?.Value, current.GetValueOrDefault(n.DocumentId)?.StatusCode, n.Purpose, n.RequiredStatuses,
            n.Anchor, n.OffsetDays, n.FixedDate?.ToDateOnly(), n.NeededBy?.ToDateOnly(), n.Department, n.State, n.MetAt?.ToDateTimeOffset(),
            n.WaiverNote, n.WaivedByName, n.WaivedAt?.ToDateTimeOffset(), n.RiskDays)).ToList();
    }

    /// <summary>The standard "no such activity" 404 answer.</summary>
    private static IResult NotFound() => Problems.NotFound("ACTIVITY_NOT_FOUND", "No such activity.");
}
