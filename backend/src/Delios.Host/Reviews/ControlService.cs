using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Reviews;

/// <summary>Body of the arrival request: Document Control's outcome code and an optional note (required when returning).</summary>
/// <param name="Outcome">One of the organization's control outcomes; empty takes the first one that fits the act.</param>
/// <param name="Return">On arrival, send it back to the sender even where no "return" outcome is published.</param>
public sealed record ControlRequest(string? Outcome = null, string? Note = null, bool Return = false);

/// <summary>
/// Document Control's own acts on a revision, kept apart from review verdicts: a
/// verdict is about what the document says, Document Control's check is about
/// whether the submission is in order. A submission that is not in order goes
/// back to be corrected under the same revision; only a change to what it says
/// needs a new one.
/// </summary>
public sealed class ControlService(DeliosDbContext db, AuditLog audit, IClock clock)
{
    /// <summary>The acts Document Control performs; a control outcome's published <c>act</c> property names one of them.</summary>
    public const string Accept = "accept", Return = "return", Release = "release";

    /// <summary>
    /// The outcome to record for an act: the one named, checked to be for that
    /// act, or the organization's first that fits. Null when it publishes none.
    /// </summary>
    /// <param name="to">For a return: "sender" (another organization) or "initiator" (ours); an outcome naming the other is passed over.</param>
    public static (string? Code, IResult? Problem) Pick(
        Catalog catalog, string? code, string act, bool? newRevision = null, string? to = null)
    {
        if (string.IsNullOrEmpty(code))
        {
            var fits = catalog.CodesWhere(ReviewSets.ControlOutcomes, "act", act)
                .Where(c => newRevision is null || NeedsNewRevision(catalog, c) == newRevision).ToList();
            return (fits.FirstOrDefault(c => To(catalog, c) == to) ?? fits.FirstOrDefault(c => To(catalog, c) is null)
                ?? fits.FirstOrDefault(), null);
        }
        if (!catalog.IsActive(ReviewSets.ControlOutcomes, code))
        {
            return (null, Problems.Invalid("VALUE_NOT_PUBLISHED", $"{code} is not a published control outcome.",
                new { field = "outcome", value = code }));
        }
        if (catalog.Prop(ReviewSets.ControlOutcomes, code, "act") is not { ValueKind: JsonValueKind.String } a || a.GetString() != act)
        {
            return (null, Problems.Invalid("OUTCOME_NOT_FOR_THIS_ACT", $"{code} is not an outcome of this act.",
                new { outcome = code, act }));
        }
        return (code, null);
    }

    /// <summary>Who a control outcome sends the submission back to (its published <c>to</c> property: "sender" or "initiator"), or null when it does not say.</summary>
    private static string? To(Catalog catalog, string code) =>
        catalog.Prop(ReviewSets.ControlOutcomes, code, "to") is { ValueKind: JsonValueKind.String } t ? t.GetString() : null;

    /// <summary>Whether a control outcome means a new revision must replace this one (its published <c>newRevision</c> property is true), rather than a correction under the same revision.</summary>
    public static bool NeedsNewRevision(Catalog catalog, string code) =>
        catalog.Prop(ReviewSets.ControlOutcomes, code, "newRevision") is { ValueKind: JsonValueKind.True };

    /// <summary>Document Control's outcome, on the revision and on the submission it judged.</summary>
    public void Record(Revision revision, string? outcome, string? note, string by)
    {
        revision.ControlOutcome = outcome ?? revision.ControlOutcome;
        var current = revision.Submissions.SingleOrDefault(s => s.Number == revision.Submission);
        if (current is null)
        {
            current = new SubmissionRecord { Number = revision.Submission, SubmittedAt = revision.CreatedAt, SubmittedByName = revision.AuthoredByName };
            revision.Submissions.Add(current);
        }
        current.Outcome = outcome;
        current.Note = note;
        current.DecidedByName = by;
        current.DecidedAt = clock.GetCurrentInstant();
    }

    /// <summary>
    /// The check on arrival: a revision another organization sent in is accepted
    /// before anybody reviews it, or returned to them to correct and send again
    /// under the same revision.
    /// </summary>
    public async Task<(Revision? Revision, IResult? Problem)> ArrivalAsync(
        ProjectAccess access, Guid revisionId, ControlRequest request, CancellationToken cancellationToken)
    {
        var revision = await db.Revisions.Include(r => r.Files).SingleOrDefaultAsync(r => r.Id == revisionId, cancellationToken);
        var restricted = (await Catalog.LoadAsync(db, cancellationToken)).RestrictedLevels();
        var document = revision is null ? null : await DocumentQueries.Visible(db, access, restricted)
            .SingleOrDefaultAsync(d => d.Id == revision.DocumentId, cancellationToken);
        if (revision is null || document is null) return (null, Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        if (!access.Allows(Verbs.Control, document.Facts))
            return (null, Problems.Forbidden("CONTROL_ONLY", "Accepting what arrives is Document Control's act."));
        if (revision.State != RevisionStates.Received)
        {
            return (null, Problems.Conflict("NOT_AWAITING_ACCEPTANCE", $"Revision {revision.Value} is not waiting to be accepted.",
                new { state = revision.State }));
        }
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var act = request.Outcome is { Length: > 0 } named
            && catalog.Prop(ReviewSets.ControlOutcomes, named, "act") is { ValueKind: JsonValueKind.String } a ? a.GetString()!
            : request.Return ? Return : Accept;
        if (act is not (Accept or Return))
            return (null, Problems.Invalid("OUTCOME_NOT_FOR_THIS_ACT", "On arrival a submission is accepted or returned.", new { act }));
        var (outcome, problem) = Pick(catalog, request.Outcome, act, newRevision: request.Outcome is null ? false : null, to: "sender");
        if (problem is not null) return (null, problem);
        var note = request.Note?.Trim();
        if (act == Return && string.IsNullOrEmpty(note))
            return (null, Problems.Invalid("NOTE_REQUIRED", "Say what is wrong, so the sender can correct it."));
        if (revision.FilesState == FilesStates.Processing)
            return (null, Problems.Conflict("FILES_NOT_READY", "Wait for the files to be scanned before judging them."));

        var now = clock.GetCurrentInstant();
        var newRevision = act == Return && outcome is not null && NeedsNewRevision(catalog, outcome);
        revision.State = act == Accept ? RevisionStates.InPreparation : newRevision ? RevisionStates.Returned : RevisionStates.Correcting;
        if (act == Return)
        {
            revision.ReturnedAt = now;
            revision.ReturnedReason = note;
        }
        Record(revision, outcome, note, access.UserName);
        document.LatestRevisionState = revision.State;
        document.UpdatedAt = now;
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), act == Accept ? "SUBMISSION_ACCEPTED" : "RETURNED_TO_SENDER",
            "Revision", revision.Id, $"{document.Number} rev {revision.Value}",
            act == Accept ? $"Submission {revision.Submission} accepted{(outcome is null ? "" : $" ({outcome})")}."
                : $"Submission {revision.Submission} returned{(outcome is null ? "" : $" ({outcome})")}: {note} "
                  + (newRevision ? "The next revision replaces it." : "It comes back corrected under the same revision."),
            document.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (revision, null);
    }

    /// <summary>
    /// One entry in a person's to-do list about a revision. <c>Kind</c>: ACCEPT_SUBMISSION (Document Control checks
    /// what arrived), CORRECT_AND_RESUBMIT (returned to its sender for a correction), RETURNED_BY_REVIEW (its review
    /// sent it back to its author; the next revision replaces it), TO_ROUTE (accepted from another organization, not
    /// yet sent for review) or DRAFT (the author's own, in preparation). <c>Note</c> is why it was returned, or, for a
    /// draft, where its files are (<c>FilesStates</c>).
    /// </summary>
    public sealed record RevisionWork(string Kind, Guid DocumentId, string DocumentNumber, string Title, Guid RevisionId,
        string Revision, int Submission, string? Note, DateTimeOffset Since);

    /// <summary>
    /// What waits on this person about revisions: submissions to accept and accepted ones to send for review (Document
    /// Control), returned ones to correct, revisions their review sent back, and their own drafts.
    /// </summary>
    public async Task<IReadOnlyList<RevisionWork>> WorkAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        var projectId = access.Project.Id;
        var me = access.UserId;
        var control = access.Holds(Verbs.Control);
        var party = access.IsInternal ? null : access.PartyCode;
        var rows = await (
            from r in db.Revisions
            join d in db.Documents on r.DocumentId equals d.Id
            where r.ProjectId == projectId
                && ((control && r.State == RevisionStates.Received)
                    || (r.State == RevisionStates.Correcting && (r.AuthoredById == me || (party != null && r.AuthoredByParty == party)))
                    || (r.State == RevisionStates.Returned && d.LatestRevisionId == r.Id && r.AuthoredById == me)
                    || (r.State == RevisionStates.InPreparation && control && r.AuthoredByParty != null
                        && db.Parties.Any(p => p.Code == r.AuthoredByParty && !p.IsInternal))
                    || (r.State == RevisionStates.InPreparation && r.AuthoredById == me && party == null))
            orderby r.CreatedAt
            select new
            {
                r.State,
                DocumentId = d.Id,
                d.Number,
                d.Title,
                r.Id,
                r.Value,
                r.Submission,
                r.ReturnedReason,
                r.ReturnedAt,
                r.CreatedAt,
                r.AuthoredById,
                r.AuthoredByParty,
                r.FilesState,
                r.ControlOutcome
            })
            .ToListAsync(cancellationToken);
        var outside = (await db.Parties.AsNoTracking().Where(p => !p.IsInternal).Select(p => p.Code).ToListAsync(cancellationToken)).ToHashSet();
        return rows.Select(x =>
        {
            var fromOutside = x.AuthoredByParty is { } code && outside.Contains(code);
            var kind = x.State switch
            {
                RevisionStates.Received => "ACCEPT_SUBMISSION",
                RevisionStates.Correcting => "CORRECT_AND_RESUBMIT",
                RevisionStates.Returned => "RETURNED_BY_REVIEW",
                _ => control && fromOutside ? "TO_ROUTE" : "DRAFT",
            };
            var note = kind switch
            {
                "CORRECT_AND_RESUBMIT" => x.ReturnedReason,
                "RETURNED_BY_REVIEW" => x.ReturnedReason ?? x.ControlOutcome,
                "DRAFT" => x.FilesState,
                _ => null,
            };
            var since = kind is "CORRECT_AND_RESUBMIT" or "RETURNED_BY_REVIEW" ? x.ReturnedAt ?? x.CreatedAt : x.CreatedAt;
            return new RevisionWork(kind, x.DocumentId, x.Number, x.Title, x.Id, x.Value, x.Submission, note, since.ToDateTimeOffset());
        }).ToList();
    }
}
