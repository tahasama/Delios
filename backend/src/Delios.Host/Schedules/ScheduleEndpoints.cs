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

/// <summary>Request body for PUT /schedule: which document is the schedule, how to read its columns, and the default lead and risk-window days. Null fields keep their current value.</summary>
public sealed record SourceRequest(Guid DocumentId, ScheduleColumns? Columns = null, int? DefaultLeadDays = null, int? RiskWindowDays = null);

/// <summary>Request body for adding a need to an activity: which document, for what purpose, and when it is needed.</summary>
/// <param name="OffsetDays">Days from the anchor: negative before, positive after. Empty: the project's lead before the start.</param>
public sealed record NeedRequest(
    Guid DocumentId, string? Purpose, string[]? RequiredStatuses = null, string? Anchor = null, int? OffsetDays = null,
    DateOnly? FixedDate = null, string? Department = null);

/// <summary>Request body for waiving a need: the note saying why the activity can go ahead without the document.</summary>
public sealed record WaiverRequest(string? Note);

/// <summary>Request body for recording what was decided about an activity whose documents were missing.</summary>
public sealed record DecisionRequest(string? Decision, string? ResponsibleName, string? Reason, string? DelayOwedBy = null, string? DelayReason = null);

/// <summary>One activity as the schedule list shows it: its dates, departments, readiness label and need counts.</summary>
public sealed record ActivitySummary(Guid Id, string Code, string Name, DateOnly? Start, DateOnly? Finish, string? Responsible,
    IReadOnlyList<string> Departments, string State, string Readiness, int Needs, int Met, int Waived, DateOnly? NextNeededBy, string? ExternalId = null);

/// <summary>One need of an activity as the activity page shows it: the document, its current revision and status, when it is needed, and its state or waiver.</summary>
public sealed record NeedView(Guid Id, Guid DocumentId, string DocumentNumber, string Title, string? CurrentRevision, string? CurrentStatus,
    string Purpose, IReadOnlyList<string> RequiredStatuses, string Anchor, int OffsetDays, DateOnly? FixedDate, DateOnly? NeededBy,
    string? Department, string State, DateTimeOffset? MetAt, string? WaiverNote, string? WaivedBy, DateTimeOffset? WaivedAt);

/// <summary>One recorded activity decision as the activity page shows it.</summary>
public sealed record DecisionView(Guid Id, string Decision, DateOnly? PlannedStart, string ResponsibleName, string Reason,
    string? DelayOwedBy, string? DelayReason, string RecordedBy, DateTimeOffset RecordedAt);

/// <summary>
/// One step in a document's path to an activity (sent for review, each review step, released, issued): when it was due, when it happened,
/// whether it was late, and who it was owed by.
/// </summary>
public sealed record Checkpoint(string Name, string Deadline, DateOnly? Due, DateTimeOffset? At, bool Late, string OwedBy);

/// <summary>For one need, the checkpoints its document went through and the first late one (the cause of the delay), or null if none was late.</summary>
public sealed record NeedLateness(Guid RequirementId, string DocumentNumber, string State, IReadOnlyList<Checkpoint> Checkpoints, Checkpoint? Cause);

/// <summary>
/// The schedule's activities, what each needs and for what, whether it is ready,
/// waivers, decisions taken when documents were missing, and who made a document late.
/// </summary>
public static class ScheduleEndpoints
{
    /// <summary>
    /// Registers the schedule, activity, need, waiver and decision URLs under /api/projects/{projectId}. Only the project's own (internal) people with read access may call them.
    /// Called once at startup from PlatformSetup.
    /// </summary>
    public static void MapScheduleEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Schedule")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>()
            .AddEndpointFilter(async (context, next) => ProjectAccessFilter.Of(context.HttpContext) is { IsInternal: true } access
                && access.Holds(Verbs.Read)
                ? await next(context)
                : Problems.Forbidden("SCHEDULE_NOT_ALLOWED", "The schedule is read by the project's own people."));
        project.MapGet("/schedule", SourceAsync);
        project.MapPut("/schedule", SetSourceAsync);
        project.MapPost("/schedule/import", ImportAsync);
        project.MapGet("/activities", ActivitiesAsync);
        project.MapGet("/activities/{activityId:guid}", ActivityAsync);
        project.MapPost("/activities/{activityId:guid}/needs", AddNeedAsync);
        project.MapDelete("/activities/{activityId:guid}/needs/{needId:guid}", RemoveNeedAsync);
        project.MapPost("/activities/{activityId:guid}/needs/{needId:guid}/waive", WaiveAsync);
        project.MapDelete("/activities/{activityId:guid}/needs/{needId:guid}/waive", UnwaiveAsync);
        project.MapPost("/activities/{activityId:guid}/decisions", DecideAsync);
        project.MapGet("/activities/{activityId:guid}/lateness", LatenessAsync);
    }

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
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control names the schedule document.");
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
        source.DefaultLeadDays = request.DefaultLeadDays ?? source.DefaultLeadDays;
        source.RiskWindowDays = request.RiskWindowDays ?? source.RiskWindowDays;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "SCHEDULE_SOURCE_SET", "Document", document.Id, document.Number,
            $"The project's schedule; needed {source.DefaultLeadDays} days before an activity unless a need says otherwise.",
            access.Project.Id, cancellationToken);
        return Results.Ok(source);
    }

    /// <summary>Reads the schedule's current released revision now: for a schedule named after its release.</summary>
    private static async Task<IResult> ImportAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control reads the schedule in.");
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

    // ── Activities ────────────────────────────────────────────────────────────

    /// <summary>
    /// GET /activities: lists the project's activities by start date, at most 2000, filtered by readiness, start date range, department or a text search on code and name.
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
        var rows = await query.OrderBy(a => a.Start).ThenBy(a => a.Code).Take(2000).ToListAsync(cancellationToken);
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
                d.DelayOwedBy, d.DelayReason, d.RecordedByName, d.RecordedAt.ToDateTimeOffset())),
        });
    }

    // ── What an activity needs ────────────────────────────────────────────────

    /// <summary>
    /// POST /activities/{activityId}/needs: records that the activity needs a document for a given purpose (a published reason for issue),
    /// checks the values given, then recomputes the activity's readiness. Without an offset the need falls the project's default lead days before the start.
    /// </summary>
    private static async Task<IResult> AddNeedAsync(
        Guid activityId, NeedRequest request, HttpContext http, DeliosDbContext db, IClock clock, AuditLog audit,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!(access.Holds(Verbs.Create) || access.Holds(Verbs.Revise) || access.Holds(Verbs.Control)))
            return Problems.Forbidden("NEEDS_NOT_ALLOWED", "Your function cannot say what activities need.");
        var activity = await db.Activities.SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, cancellationToken);
        if (activity is null) return NotFound();
        var document = await db.Documents.AsNoTracking().SingleOrDefaultAsync(d => d.Id == request.DocumentId && d.ProjectId == access.Project.Id, cancellationToken);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var purpose = request.Purpose ?? "";
        if (!catalog.IsActive(TransmittalSets.Reasons, purpose))
            return Problems.Invalid("VALUE_NOT_PUBLISHED", $"{purpose} is not a published reason for issue.", new { field = "purpose", value = purpose });
        var statuses = request.RequiredStatuses?.Distinct().ToArray() ?? [];
        var unknown = statuses.Where(s => !catalog.IsActive(ReviewSets.Statuses, s)).ToList();
        if (unknown.Count > 0)
            return Problems.Invalid("VALUE_NOT_PUBLISHED", $"{string.Join(", ", unknown)} is not a published status.", new { field = "requiredStatuses", value = unknown });
        var anchor = request.Anchor ?? Anchors.Start;
        if (anchor is not (Anchors.Start or Anchors.Finish)) return Problems.Invalid("ANCHOR_INVALID", "START or FINISH.");
        if (await db.Requirements.AnyAsync(r => r.ActivityId == activityId && r.DocumentId == document.Id && r.Purpose == purpose, cancellationToken))
            return Problems.Conflict("NEED_EXISTS", "The activity already needs that document for that purpose.");
        // A department is a discipline.
        string? department = null;
        if (!string.IsNullOrWhiteSpace(request.Department))
        {
            department = catalog.Find(ValueSets.Disciplines, request.Department);
            if (department is null)
                return Problems.Invalid("VALUE_NOT_PUBLISHED", $"{request.Department} is not a published discipline.", new { field = "department", value = request.Department });
        }
        var source = await db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id, cancellationToken);

        var need = new Requirement
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            ActivityId = activity.Id,
            DocumentId = document.Id,
            Purpose = purpose,
            RequiredStatuses = statuses,
            Anchor = anchor,
            OffsetDays = request.OffsetDays ?? -(source?.DefaultLeadDays ?? 7),
            FixedDate = request.FixedDate is { } fixedDate ? LocalDate.FromDateOnly(fixedDate) : null,
            Department = department,
            CreatedByName = access.UserName,
            CreatedAt = clock.GetCurrentInstant(),
        };
        db.Requirements.Add(need);
        await db.SaveChangesAsync(cancellationToken);
        await Readiness.RestateAsync(db, clock, [activity.Id], cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "NEED_ADDED", "Activity", activity.Id, activity.Code,
            $"Needs {document.Number} for {purpose}, by {need.NeededBy?.ToString() ?? "a date not yet known"}.", access.Project.Id, cancellationToken);
        return await ActivityAsync(activityId, http, db, clock, cancellationToken);
    }

    /// <summary>DELETE /activities/{activityId}/needs/{needId}: removes a need (by whoever added it, or Document Control) and recomputes the activity's readiness.</summary>
    private static async Task<IResult> RemoveNeedAsync(
        Guid activityId, Guid needId, HttpContext http, DeliosDbContext db, IClock clock, AuditLog audit, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var need = await db.Requirements.SingleOrDefaultAsync(r => r.Id == needId && r.ActivityId == activityId && r.ProjectId == access.Project.Id, cancellationToken);
        if (need is null) return NotFound();
        if (!access.Holds(Verbs.Control) && need.CreatedByName != access.UserName)
            return Problems.Forbidden("CONTROL_ONLY", "Whoever added a need, or Document Control, removes it.");
        db.Requirements.Remove(need);
        await db.SaveChangesAsync(cancellationToken);
        await Readiness.RestateAsync(db, clock, [activityId], cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "NEED_REMOVED", "Activity", activityId, need.Purpose, null, access.Project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// The concerned department, or Document Control, says the activity can go without
    /// the document, on its own responsibility, and why. The activity turns green but
    /// keeps the mark until the document comes.
    /// </summary>
    private static async Task<IResult> WaiveAsync(
        Guid activityId, Guid needId, WaiverRequest request, HttpContext http, DeliosDbContext db, IClock clock, AuditLog audit,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var need = await db.Requirements.SingleOrDefaultAsync(r => r.Id == needId && r.ActivityId == activityId && r.ProjectId == access.Project.Id, cancellationToken);
        if (need is null) return NotFound();
        if (!await MayWaiveAsync(db, access, need, cancellationToken))
            return Problems.Forbidden("WAIVER_NOT_ALLOWED", "The department concerned, or Document Control, waives a need.");
        if (need.State == RequirementStates.Met) return Problems.Conflict("NEED_MET", "The document is already there.");
        var note = request.Note?.Trim() ?? "";
        if (note.Length == 0) return Problems.Invalid("NOTE_REQUIRED", "Say why the activity can go without it.");
        need.WaiverNote = note;
        need.WaivedByName = access.UserName;
        need.WaivedAt = clock.GetCurrentInstant();
        await Readiness.RestateAsync(db, clock, [activityId], cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "NEED_WAIVED", "Activity", activityId, need.Purpose, note, access.Project.Id, cancellationToken);
        return await ActivityAsync(activityId, http, db, clock, cancellationToken);
    }

    /// <summary>DELETE /activities/{activityId}/needs/{needId}/waive: withdraws a waiver, so the need counts as missing again until its document comes.</summary>
    private static async Task<IResult> UnwaiveAsync(
        Guid activityId, Guid needId, HttpContext http, DeliosDbContext db, IClock clock, AuditLog audit, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var need = await db.Requirements.SingleOrDefaultAsync(r => r.Id == needId && r.ActivityId == activityId && r.ProjectId == access.Project.Id, cancellationToken);
        if (need is null) return NotFound();
        if (!await MayWaiveAsync(db, access, need, cancellationToken))
            return Problems.Forbidden("WAIVER_NOT_ALLOWED", "The department concerned, or Document Control, withdraws a waiver.");
        need.WaiverNote = null;
        need.WaivedByName = null;
        need.WaivedAt = null;
        await Readiness.RestateAsync(db, clock, [activityId], cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "NEED_WAIVER_WITHDRAWN", "Activity", activityId, need.Purpose, null, access.Project.Id, cancellationToken);
        return await ActivityAsync(activityId, http, db, clock, cancellationToken);
    }

    // ── Decisions and lateness ────────────────────────────────────────────────

    /// <summary>The activity went ahead without its documents, or was stopped for them: who decided, why, and whose delay it was.</summary>
    private static async Task<IResult> DecideAsync(
        Guid activityId, DecisionRequest request, HttpContext http, DeliosDbContext db, IClock clock, AuditLog audit,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!(access.Holds(Verbs.Control) || access.Holds(Verbs.Approve)))
            return Problems.Forbidden("DECISION_NOT_ALLOWED", "Your function does not record decisions about activities.");
        var activity = await db.Activities.AsNoTracking().SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, cancellationToken);
        if (activity is null) return NotFound();
        if (activity.State == ActivityStates.Removed)
            return Problems.Conflict("ACTIVITY_REMOVED", "The schedule no longer has this activity: there is nothing to decide.");
        var decision = request.Decision ?? "";
        if (!(await Catalog.LoadAsync(db, cancellationToken)).IsActive(ScheduleSets.Decisions, decision))
            return Problems.Invalid("VALUE_NOT_PUBLISHED", $"{decision} is not a published activity decision.", new { field = "decision", value = decision });
        var responsible = request.ResponsibleName?.Trim() ?? "";
        var reason = request.Reason?.Trim() ?? "";
        if (responsible.Length == 0 || reason.Length == 0)
            return Problems.Invalid("DECISION_INCOMPLETE", "Say who carries the decision and why.");
        db.ActivityDecisions.Add(new ActivityDecision
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            ActivityId = activityId,
            Decision = decision,
            PlannedStart = activity.Start,
            ResponsibleName = responsible,
            Reason = reason,
            DelayOwedBy = request.DelayOwedBy?.Trim(),
            DelayReason = request.DelayReason?.Trim(),
            RecordedByName = access.UserName,
            RecordedAt = clock.GetCurrentInstant(),
        });
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "ACTIVITY_DECISION", "Activity", activityId, activity.Code,
            $"{decision} by {responsible}: {reason}", access.Project.Id, cancellationToken);
        return await ActivityAsync(activityId, http, db, clock, cancellationToken);
    }

    /// <summary>
    /// For each need, the chain of checkpoints its document went through, and the
    /// first that slipped: the cause. The ones after it inherit the delay; they do not own it.
    /// </summary>
    private static async Task<IResult> LatenessAsync(
        Guid activityId, HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var today = WorkingCalendar.Today(clock, access.Project.TimeZone);
        var zone = DateTimeZoneProviders.Tzdb.GetZoneOrNull(access.Project.TimeZone) ?? DateTimeZone.Utc;
        var activity = await db.Activities.AsNoTracking().Include(a => a.Requirements)
            .SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, cancellationToken);
        if (activity is null) return NotFound();
        var result = new List<NeedLateness>();
        foreach (var need in activity.Requirements)
        {
            var document = await db.Documents.AsNoTracking().SingleAsync(d => d.Id == need.DocumentId, cancellationToken);
            var revision = await db.Revisions.AsNoTracking().Where(r => r.DocumentId == need.DocumentId)
                .OrderByDescending(r => r.CreatedAt).FirstOrDefaultAsync(cancellationToken);
            var review = revision is null ? null : await db.Reviews.AsNoTracking().Include(r => r.Steps)
                .Where(r => r.RevisionId == revision.Id).OrderByDescending(r => r.StartedAt).FirstOrDefaultAsync(cancellationToken);
            var issued = revision is null ? null : await (from i in db.TransmittalItems
                                                          join t in db.Transmittals on i.TransmittalId equals t.Id
                                                          where i.RevisionId == revision.Id && t.ReviewStepId == null
                                                          orderby t.IssuedAt
                                                          select (Instant?)t.IssuedAt).FirstOrDefaultAsync(cancellationToken);
            var due = need.NeededBy;
            var routeDays = review?.Steps.Sum(s => s.Days ?? 0) ?? 0;
            var external = revision?.AuthoredByParty is not null;
            var checkpoints = new List<Checkpoint>
            {
                Point(today, zone, external ? "Sent in by the supplier" : "Sent for review", "Submission due",
                    due?.PlusDays(-routeDays), review?.StartedAt, external ? document.Originator ?? "the supplier" : revision?.AuthoredByName ?? "its author"),
            };
            foreach (var step in review?.Steps.OrderBy(s => s.Index) ?? Enumerable.Empty<ReviewStep>())
            {
                checkpoints.Add(Point(today, zone, step.PartyName is null ? $"Review step {step.Index + 1}: {step.Title}" : $"{step.PartyName}: {step.Title}",
                    "Step due", step.DueDate, step.CompletedAt, step.PartyName ?? step.FunctionCode ?? "the step"));
            }
            checkpoints.Add(Point(today, zone, "Released", "Needed by", due, revision?.ReleasedAt, "Document Control"));
            checkpoints.Add(Point(today, zone, "Issued", "Needed by", due, issued, "Document Control"));
            result.Add(new NeedLateness(need.Id, document.Number, need.State, checkpoints, checkpoints.FirstOrDefault(c => c.Late)));
        }
        return Results.Ok(result);
    }

    /// <summary>Builds one checkpoint and decides whether it was late: done after its due day, or not done and the due day has passed.</summary>
    private static Checkpoint Point(LocalDate today, DateTimeZone zone, string name, string deadline, LocalDate? due, Instant? at, string owedBy)
    {
        // Late: done after its day, or not done and its day has passed. Days are the project's.
        var day = at?.InZone(zone).Date ?? today;
        return new Checkpoint(name, deadline, due?.ToDateOnly(), at?.ToDateTimeOffset(), due is not null && day > due, owedBy);
    }

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
        ReadinessLabels.Of(a, today, window), a.NeedCount, a.MetCount, a.WaivedCount, a.NextNeededBy?.ToDateOnly(), a.ExternalId);

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
            n.WaiverNote, n.WaivedByName, n.WaivedAt?.ToDateTimeOffset())).ToList();
    }

    /// <summary>The standard "no such activity" 404 answer.</summary>
    private static IResult NotFound() => Problems.NotFound("ACTIVITY_NOT_FOUND", "No such activity.");
}
