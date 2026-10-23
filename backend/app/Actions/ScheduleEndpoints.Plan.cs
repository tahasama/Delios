using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Records;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Actions;

/// <summary>The schedule as its screens show it: the actions in force, each with everything its rows and page need.</summary>
public sealed record PlanView(string? VersionInForce, IReadOnlyList<PlanAction> Actions);

/// <summary>
/// An action with its needs (each with its document and where it stands), the decisions about it (newest first), and each
/// discipline's confirmations. <c>LastMetAt</c>: when the last of its documents arrived, once none is missing.
/// Where it stands, said once for every screen (<see cref="ActionStates"/>): <c>Passed</c> its day is over (in the
/// project's time zone); <c>RiskFrom</c> the day it is at risk from, overall and for each discipline (the earliest day a
/// missing document's risk window opens, counted back from the action's day).
/// </summary>
public sealed record PlanAction(Guid Id, string Code, string? ExternalId, string Name, string? Responsible, IReadOnlyList<string> Departments,
    DateOnly? Start, DateOnly? Finish, int NeedCount, ActivityMove? Moved, DateTimeOffset? LastMetAt,
    IReadOnlyList<PlanNeed> Needs, IReadOnlyList<DecisionView> Decisions, IReadOnlyList<PlanConfirmation> Confirmations,
    bool Passed, string State, DateOnly? RiskFrom, IReadOnlyDictionary<string, DateOnly?> DisciplineRiskFrom,
    bool StartAchieved = false, bool FinishAchieved = false, IReadOnlyList<string>? Wbs = null, int? WbsOrder = null);

/// <summary>
/// One need: what it asks for (the statuses it names, or its purpose), by when (<c>ManualDate</c>: a date set by hand;
/// <c>LeadDays</c>: working days before the action), its own risk window, and its document.
/// </summary>
public sealed record PlanNeed(Guid Id, Guid DocumentId, string? Department, string RequiredStatus, DateOnly NeededBy, bool ManualDate,
    int? LeadDays, int? RiskDays, string State, PlanDocument Document);

/// <summary>A needed document: its released revision (and whether it serves the need), and its newest revision whatever its state.</summary>
public sealed record PlanDocument(Guid Id, string Number, string Title, string Discipline, string DocType, string? Originator, bool IsPlaceholder,
    PlanReleased? Released, PlanLatest? Latest);

public sealed record PlanReleased(string Value, string? StatusCode, bool Meets);
public sealed record PlanLatest(string Value, string State, string? StatusCode, bool Held);

/// <summary>A discipline's answer on whether the action goes ahead with its documents; a taken-back one is kept, marked.</summary>
public sealed record PlanConfirmation(string Department, bool Available, string? Note, string ConfirmedByName, DateTimeOffset ConfirmedAt,
    bool Automatic, DateTimeOffset? RevokedAt, string? RevokedByName, string? RevokedReason);

/// <summary>
/// Where an action stands, one of seven, and they are not degrees of one thing: nothing listed; done (every document
/// there by the day); late receipt (every document there, the last after the day); ready (every document there, the day
/// ahead); overdue (the day passed with something missing); at risk (inside a missing document's risk window); still
/// ahead (something missing, nothing owed soon).
/// </summary>
public static class ActionStates
{
    public const string Unknown = "UNKNOWN", Done = "DONE", LateReceipt = "LATE_RECEIPT", Ready = "READY", Overdue = "NOT_READY",
        AtRisk = "AT_RISK", Upcoming = "UPCOMING";
}

public static partial class ScheduleEndpoints
{
    // ── The plan, as its screens show it ──────────────────────────────────────

    /// <summary>GET /plan: every action in force, in one answer (the schedule list, its exports and its upkeep).</summary>
    private static async Task<IResult> PlanAsync(HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var activities = await db.Activities.AsNoTracking().Include(a => a.Requirements)
            .Where(a => a.ProjectId == access.Project.Id && a.State == ActivityStates.Active)
            .OrderBy(a => a.Start).ThenBy(a => a.Code).Take(2000).ToListAsync(cancellationToken);
        return Results.Ok(await ViewAsync(db, clock, access, activities, cancellationToken));
    }

    /// <summary>GET /plan/{code}: one action by its code, also one the schedule has since dropped.</summary>
    private static async Task<IResult> PlanActionAsync(string code, HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var activity = await db.Activities.AsNoTracking().Include(a => a.Requirements)
            .Where(a => a.ProjectId == access.Project.Id && a.Code == code)
            .OrderBy(a => a.State == ActivityStates.Active ? 0 : 1).FirstOrDefaultAsync(cancellationToken);
        if (activity is null) return NotFound();
        var view = await ViewAsync(db, clock, access, [activity], cancellationToken);
        return view.Actions.Count == 0 ? NotFound() : Results.Ok(view);
    }

    /// <summary>The plan as this reader sees it: whole for our people, narrowed for another organization's.</summary>
    private static async Task<PlanView> ViewAsync(DeliosDbContext db, IClock clock, ProjectAccess access, List<Activity> activities,
        CancellationToken cancellationToken)
    {
        var visible = await OutsideViewAsync(db, access, cancellationToken);
        if (visible is not null) activities = Narrow(activities, visible);
        var actions = await PlanActionsAsync(db, clock, access.Project, activities, cancellationToken);
        return new PlanView(await VersionInForceAsync(db, access.Project.Id, cancellationToken),
            visible is null ? actions : actions.Select(ForOutside).ToList());
    }

    /// <summary>The label of the schedule read in force ("rev B"), or null when none was read.</summary>
    private static async Task<string?> VersionInForceAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken)
    {
        var value = await db.ScheduleImports.AsNoTracking().Where(i => i.ProjectId == projectId && i.Status == ScheduleImportStatuses.Done)
            .OrderByDescending(i => i.ImportedAt).Select(i => i.RevisionValue).FirstOrDefaultAsync(cancellationToken);
        return value is null ? null : $"rev {value}";
    }

    private static async Task<List<PlanAction>> PlanActionsAsync(DeliosDbContext db, IClock clock, Project project, List<Activity> activities,
        CancellationToken cancellationToken)
    {
        var projectId = project.Id;
        var today = WorkingCalendar.Today(clock, project.TimeZone);
        var window = (await ScheduleDays.ForProjectAsync(db, projectId, cancellationToken)).Risk;
        var ids = activities.Select(a => a.Id).ToList();
        var documentIds = activities.SelectMany(a => a.Requirements).Select(r => r.DocumentId).Distinct().ToList();
        var documents = await db.Documents.AsNoTracking().Where(d => documentIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id, cancellationToken);
        var revisions = await db.Revisions.AsNoTracking().Where(r => documentIds.Contains(r.DocumentId))
            .Select(r => new { r.DocumentId, r.Value, r.State, r.StatusCode, r.HeldAt, r.CreatedAt }).ToListAsync(cancellationToken);
        var released = revisions.Where(r => r.State == RevisionStates.Released).GroupBy(r => r.DocumentId).ToDictionary(g => g.Key, g => g.First());
        var latest = revisions.GroupBy(r => r.DocumentId).ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.CreatedAt).First());
        var decisions = (await db.ActivityDecisions.AsNoTracking().Where(d => ids.Contains(d.ActivityId)).ToListAsync(cancellationToken))
            .ToLookup(d => d.ActivityId);
        var confirmations = (await db.Set<ReadinessConfirmation>().AsNoTracking().Where(c => c.ProjectId == projectId && ids.Contains(c.ActivityId))
            .OrderBy(c => c.Id).ToListAsync(cancellationToken)).ToLookup(c => c.ActivityId);

        return activities.Select(a =>
        {
            var needs = a.Requirements
                .OrderBy(n => n.Department ?? "", StringComparer.Ordinal).ThenBy(n => n.NeededBy)
                .Select(n =>
                {
                    var document = documents[n.DocumentId];
                    var inForce = released.GetValueOrDefault(n.DocumentId);
                    var newest = latest.GetValueOrDefault(n.DocumentId);
                    return new PlanNeed(n.Id, n.DocumentId, n.Department,
                        n.RequiredStatuses.Length > 0 ? string.Join("/", n.RequiredStatuses) : n.Purpose,
                        (n.NeededBy ?? a.Start ?? LocalDate.FromDateTime(DateTime.UtcNow)).ToDateOnly(), n.FixedDate is not null,
                        n.Anchor == "START" && n.OffsetDays <= 0 ? -n.OffsetDays : null, n.RiskDays, n.State,
                        new PlanDocument(document.Id, document.Number, document.Title, document.Discipline, document.DocType, document.Originator,
                            document.IsPlaceholder,
                            inForce is null ? null : new PlanReleased(inForce.Value, inForce.StatusCode, n.State == RequirementStates.Met),
                            newest is null ? null : new PlanLatest(newest.Value, newest.State, newest.StatusCode, newest.HeldAt is not null)));
                }).ToList();
            var covered = a.Requirements.Count > 0 && a.Requirements.All(n => n.State == RequirementStates.Met);
            var lastMet = covered ? a.Requirements.Max(n => n.MetAt)?.ToDateTimeOffset() : null;
            var passed = a.Start is { } day && day < today;
            LocalDate? RiskFromOf(Func<Requirement, bool> only)
            {
                var missing = a.Requirements.Where(n => only(n) && n.State != RequirementStates.Met).ToList();
                return a.Start is { } start && missing.Count > 0 ? missing.Min(n => start.PlusDays(-(n.RiskDays ?? window))) : null;
            }
            var riskFrom = RiskFromOf(_ => true);
            var state = a.Requirements.Count == 0 ? ActionStates.Unknown
                : covered ? (!passed ? ActionStates.Ready
                    : lastMet is { } met && a.Start is { } s && met > s.AtStartOfDayInZone(DateTimeZone.Utc).ToDateTimeOffset() ? ActionStates.LateReceipt
                    : ActionStates.Done)
                : passed ? ActionStates.Overdue
                : riskFrom is { } from && from <= today ? ActionStates.AtRisk : ActionStates.Upcoming;
            var disciplineRisk = a.Departments.ToDictionary(d => d,
                d => RiskFromOf(n => n.Department is null || string.Equals(n.Department, d, StringComparison.Ordinal))?.ToDateOnly());
            return new PlanAction(a.Id, a.Code, a.ExternalId, a.Name, a.Responsible, a.Departments, a.Start?.ToDateOnly(), a.Finish?.ToDateOnly(),
                a.NeedCount,
                a.MovedIn is null || a.MovedAt is null ? null : new ActivityMove(a.WasStart?.ToDateOnly(), a.WasFinish?.ToDateOnly(), a.MovedIn, a.MovedAt.Value.ToDateTimeOffset()),
                lastMet, needs,
                decisions[a.Id].OrderByDescending(d => d.RecordedAt).Select(d => new DecisionView(d.Id, d.Decision, d.PlannedStart?.ToDateOnly(),
                    d.ResponsibleName, d.Reason, d.DelayOwedBy, d.DelayReason, d.RecordedByName, d.RecordedAt.ToDateTimeOffset(),
                    d.ConfirmedByName, d.ConfirmedAt?.ToDateTimeOffset(), d.ConfirmNote, d.ReversedByName, d.ReversedAt?.ToDateTimeOffset(), d.ReversedReason)).ToList(),
                confirmations[a.Id].Select(c => new PlanConfirmation(c.Department, c.Available, c.Note, c.ConfirmedByName, c.ConfirmedAt.ToDateTimeOffset(),
                    c.Automatic, c.RevokedAt?.ToDateTimeOffset(), c.RevokedByName, c.RevokedReason)).ToList(),
                passed, state, riskFrom?.ToDateOnly(), disciplineRisk, a.StartAchieved, a.FinishAchieved, a.Wbs, a.WbsOrder);
        }).ToList();
    }
}
