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
    // ── Decisions and lateness ────────────────────────────────────────────────

    /// <summary>The activity went ahead without its documents, or was stopped for them: who decided, why, and whose delay it was.</summary>
    private static async Task<IResult> DecideAsync(
        Guid activityId, DecisionRequest request, HttpContext http, DeliosDbContext db, IClock clock, AuditLog audit,
        Notifications.Notifier notifier, TransmittalService transmittals, CancellationToken cancellationToken)
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
        var row = new ActivityDecision
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
        };
        db.ActivityDecisions.Add(row);
        // Postponed: whoever plans the project is asked to confirm it on a transmittal, everyone the activity concerns
        // copied in. The notice log keeps it too, so the action counts it with its other notices.
        if (!ActionNotices.Proceeds(await Catalog.LoadAsync(db, cancellationToken), decision))
        {
            var concerned = await ConcernedAsync(db, access.Project.Id, activity, cancellationToken);
            var planners = await NoticeLog.HoldersAsync(db, access.Project.Id, Verbs.Plan, cancellationToken);
            var title = $"{activity.Code} is postponed: whoever plans the project, confirm it";
            var body = $"{activity.Name}. {responsible} decided: {reason} Confirm it on the action's page and say what changes, so a new schedule revision can follow.";
            var letter = await ActionLetters.SendAsync(db, transmittals, clock, access.Project, new Actor(access.UserId, access.UserName), ActionLetters.Request,
                $"{activity.Code} postponed", body, planners, concerned, null, cancellationToken);
            row.TransmittalId = letter?.Id;
            await NoticeLog.SendAsync(db, notifier, clock, access.Project.TenantId, access.Project.Id, $"activity:{activityId}:postponed", false,
                access.UserName, title, body, $"/actions/{activity.Code}", [.. concerned, .. planners], cancellationToken, tell: letter is null);
        }
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "ACTIVITY_DECISION", "Activity", activityId, activity.Code,
            $"{decision} by {responsible}: {reason}", access.Project.Id, cancellationToken);
        return await ActivityAsync(activityId, http, db, clock, cancellationToken);
    }

    /// <summary>GET /activities-work: what on the schedule waits for the person asking, for their home page.</summary>
    private static async Task<IResult> ActionWorkAsync(HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var work = new List<ActionWork>();
        if (!access.IsInternal) return Results.Ok(work);
        var projectId = access.Project.Id;
        var today = WorkingCalendar.Today(clock, access.Project.TimeZone);
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var decisions = await db.ActivityDecisions.AsNoTracking().Where(d => d.ProjectId == projectId && d.ReversedAt == null).ToListAsync(cancellationToken);
        var postponed = decisions.Where(d => !ActionNotices.Proceeds(catalog, d.Decision)).ToList();
        var postponedIds = postponed.Select(d => d.ActivityId).ToHashSet();

        // Confirming documents: the departments this person answers for.
        var mine = await db.Memberships.AsNoTracking().Where(m => m.ProjectId == projectId && m.UserId == access.UserId && m.Active && m.Department != null)
            .Select(m => m.Department!).Distinct().ToListAsync(cancellationToken);
        if (mine.Count > 0)
        {
            var window = await db.ScheduleSources.Where(x => x.ProjectId == projectId).Select(x => (int?)x.RiskWindowDays).SingleOrDefaultAsync(cancellationToken) ?? 7;
            var activities = await db.Activities.AsNoTracking().Include(a => a.Requirements)
                .Where(a => a.ProjectId == projectId && a.State == ActivityStates.Active && a.Start != null && a.Departments.Any(d => mine.Contains(d)))
                .ToListAsync(cancellationToken);
            var confirmed = await db.Set<Records.ReadinessConfirmation>().AsNoTracking()
                .Where(c => c.ProjectId == projectId && c.RevokedAt == null && mine.Contains(c.Department))
                .Select(c => new { c.ActivityId, c.Department }).ToListAsync(cancellationToken);
            foreach (var activity in activities.Where(a => !postponedIds.Contains(a.Id)))
            {
                var day = activity.Start!.Value;
                foreach (var department in activity.Departments.Where(mine.Contains))
                {
                    if (confirmed.Any(c => c.ActivityId == activity.Id && c.Department == department)) continue;
                    var missing = activity.Requirements.Where(r => r.State == RequirementStates.Missing
                        && (r.Department == null || string.Equals(r.Department, department, StringComparison.OrdinalIgnoreCase))).ToList();
                    if (missing.Count == 0) continue;
                    var from = missing.Select(r => day.PlusDays(-(r.RiskDays ?? window))).Min();
                    if (from > today) continue;
                    work.Add(new ActionWork("CONFIRM_DOCUMENTS", activity.Id, activity.Code, activity.Name, day.ToDateOnly(), department, missing.Count,
                        from.AtStartOfDayInZone(DateTimeZone.Utc).ToDateTimeOffset()));
                }
            }
        }

        // Confirming a postponement: whoever plans the project.
        if (access.Holds(Verbs.Plan))
        {
            var waiting = postponed.Where(d => d.ConfirmedAt == null).ToList();
            var named = await db.Activities.AsNoTracking().Where(a => waiting.Select(w => w.ActivityId).Contains(a.Id))
                .ToDictionaryAsync(a => a.Id, cancellationToken);
            work.AddRange(waiting.Where(d => named.ContainsKey(d.ActivityId)).Select(d => new ActionWork("CONFIRM_POSTPONEMENT", d.ActivityId,
                named[d.ActivityId].Code, named[d.ActivityId].Name, d.PlannedStart?.ToDateOnly(), null, 1, d.RecordedAt.ToDateTimeOffset())));
        }

        // Requests to add a document to an action: Document Control answers each one.
        if (access.Holds(Verbs.Control))
        {
            var asks = await (from t in db.Transmittals.AsNoTracking()
                              join a in db.Activities.AsNoTracking() on t.ActivityId equals a.Id
                              where t.ProjectId == projectId && t.ActivityAnsweredAt == null && t.ActivityCheckedAt == null
                              orderby t.IssuedAt
                              select new { t.Id, t.Number, t.IssuedAt, t.IssuedByName, t.ActivityAskKind, ActivityId = a.Id, a.Code, a.Name, a.Start })
                .ToListAsync(cancellationToken);
            work.AddRange(asks.Select(x => new ActionWork("ADD_TO_ACTION", x.ActivityId, x.Code, x.Name, x.Start?.ToDateOnly(), null, 1,
                x.IssuedAt.ToDateTimeOffset(), x.Id, x.Number, x.IssuedByName, x.ActivityAskKind ?? "DOCUMENT")));
        }

        // A checked request waiting on this person's confirmation: whoever was asked, management first.
        var confirming = await (from t in db.Transmittals.AsNoTracking()
                                join a in db.Activities.AsNoTracking() on t.ActivityId equals a.Id
                                where t.ProjectId == projectId && t.ActivityAnsweredAt == null && t.ActivityCheckedAt != null && t.ActivityConfirmerId == access.UserId
                                orderby t.ActivityCheckedAt
                                select new { t.Id, t.Number, t.ActivityCheckedAt, t.ActivityCheckedByName, t.ActivityAskKind, ActivityId = a.Id, a.Code, a.Name, a.Start })
            .ToListAsync(cancellationToken);
        work.AddRange(confirming.Select(x => new ActionWork("CONFIRM_ACTION_REQUEST", x.ActivityId, x.Code, x.Name, x.Start?.ToDateOnly(), null, 1,
            x.ActivityCheckedAt?.ToDateTimeOffset(), x.Id, x.Number, x.ActivityCheckedByName, x.ActivityAskKind ?? "DOCUMENT")));

        // People added to the project who wait for this person's confirmation (anyone holding Manage when nobody was named).
        var manages = access.Holds(Verbs.Manage);
        var joining = await db.Memberships.AsNoTracking()
            .Where(m => m.ProjectId == projectId && m.PendingSince != null && (m.ConfirmerId == access.UserId || (m.ConfirmerId == null && manages)))
            .OrderBy(m => m.PendingSince).Select(m => m.PendingSince).ToListAsync(cancellationToken);
        if (joining.Count > 0)
            work.Add(new ActionWork("CONFIRM_PERSON", null, null, null, null, null, joining.Count, joining[0]!.Value.ToDateTimeOffset()));

        // The schedule's own upkeep: Document Control, or whoever plans.
        if (access.Holds(Verbs.Control) || access.Holds(Verbs.Plan))
        {
            var untagged = await db.Activities.CountAsync(a => a.ProjectId == projectId && a.State == ActivityStates.Active && a.Departments.Length == 0, cancellationToken);
            if (untagged > 0) work.Add(new ActionWork("UNTAGGED", null, null, null, null, null, untagged, null));
            var last = await db.ScheduleImports.AsNoTracking().Where(i => i.ProjectId == projectId).OrderByDescending(i => i.ImportedAt).FirstOrDefaultAsync(cancellationToken);
            if (last is { Status: ScheduleImportStatuses.Failed })
                work.Add(new ActionWork("SCHEDULE_READ_FAILED", null, $"rev {last.RevisionValue}", last.Error, null, null, 1, last.ImportedAt.ToDateTimeOffset()));
        }
        return Results.Ok(work);
    }

    /// <summary>GET /notices?subject=…: every notice whose subject starts with it, oldest first.</summary>
    private static async Task<IResult> NoticesAsync(HttpContext http, DeliosDbContext db, string? subject, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal) return Results.Ok(Array.Empty<NoticeView>());
        var prefix = subject?.Trim() ?? "";
        var rows = await db.Notices.AsNoTracking().Where(n => n.ProjectId == access.Project.Id && (prefix.Length == 0 || n.Subject.StartsWith(prefix)))
            .OrderBy(n => n.SentAt).Take(500).ToListAsync(cancellationToken);
        return Results.Ok(rows.Select(n => new NoticeView(n.Id, n.Subject, n.Automatic, n.Title, n.Body, n.RecipientNames, n.SentByName, n.SentAt.ToDateTimeOffset())));
    }

    /// <summary>POST /notices: a person tells the people they chose. Document Control, or whoever plans the project.</summary>
    private static async Task<IResult> SendNoticeAsync(NoticeRequest request, HttpContext http, DeliosDbContext db, IClock clock, AuditLog audit,
        Notifications.Notifier notifier, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var subject = request.Subject?.Trim() ?? "";
        // Document Control or whoever plans the project; and, about a review, whoever started it.
        var mayTell = access.Holds(Verbs.Control) || access.Holds(Verbs.Plan)
            || (subject.StartsWith("review:") && Guid.TryParse(subject.Split(':')[1], out var reviewId)
                && await db.Reviews.AnyAsync(r => r.Id == reviewId && r.ProjectId == access.Project.Id && r.StartedById == access.UserId, cancellationToken));
        if (!mayTell)
            return Problems.Forbidden("NOTICE_NOT_ALLOWED", "Document Control, whoever plans the project, or whoever started the review sends these notices.");
        var title = request.Title?.Trim() ?? "";
        if (subject.Length == 0 || title.Length == 0) return Problems.Invalid("NOTICE_INCOMPLETE", "Say what the notice is about.");
        // What is written is kept whole: too long is refused, never cut.
        if (title.Length > 300 || (request.Body?.Trim().Length ?? 0) > 4000)
            return Problems.Invalid("NOTICE_TOO_LONG", "Keep the title under 300 characters and the message under 4000.");
        var chosen = (request.People ?? []).Distinct().ToArray();
        // Only people on this project are told.
        var people = await db.Memberships.AsNoTracking().Where(m => m.ProjectId == access.Project.Id && m.Active && chosen.Contains(m.UserId))
            .Select(m => m.UserId).Distinct().ToListAsync(cancellationToken);
        if (people.Count == 0) return Problems.Invalid("NO_ONE", "Choose at least one person on this project.");
        var link = request.Link is { Length: > 0 } l && l.StartsWith('/') ? l : null;
        var outsideLink = request.OutsideLink is { Length: > 0 } o && o.StartsWith('/') ? o : null;
        var notice = await NoticeLog.SendAsync(db, notifier, clock, access.Project.TenantId, access.Project.Id, subject, false, access.UserName,
            title, request.Body?.Trim() is { Length: > 0 } b ? b : null, link, people, cancellationToken, outsideLink);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "NOTICE_SENT", "Notice", notice.Id, subject,
            $"{title} — to {string.Join(", ", notice.RecipientNames)}", access.Project.Id, cancellationToken);
        return Results.Ok(new NoticeView(notice.Id, notice.Subject, false, notice.Title, notice.Body, notice.RecipientNames, notice.SentByName, notice.SentAt.ToDateTimeOffset()));
    }

    /// <summary>Everyone who answers for one of the activity's departments.</summary>
    private static async Task<List<Guid>> ConcernedAsync(DeliosDbContext db, Guid projectId, Activity activity, CancellationToken cancellationToken)
    {
        var people = new List<Guid>();
        foreach (var department in activity.Departments) people.AddRange(await NoticeLog.DepartmentMembersAsync(db, projectId, department, cancellationToken));
        return people;
    }

    /// <summary>
    /// Whoever plans the project confirms a postponement, saying what changes, so a new schedule revision can be
    /// expected. Everyone concerned and Document Control are told.
    /// </summary>
    private static async Task<IResult> ConfirmPostponementAsync(Guid activityId, Guid decisionId, DecisionNoteRequest request, HttpContext http,
        DeliosDbContext db, IClock clock, AuditLog audit, Notifications.Notifier notifier, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Plan)) return Problems.Forbidden("PLAN_ONLY", "Whoever plans the project confirms a postponement.");
        var note = request.Note?.Trim() ?? "";
        if (note.Length == 0) return Problems.Invalid("NOTE_REQUIRED", "Say what changes, so the next schedule revision can follow.");
        var activity = await db.Activities.AsNoTracking().SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, cancellationToken);
        var row = await db.ActivityDecisions.SingleOrDefaultAsync(d => d.Id == decisionId && d.ActivityId == activityId, cancellationToken);
        if (activity is null || row is null) return NotFound();
        if (ActionNotices.Proceeds(await Catalog.LoadAsync(db, cancellationToken), row.Decision))
            return Problems.Conflict("NOT_POSTPONED", "Only a postponement is confirmed.");
        if (row.ReversedAt is not null) return Problems.Conflict("REVERSED", "This postponement was taken back.");
        if (row.ConfirmedAt is not null) return Problems.Conflict("CONFIRMED", $"{row.ConfirmedByName} already confirmed it.");
        row.ConfirmedByName = access.UserName;
        row.ConfirmedAt = clock.GetCurrentInstant();
        row.ConfirmNote = note;
        var concerned = await ConcernedAsync(db, access.Project.Id, activity, cancellationToken);
        var control = await NoticeLog.HoldersAsync(db, access.Project.Id, Verbs.Control, cancellationToken);
        var asked = await AskOfAsync(db, row.TransmittalId, cancellationToken);
        var letter = await ActionLetters.SendAsync(db, transmittals, clock, access.Project, new Actor(access.UserId, access.UserName), ActionLetters.Confirmation,
            asked?.Subject ?? $"{activity.Code} postponed", $"Postponement of {activity.Code} {activity.Name} confirmed by {access.UserName}: {note}",
            asked?.IssuedById is { } recorder ? [recorder] : control, [.. concerned, .. control], asked?.Id, cancellationToken);
        await NoticeLog.SendAsync(db, notifier, clock, access.Project.TenantId, access.Project.Id, $"activity:{activityId}:postponed", false,
            access.UserName, $"{activity.Code}: postponement confirmed by {access.UserName}", note, $"/actions/{activity.Code}",
            [.. concerned, .. control], cancellationToken, tell: letter is null);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "POSTPONEMENT_CONFIRMED", "Activity", activityId, activity.Code, note, access.Project.Id, cancellationToken);
        return await ActivityAsync(activityId, http, db, clock, cancellationToken);
    }

    /// <summary>Document Control takes a decision back, with why (a planner who would not confirm, a mistake). Kept, marked.</summary>
    private static async Task<IResult> ReverseDecisionAsync(Guid activityId, Guid decisionId, DecisionNoteRequest request, HttpContext http,
        DeliosDbContext db, IClock clock, AuditLog audit, Notifications.Notifier notifier, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control takes a decision back.");
        var reason = request.Note?.Trim() ?? "";
        if (reason.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it is taken back.");
        var activity = await db.Activities.AsNoTracking().SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, cancellationToken);
        var row = await db.ActivityDecisions.SingleOrDefaultAsync(d => d.Id == decisionId && d.ActivityId == activityId, cancellationToken);
        if (activity is null || row is null) return NotFound();
        if (row.ReversedAt is not null) return Problems.Conflict("REVERSED", "It was already taken back.");
        row.ReversedByName = access.UserName;
        row.ReversedAt = clock.GetCurrentInstant();
        row.ReversedReason = reason;
        var concerned = await ConcernedAsync(db, access.Project.Id, activity, cancellationToken);
        var planners = await NoticeLog.HoldersAsync(db, access.Project.Id, Verbs.Plan, cancellationToken);
        var asked = await AskOfAsync(db, row.TransmittalId, cancellationToken);
        var letter = await ActionLetters.SendAsync(db, transmittals, clock, access.Project, new Actor(access.UserId, access.UserName), ActionLetters.Answer,
            asked?.Subject ?? $"{activity.Code}: decision taken back", $"The decision on {activity.Code} {activity.Name} ({row.Decision}) was taken back by {access.UserName}: {reason}",
            asked?.IssuedById is { } recorder ? [recorder, .. planners] : planners, concerned, asked?.Id, cancellationToken);
        await NoticeLog.SendAsync(db, notifier, clock, access.Project.TenantId, access.Project.Id, $"activity:{activityId}:postponed", false,
            access.UserName, $"{activity.Code}: the decision was taken back by {access.UserName}", reason, $"/actions/{activity.Code}",
            [.. concerned, .. planners], cancellationToken, tell: letter is null);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "DECISION_REVERSED", "Activity", activityId, activity.Code, reason, access.Project.Id, cancellationToken);
        return await ActivityAsync(activityId, http, db, clock, cancellationToken);
    }

    /// <summary>The transmittal that asked, to reply to it in the same thread; null for one recorded before they were sent.</summary>
    private static Task<Transmittal?> AskOfAsync(DeliosDbContext db, Guid? transmittalId, CancellationToken cancellationToken) =>
        transmittalId is { } id ? db.Transmittals.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id, cancellationToken) : Task.FromResult<Transmittal?>(null);

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
        // Before a review starts, the route it will take is the one that serves the document: its days are what
        // sending for review has to leave before the day the document is needed.
        var routes = await db.ReviewRoutes.AsNoTracking().Where(r => r.Active).ToListAsync(cancellationToken);
        // Released and issued as one act unless the project (or else the organization) separates them: then one checkpoint.
        var policy = await db.Settings.AsNoTracking().Where(s => s.Key == "POLICY_RELEASE" && (s.ProjectId == access.Project.Id || s.ProjectId == null))
            .Select(s => new { s.ProjectId, s.Value }).ToListAsync(cancellationToken);
        var together = (policy.FirstOrDefault(p => p.ProjectId == access.Project.Id)?.Value ?? policy.FirstOrDefault(p => p.ProjectId == null)?.Value ?? "TOGETHER") != "SEPARATE";
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
            var expected = routes.Select(r => (Route: r, Score: Reviews.ReviewService.Score(r, document))).Where(x => x.Score >= 0)
                .OrderByDescending(x => x.Score).ThenByDescending(x => x.Route.IsDefault).Select(x => x.Route).FirstOrDefault();
            var routeDays = review?.Steps.Sum(s => s.Days ?? 0) ?? expected?.Steps.Sum(s => s.Days ?? 0) ?? 0;
            // Owed by an outside organization when its revision came from one, or, before any revision, when the document's
            // originator is an organization outside ours.
            var external = revision is not null
                ? revision.AuthoredByParty is not null
                : document.Originator is { } originator && await db.Parties.AnyAsync(p => p.Code == originator && !p.IsInternal, cancellationToken);
            // Named for the act, not as if it happened: whether it did is the checkpoint's own date.
            var checkpoints = new List<Checkpoint>
            {
                // Step days are working days in the project's calendar, so the route is counted back the same way.
                Point(today, zone, external ? "Sending in, by the supplier" : "Sending for review", "Submission due",
                    due is { } needed ? WorkingCalendar.SubtractWorkingDays(needed, routeDays, access.Project.WeekendDays) : null, review?.StartedAt,
                    external ? document.Originator ?? "the supplier" : revision?.AuthoredByName ?? document.CreatedByName),
            };
            foreach (var step in review?.Steps.OrderBy(s => s.Index) ?? Enumerable.Empty<ReviewStep>())
            {
                checkpoints.Add(Point(today, zone, step.PartyName is null ? $"Review step {step.Index + 1}: {step.Title}" : $"{step.PartyName}: {step.Title}",
                    "Step due", step.DueDate, step.CompletedAt, step.PartyName ?? step.FunctionCode ?? "the step"));
            }
            if (together)
                // One act: done when it went out, which is the release itself.
                checkpoints.Add(Point(today, zone, "Release & issue", "Needed by", due, issued, "Document Control"));
            else
            {
                checkpoints.Add(Point(today, zone, "Release", "Needed by", due, revision?.ReleasedAt, "Document Control"));
                checkpoints.Add(Point(today, zone, "Issue", "Needed by", due, issued, "Document Control"));
            }
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
}
