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

public sealed partial class ReviewService
{
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
        // A supplier's document: a verdict with comments for the next revision hands it to them; accepted, or for
        // information, it stays with us. Read from the verdict's meaning, whatever the organization calls it.
        if (document.WithSupplier is not null)
            document.WithSupplier = review.Verdict is { } verdict && SupplierHold.HandsToSupplier(await Catalog.LoadAsync(db, cancellationToken), review.VerdictSet, verdict);
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
        // Handed back to its supplier with comments for the next revision: their people are told too.
        var supplier = document.WithSupplier == true ? await SupplierHold.PeopleAsync(db, document, revision, cancellationToken) : [];
        // Accepted with comments: in force, and back with its author (or supplier) for the next revision, which needs nobody's leave.
        var commentsNext = review.Verdict is { } given && SupplierHold.HandsToSupplier(await Catalog.LoadAsync(db, cancellationToken), review.VerdictSet, given);
        await TellAsync(review, [review.StartedById, revision.AuthoredById, .. supplier], Notifications.NotificationKinds.Released,
            $"{TransmittalService.Label(document, revision)} released at {status}" + (commentsNext ? ", with comments for the next revision" : ""),
            commentsNext ? $"Review {review.Number}. It is in force; its comments go into your next revision, which you start without asking." : $"Review {review.Number}.",
            cancellationToken, $"/documents/{document.Id}");
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
        // Whoever started the review, or Document Control (and above): never anyone else, and always with why.
        if (review.StartedById != access.UserId && !access.Holds(Verbs.Control))
            return Problems.Forbidden("STARTER_OR_CONTROL", "Whoever started the review, or Document Control, takes a revision out of it.");
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
        if (document.WithSupplier is not null) document.WithSupplier = true;
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
        var supplier = document.WithSupplier == true ? await SupplierHold.PeopleAsync(db, document, revision, cancellationToken) : [];
        await TellAsync(review, [review.StartedById, revision.AuthoredById, .. supplier], Notifications.NotificationKinds.ReviewReturned,
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
        if (document.WithSupplier is not null) document.WithSupplier = true;
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
        var supplier = document.WithSupplier == true ? await SupplierHold.PeopleAsync(db, document, revision, cancellationToken) : [];
        await TellAsync(review, [review.StartedById, revision.AuthoredById, .. supplier], Notifications.NotificationKinds.ReviewReturned,
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
        // What the reset steps had answered is kept with the review, with who sent it back and why.
        var answers = reset.OrderBy(s => s.Index).SelectMany(s => s.Participants.Where(p => p.AnsweredAt is not null)
                .OrderBy(p => p.AnsweredAt)
                .Select(p => new EarlierAnswer(s.Index + 1, s.Title, p.AnsweredByName ?? p.UserName, p.Answer, p.GrantedStatus, p.Note,
                    p.AnsweredAt?.ToDateTimeOffset()))
                .Concat(s.ForeignAnswer is { } foreign
                    ? [new EarlierAnswer(s.Index + 1, s.Title, s.PartyName ?? s.RecordedByName ?? "", s.Answer, null,
                        $"{foreign}{(s.RecordedByName is null ? "" : $" (recorded by {s.RecordedByName})")}", s.CompletedAt?.ToDateTimeOffset())]
                    : []))
            .ToList();
        var sendBacks = review.SendBacks is null ? [] : JsonSerializer.Deserialize<List<SendBack>>(review.SendBacks) ?? [];
        sendBacks.Add(new SendBack(clock.GetCurrentInstant().ToDateTimeOffset(), access.UserName, index + 1, reason,
            string.IsNullOrWhiteSpace(note) ? null : note.Trim(), answers));
        review.SendBacks = JsonSerializer.Serialize(sendBacks);
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
}
