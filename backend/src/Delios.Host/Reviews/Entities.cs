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

public sealed class RoutePattern
{
    public string? DeliverableType { get; set; }
    public string? DocType { get; set; }
    public string? Discipline { get; set; }
    public string? Criticality { get; set; }
    public string? Originator { get; set; }
}

public sealed class RouteStep
{
    public required string Title { get; set; }
    /// <summary>The function whose holders on the project answer this step.</summary>
    public required string FunctionCode { get; set; }
    /// <summary>ANY: the first answer closes the step. ALL: every holder answers.</summary>
    public string Mode { get; set; } = StepModes.Any;
    /// <summary>Working days, in the project's calendar, the step has once it opens.</summary>
    public int? Days { get; set; }
    /// <summary>On the deciding step: the statuses it may grant. Empty means any published status.</summary>
    public string[] GrantsStatuses { get; set; } = [];
}

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
    public string State { get; set; } = ReviewStates.InProgress;
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
    public string? ReturnReason { get; set; }
    public string? ReturnNote { get; set; }
    public uint Version { get; set; }
    public List<ReviewStep> Steps { get; set; } = [];
    public List<ReviewComment> Comments { get; set; } = [];
}

public static class ReviewStates
{
    /// <summary>Steps are answering.</summary>
    public const string InProgress = "IN_PROGRESS";
    /// <summary>The deciding step has answered; Document Control releases or sends back.</summary>
    public const string Decided = "DECIDED";
    public const string Released = "RELEASED";
    public const string Returned = "RETURNED";
}

/// <summary>A step of a run, copied from the route when the review starts.</summary>
public sealed class ReviewStep
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ReviewId { get; set; }
    public int Index { get; set; }
    public required string Title { get; set; }
    public required string FunctionCode { get; set; }
    public string Mode { get; set; } = StepModes.Any;
    public bool Deciding { get; set; }
    public int? Days { get; set; }
    public string[] GrantsStatuses { get; set; } = [];
    public string State { get; set; } = StepStates.Waiting;
    public Instant? OpenedAt { get; set; }
    public LocalDate? DueDate { get; set; }
    public Instant? CompletedAt { get; set; }
    /// <summary>The step's answer: a verdict on the deciding step, the advice otherwise.</summary>
    public string? Answer { get; set; }
    public List<ReviewParticipant> Participants { get; set; } = [];
}

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
    public string? GrantedStatus { get; set; }
    public string? Note { get; set; }
    public Instant? AnsweredAt { get; set; }
}

public sealed class ReviewComment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ReviewId { get; set; }
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
    public int? ClosesWithStep { get; set; }
    public string Status { get; set; } = CommentStatuses.Open;
    public string? Resolution { get; set; }
    public Instant? ClosedAt { get; set; }
    public string? ClosedByName { get; set; }
    public Instant CreatedAt { get; set; }
}

public static class CommentClosure
{
    public const string Revision = "REVISION";
    public const string Step = "STEP";
}

public static class CommentStatuses
{
    public const string Open = "OPEN";
    public const string Closed = "CLOSED";
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
}
