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
    // ── What an activity needs ────────────────────────────────────────────────

    /// <summary>
    /// POST /activities/{activityId}/needs: records that the activity needs a document for a given purpose (a published reason for issue),
    /// checks the values given, then recomputes the activity's readiness. Without an offset the need falls the project's default lead days before the start.
    /// </summary>
    private static async Task<IResult> AddNeedAsync(
        Guid activityId, NeedRequest request, HttpContext http, DeliosDbContext db, IClock clock, AuditLog audit,
        Notifications.Notifier notifier, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var activity = await db.Activities.SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, cancellationToken);
        if (activity is null) return NotFound();
        // Added in answer to a request: the request is this action's and still open, and not one management confirms.
        Transmittal? ask = null;
        if (request.TransmittalId is { } askId)
        {
            ask = await db.Transmittals.SingleOrDefaultAsync(t => t.Id == askId && t.ProjectId == access.Project.Id && t.ActivityId == activityId, cancellationToken);
            if (ask is null) return Problems.NotFound("REQUEST_NOT_FOUND", $"No request to add a document to {activity.Code} by that number.");
            if (ask.ActivityAnsweredAt is not null) return Problems.Conflict("ALREADY_ANSWERED", $"{ask.ActivityAnsweredByName} already answered {ask.Number}.");
            if (ask.ActivityConfirm)
                return Problems.Conflict("NEEDS_CONFIRMATION", $"{ask.Number} needs management's confirmation: check it and send it on; it is applied once confirmed.");
        }
        var (need, document, problem) = await NewNeedAsync(db, clock, access, activity, request, cancellationToken);
        if (problem is not null) return problem;
        // Document Control adds for any discipline; whoever plans only by uploading the requirements list. Without
        // Document Control, the people of a discipline add for their own discipline only.
        var self = !access.Holds(Verbs.Control) && !(request.FromList && access.Holds(Verbs.Plan));
        if (self)
        {
            if (await Delios.Host.Settings.ProjectAnswers.ControlDoesAsync(db, access.Project.Id, "ACTION_LINKS", cancellationToken))
                return Problems.Forbidden("CONTROL_ONLY", "On this project Document Control adds documents to actions: ask them.");
            var own = await OwnDepartmentAsync(db, access, cancellationToken);
            if (own is null || need!.Department != own)
                return Problems.Forbidden("OWN_DISCIPLINE_ONLY", "You add documents for your own discipline only.");
        }
        db.Requirements.Add(need!);
        await db.SaveChangesAsync(cancellationToken);
        await Readiness.RestateAsync(db, clock, [activity.Id], cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        if (ask is not null) await AnswerAsync(db, transmittals, clock, access, ask, activity, $"{document!.Number} added to {activity.Code}.", cancellationToken);
        if (self) await TellPlannersAsync(db, notifier, access, activity, $"{access.UserName} added {document!.Number}", $"{activity.Code} now needs {document.Number} for {need!.Department}.", cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "NEED_ADDED", "Activity", activity.Id, activity.Code,
            $"Needs {document!.Number} for {need!.Purpose}, by {need.NeededBy?.ToString() ?? "a date not yet known"}"
            + (ask is null ? "." : $", as {ask.Number} asked."), access.Project.Id, cancellationToken);
        return await ActivityAsync(activityId, http, db, clock, cancellationToken);
    }

    /// <summary>
    /// A need checked and made, not yet saved: the document is this project's, the purpose, statuses and discipline
    /// are published, and the action does not need it already for that purpose.
    /// </summary>
    private static async Task<(Requirement? Need, Document? Document, IResult? Problem)> NewNeedAsync(
        DeliosDbContext db, IClock clock, ProjectAccess access, Activity activity, NeedRequest request, CancellationToken cancellationToken)
    {
        static (Requirement?, Document?, IResult?) Fail(IResult problem) => (null, null, problem);
        var document = await db.Documents.AsNoTracking().SingleOrDefaultAsync(d => d.Id == request.DocumentId && d.ProjectId == access.Project.Id, cancellationToken);
        if (document is null) return Fail(Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document."));
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var purpose = request.Purpose ?? "";
        if (!catalog.IsActive(TransmittalSets.Reasons, purpose))
            return Fail(Problems.Invalid("VALUE_NOT_PUBLISHED", $"{purpose} is not a published reason for issue.", new { field = "purpose", value = purpose }));
        var statuses = request.RequiredStatuses?.Distinct().ToArray() ?? [];
        var unknown = statuses.Where(s => !catalog.IsActive(ReviewSets.Statuses, s)).ToList();
        if (unknown.Count > 0)
            return Fail(Problems.Invalid("VALUE_NOT_PUBLISHED", $"{string.Join(", ", unknown)} is not a published status.", new { field = "requiredStatuses", value = unknown }));
        var anchor = request.Anchor ?? Anchors.Start;
        if (anchor is not (Anchors.Start or Anchors.Finish)) return Fail(Problems.Invalid("ANCHOR_INVALID", "START or FINISH."));
        if (await db.Requirements.AnyAsync(r => r.ActivityId == activity.Id && r.DocumentId == document.Id && r.Purpose == purpose, cancellationToken))
            return Fail(Problems.Conflict("NEED_EXISTS", $"{activity.Code} already needs {document.Number}."));
        // A department is a discipline.
        string? department = null;
        if (!string.IsNullOrWhiteSpace(request.Department))
        {
            department = catalog.Find(ValueSets.Disciplines, request.Department);
            if (department is null)
                return Fail(Problems.Invalid("VALUE_NOT_PUBLISHED", $"{request.Department} is not a published discipline.", new { field = "department", value = request.Department }));
        }
        var source = await db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id, cancellationToken);
        return (new Requirement
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
        }, document, null);
    }

    /// <summary>
    /// Document Control answers a request to add a document to an action without adding one (already there, not
    /// the right action…), saying why. Whoever asked is told, as when a document is added.
    /// </summary>
    private static async Task<IResult> AnswerActivityAskAsync(Guid transmittalId, ActivityAskAnswer request, HttpContext http,
        DeliosDbContext db, IClock clock, AuditLog audit, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control answers a request to add a document to an action.");
        var note = request.Note?.Trim() ?? "";
        if (note.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why nothing is added; whoever asked reads it.");
        var ask = await db.Transmittals.SingleOrDefaultAsync(t => t.Id == transmittalId && t.ProjectId == access.Project.Id, cancellationToken);
        if (ask?.ActivityId is not { } activityId) return NotFound();
        if (ask.ActivityAnsweredAt is not null) return Problems.Conflict("ALREADY_ANSWERED", $"{ask.ActivityAnsweredByName} already answered it.");
        if (ask.ActivityCheckedAt is not null)
            return Problems.Conflict("WITH_MANAGEMENT", $"It was checked and is with {ask.ActivityConfirmerName}, who confirms or refuses it.");
        var activity = await db.Activities.AsNoTracking().SingleAsync(a => a.Id == activityId, cancellationToken);
        await AnswerAsync(db, transmittals, clock, access, ask, activity, $"Nothing added: {note}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "ACTIVITY_REQUEST_ANSWERED", "Transmittal", ask.Id, ask.Number, note, access.Project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>GET /activities/{id}/requests: the requests about the action not yet answered, oldest first.</summary>
    private static async Task<IResult> ActivityRequestsAsync(Guid activityId, HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var rows = await db.Transmittals.AsNoTracking().Include(t => t.Items)
            .Where(t => t.ProjectId == access.Project.Id && t.ActivityId == activityId && t.ActivityAnsweredAt == null)
            .OrderBy(t => t.IssuedAt).ToListAsync(cancellationToken);
        return Results.Ok(rows.Select(t => new ActivityRequestView(t.Id, t.Number, t.IssuedByName, t.IssuedAt.ToDateTimeOffset(),
            t.ActivityAskKind ?? "DOCUMENT", t.Subject, t.Message, t.ActivityConfirm, t.ActivityCheckedAt?.ToDateTimeOffset(), t.ActivityCheckedByName,
            t.ActivityConfirmerId, t.ActivityConfirmerName,
            t.ActivityProposal is null ? null : JsonSerializer.Deserialize<ActivityProposal>(t.ActivityProposal),
            t.Items.Where(i => i.DocumentId != null).Select(i => i.DocumentId!.Value).Distinct().ToList())));
    }

    /// <summary>
    /// Document Control checks a request management confirms: the right documents for a discipline the action
    /// concerns, or the disciplines it should concern, and who confirms it (management is proposed first; anyone on
    /// the project may be chosen). Nothing changes yet; whoever confirms is told.
    /// </summary>
    private static async Task<IResult> CheckActivityAskAsync(Guid transmittalId, ActivityCheckRequest request, HttpContext http,
        DeliosDbContext db, IClock clock, AuditLog audit, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control checks these requests.");
        var ask = await db.Transmittals.SingleOrDefaultAsync(t => t.Id == transmittalId && t.ProjectId == access.Project.Id, cancellationToken);
        if (ask?.ActivityId is not { } activityId) return NotFound();
        if (!ask.ActivityConfirm) return Problems.Conflict("NO_CONFIRMATION", "This request does not need management's confirmation: apply it.");
        if (ask.ActivityAnsweredAt is not null) return Problems.Conflict("ALREADY_ANSWERED", $"{ask.ActivityAnsweredByName} already answered it.");
        if (ask.ActivityCheckedAt is not null) return Problems.Conflict("ALREADY_CHECKED", $"{ask.ActivityCheckedByName} already checked it; it is with {ask.ActivityConfirmerName}.");
        var activity = await db.Activities.AsNoTracking().SingleAsync(a => a.Id == activityId, cancellationToken);
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        ActivityProposal proposal;
        string what;
        if (ask.ActivityAskKind == "DISCIPLINE")
        {
            var departments = (request.Departments ?? []).Select(d => d.Trim().ToUpperInvariant()).Where(d => d.Length > 0).Distinct().OrderBy(d => d).ToArray();
            if (departments.FirstOrDefault(d => !catalog.IsActive(ValueSets.Disciplines, d)) is { } unknown)
                return Problems.Invalid("VALUE_NOT_PUBLISHED", $"{unknown} is not a published discipline.");
            if (departments.SequenceEqual(activity.Departments.OrderBy(d => d)))
                return Problems.Invalid("NOTHING_CHANGES", "That is what the action concerns already: answer “Nothing to add” instead.");
            proposal = new ActivityProposal(Departments: departments);
            what = $"concerns {(departments.Length == 0 ? "no discipline" : string.Join(", ", departments.Select(d => catalog.Label(ValueSets.Disciplines, d))))}";
        }
        else
        {
            var ids = (request.DocumentIds ?? []).Distinct().ToArray();
            if (ids.Length == 0) return Problems.Invalid("DOCUMENT_REQUIRED", "Choose the document to add.");
            var department = request.Department?.Trim().ToUpperInvariant() ?? "";
            if (!activity.Departments.Contains(department))
                return Problems.Invalid("DEPARTMENT_NOT_TAGGED", $"{activity.Code} does not concern {department}: tag it on the action first.");
            var numbers = await db.Documents.AsNoTracking().Where(d => ids.Contains(d.Id) && d.ProjectId == access.Project.Id).Select(d => d.Number).ToListAsync(cancellationToken);
            if (numbers.Count != ids.Length) return Problems.NotFound("DOCUMENT_NOT_FOUND", "A document chosen is not in this project's register.");
            proposal = new ActivityProposal(DocumentIds: ids, Department: department, Purpose: request.Purpose, Statuses: request.Statuses);
            what = $"needs {string.Join(", ", numbers.OrderBy(n => n))} for {catalog.Label(ValueSets.Disciplines, department)}";
        }
        var confirmer = request.ConfirmerId is { } cid
            ? await (from m in db.Memberships.AsNoTracking()
                     join u in db.Users.AsNoTracking() on m.UserId equals u.Id
                     where m.ProjectId == access.Project.Id && m.Active && u.Active && u.Id == cid
                     select new { u.Id, u.Name }).FirstOrDefaultAsync(cancellationToken)
            : null;
        if (confirmer is null) return Problems.Invalid("CONFIRMER_REQUIRED", "Choose who confirms it: someone on the project.");
        ask.ActivityProposal = JsonSerializer.Serialize(proposal);
        ask.ActivityCheckedAt = clock.GetCurrentInstant();
        ask.ActivityCheckedByName = access.UserName;
        ask.ActivityConfirmerId = confirmer.Id;
        ask.ActivityConfirmerName = confirmer.Name;
        await ActionLetters.SendAsync(db, transmittals, clock, access.Project, new Actor(access.UserId, access.UserName), ActionLetters.Request,
            ask.Subject, $"{ask.IssuedByName} asked, and {access.UserName} checked it: {activity.Code} {what}. "
            + $"Your confirmation is asked: confirm or refuse it under “Your confirmation” on {activity.Code}.",
            [confirmer.Id], [], ask.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "ACTIVITY_REQUEST_CHECKED", "Transmittal", ask.Id, ask.Number,
            $"{activity.Code} {what}. Sent to {confirmer.Name} to confirm.", access.Project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// Whoever was asked confirms the request: what Document Control checked is applied by itself, and whoever asked,
    /// and Document Control, are told.
    /// </summary>
    private static async Task<IResult> ConfirmActivityAskAsync(Guid transmittalId, HttpContext http,
        DeliosDbContext db, IClock clock, AuditLog audit, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (ask, activity, problem) = await ConfirmingAsync(db, access, transmittalId, cancellationToken);
        if (problem is not null) return problem;
        var proposal = JsonSerializer.Deserialize<ActivityProposal>(ask!.ActivityProposal!)!;
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        string done;
        if (ask.ActivityAskKind == "DISCIPLINE")
        {
            var was = string.Join(", ", activity!.Departments);
            activity.Departments = proposal.Departments ?? [];
            done = $"{activity.Code} now concerns {(activity.Departments.Length == 0 ? "no discipline" : string.Join(", ", activity.Departments.Select(d => catalog.Label(ValueSets.Disciplines, d))))}";
            await audit.WriteAsync(http.User.Actor(), "ACTIVITY_DEPARTMENTS", "Activity", activity.Id, activity.Code,
                $"{(was.Length == 0 ? "none" : was)} → {(activity.Departments.Length == 0 ? "none" : string.Join(", ", activity.Departments))}, as {ask.Number} asked and {access.UserName} confirmed.",
                access.Project.Id, cancellationToken);
        }
        else
        {
            var added = new List<string>();
            foreach (var documentId in proposal.DocumentIds ?? [])
            {
                var (need, document, refused) = await NewNeedAsync(db, clock, access, activity!,
                    new NeedRequest(documentId, proposal.Purpose, proposal.Statuses, Department: proposal.Department), cancellationToken);
                // One the action came to need in the meantime stays as it is.
                if (refused is not null) continue;
                db.Requirements.Add(need!);
                added.Add(document!.Number);
            }
            await db.SaveChangesAsync(cancellationToken);
            await Readiness.RestateAsync(db, clock, [activity!.Id], cancellationToken);
            done = added.Count > 0 ? $"{string.Join(", ", added)} added to {activity.Code}" : $"{activity.Code} needed them already";
            if (added.Count > 0)
                await audit.WriteAsync(http.User.Actor(), "NEED_ADDED", "Activity", activity.Id, activity.Code,
                    $"Needs {string.Join(", ", added)}, as {ask.Number} asked and {access.UserName} confirmed.", access.Project.Id, cancellationToken);
        }
        await AnswerAsync(db, transmittals, clock, access, ask, activity!, $"Confirmed by {access.UserName}: {done}.", cancellationToken,
            ActionLetters.Confirmation, copyControl: true);
        await audit.WriteAsync(http.User.Actor(), "ACTIVITY_REQUEST_CONFIRMED", "Transmittal", ask.Id, ask.Number, done, access.Project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>Whoever was asked refuses the request, saying why: nothing changes, and whoever asked and Document Control are told.</summary>
    private static async Task<IResult> RefuseActivityAskAsync(Guid transmittalId, ActivityAskAnswer request, HttpContext http,
        DeliosDbContext db, IClock clock, AuditLog audit, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var note = request.Note?.Trim() ?? "";
        if (note.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it is refused; whoever asked reads it.");
        var (ask, activity, problem) = await ConfirmingAsync(db, access, transmittalId, cancellationToken);
        if (problem is not null) return problem;
        await AnswerAsync(db, transmittals, clock, access, ask!, activity!, $"Refused by {access.UserName}: {note}", cancellationToken,
            copyControl: true);
        await audit.WriteAsync(http.User.Actor(), "ACTIVITY_REQUEST_REFUSED", "Transmittal", ask!.Id, ask.Number, note, access.Project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>A checked request waiting on the caller's confirmation, and its action.</summary>
    private static async Task<(Transmittal? Ask, Activity? Activity, IResult? Problem)> ConfirmingAsync(
        DeliosDbContext db, ProjectAccess access, Guid transmittalId, CancellationToken cancellationToken)
    {
        var ask = await db.Transmittals.SingleOrDefaultAsync(t => t.Id == transmittalId && t.ProjectId == access.Project.Id, cancellationToken);
        if (ask?.ActivityId is not { } activityId) return (null, null, NotFound());
        if (ask.ActivityAnsweredAt is not null) return (null, null, Problems.Conflict("ALREADY_ANSWERED", $"{ask.ActivityAnsweredByName} already answered it."));
        if (ask.ActivityCheckedAt is null || ask.ActivityProposal is null)
            return (null, null, Problems.Conflict("NOT_CHECKED", "Document Control has not checked it yet."));
        if (ask.ActivityConfirmerId != access.UserId)
            return (null, null, Problems.Forbidden("NOT_YOURS", $"{ask.ActivityConfirmerName} was asked to confirm it."));
        var activity = await db.Activities.SingleAsync(a => a.Id == activityId, cancellationToken);
        return (ask, activity, null);
    }

    /// <summary>
    /// POST /activities/{id}/departments/own: without Document Control, someone whose discipline the action should
    /// concern adds it themselves. Their own discipline only; whoever plans the project is told.
    /// </summary>
    private static async Task<IResult> AddOwnDepartmentAsync(Guid activityId, HttpContext http, DeliosDbContext db, AuditLog audit,
        Notifications.Notifier notifier, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (await Delios.Host.Settings.ProjectAnswers.ControlDoesAsync(db, access.Project.Id, "ACTION_LINKS", cancellationToken))
            return Problems.Forbidden("CONTROL_ONLY", "On this project Document Control adds disciplines to actions: ask them.");
        var own = await OwnDepartmentAsync(db, access, cancellationToken);
        if (own is null) return Problems.Forbidden("NO_DISCIPLINE", "You answer for no discipline on this project.");
        var activity = await db.Activities.SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, cancellationToken);
        if (activity is null) return NotFound();
        if (activity.Departments.Contains(own)) return Results.NoContent();
        var was = string.Join(", ", activity.Departments);
        activity.Departments = [.. activity.Departments.Append(own).OrderBy(d => d)];
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "ACTIVITY_DEPARTMENTS", "Activity", activity.Id, activity.Code,
            $"{(was.Length == 0 ? "none" : was)} → {string.Join(", ", activity.Departments)}: {access.UserName} added their own discipline.", access.Project.Id, cancellationToken);
        await TellPlannersAsync(db, notifier, access, activity, $"{access.UserName} added {own}", $"{activity.Code} now concerns {own} too.", cancellationToken);
        return Results.NoContent();
    }

    /// <summary>The discipline the caller answers for on the project, if any.</summary>
    private static Task<string?> OwnDepartmentAsync(DeliosDbContext db, ProjectAccess access, CancellationToken cancellationToken) =>
        db.Memberships.AsNoTracking().Where(m => m.ProjectId == access.Project.Id && m.UserId == access.UserId && m.Active && m.Department != null)
            .Select(m => m.Department).FirstOrDefaultAsync(cancellationToken);

    /// <summary>Tells whoever plans the project of a change made by a discipline itself.</summary>
    private static async Task TellPlannersAsync(DeliosDbContext db, Notifications.Notifier notifier, ProjectAccess access, Activity activity,
        string title, string body, CancellationToken cancellationToken)
    {
        var planners = (await NoticeLog.HoldersAsync(db, access.Project.Id, Verbs.Plan, cancellationToken)).Where(id => id != access.UserId).Distinct().ToList();
        if (planners.Count > 0)
            await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, planners, Notifications.NotificationKinds.General,
                $"{activity.Code}: {title}", body, $"/actions/{activity.Code}", cancellationToken);
    }

    /// <summary>
    /// Closes a request about an action with what was done, and answers whoever asked on a transmittal replying to
    /// theirs (Document Control copied in when <paramref name="copyControl"/>: a request it checked was settled by somebody else).
    /// </summary>
    internal static async Task AnswerAsync(DeliosDbContext db, TransmittalService transmittals, IClock clock, ProjectAccess access,
        Transmittal ask, Activity activity, string answer, CancellationToken cancellationToken, string reason = ActionLetters.Answer,
        bool copyControl = false)
    {
        ask.ActivityAnsweredAt = clock.GetCurrentInstant();
        ask.ActivityAnsweredByName = access.UserName;
        ask.ActivityAnswer = answer;
        var control = copyControl ? await NoticeLog.HoldersAsync(db, access.Project.Id, Verbs.Control, cancellationToken) : [];
        await ActionLetters.SendAsync(db, transmittals, clock, access.Project, new Actor(access.UserId, access.UserName), reason,
            ask.Subject, $"{answer} ({activity.Code} {activity.Name})", ask.IssuedById is { } asker ? [asker] : [], control, ask.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
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
}
