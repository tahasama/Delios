using System.Text.Json;
using Delios.Host.Documents;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Schedules;

/// <summary>An activity's readiness, as people read it.</summary>
public static class ReadinessLabels
{
    /// <summary>It needs nothing.</summary>
    public const string None = "NONE";
    /// <summary>Every document it needs is there.</summary>
    public const string Ready = "READY";
    /// <summary>Covered, but some only by waiver: green, and still followed up.</summary>
    public const string ReadyWithWaivers = "READY_WITH_WAIVERS";
    /// <summary>A document still missing is owed within the risk window, or already late.</summary>
    public const string AtRisk = "AT_RISK";
    /// <summary>Something is missing, but not yet near.</summary>
    public const string Pending = "PENDING";

    public static string Of(Activity a, LocalDate today, int riskWindowDays) =>
        a.NeedCount == 0 ? None
        : a.MetCount == a.NeedCount ? Ready
        : a.MetCount + a.WaivedCount == a.NeedCount ? ReadyWithWaivers
        : a.NextNeededBy is { } owed && owed <= today.PlusDays(riskWindowDays) ? AtRisk
        : Pending;
}

/// <summary>
/// Works out, for each need, the day it is needed and whether its document is
/// there for what it serves, and writes the totals on the activity. Called when a
/// need is added or waived, when the schedule moves, and when a document is released.
/// </summary>
public static class Readiness
{
    public static async Task RestateAsync(DeliosDbContext db, IClock clock, IReadOnlyCollection<Guid> activityIds, CancellationToken cancellationToken)
    {
        if (activityIds.Count == 0) return;
        var activities = await db.Activities.Include(a => a.Requirements)
            .Where(a => activityIds.Contains(a.Id)).ToListAsync(cancellationToken);
        var documentIds = activities.SelectMany(a => a.Requirements).Select(r => r.DocumentId).Distinct().ToList();
        var current = await db.Revisions.AsNoTracking()
            .Where(r => documentIds.Contains(r.DocumentId) && r.State == RevisionStates.Released)
            .Select(r => new { r.DocumentId, r.StatusCode, r.ReleasedAt }).ToListAsync(cancellationToken);
        var released = current.ToDictionary(r => r.DocumentId);
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var now = clock.GetCurrentInstant();

        foreach (var activity in activities)
        {
            foreach (var need in activity.Requirements)
            {
                need.NeededBy = NeededBy(activity, need);
                var there = released.TryGetValue(need.DocumentId, out var revision)
                    && Serves(catalog, need, revision.StatusCode);
                if (there)
                {
                    need.State = RequirementStates.Met;
                    need.MetAt ??= revision!.ReleasedAt ?? now;
                }
                else
                {
                    need.State = need.WaivedAt is null ? RequirementStates.Missing : RequirementStates.Waived;
                    need.MetAt = null;
                }
            }
            activity.NeedCount = activity.Requirements.Count;
            activity.MetCount = activity.Requirements.Count(r => r.State == RequirementStates.Met);
            activity.WaivedCount = activity.Requirements.Count(r => r.State == RequirementStates.Waived);
            activity.NextNeededBy = activity.Requirements.Where(r => r.State == RequirementStates.Missing && r.NeededBy is not null)
                .Select(r => r.NeededBy).Min();
        }
    }

    /// <summary>Every active activity that needs this document: the ones its release may change.</summary>
    public static Task<List<Guid>> NeedingAsync(DeliosDbContext db, Guid documentId, CancellationToken cancellationToken) =>
        db.Requirements.Where(r => r.DocumentId == documentId).Select(r => r.ActivityId).Distinct().ToListAsync(cancellationToken);

    /// <summary>The fixed date, or the anchor's date moved by the offset; unknown while the anchor has no date.</summary>
    public static LocalDate? NeededBy(Activity activity, Requirement need) =>
        need.FixedDate ?? (need.Anchor == Anchors.Finish ? activity.Finish : activity.Start)?.PlusDays(need.OffsetDays);

    /// <summary>
    /// Whether a released status serves the need: one of the statuses it names; or,
    /// for a purpose that executes (for construction), a status that allows work;
    /// or, for anything else (for information), any release.
    /// </summary>
    public static bool Serves(Catalog catalog, Requirement need, string? status)
    {
        if (status is null) return false;
        if (need.RequiredStatuses.Length > 0) return need.RequiredStatuses.Contains(status);
        var executes = catalog.Prop(TransmittalSets.Reasons, need.Purpose, "executes") is { ValueKind: JsonValueKind.True };
        return !executes || catalog.Prop(ReviewSets.Statuses, status, "executes") is { ValueKind: JsonValueKind.True };
    }
}
