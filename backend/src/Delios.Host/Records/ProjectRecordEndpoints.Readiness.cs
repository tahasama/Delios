using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Schedules;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Records;

public static partial class ProjectRecordEndpoints
{
    // ── Calls to departments, readiness, senders ──────────────────────────────

    private static async Task<IResult> IssueCallsAsync(CallsRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock,
        Notifications.Notifier notifier, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control issues the calls to departments.");
        var departments = r.Departments?.Select(d => d.Trim().ToUpperInvariant()).Where(d => d.Length > 0).Distinct().ToList() ?? [];
        if (departments.Count == 0) return Problems.Invalid("DEPARTMENTS_REQUIRED", "Choose the departments to ask.");
        if (r.DueOn is not { } due || LocalDate.FromDateOnly(due) < WorkingCalendar.Today(clock, access.Project.TimeZone))
            return Problems.Invalid("DUE_REQUIRED", "Say by when they answer: today or later.");
        var activities = await db.Activities.AsNoTracking().Where(a => a.ProjectId == access.Project.Id && a.State == ActivityStates.Active)
            .Select(a => new { a.Code, a.Departments }).ToListAsync(c);
        var earlier = await db.Set<RequirementCall>().AsNoTracking().Where(x => x.ProjectId == access.Project.Id).ToListAsync(c);
        var now = clock.GetCurrentInstant();
        var issued = new List<RequirementCall>();
        foreach (var department in departments)
        {
            // A call covers what no earlier call covered: a new schedule version asks only about what is new.
            var covered = earlier.Where(x => x.Department == department).SelectMany(x => x.ActivityCodes).ToHashSet();
            var codes = activities.Where(a => a.Departments.Contains(department) && !covered.Contains(a.Code)).Select(a => a.Code).OrderBy(x => x).ToArray();
            if (codes.Length == 0) continue;
            var call = new RequirementCall
            {
                TenantId = access.Project.TenantId,
                ProjectId = access.Project.Id,
                Department = department,
                ActivityCodes = codes,
                DueOn = LocalDate.FromDateOnly(due),
                IssuedAt = now,
                IssuedByName = access.UserName,
            };
            db.Add(call);
            issued.Add(call);
            await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, await DepartmentMembersAsync(db, access.Project.Id, department, c),
                Notifications.NotificationKinds.General, $"What documents does {department} need? Answer by {due:yyyy-MM-dd}",
                $"{codes.Length} activit{(codes.Length == 1 ? "y" : "ies")}: {string.Join(", ", codes.Take(20))}{(codes.Length > 20 ? "…" : "")}.",
                "/actions/requirements", c);
            await audit.WriteAsync(Who(access), "REQUIREMENT_CALL", "RequirementCall", call.Id, department,
                $"Asked for the documents of {codes.Length} activities, by {due:yyyy-MM-dd}.", access.Project.Id, c);
        }
        if (issued.Count == 0) return Problems.Conflict("NOTHING_TO_ASK", "Every activity those departments are tagged on has already been asked about.");
        await db.SaveChangesAsync(c);
        return Results.Ok(issued);
    }

    private static async Task<IResult> RemindCallAsync(Guid callId, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock,
        Notifications.Notifier notifier, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control sends reminders.");
        var call = await db.Set<RequirementCall>().SingleOrDefaultAsync(x => x.Id == callId && x.ProjectId == access.Project.Id, c);
        if (call is null) return Problems.NotFound("CALL_NOT_FOUND", "No such call.");
        if (call.AnsweredAt is not null) return Problems.Conflict("CALL_ANSWERED", "That department has answered.");
        call.Reminders++;
        call.LastRemindedAt = clock.GetCurrentInstant();
        await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, await DepartmentMembersAsync(db, access.Project.Id, call.Department, c),
            Notifications.NotificationKinds.General, $"Reminder: {call.Department}'s documents were due {call.DueOn:yyyy-MM-dd}",
            $"Activities: {string.Join(", ", call.ActivityCodes.Take(20))}.", "/actions/requirements", c);
        await audit.WriteAsync(Who(access), "REQUIREMENT_CALL_REMINDED", "RequirementCall", call.Id, call.Department, $"Reminder {call.Reminders}.",
            access.Project.Id, c);
        await db.SaveChangesAsync(c);
        return Results.Ok(call);
    }

    private static async Task<IResult> AnswerCallAsync(Guid callId, AnswerCallRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control records the answer.");
        var call = await db.Set<RequirementCall>().SingleOrDefaultAsync(x => x.Id == callId && x.ProjectId == access.Project.Id, c);
        if (call is null) return Problems.NotFound("CALL_NOT_FOUND", "No such call.");
        if (call.AnsweredAt is not null) return Problems.Conflict("CALL_ANSWERED", "That department has answered.");
        call.AnsweredAt = clock.GetCurrentInstant();
        call.AnswerNote = Blank(r.Note);
        await audit.WriteAsync(Who(access), "REQUIREMENT_CALL_ANSWERED", "RequirementCall", call.Id, call.Department, call.AnswerNote ?? "Answered.",
            access.Project.Id, c);
        await db.SaveChangesAsync(c);
        return Results.Ok(call);
    }

    private static async Task<IResult> ConfirmReadinessAsync(Guid activityId, ReadinessRequest r, HttpContext h, DeliosDbContext db, AuditLog audit,
        IClock clock, Notifications.Notifier notifier, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        var activity = await db.Activities.AsNoTracking().SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, c);
        if (activity is null) return Problems.NotFound("ACTIVITY_NOT_FOUND", "No such activity.");
        var department = r.Department?.Trim().ToUpperInvariant() ?? "";
        if (!activity.Departments.Contains(department)) return Problems.Invalid("NOT_CONCERNED", $"{activity.Code} does not concern {department}.");
        var mine = await db.Memberships.AnyAsync(m => m.ProjectId == access.Project.Id && m.UserId == access.UserId && m.Active && m.Department == department, c);
        if (!mine && !access.Holds(Verbs.Control)) return Problems.Forbidden("NOT_YOUR_DEPARTMENT", $"Someone who answers for {department} confirms its documents.");
        var note = Blank(r.Note);
        if (!r.Available && note is null) return Problems.Invalid("NOTE_REQUIRED", "Say what is missing and why: Document Control is alerted with it.");
        // After the day a confirmation is still taken, and always says why it comes late.
        var today = WorkingCalendar.Today(clock, access.Project.TimeZone);
        if (activity.Start is { } day && day < today && note is null)
            return Problems.Invalid("NOTE_REQUIRED", "The day has passed: say why it is confirmed now, and whether the documents came after it.");
        // Going ahead with this discipline's documents missing is always explained.
        if (r.Available && note is null && await db.Set<Schedules.Requirement>().AnyAsync(n => n.ActivityId == activityId && n.Department == department
                && n.State != RequirementStates.Met && n.State != RequirementStates.Waived, c))
            return Problems.Invalid("NOTE_REQUIRED", "Some of its documents are missing: say why it can go ahead without them.");
        var row = await db.Set<ReadinessConfirmation>().SingleOrDefaultAsync(x => x.ActivityId == activityId && x.Department == department, c);
        if (row is null)
        {
            row = new ReadinessConfirmation
            {
                TenantId = access.Project.TenantId,
                ProjectId = access.Project.Id,
                ActivityId = activityId,
                Department = department,
                ConfirmedByName = access.UserName,
            };
            db.Add(row);
        }
        row.Available = r.Available;
        row.Note = note;
        row.ConfirmedByName = access.UserName;
        row.ConfirmedAt = clock.GetCurrentInstant();
        // A person's answer replaces the system's, and an answer taken back is answered afresh.
        row.Automatic = false;
        row.RevokedAt = null;
        row.RevokedByName = null;
        row.RevokedReason = null;
        await audit.WriteAsync(Who(access), "READINESS_CONFIRMED", "Activity", activity.Id, activity.Code,
            $"{department}: {(r.Available ? "documents available" : "not available")}.{(note is null ? "" : $" {note}")}", access.Project.Id, c);
        if (!r.Available)
        {
            await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, await notifier.ControlHoldersAsync(access.Project.Id, c),
                Notifications.NotificationKinds.General, $"{activity.Code}: {department} is short of documents", note, $"/actions/{activity.Code}", c);
        }
        await db.SaveChangesAsync(c);
        return Results.Ok(row);
    }

    /// <summary>
    /// Document Control takes a person's confirmation back (an honest mistake), with a reason. The row stays, marked,
    /// so the record shows both; the department then counts as not confirmed and answers again.
    /// </summary>
    private static async Task<IResult> RevokeReadinessAsync(Guid activityId, RevokeReadinessRequest r, HttpContext h, DeliosDbContext db,
        AuditLog audit, IClock clock, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control takes a confirmation back.");
        var reason = Blank(r.Reason);
        if (reason is null) return Problems.Invalid("REASON_REQUIRED", "Say why the confirmation is taken back.");
        var department = r.Department?.Trim().ToUpperInvariant() ?? "";
        var activity = await db.Activities.AsNoTracking().SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, c);
        if (activity is null) return Problems.NotFound("ACTIVITY_NOT_FOUND", "No such activity.");
        var row = await db.Set<ReadinessConfirmation>().SingleOrDefaultAsync(x => x.ActivityId == activityId && x.Department == department, c);
        if (row is null || row.RevokedAt is not null) return Problems.Conflict("NOT_CONFIRMED", $"{department} has no confirmation to take back.");
        if (row.Automatic) return Problems.Conflict("AUTOMATIC", "This one was written by the system when the day passed; it stays as it was.");
        row.RevokedAt = clock.GetCurrentInstant();
        row.RevokedByName = access.UserName;
        row.RevokedReason = reason;
        await audit.WriteAsync(Who(access), "READINESS_REVOKED", "Activity", activity.Id, activity.Code,
            $"{department}: confirmation by {row.ConfirmedByName} taken back. Why: {reason}", access.Project.Id, c);
        await db.SaveChangesAsync(c);
        return Results.Ok(row);
    }

    private static async Task<IResult> NotifyDepartmentsAsync(Guid activityId, HttpContext h, DeliosDbContext db, AuditLog audit,
        Notifications.Notifier notifier, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await KeepsAsync(h, access)) return Problems.Forbidden("CONTROL_ONLY", "Document Control tells the departments where they stand.");
        var activity = await db.Activities.AsNoTracking().Include(a => a.Requirements)
            .SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, c);
        if (activity is null) return Problems.NotFound("ACTIVITY_NOT_FOUND", "No such activity.");
        if (activity.Departments.Length == 0) return Problems.Conflict("NO_DEPARTMENTS", "No department is tagged on this activity.");
        var shortages = activity.Requirements.Where(n => n.State != RequirementStates.Met && n.State != RequirementStates.Waived)
            .GroupBy(n => n.Department ?? "").ToDictionary(g => g.Key, g => g.Count());
        var totals = activity.Requirements.GroupBy(n => n.Department ?? "").ToDictionary(g => g.Key, g => g.Count());
        var summary = string.Join(", ", activity.Departments.Where(shortages.ContainsKey)
            .Select(d => $"{d} {shortages[d]} of {totals.GetValueOrDefault(d)} missing"));
        var subject = $"{activity.Code} on {activity.Start?.ToString("yyyy-MM-dd", null) ?? "no date"}: "
            + (summary.Length == 0 ? "every document is there" : $"at risk — {summary}");
        var people = new List<Guid>();
        foreach (var d in activity.Departments) people.AddRange(await DepartmentMembersAsync(db, access.Project.Id, d, c));
        await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, people, Notifications.NotificationKinds.General, subject,
            activity.Name, $"/actions/{activity.Code}", c);
        await audit.WriteAsync(Who(access), "DEPARTMENTS_NOTIFIED", "Activity", activity.Id, activity.Code, subject, access.Project.Id, c);
        return Results.Ok(new { subject, told = people.Distinct().Count() });
    }

    private sealed record RefusePersonRequest(string? Note);

    /// <summary>One person waiting to join the project, as the one confirming reads it.</summary>
    private sealed record PendingPerson(Guid MembershipId, Guid UserId, string Name, string? Organization, string Function, string? Department,
        DateTimeOffset Since, string? ProposedBy, Guid? ConfirmerId, string? ConfirmerName, bool Mine);

    /// <summary>GET /people/pending: the people added to the project who wait for management's confirmation.</summary>
    private static async Task<IResult> PendingPeopleAsync(HttpContext h, DeliosDbContext db, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        var manages = access.Holds(Verbs.Manage);
        var rows = await (from m in db.Memberships.AsNoTracking()
                          join u in db.Users.AsNoTracking() on m.UserId equals u.Id
                          join f in db.Functions.AsNoTracking() on m.FunctionId equals f.Id
                          where m.ProjectId == access.Project.Id && m.PendingSince != null
                          orderby m.PendingSince
                          select new { m, u.Name, Organization = u.Party != null ? u.Party.Name : null, Function = f.Name }).ToListAsync(c);
        return Results.Ok(rows.Select(x => new PendingPerson(x.m.Id, x.m.UserId, x.Name, x.Organization, x.Function, x.m.Department,
            x.m.PendingSince!.Value.ToDateTimeOffset(), x.m.ProposedByName, x.m.ConfirmerId, x.m.ConfirmerName,
            x.m.ConfirmerId == access.UserId || (x.m.ConfirmerId == null && manages))));
    }

    /// <summary>
    /// Management confirms a person on the project (they join), or refuses with why (they do not; it stays on the
    /// record). Whoever was named, or anyone holding Manage when nobody was. Whoever added them is told.
    /// </summary>
    private static async Task<IResult> SettlePersonAsync(Guid membershipId, string? refusal, HttpContext h, DeliosDbContext db, AuditLog audit,
        IClock clock, Notifications.Notifier notifier, Transmittals.TransmittalService transmittals, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        var membership = await db.Memberships.SingleOrDefaultAsync(m => m.Id == membershipId && m.ProjectId == access.Project.Id, c);
        if (membership is null) return Problems.NotFound("PERSON_NOT_FOUND", "No such person waiting on this project.");
        if (membership.PendingSince is null) return Problems.Conflict("NOT_PENDING", "They are not waiting for a confirmation.");
        if (!(membership.ConfirmerId == access.UserId || (membership.ConfirmerId is null && access.Holds(Verbs.Manage))))
            return Problems.Forbidden("NOT_YOURS", $"{membership.ConfirmerName ?? "Management"} confirms them.");
        if (refusal is not null && refusal.Trim().Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why; whoever added them reads it.");
        var person = await db.Users.AsNoTracking().SingleAsync(u => u.Id == membership.UserId, c);
        var now = clock.GetCurrentInstant();
        membership.PendingSince = null;
        if (refusal is null)
        {
            membership.Active = true;
            membership.ConfirmedAt = now;
            membership.ConfirmedByName = access.UserName;
        }
        else
        {
            membership.RefusedAt = now;
            membership.RefusedByName = access.UserName;
            membership.RefusedReason = refusal.Trim();
        }
        await db.SaveChangesAsync(c);
        var said = refusal is null ? $"{person.Name} confirmed on the project by {access.UserName}." : $"{person.Name} refused by {access.UserName}: {refusal.Trim()}";
        await audit.WriteAsync(Who(access), refusal is null ? "PERSON_CONFIRMED" : "PERSON_REFUSED", "User", person.Id, person.Name, said, access.Project.Id, c);
        // Whoever added them is answered on the transmittal that asked; the person themselves is told once they are on.
        var asked = membership.ConfirmTransmittalId is { } askId ? await db.Transmittals.AsNoTracking().SingleOrDefaultAsync(t => t.Id == askId, c) : null;
        var adder = membership.ProposedById is { } id ? new List<Guid> { id } : [];
        var letter = await Schedules.ActionLetters.SendAsync(db, transmittals, clock, access.Project, Who(access),
            refusal is null ? Schedules.ActionLetters.Confirmation : Schedules.ActionLetters.Answer,
            asked?.Subject ?? $"{person.Name} to confirm on {access.Project.Code}", said, adder, [], asked?.Id, c);
        var told = new List<Guid>();
        if (letter is null) told.AddRange(adder);
        if (refusal is null) told.Add(person.Id);
        if (told.Count > 0)
            await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, told.Distinct(), Notifications.NotificationKinds.General,
                refusal is null ? $"{person.Name} is on the project" : $"{person.Name} was not confirmed", said, "/", c);
        await db.SaveChangesAsync(c);
        return Results.NoContent();
    }

    private sealed record DepartmentsRequest(string[]? Departments, Guid? TransmittalId = null, bool FromList = false);

    private static async Task<IResult> SetDepartmentsAsync(Guid activityId, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock,
        Transmittals.TransmittalService transmittals, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        // Document Control tags by hand; whoever plans only by uploading the disciplines-per-action list.
        var body = await h.Request.ReadFromJsonAsync<DepartmentsRequest>(c);
        if (!await KeepsAsync(h, access) && !(body?.FromList == true && access.Holds(Verbs.Plan)))
            return Problems.Forbidden("CONTROL_ONLY", "Document Control tags activities; whoever plans does it with the disciplines-per-action list.");
        var activity = await db.Activities.SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, c);
        if (activity is null) return Problems.NotFound("ACTIVITY_NOT_FOUND", "No such activity.");
        var departments = body?.Departments?.Select(d => d.Trim().ToUpperInvariant()).Where(d => d.Length > 0).Distinct().OrderBy(d => d).ToArray() ?? [];
        var catalog = await Catalog.LoadAsync(db, c);
        if (departments.FirstOrDefault(d => !catalog.IsActive(ValueSets.Disciplines, d)) is { } unknown)
            return Problems.Invalid("VALUE_NOT_PUBLISHED", $"{unknown} is not a published discipline.", new { field = "departments", value = unknown });
        // Tagged in answer to a request for a missing discipline: the request is this action's and still open.
        Transmittals.Transmittal? ask = null;
        if (body?.TransmittalId is { } askId)
        {
            ask = await db.Transmittals.SingleOrDefaultAsync(t => t.Id == askId && t.ProjectId == access.Project.Id && t.ActivityId == activityId, c);
            if (ask is null) return Problems.NotFound("REQUEST_NOT_FOUND", $"No request about {activity.Code} by that number.");
            if (ask.ActivityAnsweredAt is not null) return Problems.Conflict("ALREADY_ANSWERED", $"{ask.ActivityAnsweredByName} already answered {ask.Number}.");
            if (ask.ActivityConfirm)
                return Problems.Conflict("NEEDS_CONFIRMATION", $"{ask.Number} needs management's confirmation: check it and send it on; it is applied once confirmed.");
        }
        var was = string.Join(", ", activity.Departments);
        activity.Departments = departments;
        await db.SaveChangesAsync(c);
        if (ask is not null)
            await Schedules.ScheduleEndpoints.AnswerAsync(db, transmittals, clock, access, ask, activity,
                $"{activity.Code} now concerns {(departments.Length == 0 ? "no discipline" : string.Join(", ", departments.Select(d => catalog.Label(ValueSets.Disciplines, d))))}.", c);
        await audit.WriteAsync(Who(access), "ACTIVITY_DEPARTMENTS", "Activity", activity.Id, activity.Code,
            $"{(was.Length == 0 ? "none" : was)} → {(departments.Length == 0 ? "none" : string.Join(", ", departments))}", access.Project.Id, c);
        return Results.NoContent();
    }

    private static async Task<IResult> IssueToSenderAsync(SenderIssueRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock,
        Notifications.Notifier notifier, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control issues the list to senders.");
        var sender = r.Sender?.Trim() ?? "";
        if (sender.Length == 0) return Problems.Invalid("SENDER_REQUIRED", "Say who it goes to.");
        var department = sender.StartsWith("DEPT:", StringComparison.Ordinal) ? sender[5..] : null;
        var needs = await (from n in db.Requirements
                           join a in db.Activities on n.ActivityId equals a.Id
                           join d in db.Documents on n.DocumentId equals d.Id
                           where a.ProjectId == access.Project.Id && a.State == ActivityStates.Active
                               && (department == null ? d.Originator == sender : d.Originator == null && d.Discipline == department)
                           select n.Id).ToListAsync(c);
        if (needs.Count == 0) return Problems.Conflict("NOTHING_TO_ISSUE", "No document on the list comes from them.");
        var row = new SenderIssue
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            Sender = sender,
            EntryCount = needs.Count,
            NeedIds = [.. needs],
            IssuedByName = access.UserName,
            IssuedAt = clock.GetCurrentInstant(),
        };
        db.Add(row);
        var people = department is not null
            ? await DepartmentMembersAsync(db, access.Project.Id, department, c)
            : await (from m in db.Memberships
                     join u in db.Users on m.UserId equals u.Id
                     where m.ProjectId == access.Project.Id && m.Active && u.Active && u.Party != null && u.Party.Code == sender
                     select u.Id).ToListAsync(c);
        await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, people, Notifications.NotificationKinds.General,
            $"The documents you are to send: {needs.Count}", "Document Control issued the requirements list; each has a date it is needed by.",
            "/actions/requirements", c);
        await audit.WriteAsync(Who(access), "REQUIREMENTS_ISSUED", "SenderIssue", row.Id, sender, $"{needs.Count} documents.", access.Project.Id, c);
        await db.SaveChangesAsync(c);
        return Results.Ok(row);
    }

    private static Task<List<Guid>> DepartmentMembersAsync(DeliosDbContext db, Guid projectId, string department, CancellationToken c) =>
        (from m in db.Memberships
         join u in db.Users on m.UserId equals u.Id
         where m.ProjectId == projectId && m.Active && u.Active && m.Department == department
         select u.Id).Distinct().ToListAsync(c);
}
