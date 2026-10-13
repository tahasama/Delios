using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Reviews;

/// <summary>Body of the start-review request. <c>RouteId</c> picks a route; null takes the best route for the document.</summary>
/// <summary>Body of a review start. <c>People</c>, if given, holds per step the people the sender chose; a step left empty keeps the route's own.</summary>
public sealed record StartReviewRequest(Guid? RouteId = null, Guid[][]? People = null);
/// <summary>Body of a new comment. <c>Class</c> is a published comment class code; <c>ClosesWithStep</c> (from 1) names a later step that settles it, or null when it is settled with the revision.</summary>
public sealed record CommentRequest(string? Text, string? Class, int? ClosesWithStep = null);
/// <summary>Body of the close-comment request: how the comment was settled (required).</summary>
public sealed record CloseCommentRequest(string? Resolution);
/// <summary>Body of an answer on the open step. <c>Verdict</c> and <c>Status</c> are used only on the deciding step; advisers' answers come from their comments.</summary>
/// <param name="Issue">On the deciding step, with a verdict that lets the revision out: who it goes to once released.</param>
/// <param name="ForeignAnswer">For a party answering by proxy: their answer as they wrote it.</param>
/// <param name="EvidenceFileId">For a party answering by proxy: the proof of their answer.</param>
/// <param name="Note">The comment given with the answer. It is kept as a review comment of this step: blocking with blocking advice.</param>
/// <param name="ClosesWithStep">A later step that settles that comment, counted from 1; the next revision when absent.</param>
public sealed record AnswerRequest(string? Verdict = null, string? Status = null, string? Note = null, IssueAsk? Issue = null,
    string? ForeignAnswer = null, Guid? EvidenceFileId = null, int? ClosesWithStep = null);
/// <summary>Body of a release request. <c>Status</c>, if given, must equal the status the deciding step granted.</summary>
/// <param name="Outcome">Document Control's outcome to record, from its own published set.</param>
public sealed record ReleaseRequest(string? Status = null, string? Outcome = null, Transmittals.IssueAsk? Issue = null,
    IReadOnlyList<KeptRecipients>? Kept = null);

/// <summary>
/// Of an open request asking who receives the revision, the people and organizations Document Control keeps when
/// releasing. Anyone left out is taken off that request, and the request says so; nobody is added this way.
/// </summary>
public sealed record KeptRecipients(Guid RequestId, Guid[]? UserIds, Guid[]? PartyIds);
/// <summary>Body of a return request: Document Control sends the revision back to its author, or the route back to a step. <c>Note</c> is required; <c>Reason</c> is required when going back to a step.</summary>
/// <param name="ToStep">Null sends the revision back to its author; a step number (from 1) sends the route back to that step.</param>
/// <param name="Outcome">
/// Document Control's outcome, from its own published set. Whether the revision
/// comes back corrected under the same value or is replaced by a new one follows
/// from it, and from the verdict: one that asked for changes always needs a new revision.
/// </param>
public sealed record ReturnRequest(string? Note, int? ToStep = null, string? Reason = null, string? Outcome = null);
/// <summary>Body of sending on for release a revision whose document type is not reviewed: the status it is released at, and who receives it.</summary>
public sealed record SendOnRequest(string? Status, IssueAsk? Issue = null);
/// <summary>Body of a rewind request: the earlier step (from 1) to go back to, a published return reason, and an optional note.</summary>
public sealed record RewindRequest(int ToStep, string? Reason, string? Note);

/// <summary>
/// A review is a route of steps over one revision. Each step is answered by the
/// people holding a function on the project; the last step decides, the ones
/// before it advise. Document Control then releases what was decided, or sends it
/// back, and may never decide. A revision that comes back is replaced by the next
/// one, never corrected.
/// </summary>
public sealed partial class ReviewService(
    DeliosDbContext db, Numbering numbering, AuditLog audit, IClock clock, TransmittalService transmittals,
    ControlService control, Notifications.Notifier notifier, Supersession supersession)
{
    /// <summary>Kinds of advice an advising step can give, worked out from the adviser's comments: none, some, or at least one blocking comment. Mapped to published advice codes by <see cref="AdviceCode"/>.</summary>
    private const string Advice_None = "none", Advice_Some = "some", Advice_Blocking = "blocking";
}

/// <summary>
/// Message sent through the outbox when a revision is released. The worker (<see cref="Messaging.FileQueueConsumer"/>) hands it to <see cref="Stamping"/> and then to the schedule importer.
/// <c>SupersededRevisionIds</c> are the earlier revisions this release replaced.
/// </summary>
public sealed record RevisionReleased(Guid TenantId, Guid RevisionId, Guid[] SupersededRevisionIds)
{
    public const string RoutingKey = "revision.released";
}

/// <summary>
/// Message sent through the outbox when a revision is voided or put on hold: the worker makes a copy of what people
/// were reading marked VOID or ON HOLD. <c>Mark</c> is <see cref="FileKinds.Void"/> or <see cref="FileKinds.Held"/>.
/// </summary>
public sealed record RevisionMarked(Guid TenantId, Guid RevisionId, string Mark, string Note)
{
    public const string RoutingKey = "revision.marked";
}
