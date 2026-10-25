using System.Text.Json;
using Delios.Host.Documents;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Actions;

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

    /// <summary>
    /// Works out an activity's readiness label from its stored counts. Used by the schedule endpoints when listing activities, and by the report builder.
    /// At risk once <see cref="Activity.RiskFrom"/> has come (written with each document's window); <paramref name="riskWindowDays"/> is kept for callers.
    /// </summary>
    public static string Of(Activity a, LocalDate today, int riskWindowDays) =>
        a.NeedCount == 0 ? None
        : a.MetCount == a.NeedCount ? Ready
        : a.MetCount + a.WaivedCount == a.NeedCount ? ReadyWithWaivers
        : a.RiskFrom is { } from && from <= today ? AtRisk
        : Pending;
}

/// <summary>
/// Works out, for each need, the day it is needed and whether its document is
/// there for what it serves, and writes the totals on the activity. Called when a
/// need is added or waived, when the schedule moves, and when a document is released.
/// </summary>
public static class Readiness
{
    /// <summary>
    /// Recomputes, for the given activities, each need's due day and state (met, missing or waived), and the totals stored on the activity.
    /// Does not save: the caller saves the changes. Called by the schedule endpoints, the schedule importer and on document release.
    /// </summary>
    public static async Task RestateAsync(DeliosDbContext db, IClock clock, IReadOnlyCollection<Guid> activityIds, CancellationToken cancellationToken)
    {
        if (activityIds.Count == 0) return;
        var activities = await db.Activities.Include(a => a.Requirements)
            .Where(a => activityIds.Contains(a.Id)).ToListAsync(cancellationToken);
        var documentIds = activities.SelectMany(a => a.Requirements).Select(r => r.DocumentId).Distinct().ToList();
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var now = clock.GetCurrentInstant();
        var projectIds = activities.Select(a => a.ProjectId).Distinct().ToList();
        // What makes a document count, as each project chose (POLICY_READY): released and issued at the status the action
        // needs (ISSUED, the app's), or a decided revision carrying that status, however it got there (STATUS).
        var there = new Dictionary<Guid, Dictionary<Guid, (string? Status, Instant At)>>();
        foreach (var projectId in projectIds)
            there[projectId] = await ThereAsync(db, projectId, documentIds, cancellationToken);
        var windows = await ScheduleDays.RiskByProjectAsync(db, projectIds, cancellationToken);

        foreach (var activity in activities)
        {
            foreach (var need in activity.Requirements)
            {
                need.NeededBy = NeededBy(activity, need);
                if (there[activity.ProjectId].TryGetValue(need.DocumentId, out var revision) && Serves(catalog, need, revision.Status))
                {
                    need.State = RequirementStates.Met;
                    need.MetAt ??= revision.At;
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
            activity.LastMetAt = activity.NeedCount > 0 && activity.MetCount == activity.NeedCount
                ? activity.Requirements.Max(r => r.MetAt) : null;
            activity.NextNeededBy = activity.Requirements.Where(r => r.State == RequirementStates.Missing && r.NeededBy is not null)
                .Select(r => r.NeededBy).Min();
            // At risk from the earliest day a missing document's window opens, counted back from the activity's day:
            // its own window from the requirements list, or the project's.
            var window = windows.GetValueOrDefault(activity.ProjectId, 7);
            activity.RiskFrom = activity.Start is { } day
                ? activity.Requirements.Where(r => r.State == RequirementStates.Missing).Select(r => (LocalDate?)day.PlusDays(-(r.RiskDays ?? window))).Min()
                : null;
        }

        // A document the schedule needs is planned for the earliest day an active action needs it: the same date on the
        // register, the document and its package as on the action. One the schedule does not need keeps its own.
        var here = activities.Where(a => a.State == ActivityStates.Active).SelectMany(a => a.Requirements)
            .Where(r => r.NeededBy is not null).Select(r => new { r.DocumentId, r.NeededBy }).ToList();
        var elsewhere = await (from r in db.Requirements.AsNoTracking()
                               join a in db.Activities.AsNoTracking() on r.ActivityId equals a.Id
                               where documentIds.Contains(r.DocumentId) && !activityIds.Contains(a.Id) && a.State == ActivityStates.Active && r.NeededBy != null
                               select new { r.DocumentId, r.NeededBy }).ToListAsync(cancellationToken);
        var earliest = here.Concat(elsewhere).GroupBy(r => r.DocumentId).ToDictionary(g => g.Key, g => g.Min(r => r.NeededBy));
        if (earliest.Count > 0)
        {
            var planned = earliest.Keys.ToList();
            foreach (var document in await db.Documents.Where(d => planned.Contains(d.Id)).ToListAsync(cancellationToken))
                if (document.PlannedDate != earliest[document.Id]) document.PlannedDate = earliest[document.Id];
        }
    }

    /// <summary>
    /// For each document, the revision that counts for the schedule on this project, with its status and since when. The
    /// app's reading (POLICY_READY = ISSUED): the released revision, once it reached its people: at once where releasing
    /// sends it (POLICY_RELEASE = TOGETHER), else when a transmittal first carried it out. STATUS: the newest revision a
    /// review decided (released or not, never returned or void), with the status it carries.
    /// </summary>
    private static async Task<Dictionary<Guid, (string? Status, Instant At)>> ThereAsync(DeliosDbContext db, Guid projectId, List<Guid> documentIds,
        CancellationToken cancellationToken)
    {
        var ready = await Settings.ProjectAnswers.PolicyOrDefaultAsync(db, projectId, "POLICY_READY", "ISSUED", cancellationToken);
        var mine = db.Revisions.AsNoTracking().Where(r => r.ProjectId == projectId && documentIds.Contains(r.DocumentId));
        if (ready == "STATUS")
        {
            var decided = await (from r in mine
                                 where r.State != RevisionStates.Returned && r.State != RevisionStates.Void && r.State != RevisionStates.Superseded
                                 let at = db.Reviews.Where(v => v.RevisionId == r.Id && v.DecidedAt != null).Max(v => v.DecidedAt)
                                 where r.State == RevisionStates.Released || at != null
                                 select new { r.DocumentId, r.StatusCode, r.CreatedAt, At = r.ReleasedAt ?? at }).ToListAsync(cancellationToken);
            return decided.GroupBy(r => r.DocumentId)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.CreatedAt).Select(r => ((string?)r.StatusCode, r.At!.Value)).First());
        }
        var released = await mine.Where(r => r.State == RevisionStates.Released)
            .Select(r => new { r.Id, r.DocumentId, r.StatusCode, r.ReleasedAt }).ToListAsync(cancellationToken);
        var together = await Settings.ProjectAnswers.PolicyOrDefaultAsync(db, projectId, "POLICY_RELEASE", "TOGETHER", cancellationToken) != "SEPARATE";
        if (together) return released.ToDictionary(r => r.DocumentId, r => ((string?)r.StatusCode, r.ReleasedAt!.Value));
        var ids = released.Select(r => r.Id).ToList();
        var sent = await (from i in db.TransmittalItems
                          join t in db.Transmittals on i.TransmittalId equals t.Id
                          where i.RevisionId != null && ids.Contains(i.RevisionId.Value) && t.ReviewStepId == null
                              && t.Direction == TransmittalDirections.Outgoing
                          group t by i.RevisionId!.Value into g
                          select new { RevisionId = g.Key, At = g.Min(t => t.IssuedAt) }).ToDictionaryAsync(x => x.RevisionId, x => x.At, cancellationToken);
        return released.Where(r => sent.ContainsKey(r.Id)).ToDictionary(r => r.DocumentId, r => ((string?)r.StatusCode, sent[r.Id]));
    }

    /// <summary>Restates every activity needing one of these documents (after a transmittal sent them, or a review decided one). The caller saves.</summary>
    public static async Task RestateDocumentsAsync(DeliosDbContext db, IClock clock, IReadOnlyCollection<Guid> documentIds, CancellationToken cancellationToken)
    {
        if (documentIds.Count == 0) return;
        var ids = await db.Requirements.Where(r => documentIds.Contains(r.DocumentId)).Select(r => r.ActivityId).Distinct().ToListAsync(cancellationToken);
        await RestateAsync(db, clock, ids, cancellationToken);
    }

    /// <summary>Restates every activity of a project (after what makes a document count changed). The caller saves.</summary>
    public static async Task RestateProjectAsync(DeliosDbContext db, IClock clock, Guid projectId, CancellationToken cancellationToken) =>
        await RestateAsync(db, clock, await db.Activities.Where(a => a.ProjectId == projectId).Select(a => a.Id).ToListAsync(cancellationToken), cancellationToken);

    /// <summary>Every activity (active or removed) that needs this document: the ones its release may change.</summary>
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
        if (need.RequiredStatuses.Length > 0) return status is not null && need.RequiredStatuses.Contains(status);
        var executes = catalog.Prop(TransmittalSets.Reasons, need.Purpose, "executes") is { ValueKind: JsonValueKind.True };
        // Any release serves a purpose that does not execute, even one released without a status.
        return !executes || (status is not null && catalog.Prop(ReviewSets.Statuses, status, "executes") is { ValueKind: JsonValueKind.True });
    }
}
