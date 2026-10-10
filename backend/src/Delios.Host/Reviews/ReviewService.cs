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
public sealed record AnswerRequest(string? Verdict = null, string? Status = null, string? Note = null, IssueAsk? Issue = null,
    string? ForeignAnswer = null, Guid? EvidenceFileId = null);
/// <summary>Body of a release request. <c>Status</c>, if given, must equal the status the deciding step granted.</summary>
/// <param name="Outcome">Document Control's outcome to record, from its own published set.</param>
public sealed record ReleaseRequest(string? Status = null, string? Outcome = null);
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
public sealed class ReviewService(
    DeliosDbContext db, Numbering numbering, AuditLog audit, IClock clock, TransmittalService transmittals,
    ControlService control, Notifications.Notifier notifier, Supersession supersession)
{
    /// <summary>Kinds of advice an advising step can give, worked out from the adviser's comments: none, some, or at least one blocking comment. Mapped to published advice codes by <see cref="AdviceCode"/>.</summary>
    private const string Advice_None = "none", Advice_Some = "some", Advice_Blocking = "blocking";

    // ── Routes ────────────────────────────────────────────────────────────────

    /// <summary>The routes that serve a document, most specific first; the default last.</summary>
    public async Task<IReadOnlyList<ReviewRoute>> RoutesForAsync(Document document, CancellationToken cancellationToken)
    {
        var routes = await db.ReviewRoutes.AsNoTracking().Where(r => r.Active).ToListAsync(cancellationToken);
        // A step naming a function and no people can come back with no list at all: read it as empty.
        foreach (var step in routes.SelectMany(r => r.Steps))
        {
            step.UserIds ??= [];
            step.GrantsStatuses ??= [];
        }
        return routes
            .Select(r => (Route: r, Score: Score(r, document)))
            .Where(x => x.Score >= 0)
            .OrderByDescending(x => x.Score).ThenBy(x => x.Route.IsDefault).ThenBy(x => x.Route.Name)
            .Select(x => x.Route).ToList();
    }

    /// <summary>-1 when the route does not serve the document; otherwise how many fields its best pattern pins.</summary>
    private static int Score(ReviewRoute route, Document d)
    {
        if (route.Patterns.Count == 0) return route.IsDefault ? 0 : 0;
        var best = -1;
        foreach (var p in route.Patterns)
        {
            var fields = new[] { (p.DeliverableType, d.DeliverableType), (p.DocType, d.DocType), (p.Discipline, d.Discipline),
                (p.Criticality, d.Criticality), (p.Originator, d.Originator) };
            if (fields.Any(f => f.Item1 is not null && f.Item1 != f.Item2)) continue;
            best = Math.Max(best, fields.Count(f => f.Item1 is not null));
        }
        return best;
    }

    // ── Start ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Starts a review of a revision that is in preparation, after checking its files passed scanning, it has a readable PDF, a route serves the document, every step has someone to answer it and the deciding function may approve.
    /// Creates the review and its steps from the route, opens step 1 and moves the revision to in-review. Called by the start endpoint in <see cref="ReviewEndpoints"/>.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> StartAsync(
        ProjectAccess access, Guid revisionId, StartReviewRequest request, CancellationToken cancellationToken)
    {
        var revision = await db.Revisions.Include(r => r.Files).SingleOrDefaultAsync(r => r.Id == revisionId, cancellationToken);
        var document = revision is null ? null : await VisibleDocumentAsync(access, revision.DocumentId, cancellationToken);
        if (revision is null || document is null) return Fail(Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        if (!access.Allows(Verbs.Create, document.Facts) && !access.Allows(Verbs.Revise, document.Facts)
            && revision.AuthoredById != access.UserId)
        {
            return Fail(Problems.Forbidden("REVIEW_NOT_ALLOWED", "Only the author or someone who may revise it can send it for review."));
        }
        if (revision.State != RevisionStates.InPreparation)
        {
            return Fail(Problems.Conflict("REVISION_NOT_IN_PREPARATION",
                $"Revision {revision.Value} is {Words(revision.State)}; only a revision in preparation is sent for review.",
                new { state = revision.State }));
        }
        // Nothing is reviewed that nobody can read: a verdict on a file that failed
        // its scan, or on no readable copy at all, is worth less than no verdict.
        if (revision.FilesState != FilesStates.Ready)
        {
            return Fail(Problems.Conflict("FILES_NOT_READY", "The revision's files have not all passed scanning.",
                new { filesState = revision.FilesState }));
        }
        if (!revision.Files.Any(f => f.Kind == FileKinds.Rendition && f.Status == FileStatuses.Clean && f.Submission == revision.Submission))
        {
            return Fail(Problems.Conflict("NO_RENDITION", "A review needs a PDF people can read. Upload one with the revision."));
        }

        var candidates = await RoutesForAsync(document, cancellationToken);
        var route = request.RouteId is { } id ? candidates.FirstOrDefault(r => r.Id == id) : candidates.FirstOrDefault();
        if (route is null || route.Steps.Count == 0)
        {
            return Fail(Problems.Invalid("NO_ROUTE", request.RouteId is null
                ? "No review route serves this document. An administrator publishes one."
                : "That route does not serve this document."));
        }

        // The sender's choice of people on a step of ours replaces the route's for this
        // review: they answer it, and nobody else. The route itself is unchanged.
        var chosenBySender = new List<string>();
        for (var i = 0; i < route.Steps.Count && request.People is { } chosen && i < chosen.Length; i++)
        {
            if (route.Steps[i].PartyCode is not null || chosen[i] is not { Length: > 0 } ids) continue;
            route.Steps[i].FunctionCode = null;
            route.Steps[i].UserIds = ids.Distinct().ToArray();
            chosenBySender.Add($"step {i + 1}");
        }

        // Every step must have someone to answer it, a party's step a reason to
        // send it to them, and the one who decides, if ours, must be allowed to
        // approve this document. An outside party's approval is theirs to give.
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var parties = await db.Parties.AsNoTracking().Where(p => p.Active && !p.IsInternal).ToDictionaryAsync(p => p.Code, cancellationToken);
        for (var i = 0; i < route.Steps.Count; i++)
        {
            var step = route.Steps[i];
            Party? party = null;
            if (step.PartyCode is { } code)
            {
                if (!parties.TryGetValue(code, out party))
                {
                    return Fail(Problems.Invalid("STEP_PARTY_UNKNOWN",
                        $"Step {i + 1} ({step.Title}) names {code}, which is not an active outside party.",
                        new { step = i + 1, party = code }));
                }
                if (step.Reason is null || !catalog.IsActive(TransmittalSets.Reasons, step.Reason))
                {
                    return Fail(Problems.Invalid("STEP_NEEDS_REASON",
                        $"Step {i + 1} ({step.Title}) goes to {party.Name} by transmittal and needs a published reason for issue.",
                        new { step = i + 1, reason = step.Reason }));
                }
            }
            if ((await SeatsAsync(access.Project, step.FunctionCode, party, party?.Participation, cancellationToken, step.UserIds, document)).Count == 0)
            {
                return Fail(Problems.Invalid("STEP_HAS_NO_HOLDER",
                    party is null ? step.FunctionCode is null
                        ? $"Nobody named on step {i + 1} ({step.Title}) is on this project and cleared for {document.Confidentiality ?? "this document"}, so it could not be answered."
                        : $"Nobody {(step.UserIds.Length > 0 ? "named on it, nor anybody holding " : "holds ")}{step.FunctionCode} on this project with a clearance that reaches {document.Confidentiality ?? "this document"}, so step {i + 1} ({step.Title}) could not be answered."
                    : party.Participation == Participations.InApp
                        ? $"Nobody from {party.Name} is on this project, so step {i + 1} ({step.Title}) could not be answered."
                        : $"Nobody on this project carries the exchange with {party.Name}, so step {i + 1} ({step.Title}) could not be answered.",
                    new { step = i + 1, function = step.FunctionCode, party = step.PartyCode }));
            }
        }
        var deciding = route.Steps[^1];
        if (deciding.PartyCode is null && deciding.FunctionCode is null)
        {
            // Only people named: each decides on the strength of a function of theirs on the project.
            var named = await db.Memberships.AsNoTracking().Include(m => m.Function!).ThenInclude(f => f.Rules)
                .Where(m => m.ProjectId == access.Project.Id && m.Active && m.Function!.Active && deciding.UserIds.Contains(m.UserId))
                .ToListAsync(cancellationToken);
            if (!named.Any(m => Allows(m.Function!, access.Project, Verbs.Approve, document.Facts)))
            {
                return Fail(Problems.Invalid("DECIDER_CANNOT_APPROVE",
                    "Nobody named on the deciding step may approve this document.", new { step = route.Steps.Count }));
            }
        }
        else if (deciding.PartyCode is null)
        {
            var decider = await db.Functions.AsNoTracking().Include(f => f.Rules)
                .SingleOrDefaultAsync(f => f.Code == deciding.FunctionCode && f.Active, cancellationToken);
            if (decider is null || !Allows(decider, access.Project, Verbs.Approve, document.Facts))
            {
                return Fail(Problems.Invalid("DECIDER_CANNOT_APPROVE",
                    $"The deciding step is answered by {deciding.FunctionCode}, which may not approve this document.",
                    new { function = deciding.FunctionCode }));
            }
        }

        var number = await numbering.RecordAsync(access.Project.TenantId, access.Project.Id, RecordKinds.Review,
            NumberFields.ForRecord(access.Project.Code), "RV", cancellationToken);
        var now = clock.GetCurrentInstant();
        var review = new Review
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            DocumentId = document.Id,
            RevisionId = revision.Id,
            Number = number,
            RouteName = route.Name,
            VerdictSet = route.VerdictSet ?? ReviewSets.Verdicts,
            StartedById = access.UserId,
            StartedByName = access.UserName,
            StartedAt = now,
            Steps = route.Steps.Select((s, i) =>
            {
                var party = s.PartyCode is null ? null : parties[s.PartyCode];
                return new ReviewStep
                {
                    TenantId = access.Project.TenantId,
                    Index = i,
                    Title = s.Title,
                    FunctionCode = party is null ? s.FunctionCode : null,
                    // A route stored before steps named people has no list at all: none named.
                    UserIds = party is null ? s.UserIds ?? [] : [],
                    PartyId = party?.Id,
                    PartyName = party?.Name,
                    Participation = party?.Participation,
                    Reason = party is null ? null : s.Reason,
                    // One of ours records the party's single answer.
                    Mode = party?.Participation == Participations.ByProxy ? StepModes.Any : s.Mode,
                    Deciding = i == route.Steps.Count - 1,
                    Days = s.Days,
                    GrantsStatuses = s.GrantsStatuses ?? [],
                };
            }).ToList(),
        };
        db.Reviews.Add(review);
        await OpenStepAsync(access, review, 0, cancellationToken);

        revision.State = RevisionStates.InReview;
        // Under review, a revision with no purpose yet is issued for review: each step confirms it or changes it.
        if (revision.StatusCode is null && catalog.IsActive(ReviewSets.Statuses, "IFR")) revision.StatusCode = "IFR";
        document.LatestRevisionState = RevisionStates.InReview;
        document.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor(access), "REVIEW_STARTED", "Review", review.Id, review.Number,
            $"{document.Number} rev {revision.Value} sent for review on route {route.Name}"
            + (chosenBySender.Count > 0 ? $", the sender choosing the people on {string.Join(", ", chosenBySender)}." : "."), access.Project.Id, cancellationToken);
        return (review, null);
    }

    // ── Comments ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Adds a comment from someone on the open step. The class must be published; its <c>blocking</c> property decides whether the comment blocks release.
    /// For a party answering by proxy, the step must have been dispatched first and the author name records both the party and who typed it.
    /// </summary>
    public async Task<(ReviewComment? Comment, IResult? Problem)> CommentAsync(
        ProjectAccess access, Guid reviewId, CommentRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        var step = OpenStep(review);
        var seat = review.State == ReviewStates.InProgress && step is not null ? await SeatAsync(review, step, access, cancellationToken) : null;
        if (step is null || seat is null)
        {
            return (null, Problems.Forbidden("NOT_ON_OPEN_STEP", "Only the people on the step that is open comment on it."));
        }
        if (seat.AnsweredAt is not null) return (null, Problems.Conflict("ALREADY_ANSWERED", "This step is answered: what it says is settled."));
        if (step.ByProxy && step.DispatchedAt is null) return (null, NotDispatched(step));
        var text = request.Text?.Trim() ?? "";
        if (text.Length == 0) return (null, Problems.Invalid("COMMENT_EMPTY", "A comment needs words."));

        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var classCode = request.Class ?? "";
        if (!catalog.IsActive(ReviewSets.CommentClasses, classCode))
        {
            return (null, Problems.Invalid("VALUE_NOT_PUBLISHED", $"{classCode} is not a published comment class.",
                new { field = "class", value = classCode }));
        }
        var blocking = catalog.Prop(ReviewSets.CommentClasses, classCode, "blocking") is { ValueKind: JsonValueKind.True };
        // A reservation another party settles: "approved, under reserve of the architect".
        if (request.ClosesWithStep is { } later && (later <= step.Index + 1 || later > review.Steps.Count))
        {
            return (null, Problems.Invalid("CLOSING_STEP_INVALID", "A comment can only be settled by a later step of this route."));
        }

        var comment = new ReviewComment
        {
            TenantId = review.TenantId,
            ReviewId = review.Id,
            StepIndex = step.Index,
            AuthorId = access.UserId,
            // A party's comment, written down by one of ours: both are said.
            AuthorName = step.ByProxy ? $"{step.PartyName} (recorded by {access.UserName})"
                : seat.UserId == access.UserId ? access.UserName : $"{access.UserName} for {seat.UserName}",
            Text = text,
            Class = classCode,
            Blocking = blocking,
            ClosesWith = request.ClosesWithStep is null ? CommentClosure.Revision : CommentClosure.Step,
            ClosesWithStep = request.ClosesWithStep,
            CreatedAt = clock.GetCurrentInstant(),
        };
        db.ReviewComments.Add(comment);
        await db.SaveChangesAsync(cancellationToken);
        return (comment, null);
    }

    /// <summary>Closes an open comment with a resolution. Only its author or Document Control may close it. Returns null on success, or the problem.</summary>
    public async Task<IResult?> CloseCommentAsync(
        ProjectAccess access, Guid reviewId, Guid commentId, CloseCommentRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        var comment = review?.Comments.SingleOrDefault(c => c.Id == commentId);
        if (review is null || comment is null) return NotFound();
        if (comment.Status != CommentStatuses.Open) return Problems.Conflict("COMMENT_CLOSED", "The comment is already closed.");
        if (comment.AuthorId != access.UserId && !await HoldsControlAsync(access, review, cancellationToken))
        {
            return Problems.Forbidden("CLOSE_NOT_ALLOWED", "Its author or Document Control closes a comment.");
        }
        var resolution = request.Resolution?.Trim() ?? "";
        if (resolution.Length == 0) return Problems.Invalid("RESOLUTION_REQUIRED", "Say how the comment was settled.");

        Close(comment, resolution, access.UserName);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor(access), "COMMENT_CLOSED", "Review", review.Id, review.Number, resolution,
            review.ProjectId, cancellationToken);
        return null;
    }

    /// <summary>
    /// Changes a comment its author wrote, while the step it was written on is open
    /// and their seat has not answered: until then it is a draft, afterwards a record.
    /// The words it had are kept in the audit trail.
    /// </summary>
    public async Task<IResult?> EditCommentAsync(
        ProjectAccess access, Guid reviewId, Guid commentId, CommentRequest request, CancellationToken cancellationToken)
    {
        var (review, comment, problem) = await DraftCommentAsync(access, reviewId, commentId, "changed", cancellationToken);
        if (problem is not null) return problem;
        var text = request.Text?.Trim() ?? "";
        if (text.Length == 0) return Problems.Invalid("COMMENT_EMPTY", "A comment says something: write it, or take it back.");
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var classCode = request.Class ?? comment!.Class;
        if (!catalog.IsActive(ReviewSets.CommentClasses, classCode))
        {
            return Problems.Invalid("VALUE_NOT_PUBLISHED", $"{classCode} is not a published comment class.", new { field = "class", value = classCode });
        }
        var was = comment!.Text;
        comment.Text = text;
        comment.Class = classCode;
        comment.Blocking = catalog.Prop(ReviewSets.CommentClasses, classCode, "blocking") is { ValueKind: JsonValueKind.True };
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor(access), "COMMENT_CHANGED", "Review", review!.Id, review.Number,
            $"Before the step was answered. It said: \"{Clip(was)}\"", review.ProjectId, cancellationToken);
        return null;
    }

    /// <summary>Takes a comment back, on the same terms as changing it. It is kept, marked withdrawn, and no longer shown or counted.</summary>
    public async Task<IResult?> WithdrawCommentAsync(ProjectAccess access, Guid reviewId, Guid commentId, CancellationToken cancellationToken)
    {
        var (review, comment, problem) = await DraftCommentAsync(access, reviewId, commentId, "taken back", cancellationToken);
        if (problem is not null) return problem;
        comment!.Status = CommentStatuses.Withdrawn;
        comment.ClosedAt = clock.GetCurrentInstant();
        comment.ClosedByName = access.UserName;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor(access), "COMMENT_WITHDRAWN", "Review", review!.Id, review.Number,
            $"Taken back before the step was answered: \"{Clip(comment.Text)}\"", review.ProjectId, cancellationToken);
        return null;
    }

    /// <summary>The comment, when the caller wrote it and it is still a draft: its step open, their seat not answered.</summary>
    private async Task<(Review? Review, ReviewComment? Comment, IResult? Problem)> DraftCommentAsync(
        ProjectAccess access, Guid reviewId, Guid commentId, string act, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        var comment = review?.Comments.SingleOrDefault(c => c.Id == commentId && c.Status != CommentStatuses.Withdrawn);
        if (review is null || comment is null) return (null, null, NotFound());
        if (comment.AuthorId != access.UserId) return (null, null, Problems.Forbidden("NOT_AUTHOR", $"A comment is {act} by whoever wrote it."));
        var step = OpenStep(review);
        var seat = review.State == ReviewStates.InProgress && step is not null && step.Index == comment.StepIndex
            ? await SeatAsync(review, step, access, cancellationToken) : null;
        if (seat is null || seat.AnsweredAt is not null || comment.Status != CommentStatuses.Open)
        {
            return (null, null, Problems.Conflict("COMMENT_GIVEN",
                $"This step has been answered. A comment in the record is settled by closing it with a resolution, not {act}."));
        }
        return (review, comment, null);
    }

    private static string Clip(string text) => text.Length <= 200 ? text : text[..200] + "…";

    // ── Answers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Records the caller's answer on the open step. On the deciding step the answer is a verdict (plus a status if it lets the revision proceed, and optionally who receives it once released);
    /// on an advising step the answer is worked out from the caller's comments. Completes the step when everyone needed has answered.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> AnswerAsync(
        ProjectAccess access, Guid reviewId, AnswerRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        var step = OpenStep(review);
        var seat = review.State == ReviewStates.InProgress && step is not null ? await SeatAsync(review, step, access, cancellationToken) : null;
        if (step is null || seat is null)
        {
            return (null, Problems.Forbidden("NOT_ON_OPEN_STEP", "Only the people on the step that is open answer it."));
        }
        if (seat.AnsweredAt is not null) return (null, Problems.Conflict("ALREADY_ANSWERED", "You have answered this step."));
        if (step.ByProxy)
        {
            if (step.DispatchedAt is null) return (null, NotDispatched(step));
            var evidenceRequired = await db.Parties.AsNoTracking().Where(p => p.Id == step.PartyId)
                .Select(p => p.EvidenceRequired).SingleAsync(cancellationToken);
            if (evidenceRequired && request.EvidenceFileId is null)
            {
                return (null, Problems.Invalid("EVIDENCE_REQUIRED",
                    $"An answer recorded for {step.PartyName} carries its proof: their stamped copy, or the message that brought it."));
            }
        }

        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        string answer;
        string? granted = null;
        if (step.Deciding)
        {
            answer = request.Verdict ?? "";
            if (!catalog.IsActive(review.VerdictSet, answer))
            {
                return (null, Problems.Invalid("VALUE_NOT_PUBLISHED", $"{answer} is not a published verdict.",
                    new { field = "verdict", value = answer }));
            }
            if (Proceeds(catalog, review.VerdictSet, answer) && review.IssueRequestId is null)
            {
                granted = request.Status ?? "";
                if (!catalog.IsActive(ReviewSets.Statuses, granted))
                {
                    return (null, Problems.Invalid("STATUS_REQUIRED",
                        "A verdict that lets the revision proceed names the status it will be released at.",
                        new { field = "status", value = granted }));
                }
                if (step.GrantsStatuses.Length > 0 && !step.GrantsStatuses.Contains(granted))
                {
                    return (null, Problems.Invalid("STATUS_NOT_GRANTABLE",
                        $"This step may grant {string.Join(", ", step.GrantsStatuses)}, not {granted}.",
                        new { allowed = step.GrantsStatuses }));
                }
                var other = step.Participants.FirstOrDefault(p => p.GrantedStatus is not null && p.GrantedStatus != granted);
                if (other is not null)
                {
                    return (null, Problems.Conflict("STATUS_DISAGREES",
                        $"{other.UserName} granted {other.GrantedStatus}; the deciders must agree on one status.",
                        new { granted = other.GrantedStatus }));
                }
            }
        }
        else
        {
            // The adviser picks from the published advice set. What they wrote sets the
            // floor: advice may not say less than their comments do.
            var mine = review.Comments.Where(c => c.StepIndex == step.Index && c.Status != CommentStatuses.Withdrawn
                && (c.AuthorId == access.UserId || c.AuthorId == seat.UserId)).ToList();
            var kind = mine.Any(c => c.Blocking) ? Advice_Blocking : mine.Count > 0 ? Advice_Some : Advice_None;
            answer = string.IsNullOrWhiteSpace(request.Verdict) ? AdviceCode(catalog, kind) : request.Verdict;
            if (!catalog.IsActive(ReviewSets.Advice, answer) && answer != AdviceCode(catalog, kind))
            {
                return (null, Problems.Invalid("VALUE_NOT_PUBLISHED", $"{answer} is not published advice.",
                    new { field = "verdict", value = answer }));
            }
            var severity = new[] { Advice_None, Advice_Some, Advice_Blocking };
            if (Array.IndexOf(severity, AdviceKind(catalog, answer)) < Array.IndexOf(severity, kind))
            {
                return (null, Problems.Invalid("ADVICE_BELOW_COMMENTS",
                    $"Your comments say {AdviceCode(catalog, kind)}; your advice cannot say less than they do.",
                    new { field = "verdict", floor = AdviceCode(catalog, kind) }));
            }
            // What the revision is issued for, as this adviser sees it: kept, or changed.
            // It is carried to the next step, which confirms it or changes it again.
            if (!string.IsNullOrWhiteSpace(request.Status))
            {
                if (!catalog.IsActive(ReviewSets.Statuses, request.Status))
                {
                    return (null, Problems.Invalid("VALUE_NOT_PUBLISHED", $"{request.Status} is not a published status.",
                        new { field = "status", value = request.Status }));
                }
                granted = request.Status;
            }
        }

        // Who it goes to once released: offered to whoever decides, because they are
        // the likeliest to know. Leaving it out is an answer too.
        IssueRequest? issue = null;
        if (request.Issue is not null)
        {
            if (!step.Deciding || granted is null)
            {
                return (null, Problems.Invalid("ISSUE_ONLY_WITH_DECISION",
                    "Who receives it is asked with a decision that lets the revision out."));
            }
            var (document, revision) = await SubjectAsync(review, cancellationToken);
            var (asked, problem) = await transmittals.NewRequestAsync(access, document, revision, request.Issue, cancellationToken);
            if (problem is not null) return (null, problem);
            issue = asked;
        }
        if (request.EvidenceFileId is { } evidence)
        {
            if (!step.ByProxy) return (null, Problems.Invalid("EVIDENCE_ONLY_BY_PROXY", "Proof is filed with an answer recorded for a party."));
            if (await transmittals.BindEvidenceAsync(access, evidence, review.RevisionId, cancellationToken) is { } bad) return (null, bad);
        }

        var now = clock.GetCurrentInstant();
        seat.Answer = answer;
        seat.GrantedStatus = granted;
        if (!step.Deciding && granted is not null)
        {
            var (_, subject) = await SubjectAsync(review, cancellationToken);
            subject.StatusCode = granted;
        }
        seat.Note = request.Note?.Trim();
        seat.AnsweredAt = now;
        var stoodIn = seat.UserId != access.UserId;
        if (stoodIn)
        {
            seat.AnsweredById = access.UserId;
            seat.AnsweredByName = access.UserName;
        }
        if (step.ByProxy)
        {
            step.ForeignAnswer = request.ForeignAnswer?.Trim() is { Length: > 0 } theirs ? theirs : null;
            step.RecordedByName = access.UserName;
            step.EvidenceFileId = request.EvidenceFileId;
        }
        if (issue is not null)
        {
            db.IssueRequests.Add(issue);
            // Saved now, so a release this answer brings about carries it out.
            await db.SaveChangesAsync(cancellationToken);
            if (await OpenApprovalAsync(access, issue, cancellationToken) is { } approvalProblem) return (null, approvalProblem);
        }
        await audit.WriteAsync(Actor(access), step.Deciding ? "VERDICT" : "ADVICE", "Review", review.Id, review.Number,
            $"Step {step.Index + 1} ({step.Title}): {answer}{(granted is null ? "" : step.Deciding ? $", granting {granted}" : $", issued for {granted}")}"
            + (stoodIn ? $", answered for {seat.UserName}, who handed the step over" : "")
            + (step.ByProxy ? $", recorded for {step.PartyName}{(step.ForeignAnswer is null ? "" : $" who wrote \"{step.ForeignAnswer}\"")}." : "."),
            review.ProjectId, cancellationToken);

        var complete = step.Mode == StepModes.Any || step.Participants.All(p => p.AnsweredAt is not null);
        if (complete)
        {
            await CompleteStepAsync(access, review, step, catalog, cancellationToken);
        }
        await db.SaveChangesAsync(cancellationToken);
        return (review, null);
    }

    /// <summary>
    /// Closes a step once answered: works out the step's answer (the most restrictive verdict, or the most severe advice), closes comments this step was named to settle, and opens the next step.
    /// After the deciding step the review becomes decided; if the project has nobody with the Document Control role, it is released or returned automatically. Called by <see cref="AnswerAsync"/>.
    /// </summary>
    private async Task CompleteStepAsync(
        ProjectAccess access, Review review, ReviewStep step, Catalog catalog, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var answered = step.Participants.Where(p => p.AnsweredAt is not null).OrderBy(p => p.AnsweredAt).ToList();
        step.State = StepStates.Done;
        step.CompletedAt = now;
        if (step.Deciding)
        {
            // Several deciders: the most restrictive verdict binds.
            var binding = answered.FirstOrDefault(p => !Proceeds(catalog, review.VerdictSet, p.Answer!)) ?? answered[^1];
            step.Answer = binding.Answer;
            review.Verdict = binding.Answer;
            review.GrantedStatus = Proceeds(catalog, review.VerdictSet, binding.Answer!) ? binding.GrantedStatus : null;
        }
        else
        {
            var severity = new[] { Advice_None, Advice_Some, Advice_Blocking };
            step.Answer = answered.Select(p => p.Answer!)
                .MaxBy(code => Array.IndexOf(severity, AdviceKind(catalog, code))) ?? AdviceCode(catalog, Advice_None);
        }

        // Reservations this step was named to settle close themselves, unless it objected.
        var settles = step.Deciding ? Proceeds(catalog, review.VerdictSet, step.Answer!) : AdviceKind(catalog, step.Answer!) != Advice_Blocking;
        if (settles)
        {
            foreach (var c in review.Comments.Where(c => c.Status == CommentStatuses.Open
                && c.ClosesWith == CommentClosure.Step && c.ClosesWithStep == step.Index + 1))
            {
                Close(c, $"Settled by step {step.Index + 1} ({step.Title}).", "System");
            }
        }

        if (!step.Deciding)
        {
            await OpenStepAsync(access, review, step.Index + 1, cancellationToken);
            return;
        }
        if (review.IssueRequestId is not null)
        {
            await SettleApprovalAsync(access, review, catalog, cancellationToken);
            return;
        }

        review.State = ReviewStates.Decided;
        review.DecidedAt = now;
        await audit.WriteAsync(Audit.Actor.System, "REVIEW_DECIDED", "Review", review.Id, review.Number,
            $"Verdict {review.Verdict}{(review.GrantedStatus is null ? "" : $", granting {review.GrantedStatus}")}.",
            review.ProjectId, cancellationToken);
        // Whoever started it, and Document Control, who acts on the decision next.
        var (decidedDocument, decidedRevision) = await SubjectAsync(review, cancellationToken);
        var controllers = await db.Memberships.AsNoTracking()
            .Where(m => m.ProjectId == review.ProjectId && m.Active && m.Function!.Active && m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control)))
            .Select(m => m.UserId).ToListAsync(cancellationToken);
        await TellAsync(review, [review.StartedById, decidedRevision.AuthoredById, .. controllers], Notifications.NotificationKinds.ReviewDecided,
            $"{TransmittalService.Label(decidedDocument, decidedRevision)} decided: {review.Verdict}",
            $"Review {review.Number}{(review.GrantedStatus is null ? "" : $" grants {review.GrantedStatus}")}.", cancellationToken);

        // Where nobody holds the control function, the people doing the work take
        // its acts: a verdict that proceeds releases, one that does not returns.
        if (await ControlHoldersAsync(access.Project.Id, cancellationToken) > 0) return;
        if (!Proceeds(catalog, review.VerdictSet, review.Verdict!))
        {
            await ReturnToAuthorAsync(review, $"Verdict {review.Verdict}.", "System", cancellationToken);
        }
        else if (!review.Comments.Any(c => c.Blocking && c.Status == CommentStatuses.Open)
            && await ApprovalOwedAsync(review.RevisionId, cancellationToken) is null)
        {
            await ReleaseCoreAsync(access, review, review.GrantedStatus!, "System", cancellationToken);
        }
    }

    // ── Not reviewed ──────────────────────────────────────────────────────────

    /// <summary>
    /// A revision of a document type the organization does not review (its
    /// published <c>review</c> property is false) goes from preparation straight to
    /// release. Whoever would have sent it for review settles its status here, and
    /// who receives it. It waits for Document Control as a decided review would, on
    /// a review with no steps; where nobody holds that function, it is released at once.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> SendOnAsync(
        ProjectAccess access, Guid revisionId, SendOnRequest request, CancellationToken cancellationToken)
    {
        var revision = await db.Revisions.Include(r => r.Files).SingleOrDefaultAsync(r => r.Id == revisionId, cancellationToken);
        var document = revision is null ? null : await VisibleDocumentAsync(access, revision.DocumentId, cancellationToken);
        if (revision is null || document is null) return Fail(Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        if (!access.Allows(Verbs.Create, document.Facts) && !access.Allows(Verbs.Revise, document.Facts)
            && revision.AuthoredById != access.UserId && !access.Allows(Verbs.Control, document.Facts))
        {
            return Fail(Problems.Forbidden("SEND_ON_NOT_ALLOWED", "Only the author, someone who may revise it, or Document Control sends it on."));
        }
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        if (catalog.Prop(ValueSets.DocumentTypes, document.DocType, "review") is not { ValueKind: JsonValueKind.False })
        {
            return Fail(Problems.Conflict("TYPE_IS_REVIEWED", $"{document.DocType} is reviewed before release: send it for review.",
                new { docType = document.DocType }));
        }
        if (revision.State != RevisionStates.InPreparation)
        {
            return Fail(Problems.Conflict("REVISION_NOT_IN_PREPARATION",
                $"Revision {revision.Value} is {Words(revision.State)}; only a revision in preparation is sent on.", new { state = revision.State }));
        }
        if (revision.FilesState != FilesStates.Ready)
        {
            return Fail(Problems.Conflict("FILES_NOT_READY", "The revision's files have not all passed scanning.", new { filesState = revision.FilesState }));
        }
        if (!revision.Files.Any(f => f.Kind == FileKinds.Rendition && f.Status == FileStatuses.Clean && f.Submission == revision.Submission))
        {
            return Fail(Problems.Conflict("NO_RENDITION", "Attach the file first: a PDF is what is released."));
        }
        var status = request.Status?.Trim() ?? "";
        if (!catalog.IsActive(ReviewSets.Statuses, status))
        {
            return Fail(Problems.Invalid("STATUS_REQUIRED", "Choose the status it is released at.", new { field = "status", value = status }));
        }
        if (request.Issue is not null)
        {
            var (asked, problem) = await transmittals.NewRequestAsync(access, document, revision, request.Issue, cancellationToken);
            if (problem is not null) return Fail(problem);
            db.IssueRequests.Add(asked!);
            await db.SaveChangesAsync(cancellationToken);
            if (await OpenApprovalAsync(access, asked!, cancellationToken) is { } approvalProblem) return Fail(approvalProblem);
        }

        var now = clock.GetCurrentInstant();
        var review = new Review
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            DocumentId = document.Id,
            RevisionId = revision.Id,
            Number = await numbering.RecordAsync(access.Project.TenantId, access.Project.Id, RecordKinds.Review,
                NumberFields.ForRecord(access.Project.Code), "RV", cancellationToken),
            RouteName = "Not reviewed",
            State = ReviewStates.Decided,
            GrantedStatus = status,
            StartedById = access.UserId,
            StartedByName = access.UserName,
            StartedAt = now,
            DecidedAt = now,
        };
        db.Reviews.Add(review);
        revision.State = RevisionStates.InReview;
        document.LatestRevisionState = RevisionStates.InReview;
        document.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor(access), "SENT_FOR_RELEASE", "Revision", revision.Id, $"{document.Number} rev {revision.Value}",
            $"Not reviewed: document type {document.DocType} goes from preparation straight to release, at {status}.",
            access.Project.Id, cancellationToken);

        var controllers = await notifier.ControlHoldersAsync(access.Project.Id, cancellationToken);
        if (controllers.Count == 0 && await ApprovalOwedAsync(revision.Id, cancellationToken) is null)
        {
            await ReleaseCoreAsync(access, review, status, "System", cancellationToken);
        }
        else
        {
            await TellAsync(review, controllers, Notifications.NotificationKinds.ReviewDecided,
                $"{TransmittalService.Label(document, revision)} is ready to release at {status}",
                $"{document.DocType} is not reviewed; {access.UserName} sent it on.", cancellationToken, $"/documents/{document.Id}");
        }
        await db.SaveChangesAsync(cancellationToken);
        return (review, null);
    }

    // ── An outside approval, and holds ────────────────────────────────────────

    /// <summary>
    /// An issue request asked an outside party to approve the revision first. Their
    /// approval is a review of one step, theirs, carried like any party's step. A
    /// revision awaiting release is not released until they answer; one already
    /// released is put on hold, not for use, and whoever received it is told.
    /// Returns the problem, or null.
    /// </summary>
    public async Task<IResult?> OpenApprovalAsync(ProjectAccess access, IssueRequest request, CancellationToken cancellationToken)
    {
        if (request.ApproverPartyId is not { } partyId) return null;
        var party = await db.Parties.AsNoTracking().SingleAsync(p => p.Id == partyId, cancellationToken);
        var revision = await db.Revisions.SingleAsync(r => r.Id == request.RevisionId, cancellationToken);
        var document = await db.Documents.SingleAsync(d => d.Id == request.DocumentId, cancellationToken);
        if ((await SeatsAsync(access.Project, null, party, party.Participation, cancellationToken)).Count == 0)
        {
            return Problems.Invalid("APPROVER_HAS_NOBODY", party.Participation == Participations.InApp
                ? $"Nobody from {party.Name} is on this project, so their approval could not be asked."
                : $"Nobody on this project carries the exchange with {party.Name}, so their approval could not be asked.");
        }
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var now = clock.GetCurrentInstant();
        var review = new Review
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            DocumentId = document.Id,
            RevisionId = revision.Id,
            Number = await numbering.RecordAsync(access.Project.TenantId, access.Project.Id, RecordKinds.Review,
                NumberFields.ForRecord(access.Project.Code), "RV", cancellationToken),
            RouteName = $"Approval by {party.Name}",
            StartedById = access.UserId,
            StartedByName = access.UserName,
            StartedAt = now,
            IssueRequestId = request.Id,
            Steps =
            [
                new ReviewStep
                {
                    TenantId = access.Project.TenantId,
                    Index = 0,
                    Title = $"Approval by {party.Name}",
                    PartyId = party.Id,
                    PartyName = party.Name,
                    Participation = party.Participation,
                    Reason = catalog.IsActive(TransmittalSets.Reasons, "APPROVAL") ? "APPROVAL" : request.Reason,
                    Mode = StepModes.Any,
                    Deciding = true,
                },
            ],
        };
        db.Reviews.Add(review);
        await OpenStepAsync(access, review, 0, cancellationToken);
        var label = TransmittalService.Label(document, revision);
        await audit.WriteAsync(Actor(access), "OUTSIDE_APPROVAL_ASKED", "Revision", revision.Id, label,
            $"{party.Name} approves it before it is used, on review {review.Number}.", access.Project.Id, cancellationToken);
        if (revision.State == RevisionStates.Released && revision.HeldAt is null)
        {
            revision.HeldAt = now;
            revision.HeldReason = $"Awaiting approval by {party.Name}.";
            revision.HeldByName = access.UserName;
            db.Enqueue(RevisionMarked.RoutingKey, new RevisionMarked(revision.TenantId, revision.Id, FileKinds.Held, revision.HeldReason));
            await audit.WriteAsync(Actor(access), "REVISION_HELD", "Revision", revision.Id, label,
                $"On hold, not for use: {revision.HeldReason}", access.Project.Id, cancellationToken);
            await notifier.NotifyAsync(document.TenantId, document.ProjectId, await ReceivedByAsync(revision.Id, cancellationToken),
                Notifications.NotificationKinds.General, $"{label} is on hold: not for use",
                $"{revision.HeldReason} Do not work from the copy you were sent until you are told the hold is lifted.",
                $"/documents/{document.Id}", cancellationToken);
        }
        await db.SaveChangesAsync(cancellationToken);
        return null;
    }

    /// <summary>
    /// The party answered. Approved: what was asked is an ordinary request again, and
    /// Document Control releases (or lifts the hold); where nobody holds that function,
    /// that happens now. Not approved: release stays blocked until it is sent back.
    /// </summary>
    private async Task SettleApprovalAsync(ProjectAccess access, Review review, Catalog catalog, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var request = await db.IssueRequests.SingleAsync(r => r.Id == review.IssueRequestId, cancellationToken);
        var party = review.Steps[0].PartyName ?? "The outside party";
        var approved = Proceeds(catalog, review.VerdictSet, review.Verdict!);
        review.DecidedAt = now;
        review.ClosedAt = now;
        review.ClosedByName = "System";
        review.State = approved ? ReviewStates.Released : ReviewStates.Returned;
        if (!approved) review.ReturnNote = $"{party} did not approve it ({review.Verdict}).";
        request.ApprovalState = approved ? ApprovalStates.Approved : ApprovalStates.Refused;
        if (approved && !request.Delegated && request.UserIds.Length + request.PartyIds.Length == 0)
        {
            // Asked only for the approval: answered.
            request.Status = IssueRequestStatuses.Done;
            request.ClosedAt = now;
            request.ClosedByName = "System";
        }
        var (document, revision) = await SubjectAsync(review, cancellationToken);
        var label = TransmittalService.Label(document, revision);
        var next = approved ? revision.HeldAt is null ? "release and issue it" : "lift the hold" : "send it back";
        await audit.WriteAsync(Audit.Actor.System, approved ? "OUTSIDE_APPROVED" : "OUTSIDE_REFUSED", "Revision", revision.Id, label,
            $"{party} {(approved ? "approved it" : "did not approve it")} ({review.Verdict}), with Document Control to {next}.",
            review.ProjectId, cancellationToken);
        var controllers = await notifier.ControlHoldersAsync(review.ProjectId, cancellationToken);
        await TellAsync(review, controllers, Notifications.NotificationKinds.ReviewDecided,
            $"{party} {(approved ? "approved" : "did not approve")} {label}", $"Yours to {next}.", cancellationToken, $"/documents/{document.Id}");
        await db.SaveChangesAsync(cancellationToken);
        if (controllers.Count > 0 || !approved) return;

        if (revision.HeldAt is not null)
        {
            if (await ApprovalOwedAsync(revision.Id, cancellationToken) is null) await LiftCoreAsync(access, revision, document, "System", cancellationToken);
            return;
        }
        var main = await db.Reviews.Include(r => r.Comments)
            .SingleOrDefaultAsync(r => r.RevisionId == revision.Id && r.State == ReviewStates.Decided && r.IssueRequestId == null, cancellationToken);
        if (main is not null && (main.Verdict is null || Proceeds(catalog, main.VerdictSet, main.Verdict))
            && !main.Comments.Any(c => c.Blocking && c.Status == CommentStatuses.Open)
            && await ApprovalOwedAsync(revision.Id, cancellationToken) is null)
        {
            await ReleaseCoreAsync(access, main, main.GrantedStatus!, "System", cancellationToken);
        }
    }

    /// <summary>Why the revision may not be released (or its hold lifted) yet for want of an outside approval; null when none is owed.</summary>
    private async Task<IResult?> ApprovalOwedAsync(Guid revisionId, CancellationToken cancellationToken)
    {
        var owed = await (from r in db.IssueRequests
                          join p in db.Parties on r.ApproverPartyId equals p.Id
                          where r.RevisionId == revisionId && r.Status == IssueRequestStatuses.Open
                              && (r.ApprovalState == ApprovalStates.Waiting || r.ApprovalState == ApprovalStates.Refused)
                          orderby r.RaisedAt
                          select new { r.ApprovalState, p.Name }).FirstOrDefaultAsync(cancellationToken);
        if (owed is null) return null;
        return owed.ApprovalState == ApprovalStates.Refused
            ? Problems.Conflict("OUTSIDE_REFUSED", $"{owed.Name} did not approve this revision. Send it back.")
            : Problems.Conflict("AWAITING_OUTSIDE_APPROVAL",
                $"{owed.Name} has to approve this revision first. Document Control releases and issues it when their answer comes back.");
    }

    /// <summary>The revision is going back: an outside approval still being asked for it ends.</summary>
    private async Task CloseApprovalsAsync(Guid revisionId, Guid except, string by, CancellationToken cancellationToken)
    {
        var open = await db.Reviews.Include(r => r.Steps)
            .Where(r => r.RevisionId == revisionId && r.IssueRequestId != null && r.Id != except && r.State == ReviewStates.InProgress)
            .ToListAsync(cancellationToken);
        foreach (var approval in open)
        {
            approval.State = ReviewStates.Returned;
            approval.ClosedAt = clock.GetCurrentInstant();
            approval.ClosedByName = by;
            approval.ReturnNote = "Closed: the revision went back.";
            foreach (var step in approval.Steps.Where(s => s.State == StepStates.Open)) step.State = StepStates.Done;
        }
    }

    /// <summary>
    /// The outside approval came back yes: Document Control lifts the hold, the
    /// revision is in use again, and whatever was asked for it is sent.
    /// </summary>
    public async Task<IResult?> LiftHoldAsync(ProjectAccess access, Guid revisionId, CancellationToken cancellationToken)
    {
        var (revision, document, problem) = await HeldAsync(access, revisionId, "lifts a hold", cancellationToken);
        if (problem is not null) return problem;
        if (await ApprovalOwedAsync(revision!.Id, cancellationToken) is { } owed) return owed;
        if (await db.IssueRequests.AnyAsync(r => r.RevisionId == revision.Id && r.ApprovalState == ApprovalStates.Refused
            && r.Status == IssueRequestStatuses.Cancelled, cancellationToken))
        {
            return Problems.Conflict("HELD_FOR_GOOD", "It was not approved and was sent back: it stays on hold, not for use. The next revision replaces it.");
        }
        await LiftCoreAsync(access, revision, document!, access.UserName, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return null;
    }

    /// <summary>
    /// The outside approval came back no: it stays on hold, not for use, for good —
    /// people hold copies, and the record says why they may not use them — and
    /// whoever it goes back to starts the next revision.
    /// </summary>
    public async Task<IResult?> ReturnHeldAsync(ProjectAccess access, Guid revisionId, string? reason, CancellationToken cancellationToken)
    {
        var (revision, document, problem) = await HeldAsync(access, revisionId, "sends a held revision back", cancellationToken);
        if (problem is not null) return problem;
        var why = reason?.Trim() ?? "";
        if (why.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it is going back: whoever gets it has to know what to do.");
        var now = clock.GetCurrentInstant();
        revision!.HeldReason = $"Not approved outside: {why}";
        foreach (var request in await db.IssueRequests.Where(r => r.RevisionId == revision.Id && r.Status == IssueRequestStatuses.Open)
            .ToListAsync(cancellationToken))
        {
            if (request.ApprovalState is not null) request.ApprovalState = ApprovalStates.Refused;
            request.Status = IssueRequestStatuses.Cancelled;
            request.ClosedAt = now;
            request.ClosedByName = access.UserName;
        }
        // Marks it held for good even where no approval request was ever refused.
        if (!await db.IssueRequests.AnyAsync(r => r.RevisionId == revision.Id && r.ApprovalState == ApprovalStates.Refused, cancellationToken))
        {
            var marker = await db.IssueRequests.Where(r => r.RevisionId == revision.Id && r.ApproverPartyId != null)
                .OrderByDescending(r => r.RaisedAt).FirstOrDefaultAsync(cancellationToken);
            if (marker is not null) marker.ApprovalState = ApprovalStates.Refused;
        }
        await CloseApprovalsAsync(revision.Id, Guid.Empty, access.UserName, cancellationToken);
        var label = TransmittalService.Label(document!, revision);
        await audit.WriteAsync(Actor(access), "HELD_RETURNED", "Revision", revision.Id, label,
            $"Not approved outside, sent back: {why} It stays on hold, not for use.", access.Project.Id, cancellationToken);
        await notifier.NotifyAsync(document!.TenantId, document.ProjectId, await ReceivedByAsync(revision.Id, cancellationToken),
            Notifications.NotificationKinds.General, $"{label} was not approved: still not for use",
            $"{why} It stays on hold, not for use; the next revision will replace it.", $"/documents/{document.Id}", cancellationToken);
        await notifier.NotifyAsync(document.TenantId, document.ProjectId, [revision.AuthoredById], Notifications.NotificationKinds.ReviewReturned,
            $"{label} was not approved outside: a new revision is needed", why, $"/documents/{document.Id}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return null;
    }

    private async Task<(Revision? Revision, Document? Document, IResult? Problem)> HeldAsync(
        ProjectAccess access, Guid revisionId, string act, CancellationToken cancellationToken)
    {
        var revision = await db.Revisions.SingleOrDefaultAsync(r => r.Id == revisionId && r.ProjectId == access.Project.Id, cancellationToken);
        var document = revision is null ? null : await VisibleDocumentAsync(access, revision.DocumentId, cancellationToken);
        if (revision is null || document is null) return (null, null, Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        var control = access.Allows(Verbs.Control, document.Facts)
            || (await ControlHoldersAsync(access.Project.Id, cancellationToken) == 0 && revision.AuthoredById == access.UserId);
        if (!control) return (null, null, Problems.Forbidden("CONTROL_ONLY", $"Document Control {act}."));
        if (revision.HeldAt is null) return (null, null, Problems.Conflict("NOT_HELD", "This revision is not on hold."));
        return (revision, document, null);
    }

    private async Task LiftCoreAsync(ProjectAccess access, Revision revision, Document document, string by, CancellationToken cancellationToken)
    {
        revision.HeldAt = null;
        revision.HeldReason = null;
        revision.HeldByName = null;
        var actor = by == "System" ? Audit.Actor.System : Actor(access);
        var label = TransmittalService.Label(document, revision);
        await audit.WriteAsync(actor, "REVISION_HOLD_LIFTED", "Revision", revision.Id, label,
            "Approved outside: the hold is lifted and it is in use again.", document.ProjectId, cancellationToken);
        await notifier.NotifyAsync(document.TenantId, document.ProjectId, await ReceivedByAsync(revision.Id, cancellationToken),
            Notifications.NotificationKinds.General, $"{label} is back in use",
            "The outside approval came back. The hold is lifted; the copy you were sent may be used again.", $"/documents/{document.Id}", cancellationToken);
        await transmittals.CarryOutOpenAsync(access.Project, actor, revision, document, cancellationToken);
    }

    /// <summary>Everybody of ours who was sent this revision on a transmittal.</summary>
    private Task<List<Guid>> ReceivedByAsync(Guid revisionId, CancellationToken cancellationToken) =>
        (from i in db.TransmittalItems
         join r in db.TransmittalRecipients on i.TransmittalId equals r.TransmittalId
         where i.RevisionId == revisionId && r.UserId != null
         select r.UserId!.Value).Distinct().ToListAsync(cancellationToken);

    // ── Document Control's acts ───────────────────────────────────────────────

    /// <summary>
    /// Document Control releases a decided review whose verdict lets the revision proceed, when no blocking comment is open, at the status the deciding step granted.
    /// Records Document Control's outcome on the revision. Called by the release endpoint.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> ReleaseAsync(
        ProjectAccess access, Guid reviewId, ReleaseRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        if (!await MayActForControlAsync(access, review, cancellationToken))
        {
            return (null, Problems.Forbidden("CONTROL_ONLY", "Releasing is Document Control's act."));
        }
        if (review.State != ReviewStates.Decided)
        {
            return (null, Problems.Conflict("REVIEW_NOT_DECIDED", "Only a decided review is released.", new { state = review.State }));
        }
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        if (review.Verdict is not null && !Proceeds(catalog, review.VerdictSet, review.Verdict))
        {
            return (null, Problems.Conflict("VERDICT_DOES_NOT_PROCEED",
                $"Verdict {review.Verdict} asks for changes: send the revision back instead.", new { verdict = review.Verdict }));
        }
        var open = review.Comments.Count(c => c.Blocking && c.Status == CommentStatuses.Open);
        if (open > 0)
        {
            return (null, Problems.Conflict("BLOCKING_COMMENTS_OPEN",
                $"{open} blocking comment(s) are open. They are settled before the release.", new { count = open }));
        }
        var status = request.Status ?? review.GrantedStatus!;
        if (status != review.GrantedStatus)
        {
            return (null, Problems.Conflict("STATUS_NOT_GRANTED",
                $"The deciding step granted {review.GrantedStatus}. Document Control releases what was decided.",
                new { granted = review.GrantedStatus }));
        }

        if (await ApprovalOwedAsync(review.RevisionId, cancellationToken) is { } owed) return (null, owed);
        var (outcome, outcomeProblem) = ControlService.Pick(catalog, request.Outcome, ControlService.Release);
        if (outcomeProblem is not null) return (null, outcomeProblem);
        await ReleaseCoreAsync(access, review, status, access.UserName, cancellationToken);
        control.Record(await db.Revisions.SingleAsync(r => r.Id == review.RevisionId, cancellationToken), outcome, null, access.UserName);
        await db.SaveChangesAsync(cancellationToken);
        return (review, null);
    }

    /// <summary>
    /// Document Control sends a review back: with no <c>ToStep</c>, the revision goes back to its author (replaced by a new revision if the verdict asked for changes or the outcome says so, otherwise corrected under the same revision);
    /// with a <c>ToStep</c>, the route restarts from that step. Called by the return endpoint.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> ReturnAsync(
        ProjectAccess access, Guid reviewId, ReturnRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        if (!await MayActForControlAsync(access, review, cancellationToken))
        {
            return (null, Problems.Forbidden("CONTROL_ONLY", "Sending a revision back is Document Control's act."));
        }
        if (review.State is not (ReviewStates.Decided or ReviewStates.InProgress))
        {
            return (null, Problems.Conflict("REVIEW_CLOSED", "The review is closed.", new { state = review.State }));
        }
        var note = request.Note?.Trim() ?? "";
        if (note.Length == 0) return (null, Problems.Invalid("NOTE_REQUIRED", "Say why it goes back."));

        if (request.ToStep is null)
        {
            // Whatever the verdict, a problem Document Control finds in the submission
            // comes back corrected under the same revision. A verdict that asked for
            // changes is different: what the document says must change, so the next
            // revision replaces it.
            var catalog = await Catalog.LoadAsync(db, cancellationToken);
            var changesAsked = review.State == ReviewStates.Decided && review.Verdict is not null && !Proceeds(catalog, review.VerdictSet, review.Verdict);
            var revision = await db.Revisions.SingleAsync(r => r.Id == review.RevisionId, cancellationToken);
            var fromOutside = revision.AuthoredByParty is { } party
                && await db.Parties.AnyAsync(p => p.Code == party && !p.IsInternal, cancellationToken);
            var (outcome, outcomeProblem) = ControlService.Pick(catalog, request.Outcome, ControlService.Return,
                newRevision: request.Outcome is null ? changesAsked : null, to: fromOutside ? "sender" : "initiator");
            if (outcomeProblem is not null) return (null, outcomeProblem);
            if (changesAsked && outcome is not null && !ControlService.NeedsNewRevision(catalog, outcome))
            {
                return (null, Problems.Conflict("VERDICT_NEEDS_NEW_REVISION",
                    $"Verdict {review.Verdict} asked for changes, so a new revision replaces this one. Choose an outcome that says so.",
                    new { verdict = review.Verdict, outcome }));
            }
            var newRevision = changesAsked || (outcome is not null && ControlService.NeedsNewRevision(catalog, outcome));
            if (newRevision) await ReturnToAuthorAsync(review, note, access.UserName, cancellationToken);
            else await ReturnForCorrectionAsync(review, note, access.UserName, cancellationToken);
            control.Record(revision, outcome, note, access.UserName);
        }
        else
        {
            var problem = await SendBackToStepAsync(access, review, request.ToStep.Value - 1, request.Reason, note,
                onlyAnswered: false, cancellationToken);
            if (problem is not null) return (null, problem);
        }
        await db.SaveChangesAsync(cancellationToken);
        return (review, null);
    }

    /// <summary>
    /// Whoever holds the open step may send the route back to a step that has
    /// already answered, never forward: a reviewer who opened the wrong file has
    /// somewhere to go other than answering falsely. It is recorded with their name.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> RewindAsync(
        ProjectAccess access, Guid reviewId, RewindRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        var step = OpenStep(review);
        if (review.State != ReviewStates.InProgress || step is null || await SeatAsync(review, step, access, cancellationToken) is null)
        {
            return (null, Problems.Forbidden("NOT_ON_OPEN_STEP", "Only the people on the step that is open send the route back."));
        }
        if (request.ToStep - 1 >= step.Index || request.ToStep < 1)
        {
            return (null, Problems.Invalid("REWIND_FORWARD", "The route goes back only to a step that has already answered."));
        }
        var problem = await SendBackToStepAsync(access, review, request.ToStep - 1, request.Reason, request.Note?.Trim() ?? "",
            onlyAnswered: true, cancellationToken);
        if (problem is not null) return (null, problem);
        await db.SaveChangesAsync(cancellationToken);
        return (review, null);
    }

    // ── A party answering by proxy ────────────────────────────────────────────

    /// <summary>
    /// One of ours records that the open step went to its party: when, how, their
    /// reference. The step's clock runs from here, and the transmittal that
    /// carried it is raised.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> DispatchAsync(
        ProjectAccess access, Guid reviewId, DispatchRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        var step = OpenStep(review);
        if (review.State != ReviewStates.InProgress || step is null || !step.ByProxy || await SeatAsync(review, step, access, cancellationToken) is null)
        {
            return (null, Problems.Forbidden("NOT_CUSTODIAN",
                "Whoever carries the exchange with the party on the open step records that it went."));
        }
        if (step.DispatchedAt is not null) return (null, Problems.Conflict("ALREADY_DISPATCHED", "It is already recorded as sent."));
        var channel = request.Channel?.Trim() ?? "";
        if (channel.Length == 0) return (null, Problems.Invalid("CHANNEL_REQUIRED", "Say how it went: email, their portal, by hand."));
        if (request.ProofFileId is { } proof
            && await transmittals.BindEvidenceAsync(access, proof, review.RevisionId, cancellationToken) is { } bad) return (null, bad);

        var project = access.Project;
        var party = await db.Parties.AsNoTracking().SingleAsync(p => p.Id == step.PartyId, cancellationToken);
        var (document, revision) = await SubjectAsync(review, cancellationToken);
        step.DispatchedAt = clock.GetCurrentInstant();
        step.DispatchChannel = channel;
        step.DispatchRef = request.Reference?.Trim() is { Length: > 0 } reference ? reference : null;
        step.DispatchedByName = access.UserName;
        step.DueDate = step.Days is { } days
            ? WorkingCalendar.AddWorkingDays(WorkingCalendar.Today(clock, project.TimeZone), days, project.WeekendDays) : null;
        var transmittal = await transmittals.RaiseAsync(new TransmittalService.Raise(project, Actor(access), step.Reason!,
            $"{TransmittalService.Label(document, revision)}: {step.Title}", null, party, party.Name, [(document, revision)],
            [new TransmittalService.Addressee(null, party.Id, party.Name, party.Name)], ReviewStepId: step.Id,
            ResponseDue: step.DueDate, Dispatched: request with { Channel = channel, Reference = step.DispatchRef }), cancellationToken);
        step.TransmittalId = transmittal.Id;
        await audit.WriteAsync(Actor(access), "STEP_DISPATCHED", "Review", review.Id, review.Number,
            $"Step {step.Index + 1} ({step.Title}) sent to {party.Name} by {channel} on {transmittal.Number}"
            + (step.DispatchRef is null ? "." : $", their reference {step.DispatchRef}."), review.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (review, null);
    }

    /// <summary>Somewhere to upload a party's proof: their stamped copy, the message that carried their answer.</summary>
    public async Task<(UploadTicket? Ticket, IResult? Problem)> EvidenceAsync(
        ProjectAccess access, Guid reviewId, UploadRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        var step = OpenStep(review);
        if (review.State != ReviewStates.InProgress || step is null || !step.ByProxy || await SeatAsync(review, step, access, cancellationToken) is null)
        {
            return (null, Problems.Forbidden("NOT_CUSTODIAN",
                "Whoever carries the exchange with the party on the open step files its proof."));
        }
        return await transmittals.EvidenceTicketAsync(access, review.DocumentId, review.RevisionId, request, cancellationToken);
    }

    // ── Queues ────────────────────────────────────────────────────────────────

    /// <summary>One entry in a person's review to-do list. <c>Kind</c> says what to do (for example ANSWER_STEP, DISPATCH_STEP, RECORD_ANSWER, READY_TO_RELEASE, SEND_BACK); <c>Since</c> is when it started waiting.</summary>
    /// <summary>
    /// One review waiting on someone. <c>Deciding</c>: their step gives the verdict (otherwise it is advice). On Document
    /// Control's gate, <c>Verdict</c> and <c>Status</c> are what the review decided and the status it grants.
    /// </summary>
    public sealed record WorkItem(Guid ReviewId, string Number, Guid DocumentId, string DocumentNumber, string Title,
        string RevisionValue, string Kind, string? StepTitle, DateOnly? DueDate, DateTimeOffset Since, bool Deciding = false,
        string? Verdict = null, string? Status = null);

    /// <summary>What this person has waiting: their open steps, and Document Control's gate.</summary>
    public async Task<object> WorkAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        var me = access.UserId;
        var today = WorkingCalendar.Today(clock, access.Project.TimeZone);
        var open = await (
            from p in db.ReviewParticipants
            join s in db.ReviewSteps on p.StepId equals s.Id
            join r in db.Reviews on s.ReviewId equals r.Id
            join d in db.Documents on r.DocumentId equals d.Id
            join v in db.Revisions on r.RevisionId equals v.Id
            where (p.UserId == me || db.Set<ReviewDelegation>().Any(dl => dl.ReviewId == r.Id && dl.StepIndex == s.Index
                    && dl.FromUserId == p.UserId && dl.ToUserId == me && dl.Status == DelegationStates.Active && dl.EndDate >= today))
                && p.AnsweredAt == null && s.State == StepStates.Open && r.ProjectId == access.Project.Id
            orderby s.OpenedAt
            select new
            {
                r.Id,
                r.Number,
                DocumentId = d.Id,
                DocumentNumber = d.Number,
                d.Title,
                v.Value,
                Title2 = s.Title,
                s.DueDate,
                s.OpenedAt,
                s.Participation,
                s.DispatchedAt,
                s.Deciding
            })
            .ToListAsync(cancellationToken);
        // A party's step answered by proxy is one task with two acts: send it, then record what came back.
        var mySteps = open.Select(x => new WorkItem(x.Id, x.Number, x.DocumentId, x.DocumentNumber, x.Title, x.Value,
            x.Participation != Participations.ByProxy ? "ANSWER_STEP" : x.DispatchedAt is null ? "DISPATCH_STEP" : "RECORD_ANSWER",
            x.Title2, x.DueDate?.ToDateOnly(), (x.DispatchedAt ?? x.OpenedAt)!.Value.ToDateTimeOffset(), x.Deciding)).ToList();

        List<WorkItem> gate = [];
        if (access.Holds(Verbs.Control))
        {
            var catalog = await Catalog.LoadAsync(db, cancellationToken);
            var decided = await (
                from r in db.Reviews
                join d in db.Documents on r.DocumentId equals d.Id
                join v in db.Revisions on r.RevisionId equals v.Id
                where r.ProjectId == access.Project.Id && r.State == ReviewStates.Decided
                orderby r.DecidedAt
                select new { r.Id, r.Number, DocumentId = d.Id, DocumentNumber = d.Number, d.Title, v.Value, r.Verdict, r.VerdictSet, r.GrantedStatus, r.DecidedAt })
                .ToListAsync(cancellationToken);
            gate = decided.Select(x => new WorkItem(x.Id, x.Number, x.DocumentId, x.DocumentNumber, x.Title, x.Value,
                x.Verdict is null || Proceeds(catalog, x.VerdictSet, x.Verdict) ? "READY_TO_RELEASE" : "SEND_BACK", null, null,
                x.DecidedAt!.Value.ToDateTimeOffset(), true, x.Verdict, x.GrantedStatus)).ToList();
        }
        return new
        {
            steps = mySteps,
            gate,
            revisions = await control.WorkAsync(access, cancellationToken),
            issues = await transmittals.WorkAsync(access, cancellationToken),
        };
    }

    // ── Core moves ────────────────────────────────────────────────────────────

    /// <summary>
    /// Opens the step at <paramref name="index"/> (0-based): seats the people who answer it, sets its due date in working days, and makes it the review's current step.
    /// For an outside party answering in the app, also raises a transmittal so they can read the revision.
    /// </summary>
    private async Task OpenStepAsync(ProjectAccess access, Review review, int index, CancellationToken cancellationToken)
    {
        var project = access.Project;
        var step = review.Steps.Single(s => s.Index == index);
        var party = step.PartyId is { } partyId
            ? await db.Parties.AsNoTracking().SingleAsync(p => p.Id == partyId, cancellationToken) : null;
        var subject = await db.Documents.AsNoTracking().SingleAsync(d => d.Id == review.DocumentId, cancellationToken);
        var holders = await SeatsAsync(project, step.FunctionCode, party, step.Participation, cancellationToken, step.UserIds, subject);
        var today = WorkingCalendar.Today(clock, project.TimeZone);
        step.State = StepStates.Open;
        step.OpenedAt = clock.GetCurrentInstant();
        // By proxy the clock starts when it goes to them, not before.
        step.DueDate = step.Days is { } days && !step.ByProxy ? WorkingCalendar.AddWorkingDays(today, days, project.WeekendDays) : null;
        step.Answer = null;
        step.CompletedAt = null;
        step.WarnedAt = null;
        ClearExchange(step);
        step.Participants = holders.Select(h => new ReviewParticipant
        {
            TenantId = review.TenantId,
            StepId = step.Id,
            UserId = h.Id,
            UserName = h.Name,
        }).ToList();
        review.CurrentStep = index;
        var (subjectDocument, subjectRevision) = await SubjectAsync(review, cancellationToken);
        await TellAsync(review, holders.Select(h => h.Id), Notifications.NotificationKinds.ReviewStep,
            $"{TransmittalService.Label(subjectDocument, subjectRevision)} is waiting on you: {step.Title}",
            $"Review {review.Number}, step {index + 1}{(step.DueDate is { } due ? $", due {due:yyyy-MM-dd}" : "")}.", cancellationToken);

        // A party answering here is sent the revision on a transmittal: that is what
        // lets them read it, and the record that it went.
        if (party is not null && !step.ByProxy)
        {
            var (document, revision) = await SubjectAsync(review, cancellationToken);
            var transmittal = await transmittals.RaiseAsync(new TransmittalService.Raise(project, Actor(access), step.Reason!,
                $"{TransmittalService.Label(document, revision)}: {step.Title}", null, party, party.Name, [(document, revision)],
                holders.Select(h => new TransmittalService.Addressee(h.Id, party.Id, h.Name, party.Name)).ToList(),
                ReviewStepId: step.Id, ResponseDue: step.DueDate), cancellationToken);
            step.TransmittalId = transmittal.Id;
        }
    }

    /// <summary>Tells these people about the review (and emails them, under the review email switch). Links to the review unless told otherwise.</summary>
    private Task TellAsync(Review review, IEnumerable<Guid> userIds, string kind, string title, string? body, CancellationToken cancellationToken,
        string? link = null) =>
        notifier.NotifyAsync(review.TenantId, review.ProjectId, userIds, kind, title, body, link ?? $"/reviews/{review.Id}", cancellationToken,
            Notifications.EmailKinds.Review);

    /// <summary>Clears everything recorded about sending a step to an outside party and their answer, so the step starts fresh.</summary>
    private static void ClearExchange(ReviewStep step)
    {
        step.TransmittalId = null;
        step.DispatchedAt = null;
        step.DispatchChannel = null;
        step.DispatchRef = null;
        step.DispatchedByName = null;
        step.ForeignAnswer = null;
        step.RecordedByName = null;
        step.EvidenceFileId = null;
    }

    /// <summary>
    /// Does the release itself: marks the revision released at the status, supersedes earlier released revisions, closes the review, and queues a <see cref="RevisionReleased"/> message in the outbox for stamping.
    /// Also carries out the open issue requests (who receives it). <paramref name="by"/> is "System" when it happens automatically.
    /// </summary>
    private async Task ReleaseCoreAsync(ProjectAccess access, Review review, string status, string by, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var revision = await db.Revisions.SingleAsync(r => r.Id == review.RevisionId, cancellationToken);
        var document = await db.Documents.SingleAsync(d => d.Id == review.DocumentId, cancellationToken);
        var earlier = await db.Revisions
            .Where(r => r.DocumentId == document.Id && r.Id != revision.Id && r.State == RevisionStates.Released)
            .ToListAsync(cancellationToken);

        revision.State = RevisionStates.Released;
        revision.StatusCode = status;
        revision.ReleasedAt = now;
        revision.ReleasedByName = by;
        foreach (var old in earlier)
        {
            old.State = RevisionStates.Superseded;
            old.SupersededAt = now;
        }
        document.State = DocumentStates.Active;
        document.LatestRevisionState = RevisionStates.Released;
        document.UpdatedAt = now;
        review.State = ReviewStates.Released;
        review.ClosedAt = now;
        review.ClosedByName = by;

        db.Enqueue(RevisionReleased.RoutingKey, new RevisionReleased(review.TenantId, revision.Id, earlier.Select(r => r.Id).ToArray()));
        var actor = by == "System" ? Audit.Actor.System : Actor(access);
        // What was asked for it goes out with the release.
        await transmittals.CarryOutOpenAsync(access.Project, actor, revision, document, cancellationToken);
        await audit.WriteAsync(actor, "RELEASED", "Revision", revision.Id, $"{document.Number} rev {revision.Value}",
            $"Released at {status} on review {review.Number}.", review.ProjectId, cancellationToken);
        await TellAsync(review, [review.StartedById, revision.AuthoredById], Notifications.NotificationKinds.Released,
            $"{TransmittalService.Label(document, revision)} released at {status}", $"Review {review.Number}.", cancellationToken,
            $"/documents/{document.Id}");
        foreach (var old in earlier)
        {
            await audit.WriteAsync(actor, "SUPERSEDED", "Revision", old.Id, $"{document.Number} rev {old.Value}",
                $"Superseded by rev {revision.Value}.", review.ProjectId, cancellationToken);
        }
        // Whoever received what it replaces, and has an account here, is told to stop using it.
        await supersession.TellReplacedAsync(document, revision, earlier, cancellationToken);
    }

    /// <summary>
    /// The author or Document Control takes a revision back out of its review to update its files: the review closes
    /// as withdrawn, with its comments kept; open steps end, open transmittals lapse, and everyone on the route is told.
    /// The revision is in preparation again, to be sent once its new files are in. Returns a problem when no review is open.
    /// </summary>
    public async Task<IResult?> WithdrawForUpdateAsync(ProjectAccess access, Guid revisionId, string reason, CancellationToken cancellationToken)
    {
        var review = await db.Reviews.Include(r => r.Steps)
            .Where(r => r.RevisionId == revisionId && (r.State == ReviewStates.InProgress || r.State == ReviewStates.Decided))
            .OrderByDescending(r => r.StartedAt).FirstOrDefaultAsync(cancellationToken);
        if (review is null) return Problems.Conflict("NO_OPEN_REVIEW", "This revision has no open review to withdraw.");
        var now = clock.GetCurrentInstant();
        var revision = await db.Revisions.SingleAsync(r => r.Id == revisionId, cancellationToken);
        var document = await db.Documents.SingleAsync(d => d.Id == review.DocumentId, cancellationToken);
        var note = $"Withdrawn for update by {access.UserName}: {reason}";
        revision.State = RevisionStates.InPreparation;
        document.LatestRevisionState = RevisionStates.InPreparation;
        document.UpdatedAt = now;
        review.State = ReviewStates.Withdrawn;
        review.ReturnNote = note;
        review.ClosedAt = now;
        review.ClosedByName = access.UserName;
        var told = review.Steps.SelectMany(s => s.UserIds).Append(review.StartedById).Distinct().Where(id => id != access.UserId).ToList();
        foreach (var step in review.Steps.Where(s => s.State == StepStates.Open)) step.State = StepStates.Done;
        await transmittals.LapseOpenAsync(revision.Id, access.UserName, cancellationToken);
        await CloseApprovalsAsync(revision.Id, review.Id, access.UserName, cancellationToken);
        await audit.WriteAsync(Actor(access), "WITHDRAWN_FOR_UPDATE", "Revision", revision.Id, $"{document.Number} rev {revision.Value}",
            $"{note} Review {review.Number} closed; its comments are kept.", review.ProjectId, cancellationToken);
        await TellAsync(review, told, Notifications.NotificationKinds.ReviewReturned,
            $"{TransmittalService.Label(document, revision)} withdrawn from review for an update", note, cancellationToken, $"/documents/{document.Id}");
        return null;
    }

    /// <summary>Closes the review and marks the revision returned: the author must make a new revision. Open steps end and open transmittals for the revision lapse.</summary>
    private async Task ReturnToAuthorAsync(Review review, string note, string by, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var revision = await db.Revisions.SingleAsync(r => r.Id == review.RevisionId, cancellationToken);
        var document = await db.Documents.SingleAsync(d => d.Id == review.DocumentId, cancellationToken);
        revision.State = RevisionStates.Returned;
        revision.ReturnedAt = now;
        revision.ReturnedReason = note;
        document.LatestRevisionState = RevisionStates.Returned;
        document.UpdatedAt = now;
        review.State = ReviewStates.Returned;
        review.ReturnNote = note;
        review.ClosedAt = now;
        review.ClosedByName = by;
        foreach (var step in review.Steps.Where(s => s.State == StepStates.Open)) step.State = StepStates.Done;
        await transmittals.LapseOpenAsync(revision.Id, by, cancellationToken);
        await CloseApprovalsAsync(revision.Id, review.Id, by, cancellationToken);
        await audit.WriteAsync(Audit.Actor.System, "RETURNED_TO_AUTHOR", "Revision", revision.Id,
            $"{document.Number} rev {revision.Value}", $"{note} The next revision replaces it.", review.ProjectId, cancellationToken);
        await TellAsync(review, [review.StartedById, revision.AuthoredById], Notifications.NotificationKinds.ReviewReturned,
            $"{TransmittalService.Label(document, revision)} returned: a new revision is needed", note, cancellationToken, $"/documents/{document.Id}");
    }

    /// <summary>
    /// Back to whoever sent it, to correct and send again under the same revision:
    /// our initiator, or the organization that sent it in. Its review is closed;
    /// once the corrected files are in, the route runs again from the start.
    /// </summary>
    private async Task ReturnForCorrectionAsync(Review review, string note, string by, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var revision = await db.Revisions.SingleAsync(r => r.Id == review.RevisionId, cancellationToken);
        var document = await db.Documents.SingleAsync(d => d.Id == review.DocumentId, cancellationToken);
        revision.State = RevisionStates.Correcting;
        revision.ReturnedAt = now;
        revision.ReturnedReason = note;
        document.LatestRevisionState = RevisionStates.Correcting;
        document.UpdatedAt = now;
        review.State = ReviewStates.Returned;
        review.ReturnNote = note;
        review.ClosedAt = now;
        review.ClosedByName = by;
        foreach (var step in review.Steps.Where(s => s.State == StepStates.Open)) step.State = StepStates.Done;
        await transmittals.LapseOpenAsync(revision.Id, by, cancellationToken);
        await CloseApprovalsAsync(revision.Id, review.Id, by, cancellationToken);
        var to = revision.AuthoredByParty is { } party
            && await db.Parties.AnyAsync(p => p.Code == party && !p.IsInternal, cancellationToken) ? party : "its initiator";
        await audit.WriteAsync(Audit.Actor.System, "RETURNED_FOR_CORRECTION", "Revision", revision.Id,
            $"{document.Number} rev {revision.Value}",
            $"Back to {to}: {note} Corrected files come back under rev {revision.Value}; no new revision.", review.ProjectId, cancellationToken);
        await TellAsync(review, [review.StartedById, revision.AuthoredById], Notifications.NotificationKinds.ReviewReturned,
            $"{TransmittalService.Label(document, revision)} returned for correction", note, cancellationToken, $"/documents/{document.Id}");
    }

    /// <summary>
    /// Resets the step at <paramref name="index"/> (0-based) and every later step, clears the verdict, lapses open transmittals, and opens that step again.
    /// With <paramref name="onlyAnswered"/> the target step must already be done (used by rewind). Returns null on success, or the problem. Called by <see cref="ReturnAsync"/> and <see cref="RewindAsync"/>.
    /// </summary>
    private async Task<IResult?> SendBackToStepAsync(
        ProjectAccess access, Review review, int index, string? reason, string note, bool onlyAnswered,
        CancellationToken cancellationToken)
    {
        if (index < 0 || index >= review.Steps.Count)
            return Problems.Invalid("STEP_INVALID", "No such step on this route.");
        var target = review.Steps.Single(s => s.Index == index);
        if (onlyAnswered && target.State != StepStates.Done)
            return Problems.Invalid("REWIND_FORWARD", "The route goes back only to a step that has already answered.");
        // Never forward: a step not yet reached would open beside the one that is open.
        if (target.State == StepStates.Waiting)
            return Problems.Invalid("STEP_NOT_REACHED", "The route has not reached that step yet: send it back to the open step or an earlier one.");
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        if (reason is null || !catalog.IsActive(ReviewSets.ReturnReasons, reason))
        {
            return Problems.Invalid("RETURN_REASON_REQUIRED",
                "Sending a route back to a step needs one of the published reasons. A document that is wrong goes back to its author.",
                new { field = "reason", value = reason });
        }

        var reset = review.Steps.Where(s => s.Index >= index).ToList();
        var seats = reset.SelectMany(s => s.Participants).ToList();
        db.ReviewParticipants.RemoveRange(seats);
        foreach (var s in reset)
        {
            s.Participants = [];
            s.State = StepStates.Waiting;
            s.Answer = null;
            s.CompletedAt = null;
            ClearExchange(s);
        }
        // A decision undone takes what it asked for with it.
        await transmittals.LapseOpenAsync(review.RevisionId, access.UserName, cancellationToken);
        review.State = ReviewStates.InProgress;
        review.Verdict = null;
        review.GrantedStatus = null;
        review.DecidedAt = null;
        await OpenStepAsync(access, review, index, cancellationToken);
        await audit.WriteAsync(Actor(access), "REVIEW_SENT_BACK_TO_STEP", "Review", review.Id, review.Number,
            $"Back to step {index + 1} ({reason}). {note}".Trim(), review.ProjectId, cancellationToken);
        return null;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>Loads a review of this project with its steps (in order), their participants and its comments, tracked so changes can be saved. Null if not found.</summary>
    private Task<Review?> LoadAsync(ProjectAccess access, Guid reviewId, CancellationToken cancellationToken) =>
        db.Reviews
            .Include(r => r.Steps.OrderBy(s => s.Index)).ThenInclude(s => s.Participants)
            .Include(r => r.Comments)
            .AsSplitQuery()
            .SingleOrDefaultAsync(r => r.Id == reviewId && r.ProjectId == access.Project.Id, cancellationToken);

    /// <summary>Loads a review for display, or null if it does not exist or its document is not visible to the caller. Called by the get-review endpoint.</summary>
    public async Task<Review?> ReadAsync(ProjectAccess access, Guid reviewId, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        return review is not null && await VisibleDocumentAsync(access, review.DocumentId, cancellationToken) is not null
            ? review : null;
    }

    /// <summary>The document if the caller may see it (taking restricted confidentiality levels into account), otherwise null.</summary>
    private async Task<Document?> VisibleDocumentAsync(ProjectAccess access, Guid documentId, CancellationToken cancellationToken)
    {
        var restricted = (await Catalog.LoadAsync(db, cancellationToken)).RestrictedLevels();
        return await DocumentQueries.Visible(db, access, restricted).SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
    }

    /// <summary>
    /// Who sits on a step: the holders of its function and the people named on it who are on the project; for a party
    /// answering here, its people on the project; for one answering by proxy, whoever of ours carries the exchange with it.
    /// </summary>
    private async Task<List<User>> SeatsAsync(
        Project project, string? functionCode, Party? party, string? participation, CancellationToken cancellationToken,
        Guid[]? named = null, Document? document = null)
    {
        if (party is null)
        {
            var holders = functionCode is null ? [] : await HoldersAsync(project.Id, functionCode, cancellationToken);
            var people = named is not { Length: > 0 } ? [] : await (from m in db.Memberships
                                                                    join u in db.Users on m.UserId equals u.Id
                                                                    where m.ProjectId == project.Id && m.Active && m.Function!.Active && u.Active && named.Contains(u.Id)
                                                                    select u).Distinct().ToListAsync(cancellationToken);
            var seated = holders.Concat(people).DistinctBy(u => u.Id).OrderBy(u => u.Name).ToList();
            return document is null ? seated : await ClearedAsync(project, document, seated, cancellationToken);
        }
        if (participation == Participations.ByProxy) return await transmittals.CustodiansAsync(project.Id, party, cancellationToken);
        return await (from m in db.Memberships
                      join u in db.Users on m.UserId equals u.Id
                      where m.ProjectId == project.Id && m.Active && m.Function!.Active && u.Active && u.PartyId == party.Id
                      orderby u.Name
                      select u).ToListAsync(cancellationToken);
    }

    /// <summary>
    /// Those of <paramref name="people"/> who may read the document: their function's clearance reaches its
    /// confidentiality, or they registered it, or they are named on it.
    /// </summary>
    private async Task<List<User>> ClearedAsync(Project project, Document document, List<User> people, CancellationToken cancellationToken)
    {
        if (document.Confidentiality is null || people.Count == 0) return people;
        var ids = people.Select(u => u.Id).ToList();
        var clearances = await db.Memberships.AsNoTracking().Where(m => m.ProjectId == project.Id && m.Active && ids.Contains(m.UserId))
            .Select(m => new { m.UserId, m.Function!.Clearance }).ToListAsync(cancellationToken);
        if (clearances.All(c => c.Clearance is null)) return people;
        var named = await db.DocumentAccess.AsNoTracking().Where(a => a.DocumentId == document.Id && ids.Contains(a.UserId))
            .Select(a => a.UserId).ToListAsync(cancellationToken);
        var ranks = await Clearance.RanksAsync(db, cancellationToken);
        return people.Where(u => u.Id == document.CreatedById || named.Contains(u.Id)
            || Clearance.Reaches(ranks, clearances.FirstOrDefault(c => c.UserId == u.Id)?.Clearance, document.Confidentiality)).ToList();
    }

    /// <summary>Loads the document and revision a review is about.</summary>
    private async Task<(Document Document, Revision Revision)> SubjectAsync(Review review, CancellationToken cancellationToken) =>
        (await db.Documents.SingleAsync(d => d.Id == review.DocumentId, cancellationToken),
         await db.Revisions.SingleAsync(r => r.Id == review.RevisionId, cancellationToken));

    /// <summary>The problem returned when someone tries to act on a by-proxy step before recording that it was sent to the party.</summary>
    private static IResult NotDispatched(ReviewStep step) => Problems.Conflict("NOT_DISPATCHED",
        $"Record that it went to {step.PartyName} first: what comes back is their answer to what was sent.");

    /// <summary>Active users who hold the given function on the project, by name.</summary>
    private Task<List<User>> HoldersAsync(Guid projectId, string functionCode, CancellationToken cancellationToken) =>
        (from m in db.Memberships
         join u in db.Users on m.UserId equals u.Id
         where m.ProjectId == projectId && m.Active && m.Function!.Code == functionCode && m.Function.Active && u.Active
         orderby u.Name
         select u).ToListAsync(cancellationToken);

    /// <summary>How many people hold a function with the CONTROL verb on the project.</summary>
    private Task<int> ControlHoldersAsync(Guid projectId, CancellationToken cancellationToken) =>
        db.Memberships.CountAsync(m => m.ProjectId == projectId && m.Active && m.Function!.Active
            && m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control))
            && db.Users.Any(u => u.Id == m.UserId && u.Active), cancellationToken);

    /// <summary>Whether the caller has the Document Control verb on the review's document.</summary>
    private async Task<bool> HoldsControlAsync(ProjectAccess access, Review review, CancellationToken cancellationToken)
    {
        var document = await db.Documents.AsNoTracking().SingleAsync(d => d.Id == review.DocumentId, cancellationToken);
        return access.Allows(Verbs.Control, document.Facts);
    }

    /// <summary>Document Control, or, where the project has nobody in that role, the people who decided.</summary>
    private async Task<bool> MayActForControlAsync(ProjectAccess access, Review review, CancellationToken cancellationToken)
    {
        if (await HoldsControlAsync(access, review, cancellationToken)) return true;
        if (await ControlHoldersAsync(access.Project.Id, cancellationToken) > 0) return false;
        // Not reviewed: whoever sent it on releases it.
        return review.Steps.SingleOrDefault(s => s.Deciding)?.Participants.Any(p => p.UserId == access.UserId)
            ?? review.StartedById == access.UserId;
    }

    /// <summary>Whether a function, on this project, would allow the verb on a document with these facts. Used to check the deciding function may approve.</summary>
    private static bool Allows(Function function, Project project, string verb, DocumentFacts facts) =>
        ProjectAccess.OfFunction(project, function).Allows(verb, facts);

    /// <summary>The review's step that is open now, or null when none is.</summary>
    /// <summary>What the caller may do on this review now: answer the open step, act as Document Control on it.</summary>
    /// <param name="OnBehalfOf">When the caller answers in somebody else's place, by a hand-over in force: that person's name.</param>
    public sealed record ReviewMe(bool Seated, bool Answered, bool Control, string? OnBehalfOf = null);

    /// <summary>For the review page: whether the caller sits on the open step (and has answered), and whether they act for Document Control. Null when they cannot see it.</summary>
    public async Task<ReviewMe?> MeAsync(ProjectAccess access, Guid reviewId, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return null;
        var step = OpenStep(review);
        var seat = step is null ? null : await SeatAsync(review, step, access, cancellationToken);
        return new ReviewMe(seat is not null, seat?.AnsweredAt is not null, await MayActForControlAsync(access, review, cancellationToken),
            seat is not null && seat.UserId != access.UserId ? seat.UserName : null);
    }

    private static ReviewStep? OpenStep(Review review) => review.Steps.SingleOrDefault(s => s.State == StepStates.Open);
    /// <summary>
    /// The seat the caller answers on this step: their own, or that of somebody who
    /// handed the step to them by a hand-over in force today. Null when they have none.
    /// </summary>
    private async Task<ReviewParticipant?> SeatAsync(Review review, ReviewStep step, ProjectAccess access, CancellationToken cancellationToken)
    {
        var own = step.Participants.FirstOrDefault(p => p.UserId == access.UserId);
        if (own is not null) return own;
        var today = WorkingCalendar.Today(clock, access.Project.TimeZone);
        var from = await db.Set<ReviewDelegation>().AsNoTracking()
            .Where(d => d.ReviewId == review.Id && d.StepIndex == step.Index && d.ToUserId == access.UserId
                && d.Status == DelegationStates.Active && d.EndDate >= today)
            .Select(d => d.FromUserId).ToListAsync(cancellationToken);
        return step.Participants.FirstOrDefault(p => from.Contains(p.UserId));
    }

    /// <summary>Whether a verdict lets the revision go on to release (its published <c>proceed</c> property is true).</summary>
    private static bool Proceeds(Catalog catalog, string set, string verdict) => ReviewSets.Proceeds(catalog, set, verdict);

    /// <summary>The published advice code for an advice kind (none, some, blocking); the kind in capitals when none is published.</summary>
    private static string AdviceCode(Catalog catalog, string kind) =>
        catalog.CodeWhere(ReviewSets.Advice, "comments", kind) ?? kind.ToUpperInvariant();

    /// <summary>The advice kind (none, some, blocking) behind a published advice code; the code in lower case when it has none.</summary>
    private static string AdviceKind(Catalog catalog, string code) =>
        catalog.Prop(ReviewSets.Advice, code, "comments") is { ValueKind: JsonValueKind.String } k ? k.GetString()! : code.ToLowerInvariant();

    /// <summary>Marks a comment closed with its resolution, the time and who closed it.</summary>
    private void Close(ReviewComment comment, string resolution, string by)
    {
        comment.Status = CommentStatuses.Closed;
        comment.Resolution = resolution;
        comment.ClosedAt = clock.GetCurrentInstant();
        comment.ClosedByName = by;
    }

    /// <summary>Turns a state code such as IN_PREPARATION into words for messages ("in preparation").</summary>
    private static string Words(string state) => state.ToLowerInvariant().Replace('_', ' ');
    /// <summary>The caller as the actor recorded in the audit log.</summary>
    private static Audit.Actor Actor(ProjectAccess access) => new(access.UserId, access.UserName);
    /// <summary>The 404 problem for a review that does not exist or is not visible.</summary>
    private static IResult NotFound() => Problems.NotFound("REVIEW_NOT_FOUND", "No such review.");
    /// <summary>Shorthand for returning a problem with no review.</summary>
    private static (Review?, IResult?) Fail(IResult problem) => (null, problem);
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
