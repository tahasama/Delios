using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Settings;
using Delios.Host.Tenancy;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Documents;

public sealed partial class KeepingService
{
    // ── Void ──────────────────────────────────────────────────────────────────

    /// <summary>
    /// Voids the newest revision of a document: one released in error, or one never
    /// reviewed. What was released is voided by the authority that decided it or by
    /// Document Control (or, where the people doing the work carry this out, its
    /// author); what was never reviewed, by its author or Document Control. Whoever
    /// received it is told to stop using it.
    /// </summary>
    public async Task<(Revision? Revision, IResult? Problem)> VoidAsync(
        HttpContext http, ProjectAccess access, Guid documentId, Guid revisionId, VoidRequest request, CancellationToken cancellationToken)
    {
        var document = await VisibleAsync(access, documentId, cancellationToken);
        var revision = document is null ? null
            : await db.Revisions.SingleOrDefaultAsync(r => r.Id == revisionId && r.DocumentId == documentId, cancellationToken);
        if (document is null || revision is null) return (null, Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        var reason = request.Reason?.Trim() ?? "";
        if (reason.Length == 0) return (null, Problems.Invalid("REASON_REQUIRED", "Voiding is recorded with a reason."));
        if (document.LegalHold) return (null, OnHold(document));
        var newer = await db.Revisions.AsNoTracking().Where(r => r.DocumentId == documentId && r.CreatedAt > revision.CreatedAt)
            .OrderByDescending(r => r.CreatedAt).Select(r => r.Value).FirstOrDefaultAsync(cancellationToken);
        if (newer is not null)
        {
            return (null, Problems.Conflict("NOT_NEWEST",
                $"Rev {revision.Value} has already been replaced by rev {newer}. Only the newest revision can be voided; everything before it is frozen as it was issued."));
        }
        var reviews = await db.Reviews.AsNoTracking().Include(r => r.Steps).ThenInclude(s => s.Participants)
            .Where(r => r.RevisionId == revision.Id && r.Steps.Any()).ToListAsync(cancellationToken);
        var neverReviewed = revision.State == RevisionStates.InPreparation && reviews.Count == 0;
        if (revision.State != RevisionStates.Released && !neverReviewed)
        {
            return (null, Problems.Conflict("NOT_VOIDABLE",
                $"Rev {revision.Value} is {revision.State.ToLowerInvariant().Replace('_', ' ')}. A revision is voided when it was released in error, or when it was never reviewed at all.",
                new { state = revision.State }));
        }

        var control = access.Allows(Verbs.Control, document.Facts) || await Keepers.ConfiguresAsync(http);
        var author = revision.AuthoredById == access.UserId;
        var decider = reviews.Any(r => r.State == ReviewStates.Released
            && r.Steps.Any(s => s.Deciding && s.Participants.Any(p => p.UserId == access.UserId && p.AnsweredAt != null)));
        var selfCarries = !await ProjectAnswers.ControlDoesAsync(db, access.Project.Id, "VOID", cancellationToken);
        var allowed = control || (neverReviewed ? author : decider || (selfCarries && author));
        if (!allowed)
        {
            return (null, Problems.Forbidden("VOID_NOT_ALLOWED", neverReviewed
                ? "Its author or Document Control voids a revision nobody reviewed."
                : "Voiding what was issued is decided by the authority that approved it, or Document Control."));
        }

        var now = clock.GetCurrentInstant();
        var was = revision.State;
        revision.State = RevisionStates.Void;
        revision.VoidedAt = now;
        revision.VoidReason = reason;
        revision.VoidAuthority = access.UserName;
        revision.UnvoidedAt = null;
        revision.UnvoidedByName = null;
        revision.UnvoidReason = null;
        db.Enqueue(Reviews.RevisionMarked.RoutingKey, new Reviews.RevisionMarked(revision.TenantId, revision.Id, FileKinds.Void, $"Void: {reason}"));
        if (request.Reassessment?.Trim() is { Length: > 0 } reassessment)
        {
            revision.VoidReassessment = reassessment;
            revision.VoidReassessedAt = now;
        }
        if (document.LatestRevisionId == revision.Id) document.LatestRevisionState = RevisionStates.Void;
        document.UpdatedAt = now;
        await transmittals.LapseOpenAsync(revision.Id, access.UserName, cancellationToken);
        var label = $"{document.Number} rev {revision.Value}";
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "VOIDED", "Revision", revision.Id, label,
            $"{(was == RevisionStates.Released ? "Released" : "Never reviewed")} → Void. {reason}", access.Project.Id, cancellationToken);
        await notifier.NotifyAsync(document.TenantId, document.ProjectId, await ReceivedByAsync(revision.Id, cancellationToken),
            Notifications.NotificationKinds.General, $"Void: {label}",
            $"{reason} Stop using it, and reassess the work done from it.", $"/documents/{document.Id}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (revision, null);
    }

    /// <summary>
    /// Takes a void back, with a reason: the revision returns to what it was (released, or in preparation) and the people
    /// who received it are told it counts again. Only while it is still the newest revision and the document is not on hold.
    /// Document Control's, as the one who answers for what is in force.
    /// </summary>
    public async Task<(Revision? Revision, IResult? Problem)> UnvoidAsync(
        HttpContext http, ProjectAccess access, Guid documentId, Guid revisionId, VoidRequest request, CancellationToken cancellationToken)
    {
        var document = await VisibleAsync(access, documentId, cancellationToken);
        var revision = document is null ? null
            : await db.Revisions.SingleOrDefaultAsync(r => r.Id == revisionId && r.DocumentId == documentId, cancellationToken);
        if (document is null || revision is null) return (null, Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        if (revision.State != RevisionStates.Void) return (null, Problems.Conflict("NOT_VOID", $"Rev {revision.Value} is not void."));
        var reason = request.Reason?.Trim() ?? "";
        if (reason.Length == 0) return (null, Problems.Invalid("REASON_REQUIRED", "Taking a void back is recorded with a reason."));
        if (document.LegalHold) return (null, OnHold(document));
        if (!access.Allows(Verbs.Control, document.Facts) && !await Keepers.ConfiguresAsync(http))
            return (null, Problems.Forbidden("CONTROL_ONLY", "Document Control takes a void back."));
        if (document.State is not (DocumentStates.Planned or DocumentStates.Active))
            return (null, Problems.Conflict("DOCUMENT_NOT_OPEN", $"The document is {document.State.ToLowerInvariant()}: reinstate it first."));
        var newer = await db.Revisions.AsNoTracking().Where(r => r.DocumentId == documentId && r.CreatedAt > revision.CreatedAt)
            .Select(r => r.Value).FirstOrDefaultAsync(cancellationToken);
        if (newer is not null)
            return (null, Problems.Conflict("NOT_NEWEST", $"Rev {newer} came after it: rev {revision.Value} stays void."));

        var now = clock.GetCurrentInstant();
        var back = revision.ReleasedAt is not null ? RevisionStates.Released : RevisionStates.InPreparation;
        revision.State = back;
        // The void stays on record beside its taking back: the revision says both.
        revision.UnvoidedAt = clock.GetCurrentInstant();
        revision.UnvoidedByName = access.UserName;
        revision.UnvoidReason = reason;
        if (document.LatestRevisionId == revision.Id) document.LatestRevisionState = back;
        document.UpdatedAt = now;
        var label = $"{document.Number} rev {revision.Value}";
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "UNVOIDED", "Revision", revision.Id, label,
            $"Void → {(back == RevisionStates.Released ? "Released" : "In preparation")}. {reason}", access.Project.Id, cancellationToken);
        await notifier.NotifyAsync(document.TenantId, document.ProjectId, await ReceivedByAsync(revision.Id, cancellationToken),
            Notifications.NotificationKinds.General, $"Valid again: {label}",
            $"The void on it was taken back. {reason}", $"/documents/{document.Id}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (revision, null);
    }

    /// <summary>Records what was found of the work done from a voided revision. Whoever may void it records it.</summary>
    public async Task<(Revision? Revision, IResult? Problem)> ReassessAsync(
        HttpContext http, ProjectAccess access, Guid revisionId, ReassessmentRequest request, CancellationToken cancellationToken)
    {
        var revision = await db.Revisions.SingleOrDefaultAsync(r => r.Id == revisionId && r.ProjectId == access.Project.Id, cancellationToken);
        var document = revision is null ? null : await VisibleAsync(access, revision.DocumentId, cancellationToken);
        if (revision is null || document is null) return (null, Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        if (revision.State != RevisionStates.Void) return (null, Problems.Conflict("NOT_VOID", "Only a voided revision is reassessed."));
        var note = request.Note?.Trim() ?? "";
        if (note.Length == 0) return (null, Problems.Invalid("NOTE_REQUIRED", "Describe the reassessment of work performed."));
        var selfCarries = !await ProjectAnswers.ControlDoesAsync(db, access.Project.Id, "VOID", cancellationToken);
        if (!access.Allows(Verbs.Control, document.Facts) && !await Keepers.ConfiguresAsync(http)
            && !(revision.AuthoredById == access.UserId && (selfCarries || revision.ReleasedAt is null)))
        {
            return (null, Problems.Forbidden("REASSESS_NOT_ALLOWED", "Whoever carries out voiding records its reassessment."));
        }
        revision.VoidReassessment = note;
        revision.VoidReassessedAt = clock.GetCurrentInstant();
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "VOID_REASSESSED", "Revision", revision.Id,
            $"{document.Number} rev {revision.Value}", note, access.Project.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (revision, null);
    }

    /// <summary>Voided revisions nobody has reassessed yet, newest first.</summary>
    public async Task<IReadOnlyList<UnresolvedVoid>> UnresolvedVoidsAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        var restricted = (await Catalog.LoadAsync(db, cancellationToken)).RestrictedLevels();
        var visible = DocumentQueries.Visible(db, access, restricted).Select(d => d.Id);
        return await (from r in db.Revisions
                      join d in db.Documents on r.DocumentId equals d.Id
                      where r.ProjectId == access.Project.Id && r.State == RevisionStates.Void && r.VoidReassessment == null
                          && visible.Contains(d.Id)
                      orderby r.VoidedAt descending
                      select new UnresolvedVoid(r.Id, d.Id, d.Number, d.Title, r.Value, r.VoidReason, r.VoidedAt!.Value.ToDateTimeOffset(), r.VoidAuthority))
            .ToListAsync(cancellationToken);
    }
}
