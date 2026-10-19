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
    // ── A supplier's document: who holds it, handing it over, asking for it back ──

    /// <summary>
    /// The control function (or an administrator) sends a supplier's document we hold to the supplier, for them to update
    /// it: they hold it from then on. A revision not yet reviewed goes as it is and comes back under the same value;
    /// only a release, or a review that returns it, makes their next one a new revision.
    /// </summary>
    public async Task<IResult> SendToSupplierAsync(
        HttpContext http, ProjectAccess access, Guid documentId, SupplierNoteRequest request, CancellationToken cancellationToken)
    {
        var document = await db.Documents.SingleOrDefaultAsync(d => d.Id == documentId && d.ProjectId == access.Project.Id, cancellationToken);
        if (document is null || await VisibleAsync(access, documentId, cancellationToken) is null)
            return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (!access.IsInternal || (!access.Allows(Verbs.Control, document.Facts) && !await Keepers.ConfiguresAsync(http)
                && !await StandIns.ExchangesAsync(db, access, cancellationToken)))
            return Problems.Forbidden("CONTROL_ONLY", "The control function sends a document to its supplier.");
        var supplier = await SupplierOfAsync(document, cancellationToken);
        if (supplier is null || document.WithSupplier is null)
            return Problems.Conflict("NOT_EXCHANGED", "Only a document asked of a supplier is sent to them for an update.");
        if (document.WithSupplier == true) return Problems.Conflict("WITH_SUPPLIER", $"It is with {supplier.Name} already.");
        var note = request.Note?.Trim() is { Length: > 0 } written ? written : null;
        if (note is { Length: > 4000 }) return Problems.Invalid("NOTE_TOO_LONG", "Keep the message under 4000 characters.");
        var (sent, refused) = await HandToSupplierAsync(access, document, supplier, note, cancellationToken);
        if (refused is not null) return refused;
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "SENT_TO_SUPPLIER", "Document", document.Id, document.Number,
            $"Sent to {supplier.Name} for an update on {sent}." + (note is null ? "" : $" {note}"), access.Project.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// The side that does not hold a supplier's document asks the holder to hand it back for an update (RETURN_FOR_UPDATE),
    /// saying why. On our side the control function (or an administrator) asks; on theirs, whoever of the supplier may
    /// upload. One ask open at a time; the holder is told, and answers on the document or from their Home.
    /// </summary>
    public async Task<IResult> AskBackAsync(
        HttpContext http, ProjectAccess access, Guid documentId, SupplierNoteRequest request, CancellationToken cancellationToken)
    {
        var document = await VisibleAsync(access, documentId, cancellationToken);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        var supplier = await SupplierOfAsync(document, cancellationToken);
        if (supplier is null || document.WithSupplier is null)
            return Problems.Conflict("NOT_EXCHANGED", "Only a document exchanged with a supplier is asked back.");
        var fromSupplier = !access.IsInternal;
        if (fromSupplier && !await SupplierMayAsync(access, document))
            return Problems.Forbidden("NOT_ALLOWED", $"Whoever of {supplier.Name} may upload asks for it back.");
        if (!fromSupplier && !access.Allows(Verbs.Control, document.Facts) && !await Keepers.ConfiguresAsync(http)
            && !await StandIns.ExchangesAsync(db, access, cancellationToken))
            return Problems.Forbidden("CONTROL_ONLY", "The control function asks a supplier to hand a document back.");
        // Asked of the side that holds it: the supplier asks us when we hold it, we ask them when they do.
        if (document.WithSupplier == fromSupplier)
            return Problems.Conflict("ALREADY_YOURS", "It is with you already: change it, then send it.");
        if (await db.HandBackRequests.AnyAsync(a => a.DocumentId == document.Id && a.AnsweredAt == null, cancellationToken))
            return Problems.Conflict("ALREADY_ASKED", "It has been asked back already; wait for the answer.");
        var reason = request.Note?.Trim() ?? "";
        if (reason.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why you need it back.");
        if (reason.Length > 2000) return Problems.Invalid("REASON_TOO_LONG", "Keep the reason under 2000 characters.");
        var ask = new HandBackRequest
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            DocumentId = document.Id,
            FromSupplier = fromSupplier,
            AskedById = access.UserId,
            AskedByName = access.UserName,
            Reason = reason,
            AskedAt = clock.GetCurrentInstant(),
        };
        db.HandBackRequests.Add(ask);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "ASKED_BACK", "Document", document.Id, document.Number,
            $"{(fromSupplier ? supplier.Name : "We")} asked for it back to update it: {reason}", access.Project.Id, cancellationToken);
        await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, await HoldersAsync(document, supplier, !fromSupplier, cancellationToken),
            Notifications.NotificationKinds.General, $"{document.Number}: asked back for update by {access.UserName}",
            $"{reason}\n\nAccept to hand it over, or refuse and say why.", $"/documents/{document.Id}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// The holder answers an ask to hand a supplier's document back. Accepted, the document passes to whoever asked (a
    /// revision not yet reviewed passes as it is, under the same value); refused, nothing changes, and why is required.
    /// The one who asked is told either way.
    /// </summary>
    public async Task<IResult> AnswerAskAsync(
        HttpContext http, ProjectAccess access, Guid askId, AnswerAskRequest request, CancellationToken cancellationToken)
    {
        var ask = await db.HandBackRequests.SingleOrDefaultAsync(a => a.Id == askId && a.ProjectId == access.Project.Id, cancellationToken);
        if (ask is null) return Problems.NotFound("ASK_NOT_FOUND", "No such request.");
        if (ask.AnsweredAt is not null) return Problems.Conflict("ALREADY_ANSWERED", "It has been answered already.");
        var document = await db.Documents.SingleOrDefaultAsync(d => d.Id == ask.DocumentId, cancellationToken);
        if (document is null || await VisibleAsync(access, ask.DocumentId, cancellationToken) is null)
            return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        var supplier = await SupplierOfAsync(document, cancellationToken);
        if (supplier is null) return Problems.Conflict("NOT_EXCHANGED", "Only a document exchanged with a supplier is asked back.");
        // The holder answers: we, when the supplier asked; the supplier, when we asked.
        var mayAnswer = ask.FromSupplier
            ? access.IsInternal && (access.Allows(Verbs.Control, document.Facts) || await Keepers.ConfiguresAsync(http)
                || await StandIns.ExchangesAsync(db, access, cancellationToken))
            : !access.IsInternal && await SupplierMayAsync(access, document);
        if (!mayAnswer)
            return Problems.Forbidden("NOT_THE_HOLDER", ask.FromSupplier ? "The control function answers this." : $"{supplier.Name} answers this.");
        var answer = request.Answer?.Trim() is { Length: > 0 } written ? written : null;
        if (!request.Accept && answer is null) return Problems.Invalid("REASON_REQUIRED", "Say why it is refused.");
        if (answer is { Length: > 2000 }) return Problems.Invalid("ANSWER_TOO_LONG", "Keep the answer under 2000 characters.");

        string? sent = null;
        if (request.Accept)
        {
            if (ask.FromSupplier)
            {
                // To the supplier, on a transmittal, like any send of ours.
                var (number, refused) = await HandToSupplierAsync(access, document, supplier, answer ?? $"Handed back at your request: {ask.Reason}", cancellationToken);
                if (refused is not null) return refused;
                sent = number;
            }
            else
            {
                // Back with us: a revision they had not sent yet stays theirs under its value; ours to work on now.
                var latest = document.LatestRevisionId is { } id ? await db.Revisions.SingleAsync(r => r.Id == id, cancellationToken) : null;
                if (latest?.State is RevisionStates.Correcting)
                {
                    latest.State = RevisionStates.InPreparation;
                    document.LatestRevisionState = latest.State;
                }
                document.WithSupplier = false;
                document.UpdatedAt = clock.GetCurrentInstant();
            }
        }
        ask.AnsweredAt = clock.GetCurrentInstant();
        ask.AnsweredByName = access.UserName;
        ask.Accepted = request.Accept;
        ask.Answer = answer;
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), request.Accept ? "HANDED_BACK" : "HAND_BACK_REFUSED", "Document",
            document.Id, document.Number,
            (request.Accept ? $"Handed back to {(ask.FromSupplier ? supplier.Name : "us")}{(sent is null ? "" : $" on {sent}")}." : "Refused to hand it back.")
            + (answer is null ? "" : $" {answer}") + $" Asked by {ask.AskedByName}: {ask.Reason}", access.Project.Id, cancellationToken);
        await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, [ask.AskedById], Notifications.NotificationKinds.General,
            $"{document.Number}: {(request.Accept ? "handed back to you" : "not handed back")}",
            answer ?? (request.Accept ? "It is yours to update now." : null), $"/documents/{document.Id}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>Every ask to hand the document back, newest first, with its answer.</summary>
    public async Task<IReadOnlyList<HandBackView>?> AsksAsync(ProjectAccess access, Guid documentId, CancellationToken cancellationToken)
    {
        if (await VisibleAsync(access, documentId, cancellationToken) is null) return null;
        return (await db.HandBackRequests.AsNoTracking().Where(a => a.DocumentId == documentId).OrderByDescending(a => a.AskedAt)
                .ToListAsync(cancellationToken))
            .Select(a => new HandBackView(a.Id, a.Kind, a.FromSupplier, a.AskedByName, a.Reason, a.AskedAt.ToDateTimeOffset(),
                a.AnsweredAt?.ToDateTimeOffset(), a.AnsweredByName, a.Accepted, a.Answer)).ToList();
    }

    /// <summary>
    /// Hands the document to its supplier on a transmittal, the way it was first asked of them (reason, package, due
    /// date): a revision not yet reviewed goes as it is and comes back under the same value. Does not save.
    /// </summary>
    private async Task<(string? Number, IResult? Problem)> HandToSupplierAsync(
        ProjectAccess access, Document document, Party supplier, string? note, CancellationToken cancellationToken)
    {
        var latest = document.LatestRevisionId is { } latestId ? await db.Revisions.SingleAsync(r => r.Id == latestId, cancellationToken) : null;
        if (latest?.State is RevisionStates.InReview)
            return (null, Problems.Conflict("IN_REVIEW", $"Rev {latest.Value} is in review (or decided and not released): withdraw it from review, or release it, first."));
        var asked = await (from i in db.TransmittalItems
                           join t in db.Transmittals on i.TransmittalId equals t.Id
                           where i.DocumentId == document.Id && i.Kind == TransmittalItemKinds.Placeholder
                           orderby t.IssuedAt descending
                           select new { t.Reason, t.PackageId, i.DueDate }).FirstAsync(cancellationToken);
        var members = await transmittals.MembersAsync(access.Project, cancellationToken);
        var sent = await transmittals.RaiseAsync(new TransmittalService.Raise(access.Project, new Actor(access.UserId, access.UserName), asked.Reason,
            $"{document.Number}: sent to you for an update", note, supplier, supplier.Name, [],
            TransmittalService.AddresseesOf(supplier, members), PackageId: asked.PackageId,
            Placeholders: [(document, asked.DueDate)]), cancellationToken);
        // Raising it handed it over: a placeholder puts it with them, and a revision not yet reviewed goes as it is.
        document.UpdatedAt = clock.GetCurrentInstant();
        return (sent.Number, null);
    }

    /// <summary>Whoever answers for the side holding the document: The control function for us, the supplier's uploaders for them.</summary>
    private async Task<List<Guid>> HoldersAsync(Document document, Party supplier, bool supplierHolds, CancellationToken cancellationToken) =>
        supplierHolds
            ? await db.Users.AsNoTracking().Where(u => u.PartyId == supplier.Id && u.Active).Select(u => u.Id).ToListAsync(cancellationToken)
            : await notifier.ControlHoldersAsync(document.ProjectId, cancellationToken);

    /// <summary>Whether this person is of the supplier that produces the document and may upload for it.</summary>
    private Task<bool> SupplierMayAsync(ProjectAccess access, Document document) =>
        Task.FromResult(!access.IsInternal && access.PartyCode == document.Originator
            && (access.Allows(Verbs.Create, document.Facts) || access.Allows(Verbs.Revise, document.Facts)));

    /// <summary>The outside organization that produces the document; null for our own.</summary>
    private Task<Party?> SupplierOfAsync(Document document, CancellationToken cancellationToken) =>
        document.Originator is { } code
            ? db.Parties.AsNoTracking().FirstOrDefaultAsync(p => p.Code == code && !p.IsInternal, cancellationToken)
            : Task.FromResult<Party?>(null);
}
