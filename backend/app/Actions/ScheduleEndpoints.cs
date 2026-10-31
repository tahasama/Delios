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

/// <summary>Request body for PUT /schedule: which document is the schedule, how to read its columns, and the default lead and risk-window days. Null fields keep their current value.</summary>
/// <summary>Body of setting the days around an action: how long before its day a document is needed, and from when it is at risk.</summary>

public sealed record SourceRequest(Guid DocumentId, ScheduleColumns? Columns = null, int? DefaultLeadDays = null, int? RiskWindowDays = null);

/// <summary>Request body for adding a need to an activity: which document, for what purpose, and when it is needed.</summary>
/// <param name="OffsetDays">Days from the anchor: negative before, positive after. Empty: the project's lead before the start.</param>
public sealed record NeedRequest(
    Guid DocumentId, string? Purpose, string[]? RequiredStatuses = null, string? Anchor = null, int? OffsetDays = null,
    DateOnly? FixedDate = null, string? Department = null, Guid? TransmittalId = null, bool FromList = false);

/// <summary>Several needs added and taken off an action at once (the register opened for it): all or none.</summary>
public sealed record NeedsChange(NeedRequest[]? Add, Guid[]? Remove);

/// <summary>The control function's answer to a request to add a document to an action, when nothing is added: why.</summary>
public sealed record ActivityAskAnswer(string? Note);

/// <summary>
/// What a request will change once whoever holds Manage confirms it, as the control function checked it: the documents and the
/// discipline needing them (with the purpose and statuses the need takes), or the disciplines the action concerns.
/// </summary>
public sealed record ActivityProposal(Guid[]? DocumentIds = null, string? Department = null, string[]? Departments = null,
    string? Purpose = null, string[]? Statuses = null);

/// <summary>A request about an action still open: who asked, what for, and where it stands.</summary>
public sealed record ActivityRequestView(Guid Id, string Number, string From, DateTimeOffset At, string Kind, string Subject, string? Message,
    bool Confirm, DateTimeOffset? CheckedAt, string? CheckedBy, Guid? ConfirmerId, string? ConfirmerName, ActivityProposal? Proposal,
    IReadOnlyList<Guid> DocumentIds);

/// <summary>The control function's check of a request that whoever holds Manage confirms: what will change, and who confirms it.</summary>
public sealed record ActivityCheckRequest(Guid? ConfirmerId, Guid[]? DocumentIds = null, string? Department = null,
    string[]? Departments = null, string? Purpose = null, string[]? Statuses = null);

/// <summary>Request body for waiving a need: the note saying why the activity can go ahead without the document.</summary>
public sealed record WaiverRequest(string? Note);

/// <summary>Request body for recording what was decided about an activity whose documents were missing.</summary>
public sealed record DecisionRequest(string? Decision, string? ResponsibleName, string? Reason, string? DelayOwedBy = null, string? DelayReason = null);

/// <summary>One activity as the schedule list shows it: its dates, departments, readiness label and need counts.</summary>
public sealed record ActivitySummary(Guid Id, string Code, string Name, DateOnly? Start, DateOnly? Finish, string? Responsible,
    IReadOnlyList<string> Departments, string State, string Readiness, int Needs, int Met, int Waived, DateOnly? NextNeededBy, string? ExternalId = null,
    ActivityMove? Moved = null);

/// <summary>The latest schedule read moved the activity: its dates before, and which read moved it.</summary>
public sealed record ActivityMove(DateOnly? WasStart, DateOnly? WasFinish, string In, DateTimeOffset At);

/// <summary>One need of an activity as the activity page shows it: the document, its current revision and status, when it is needed, and its state or waiver.</summary>
public sealed record NeedView(Guid Id, Guid DocumentId, string DocumentNumber, string Title, string? CurrentRevision, string? CurrentStatus,
    string Purpose, IReadOnlyList<string> RequiredStatuses, string Anchor, int OffsetDays, DateOnly? FixedDate, DateOnly? NeededBy,
    string? Department, string State, DateTimeOffset? MetAt, string? WaiverNote, string? WaivedBy, DateTimeOffset? WaivedAt, int? RiskDays = null);

/// <summary>One recorded activity decision as the activity page shows it.</summary>
public sealed record DecisionView(Guid Id, string Decision, DateOnly? PlannedStart, string ResponsibleName, string Reason,
    string? DelayOwedBy, string? DelayReason, string RecordedBy, DateTimeOffset RecordedAt,
    string? ConfirmedBy = null, DateTimeOffset? ConfirmedAt = null, string? ConfirmNote = null,
    string? ReversedBy = null, DateTimeOffset? ReversedAt = null, string? ReversedReason = null);

/// <summary>
/// One thing on the schedule waiting for the person asking: CONFIRM_DOCUMENTS (their discipline confirms an action's
/// documents), CONFIRM_POSTPONEMENT (whoever plans confirms a postponement), UNTAGGED (actions no discipline is
/// tagged on), SCHEDULE_READ_FAILED (the schedule's last read failed).
/// </summary>
public sealed record ActionWork(string Kind, Guid? ActivityId, string? Code, string? Name, DateOnly? Day, string? Department, int Count, DateTimeOffset? Since,
    Guid? TransmittalId = null, string? Number = null, string? From = null, string? Ask = null);

/// <summary>A notice a person sends: what it is about (its subject key), to whom, and what it says.</summary>
/// <summary>Body of a notice sent by hand. <c>OutsideLink</c>: the page another organization's people are sent to, since they cannot open the schedule.</summary>
public sealed record NoticeRequest(string? Subject, string? Title, string? Body, string? Link, Guid[]? People, string? OutsideLink = null);

/// <summary>One notice as the screens list it.</summary>
public sealed record NoticeView(Guid Id, string Subject, bool Automatic, string Title, string? Body, string[] Recipients, string SentBy, DateTimeOffset SentAt);

/// <summary>A postponement confirmed by whoever plans, or taken back by the control function: the words that go with it.</summary>
public sealed record DecisionNoteRequest(string? Note);

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
public static partial class ScheduleEndpoints
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
        // The plan and an action's page are read by everyone on the project, each narrowed to what is theirs.
        var everyone = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Schedule")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>()
            .AddEndpointFilter(async (context, next) => ProjectAccessFilter.Of(context.HttpContext) is { } access
                && (!access.IsInternal || access.Holds(Verbs.Read))
                ? await next(context)
                : Problems.Forbidden("SCHEDULE_NOT_ALLOWED", "You do not read the schedule on this project."));
        everyone.MapGet("/plan", PlanAsync);
        everyone.MapGet("/plan/page", PlanPageAsync);
        everyone.MapGet("/plan/progress", PlanProgressAsync);
        everyone.MapGet("/plan/{code}", PlanActionAsync);
        everyone.MapGet("/activities/{activityId:guid}/lateness", LatenessAsync);
        project.MapGet("/schedule", SourceAsync);
        project.MapPut("/schedule", SetSourceAsync);
        project.MapPut("/schedule/days", ScheduleDays.ProjectPutAsync);
        project.MapPost("/schedule/import", ImportAsync);
        project.MapGet("/activities", ActivitiesAsync);
        project.MapGet("/activities/short", ShortAsync);
        project.MapGet("/activities/{activityId:guid}", ActivityAsync);
        project.MapPost("/activities/{activityId:guid}/needs", AddNeedAsync);
        project.MapPost("/activities/{activityId:guid}/needs/many", ChangeNeedsAsync);
        project.MapDelete("/activities/{activityId:guid}/needs/{needId:guid}", RemoveNeedAsync);
        project.MapPost("/activities/{activityId:guid}/needs/{needId:guid}/waive", WaiveAsync);
        project.MapDelete("/activities/{activityId:guid}/needs/{needId:guid}/waive", UnwaiveAsync);
        // Confirmations, postponements, notices and answers are never made twice by a second press or a retry.
        project.MapPost("/activities/{activityId:guid}/decisions", DecideAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapGet("/notices", NoticesAsync);
        project.MapGet("/activities-work", ActionWorkAsync);
        project.MapPost("/notices", SendNoticeAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapPost("/activities/{activityId:guid}/decisions/{decisionId:guid}/confirm", ConfirmPostponementAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapPost("/activities/{activityId:guid}/decisions/{decisionId:guid}/reverse", ReverseDecisionAsync);
        project.MapPost("/transmittals/{transmittalId:guid}/activity-answer", AnswerActivityAskAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapGet("/activities/{activityId:guid}/requests", ActivityRequestsAsync);
        project.MapPost("/activities/{activityId:guid}/departments/own", AddOwnDepartmentAsync);
        project.MapPost("/transmittals/{transmittalId:guid}/activity-check", CheckActivityAskAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapPost("/transmittals/{transmittalId:guid}/activity-confirm", ConfirmActivityAskAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapPost("/transmittals/{transmittalId:guid}/activity-refuse", RefuseActivityAskAsync);
    }
}
