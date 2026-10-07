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

public sealed record StartReviewRequest(Guid? RouteId = null);
public sealed record CommentRequest(string? Text, string? Class, int? ClosesWithStep = null);
public sealed record CloseCommentRequest(string? Resolution);
/// <param name="Issue">On the deciding step, with a verdict that lets the revision out: who it goes to once released.</param>
/// <param name="ForeignAnswer">For a party answering by proxy: their answer as they wrote it.</param>
/// <param name="EvidenceFileId">For a party answering by proxy: the proof of their answer.</param>
public sealed record AnswerRequest(string? Verdict = null, string? Status = null, string? Note = null, IssueAsk? Issue = null,
    string? ForeignAnswer = null, Guid? EvidenceFileId = null);
/// <param name="Outcome">Document Control's outcome to record, from its own published set.</param>
public sealed record ReleaseRequest(string? Status = null, string? Outcome = null);
/// <param name="ToStep">Null sends the revision back to its author; a step number (from 1) sends the route back to that step.</param>
/// <param name="Outcome">
/// Document Control's outcome, from its own published set. Whether the revision
/// comes back corrected under the same value or is replaced by a new one follows
/// from it, and from the verdict: one that asked for changes always needs a new revision.
/// </param>
public sealed record ReturnRequest(string? Note, int? ToStep = null, string? Reason = null, string? Outcome = null);
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
    ControlService control)
{
    private const string Advice_None = "none", Advice_Some = "some", Advice_Blocking = "blocking";

    // ── Routes ────────────────────────────────────────────────────────────────

    /// <summary>The routes that serve a document, most specific first; the default last.</summary>
    public async Task<IReadOnlyList<ReviewRoute>> RoutesForAsync(Document document, CancellationToken cancellationToken)
    {
        var routes = await db.ReviewRoutes.AsNoTracking().Where(r => r.Active).ToListAsync(cancellationToken);
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
            if ((await SeatsAsync(access.Project, step.FunctionCode, party, party?.Participation, cancellationToken)).Count == 0)
            {
                return Fail(Problems.Invalid("STEP_HAS_NO_HOLDER",
                    party is null ? $"Nobody holds {step.FunctionCode} on this project, so step {i + 1} ({step.Title}) could not be answered."
                    : party.Participation == Participations.InApp
                        ? $"Nobody from {party.Name} is on this project, so step {i + 1} ({step.Title}) could not be answered."
                        : $"Nobody on this project carries the exchange with {party.Name}, so step {i + 1} ({step.Title}) could not be answered.",
                    new { step = i + 1, function = step.FunctionCode, party = step.PartyCode }));
            }
        }
        var deciding = route.Steps[^1];
        if (deciding.PartyCode is null)
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
                    PartyId = party?.Id,
                    PartyName = party?.Name,
                    Participation = party?.Participation,
                    Reason = party is null ? null : s.Reason,
                    // One of ours records the party's single answer.
                    Mode = party?.Participation == Participations.ByProxy ? StepModes.Any : s.Mode,
                    Deciding = i == route.Steps.Count - 1,
                    Days = s.Days,
                    GrantsStatuses = s.GrantsStatuses,
                };
            }).ToList(),
        };
        db.Reviews.Add(review);
        await OpenStepAsync(access, review, 0, cancellationToken);

        revision.State = RevisionStates.InReview;
        document.LatestRevisionState = RevisionStates.InReview;
        document.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor(access), "REVIEW_STARTED", "Review", review.Id, review.Number,
            $"{document.Number} rev {revision.Value} sent for review on route {route.Name}.", access.Project.Id, cancellationToken);
        return (review, null);
    }

    // ── Comments ──────────────────────────────────────────────────────────────

    public async Task<(ReviewComment? Comment, IResult? Problem)> CommentAsync(
        ProjectAccess access, Guid reviewId, CommentRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        var step = OpenStep(review);
        if (review.State != ReviewStates.InProgress || step is null || !IsSeated(step, access.UserId))
        {
            return (null, Problems.Forbidden("NOT_ON_OPEN_STEP", "Only the people on the step that is open comment on it."));
        }
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
            AuthorName = step.ByProxy ? $"{step.PartyName} (recorded by {access.UserName})" : access.UserName,
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

    // ── Answers ───────────────────────────────────────────────────────────────

    public async Task<(Review? Review, IResult? Problem)> AnswerAsync(
        ProjectAccess access, Guid reviewId, AnswerRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        var step = OpenStep(review);
        var seat = step?.Participants.SingleOrDefault(p => p.UserId == access.UserId);
        if (review.State != ReviewStates.InProgress || step is null || seat is null)
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
            if (!catalog.IsActive(ReviewSets.Verdicts, answer))
            {
                return (null, Problems.Invalid("VALUE_NOT_PUBLISHED", $"{answer} is not a published verdict.",
                    new { field = "verdict", value = answer }));
            }
            if (Proceeds(catalog, answer))
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
            // An adviser is not asked: the answer is already in what they wrote.
            var mine = review.Comments.Where(c => c.StepIndex == step.Index && c.AuthorId == access.UserId).ToList();
            var kind = mine.Any(c => c.Blocking) ? Advice_Blocking : mine.Count > 0 ? Advice_Some : Advice_None;
            answer = AdviceCode(catalog, kind);
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
        seat.Note = request.Note?.Trim();
        seat.AnsweredAt = now;
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
        }
        await audit.WriteAsync(Actor(access), step.Deciding ? "VERDICT" : "ADVICE", "Review", review.Id, review.Number,
            $"Step {step.Index + 1} ({step.Title}): {answer}{(granted is null ? "" : $", granting {granted}")}"
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
            var binding = answered.FirstOrDefault(p => !Proceeds(catalog, p.Answer!)) ?? answered[^1];
            step.Answer = binding.Answer;
            review.Verdict = binding.Answer;
            review.GrantedStatus = Proceeds(catalog, binding.Answer!) ? binding.GrantedStatus : null;
        }
        else
        {
            var severity = new[] { Advice_None, Advice_Some, Advice_Blocking };
            step.Answer = answered.Select(p => p.Answer!)
                .MaxBy(code => Array.IndexOf(severity, AdviceKind(catalog, code))) ?? AdviceCode(catalog, Advice_None);
        }

        // Reservations this step was named to settle close themselves, unless it objected.
        var settles = step.Deciding ? Proceeds(catalog, step.Answer!) : AdviceKind(catalog, step.Answer!) != Advice_Blocking;
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

        review.State = ReviewStates.Decided;
        review.DecidedAt = now;
        await audit.WriteAsync(Audit.Actor.System, "REVIEW_DECIDED", "Review", review.Id, review.Number,
            $"Verdict {review.Verdict}{(review.GrantedStatus is null ? "" : $", granting {review.GrantedStatus}")}.",
            review.ProjectId, cancellationToken);

        // Where nobody holds the control function, the people doing the work take
        // its acts: a verdict that proceeds releases, one that does not returns.
        if (await ControlHoldersAsync(access.Project.Id, cancellationToken) > 0) return;
        if (!Proceeds(catalog, review.Verdict!))
        {
            await ReturnToAuthorAsync(review, $"Verdict {review.Verdict}.", "System", cancellationToken);
        }
        else if (!review.Comments.Any(c => c.Blocking && c.Status == CommentStatuses.Open))
        {
            await ReleaseCoreAsync(access, review, review.GrantedStatus!, "System", cancellationToken);
        }
    }

    // ── Document Control's acts ───────────────────────────────────────────────

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
        if (!Proceeds(catalog, review.Verdict!))
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

        var (outcome, outcomeProblem) = ControlService.Pick(catalog, request.Outcome, ControlService.Release);
        if (outcomeProblem is not null) return (null, outcomeProblem);
        await ReleaseCoreAsync(access, review, status, access.UserName, cancellationToken);
        control.Record(await db.Revisions.SingleAsync(r => r.Id == review.RevisionId, cancellationToken), outcome, null, access.UserName);
        await db.SaveChangesAsync(cancellationToken);
        return (review, null);
    }

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
            var changesAsked = review.State == ReviewStates.Decided && !Proceeds(catalog, review.Verdict!);
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
        if (review.State != ReviewStates.InProgress || step is null || !IsSeated(step, access.UserId))
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
        if (review.State != ReviewStates.InProgress || step is null || !step.ByProxy || !IsSeated(step, access.UserId))
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
        if (review.State != ReviewStates.InProgress || step is null || !step.ByProxy || !IsSeated(step, access.UserId))
        {
            return (null, Problems.Forbidden("NOT_CUSTODIAN",
                "Whoever carries the exchange with the party on the open step files its proof."));
        }
        return await transmittals.EvidenceTicketAsync(access, review.DocumentId, review.RevisionId, request, cancellationToken);
    }

    // ── Queues ────────────────────────────────────────────────────────────────

    public sealed record WorkItem(Guid ReviewId, string Number, Guid DocumentId, string DocumentNumber, string Title,
        string RevisionValue, string Kind, string? StepTitle, DateOnly? DueDate, DateTimeOffset Since);

    /// <summary>What this person has waiting: their open steps, and Document Control's gate.</summary>
    public async Task<object> WorkAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        var me = access.UserId;
        var open = await (
            from p in db.ReviewParticipants
            join s in db.ReviewSteps on p.StepId equals s.Id
            join r in db.Reviews on s.ReviewId equals r.Id
            join d in db.Documents on r.DocumentId equals d.Id
            join v in db.Revisions on r.RevisionId equals v.Id
            where p.UserId == me && p.AnsweredAt == null && s.State == StepStates.Open && r.ProjectId == access.Project.Id
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
                s.DispatchedAt
            })
            .ToListAsync(cancellationToken);
        // A party's step answered by proxy is one task with two acts: send it, then record what came back.
        var mySteps = open.Select(x => new WorkItem(x.Id, x.Number, x.DocumentId, x.DocumentNumber, x.Title, x.Value,
            x.Participation != Participations.ByProxy ? "ANSWER_STEP" : x.DispatchedAt is null ? "DISPATCH_STEP" : "RECORD_ANSWER",
            x.Title2, x.DueDate?.ToDateOnly(), (x.DispatchedAt ?? x.OpenedAt)!.Value.ToDateTimeOffset())).ToList();

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
                select new { r.Id, r.Number, DocumentId = d.Id, DocumentNumber = d.Number, d.Title, v.Value, r.Verdict, r.DecidedAt })
                .ToListAsync(cancellationToken);
            gate = decided.Select(x => new WorkItem(x.Id, x.Number, x.DocumentId, x.DocumentNumber, x.Title, x.Value,
                Proceeds(catalog, x.Verdict!) ? "READY_TO_RELEASE" : "SEND_BACK", null, null,
                x.DecidedAt!.Value.ToDateTimeOffset())).ToList();
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

    private async Task OpenStepAsync(ProjectAccess access, Review review, int index, CancellationToken cancellationToken)
    {
        var project = access.Project;
        var step = review.Steps.Single(s => s.Index == index);
        var party = step.PartyId is { } partyId
            ? await db.Parties.AsNoTracking().SingleAsync(p => p.Id == partyId, cancellationToken) : null;
        var holders = await SeatsAsync(project, step.FunctionCode, party, step.Participation, cancellationToken);
        var today = WorkingCalendar.Today(clock, project.TimeZone);
        step.State = StepStates.Open;
        step.OpenedAt = clock.GetCurrentInstant();
        // By proxy the clock starts when it goes to them, not before.
        step.DueDate = step.Days is { } days && !step.ByProxy ? WorkingCalendar.AddWorkingDays(today, days, project.WeekendDays) : null;
        step.Answer = null;
        step.CompletedAt = null;
        ClearExchange(step);
        step.Participants = holders.Select(h => new ReviewParticipant
        {
            TenantId = review.TenantId,
            StepId = step.Id,
            UserId = h.Id,
            UserName = h.Name,
        }).ToList();
        review.CurrentStep = index;

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
        foreach (var old in earlier)
        {
            await audit.WriteAsync(actor, "SUPERSEDED", "Revision", old.Id, $"{document.Number} rev {old.Value}",
                $"Superseded by rev {revision.Value}.", review.ProjectId, cancellationToken);
        }
    }

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
        await audit.WriteAsync(Audit.Actor.System, "RETURNED_TO_AUTHOR", "Revision", revision.Id,
            $"{document.Number} rev {revision.Value}", $"{note} The next revision replaces it.", review.ProjectId, cancellationToken);
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
        var to = revision.AuthoredByParty is { } party
            && await db.Parties.AnyAsync(p => p.Code == party && !p.IsInternal, cancellationToken) ? party : "its initiator";
        await audit.WriteAsync(Audit.Actor.System, "RETURNED_FOR_CORRECTION", "Revision", revision.Id,
            $"{document.Number} rev {revision.Value}",
            $"Back to {to}: {note} Corrected files come back under rev {revision.Value}; no new revision.", review.ProjectId, cancellationToken);
    }

    private async Task<IResult?> SendBackToStepAsync(
        ProjectAccess access, Review review, int index, string? reason, string note, bool onlyAnswered,
        CancellationToken cancellationToken)
    {
        if (index < 0 || index >= review.Steps.Count)
            return Problems.Invalid("STEP_INVALID", "No such step on this route.");
        if (onlyAnswered && review.Steps.Single(s => s.Index == index).State != StepStates.Done)
            return Problems.Invalid("REWIND_FORWARD", "The route goes back only to a step that has already answered.");
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

    private Task<Review?> LoadAsync(ProjectAccess access, Guid reviewId, CancellationToken cancellationToken) =>
        db.Reviews
            .Include(r => r.Steps.OrderBy(s => s.Index)).ThenInclude(s => s.Participants)
            .Include(r => r.Comments)
            .AsSplitQuery()
            .SingleOrDefaultAsync(r => r.Id == reviewId && r.ProjectId == access.Project.Id, cancellationToken);

    public async Task<Review?> ReadAsync(ProjectAccess access, Guid reviewId, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        return review is not null && await VisibleDocumentAsync(access, review.DocumentId, cancellationToken) is not null
            ? review : null;
    }

    private async Task<Document?> VisibleDocumentAsync(ProjectAccess access, Guid documentId, CancellationToken cancellationToken)
    {
        var restricted = (await Catalog.LoadAsync(db, cancellationToken)).RestrictedLevels();
        return await DocumentQueries.Visible(db, access, restricted).SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
    }

    /// <summary>
    /// Who sits on a step: the holders of its function; for a party answering here,
    /// its people on the project; for one answering by proxy, whoever of ours carries
    /// the exchange with it.
    /// </summary>
    private async Task<List<User>> SeatsAsync(
        Project project, string? functionCode, Party? party, string? participation, CancellationToken cancellationToken)
    {
        if (party is null) return functionCode is null ? [] : await HoldersAsync(project.Id, functionCode, cancellationToken);
        if (participation == Participations.ByProxy) return await transmittals.CustodiansAsync(project.Id, party, cancellationToken);
        return await (from m in db.Memberships
                      join u in db.Users on m.UserId equals u.Id
                      where m.ProjectId == project.Id && m.Active && m.Function!.Active && u.Active && u.PartyId == party.Id
                      orderby u.Name
                      select u).ToListAsync(cancellationToken);
    }

    private async Task<(Document Document, Revision Revision)> SubjectAsync(Review review, CancellationToken cancellationToken) =>
        (await db.Documents.SingleAsync(d => d.Id == review.DocumentId, cancellationToken),
         await db.Revisions.SingleAsync(r => r.Id == review.RevisionId, cancellationToken));

    private static IResult NotDispatched(ReviewStep step) => Problems.Conflict("NOT_DISPATCHED",
        $"Record that it went to {step.PartyName} first: what comes back is their answer to what was sent.");

    private Task<List<User>> HoldersAsync(Guid projectId, string functionCode, CancellationToken cancellationToken) =>
        (from m in db.Memberships
         join u in db.Users on m.UserId equals u.Id
         where m.ProjectId == projectId && m.Active && m.Function!.Code == functionCode && m.Function.Active && u.Active
         orderby u.Name
         select u).ToListAsync(cancellationToken);

    /// <summary>How many people hold a function with the CONTROL verb on the project.</summary>
    private Task<int> ControlHoldersAsync(Guid projectId, CancellationToken cancellationToken) =>
        db.Memberships.CountAsync(m => m.ProjectId == projectId && m.Active && m.Function!.Active
            && m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control)), cancellationToken);

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
        return review.Steps.Single(s => s.Deciding).Participants.Any(p => p.UserId == access.UserId);
    }

    private static bool Allows(Function function, Project project, string verb, DocumentFacts facts) =>
        ProjectAccess.OfFunction(project, function).Allows(verb, facts);

    private static ReviewStep? OpenStep(Review review) => review.Steps.SingleOrDefault(s => s.State == StepStates.Open);
    private static bool IsSeated(ReviewStep step, Guid userId) => step.Participants.Any(p => p.UserId == userId);

    private static bool Proceeds(Catalog catalog, string verdict) =>
        catalog.Prop(ReviewSets.Verdicts, verdict, "proceed") is { ValueKind: JsonValueKind.True };

    private static string AdviceCode(Catalog catalog, string kind) =>
        catalog.CodeWhere(ReviewSets.Advice, "comments", kind) ?? kind.ToUpperInvariant();

    private static string AdviceKind(Catalog catalog, string code) =>
        catalog.Prop(ReviewSets.Advice, code, "comments") is { ValueKind: JsonValueKind.String } k ? k.GetString()! : code.ToLowerInvariant();

    private void Close(ReviewComment comment, string resolution, string by)
    {
        comment.Status = CommentStatuses.Closed;
        comment.Resolution = resolution;
        comment.ClosedAt = clock.GetCurrentInstant();
        comment.ClosedByName = by;
    }

    private static string Words(string state) => state.ToLowerInvariant().Replace('_', ' ');
    private static Audit.Actor Actor(ProjectAccess access) => new(access.UserId, access.UserName);
    private static IResult NotFound() => Problems.NotFound("REVIEW_NOT_FOUND", "No such review.");
    private static (Review?, IResult?) Fail(IResult problem) => (null, problem);
}

public sealed record RevisionReleased(Guid TenantId, Guid RevisionId, Guid[] SupersededRevisionIds)
{
    public const string RoutingKey = "revision.released";
}
