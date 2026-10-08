using Delios.Host.Identity;
using NodaTime;

namespace Delios.Host.Reviews;

/// <summary>
/// A review route the organization publishes: steps in order, each answered by
/// the people holding a function on the project. The last step decides; the
/// ones before it advise. Which documents it serves is said by its patterns.
/// </summary>
public sealed class ReviewRoute
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }
    /// <summary>Offered when no route's patterns match the document.</summary>
    public bool IsDefault { get; set; }
    public bool Active { get; set; } = true;
    /// <summary>Documents it serves. Empty serves every document. A null field in a pattern means any value.</summary>
    public List<RoutePattern> Patterns { get; set; } = [];
    public List<RouteStep> Steps { get; set; } = [];
}

/// <summary>Which documents a route serves, by document fields. A null field matches any value; set fields must all match. Stored as JSON on the route.</summary>
public sealed class RoutePattern
{
    public string? DeliverableType { get; set; }
    public string? DocType { get; set; }
    public string? Discipline { get; set; }
    public string? Criticality { get; set; }
    public string? Originator { get; set; }
}

/// <summary>One step of a published route: who answers it, how, and in how many days. Copied into a <see cref="ReviewStep"/> when a review starts. Stored as JSON on the route.</summary>
public sealed class RouteStep
{
    public required string Title { get; set; }
    /// <summary>The function whose holders on the project answer this step. Empty when a party answers it.</summary>
    public string? FunctionCode { get; set; }
    /// <summary>
    /// An organization outside our control that answers this step. The step then
    /// travels by transmittal: to their people when they answer here, or carried
    /// by one of ours, who records their answer, when they do not.
    /// </summary>
    public string? PartyCode { get; set; }
    /// <summary>For a party's step: the reason for issue on the transmittal that carries it.</summary>
    public string? Reason { get; set; }
    /// <summary>ANY: the first answer closes the step. ALL: every holder answers.</summary>
    public string Mode { get; set; } = StepModes.Any;
    /// <summary>Working days, in the project's calendar, the step has once it opens.</summary>
    public int? Days { get; set; }
    /// <summary>On the deciding step: the statuses it may grant. Empty means any published status.</summary>
    public string[] GrantsStatuses { get; set; } = [];
}

/// <summary>How many of a step's people must answer: ANY (the first answer closes the step) or ALL.</summary>
public static class StepModes
{
    public const string Any = "ANY";
    public const string All = "ALL";
}

/// <summary>One run of a route over one revision.</summary>
public sealed class Review
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid DocumentId { get; set; }
    public Guid RevisionId { get; set; }
    /// <summary>What people say on the phone: P1001-RV-0001.</summary>
    public required string Number { get; set; }
    public required string RouteName { get; set; }
    /// <summary>One of <see cref="ReviewStates"/>.</summary>
    public string State { get; set; } = ReviewStates.InProgress;
    /// <summary>Index (from 0) of the step that is open, or was open last.</summary>
    public int CurrentStep { get; set; }
    /// <summary>The deciding step's verdict and the status it granted.</summary>
    public string? Verdict { get; set; }
    public string? GrantedStatus { get; set; }
    public Guid StartedById { get; set; }
    public required string StartedByName { get; set; }
    public Instant StartedAt { get; set; }
    public Instant? DecidedAt { get; set; }
    public Instant? ClosedAt { get; set; }
    public string? ClosedByName { get; set; }
    /// <summary>Meant for the reason code when the review is sent back; nothing sets it at present.</summary>
    public string? ReturnReason { get; set; }
    /// <summary>Why the revision was sent back to its author, when it was.</summary>
    public string? ReturnNote { get; set; }
    /// <summary>Row version, changed by the database on each update; used to detect two saves of the same review at once.</summary>
    public uint Version { get; set; }
    public List<ReviewStep> Steps { get; set; } = [];
    public List<ReviewComment> Comments { get; set; } = [];
}

/// <summary>The states a <see cref="Review"/> moves through: IN_PROGRESS, DECIDED, then RELEASED or RETURNED.</summary>
public static class ReviewStates
{
    /// <summary>Steps are answering.</summary>
    public const string InProgress = "IN_PROGRESS";
    /// <summary>The deciding step has answered; Document Control releases or sends back.</summary>
    public const string Decided = "DECIDED";
    /// <summary>Document Control released the revision; the review is closed.</summary>
    public const string Released = "RELEASED";
    /// <summary>The revision was sent back to its author or sender; the review is closed.</summary>
    public const string Returned = "RETURNED";
}

/// <summary>A step of a run, copied from the route when the review starts.</summary>
public sealed class ReviewStep
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ReviewId { get; set; }
    /// <summary>Position of the step in the route, from 0. Shown to people as Index + 1.</summary>
    public int Index { get; set; }
    public required string Title { get; set; }
    public string? FunctionCode { get; set; }
    /// <summary>The outside party that answers, copied when the review starts.</summary>
    public Guid? PartyId { get; set; }
    public string? PartyName { get; set; }
    /// <summary>IN_APP or BY_PROXY, as the party worked when the review started.</summary>
    public string? Participation { get; set; }
    public string? Reason { get; set; }
    public string Mode { get; set; } = StepModes.Any;
    public bool Deciding { get; set; }
    public int? Days { get; set; }
    public string[] GrantsStatuses { get; set; } = [];
    /// <summary>One of <see cref="StepStates"/>.</summary>
    public string State { get; set; } = StepStates.Waiting;
    public Instant? OpenedAt { get; set; }
    /// <summary>The date the step should be answered by, counted in working days; null when the step has no deadline or, by proxy, has not been sent yet.</summary>
    public LocalDate? DueDate { get; set; }
    public Instant? CompletedAt { get; set; }
    /// <summary>The step's answer: a verdict on the deciding step, the advice otherwise.</summary>
    public string? Answer { get; set; }
    /// <summary>The transmittal that carried the step to the party.</summary>
    public Guid? TransmittalId { get; set; }
    /// <summary>By proxy: when it went to them, how, their reference, and which of us sent it. The clock runs from here.</summary>
    public Instant? DispatchedAt { get; set; }
    public string? DispatchChannel { get; set; }
    public string? DispatchRef { get; set; }
    public string? DispatchedByName { get; set; }
    /// <summary>By proxy: their answer as they wrote it, who of ours recorded it, and its proof.</summary>
    public string? ForeignAnswer { get; set; }
    public string? RecordedByName { get; set; }
    public Guid? EvidenceFileId { get; set; }
    public List<ReviewParticipant> Participants { get; set; } = [];

    /// <summary>One of ours carries this step and records the party's answer.</summary>
    public bool ByProxy => Participation == Participations.ByProxy;
}

/// <summary>The states of a <see cref="ReviewStep"/>: WAITING (not reached yet), OPEN (being answered) and DONE.</summary>
public static class StepStates
{
    public const string Waiting = "WAITING";
    public const string Open = "OPEN";
    public const string Done = "DONE";
}

/// <summary>Who was seated on a step when it opened, and what each answered.</summary>
public sealed class ReviewParticipant
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid StepId { get; set; }
    public Guid UserId { get; set; }
    public required string UserName { get; set; }
    public string? Answer { get; set; }
    /// <summary>On the deciding step, when the verdict lets the revision proceed: the status this person grants.</summary>
    public string? GrantedStatus { get; set; }
    public string? Note { get; set; }
    public Instant? AnsweredAt { get; set; }
    /// <summary>Set when somebody this person handed the step to answered in their place.</summary>
    public Guid? AnsweredById { get; set; }
    public string? AnsweredByName { get; set; }
}

/// <summary>A comment written on a review step. Blocking comments must be closed before release.</summary>
public sealed class ReviewComment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ReviewId { get; set; }
    /// <summary>The step (from 0) it was written on.</summary>
    public int StepIndex { get; set; }
    public Guid AuthorId { get; set; }
    public required string AuthorName { get; set; }
    public required string Text { get; set; }
    /// <summary>From the organization's comment classes.</summary>
    public required string Class { get; set; }
    /// <summary>Stops the release until it is closed.</summary>
    public bool Blocking { get; set; }
    /// <summary>REVISION: settled by the next revision. STEP: settled when a later step of this route answers.</summary>
    public string ClosesWith { get; set; } = CommentClosure.Revision;
    /// <summary>When <c>ClosesWith</c> is STEP: the step number (from 1) whose answer settles it.</summary>
    public int? ClosesWithStep { get; set; }
    /// <summary>One of <see cref="CommentStatuses"/>.</summary>
    public string Status { get; set; } = CommentStatuses.Open;
    public string? Resolution { get; set; }
    public Instant? ClosedAt { get; set; }
    public string? ClosedByName { get; set; }
    public Instant CreatedAt { get; set; }
}

/// <summary>What settles a comment: the next revision (REVISION) or a later step of the same route (STEP).</summary>
public static class CommentClosure
{
    public const string Revision = "REVISION";
    public const string Step = "STEP";
}

/// <summary>Whether a comment is still open or has been closed.</summary>
public static class CommentStatuses
{
    public const string Open = "OPEN";
    public const string Closed = "CLOSED";
    /// <summary>Taken back by its author before their step was answered. Kept, and no longer shown or counted.</summary>
    public const string Withdrawn = "WITHDRAWN";
}

/// <summary>
/// One person's step handed to somebody else until a date: the other person
/// answers it in their place, and the record says both names. Raised from a
/// review, it covers that review's step only.
/// </summary>
public sealed class ReviewDelegation
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid ReviewId { get; set; }
    /// <summary>The step (from 0) it hands over.</summary>
    public int StepIndex { get; set; }
    public Guid FromUserId { get; set; }
    public required string FromName { get; set; }
    public Guid ToUserId { get; set; }
    public required string ToName { get; set; }
    /// <summary>REVIEW (advice) or APPROVE (the decision): what is handed over.</summary>
    public required string Verb { get; set; }
    /// <summary>The last day it is in force, in the project's calendar.</summary>
    public LocalDate EndDate { get; set; }
    public string? Reason { get; set; }
    /// <summary>One of <see cref="DelegationStates"/>.</summary>
    public string Status { get; set; } = DelegationStates.Active;
    public string? RefusedReason { get; set; }
    /// <summary>Why the matrix would not have made this hand-over, when it would not.</summary>
    public string? Flag { get; set; }
    public required string AskedByName { get; set; }
    public string? GrantedByName { get; set; }
    public Instant? GrantedAt { get; set; }
    public Instant CreatedAt { get; set; }
}

/// <summary>Where a <see cref="ReviewDelegation"/> stands.</summary>
public static class DelegationStates
{
    /// <summary>Asked for; Document Control has not put it in force.</summary>
    public const string Open = "OPEN";
    /// <summary>In force until its end date.</summary>
    public const string Active = "ACTIVE";
    /// <summary>Document Control declined it, with a reason.</summary>
    public const string Refused = "REFUSED";
    /// <summary>Ended before its date, by the person who gave it or by Document Control.</summary>
    public const string Withdrawn = "WITHDRAWN";
}

/// <summary>Value lists a review reads, all the organization's to edit.</summary>
public static class ReviewSets
{
    /// <summary>What a released revision is for: IFC, IFA… Props: executes (bool).</summary>
    public const string Statuses = "STATUSES";
    /// <summary>The deciding step's verdicts. Props: proceed (bool).</summary>
    public const string Verdicts = "REVIEW_OUTCOMES";
    /// <summary>What an adviser's comments amount to. Props: comments = none | some | blocking.</summary>
    public const string Advice = "REVIEW_ADVICE";
    /// <summary>Props: blocking (bool).</summary>
    public const string CommentClasses = "COMMENT_CLASSES";
    /// <summary>Why a review is sent back to one of its steps.</summary>
    public const string ReturnReasons = "RETURN_REASONS";
    /// <summary>
    /// Document Control's own outcomes, never a review verdict. Props: act = accept
    /// (on arrival) | return | release; newRevision (bool): whether what it returns
    /// needs a new revision or comes back corrected under the same one.
    /// </summary>
    public const string ControlOutcomes = "CONTROL_OUTCOMES";
}
