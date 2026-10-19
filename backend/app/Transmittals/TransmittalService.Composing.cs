using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Transmittals;

public sealed partial class TransmittalService
{
    // ── Composing ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Body of a transmittal the control function composes itself: released revisions, the people and outside parties
    /// it goes to, why (a reason for issue), a subject, a message, and when an answer is due if one is wanted.
    /// </summary>
    public sealed record ComposeRequest(
        Guid[]? RevisionIds, Guid[]? UserIds, Guid[]? PartyIds, string? Reason, string? Subject = null, string? Message = null,
        DateOnly? ResponseDue = null, Guid[]? CopyUserIds = null, bool Draft = false, Guid? InReplyToId = null, Guid? FollowsId = null,
        string? FollowKind = null, DateOnly? IssuedOn = null, Dictionary<string, string?>? Extras = null, Guid? ActivityId = null,
        string? ActivityAsk = null, Guid[]? PlaceholderIds = null, bool? ResponseRequired = null);

    /// <summary>A compose request checked: what it carries, to whom, and when it is dated.</summary>
    private sealed record Prepared(
        string Reason, string Subject, string? Message, LocalDate? Due, List<(Document Document, Revision Revision)> Items,
        List<Addressee> People, List<Party> Parties, List<Addressee> Copies, Instant IssuedAt, Guid? InReplyToId, Guid? FollowsId,
        string? FollowKind, string? Extras, List<Member> Members, Guid? ActivityId = null, string? ActivityAsk = null,
        List<(Document Document, LocalDate? Due)>? Placeholders = null, Party? Supplier = null);

    /// <summary>
    /// Issues released revisions directly, without an issue request: one transmittal to the project's own people
    /// chosen, and one to each outside party; those copied in are on each. Only those who may control or transmit
    /// every document do this. A letter may carry no documents when it has a subject and a message.
    /// </summary>
    public async Task<(IReadOnlyList<Transmittal> Sent, IResult? Problem)> ComposeAsync(
        ProjectAccess access, ComposeRequest request, CancellationToken cancellationToken)
    {
        var (prepared, problem) = await PrepareAsync(access, request, cancellationToken);
        if (problem is not null) return ([], problem);
        var p = prepared!;
        var actor = new Actor(access.UserId, access.UserName);
        var sent = new List<Transmittal>();
        Raise Of(Party? to, string toName, IReadOnlyList<Addressee> recipients) => new(access.Project, actor, p.Reason, p.Subject, p.Message,
            to, toName, p.Items, recipients, ResponseDue: p.Due, Copies: p.Copies, IssuedAt: p.IssuedAt, InReplyToId: p.InReplyToId,
            FollowsId: p.FollowsId, FollowKind: p.FollowKind, Extras: p.Extras, ActivityId: p.ActivityId, ActivityAsk: p.ActivityAsk,
            Placeholders: p.Placeholders, ResponseRequired: request.ResponseRequired);
        // Placeholders go to the supplier that owes them, alone: one transmittal, to its people named (or all of them).
        if (p.Supplier is { } supplier)
        {
            sent.Add(await RaiseAsync(Of(supplier, supplier.Name, p.People.Count > 0 ? p.People : AddresseesOf(supplier, p.Members)), cancellationToken));
            await db.SaveChangesAsync(cancellationToken);
            return (sent, null);
        }
        if (p.People.Count > 0 || p.Parties.Count == 0) sent.Add(await RaiseAsync(Of(null, "Internal distribution", p.People), cancellationToken));
        foreach (var party in p.Parties) sent.Add(await RaiseAsync(Of(party, party.Name, AddresseesOf(party, p.Members)), cancellationToken));
        foreach (var (document, revision) in p.Items)
        {
            await audit.WriteAsync(actor, "ISSUED", "Revision", revision.Id, Label(document, revision),
                $"Issued {p.Reason}: {string.Join(", ", sent.Select(t => t.Number))}.", access.Project.Id, cancellationToken);
        }
        await db.SaveChangesAsync(cancellationToken);
        // Sent out, a released revision may now count for the actions needing it (where released and issued are apart).
        if (p.Items.Count > 0)
        {
            await Actions.Readiness.RestateDocumentsAsync(db, clock, [.. p.Items.Select(i => i.Document.Id).Distinct()], cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
        }
        return (sent, null);
    }

    /// <summary>
    /// What the project's transmittal form insists on (Settings, Forms &amp; fields), for a transmittal one of ours sends:
    /// checked when it is sent, never on a draft.
    /// </summary>
    public Task<IResult?> FormProblemAsync(ProjectAccess access, ComposeRequest request, CancellationToken cancellationToken) =>
        Settings.FormRules.CheckAsync(db, access.Project.Id, "TRANSMITTAL", new Dictionary<string, bool>
        {
            ["subject"] = !string.IsNullOrWhiteSpace(request.Subject), ["message"] = !string.IsNullOrWhiteSpace(request.Message),
            ["cc"] = request.CopyUserIds is { Length: > 0 },
        }, request.Extras, cancellationToken);

    private async Task<(Prepared? Prepared, IResult? Problem)> PrepareAsync(ProjectAccess access, ComposeRequest request, CancellationToken cancellationToken)
    {
        static (Prepared?, IResult?) Fail(IResult problem) => (null, problem);
        var revisionIds = request.RevisionIds?.Distinct().ToList() ?? [];
        var placeholderIds = request.PlaceholderIds?.Distinct().ToList() ?? [];
        var subjectGiven = request.Subject?.Trim() is { Length: > 0 };
        var messageGiven = request.Message?.Trim() is { Length: > 0 };
        if (revisionIds.Count > 500) return Fail(Problems.Invalid("ITEMS_REQUIRED", "Choose at most 500 released revisions."));
        // Sending our documents out (ISSUE): where the control function carries it out, whoever wants a revision sent asks
        // for it (on the document, "Ask for rev X to be sent"), and the control function raises and sends the transmittal.
        if (revisionIds.Count > 0 && access.IsInternal && !access.Holds(Verbs.Control)
            && await Settings.ProjectAnswers.ControlDoesAsync(db, access.Project.Id, "ISSUE", cancellationToken))
            return Fail(Problems.Forbidden("CONTROL_SENDS",
                "On this project the control function sends documents out: ask for each to be sent from its page (\"Ask for rev … to be sent\"), with who and why."));
        if (revisionIds.Count == 0 && placeholderIds.Count == 0 && !(subjectGiven && messageGiven))
            return Fail(Problems.Invalid("ITEMS_REQUIRED", "Enclose at least one released revision, or write a subject and a message: a letter says something."));
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var reason = request.Reason?.Trim() ?? "";
        if (!catalog.IsActive(TransmittalSets.Reasons, reason))
            return Fail(Problems.Invalid("VALUE_NOT_PUBLISHED", $"{reason} is not a published reason for issue.", new { field = "reason", value = reason }));
        // A data transmittal carries documents: words alone are an information transmittal (a request, an answer…).
        var isData = catalog.Prop(TransmittalSets.Reasons, reason, "family") is not { ValueKind: System.Text.Json.JsonValueKind.String } family
            || family.GetString() != "Information";
        if (isData && revisionIds.Count == 0 && placeholderIds.Count == 0)
            return Fail(Problems.Invalid("FILE_REQUIRED", "A data transmittal carries a document: enclose one from the register, or choose an information reason to write a letter."));
        var revisions = await db.Revisions.Where(r => revisionIds.Contains(r.Id) && r.ProjectId == access.Project.Id).ToListAsync(cancellationToken);
        var documentIds = revisions.Select(r => r.DocumentId).ToList();
        var documents = await DocumentQueries.Visible(db, access, catalog.RestrictedLevels())
            .Where(d => documentIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id, cancellationToken);
        if (revisions.Count != revisionIds.Count || revisions.Any(r => !documents.ContainsKey(r.DocumentId)))
            return Fail(Problems.NotFound("REVISION_NOT_FOUND", "A revision chosen does not exist or is not yours to see."));
        if (revisions.FirstOrDefault(r => r.State != RevisionStates.Released) is { } unreleased)
            return Fail(Problems.Conflict("NOT_RELEASED", $"{Label(documents[unreleased.DocumentId], unreleased)} is not released: only released revisions are issued."));
        if (revisions.FirstOrDefault(r => r.HeldAt is not null) is { } held)
            return Fail(Problems.Conflict("ON_HOLD", $"{Label(documents[held.DocumentId], held)} is on hold, not for use."));
        if (documents.Values.FirstOrDefault(d => !access.Allows(Verbs.Control, d.Facts) && !access.Allows(Verbs.Transmit, d.Facts)) is { } refused)
            return Fail(Problems.Forbidden("TRANSMIT_NOT_ALLOWED", $"Your function does not issue {refused.Number}."));
        if (revisionIds.Count == 0 && placeholderIds.Count == 0 && !access.IsInternal)
            return Fail(Problems.Forbidden("TRANSMIT_NOT_ALLOWED", "Only the project's own people write letters here."));

        var members = await MembersAsync(access.Project, cancellationToken);
        var userIds = request.UserIds?.Distinct().ToList() ?? [];
        var people = members.Where(m => userIds.Contains(m.UserId)).Select(m => new Addressee(m.UserId, null, m.Name, m.PartyName)).ToList();
        if (people.Count != userIds.Count) return Fail(Problems.Invalid("RECIPIENT_UNKNOWN", "Someone chosen is not active on this project."));
        var partyIds = request.PartyIds?.Distinct().ToList() ?? [];
        var parties = await db.Parties.AsNoTracking().Where(p => partyIds.Contains(p.Id) && p.Active).OrderBy(p => p.Name).ToListAsync(cancellationToken);
        if (parties.Count != partyIds.Count) return Fail(Problems.Invalid("PARTY_UNKNOWN", "An organization chosen is not an active party."));
        if (people.Count == 0 && parties.Count == 0) return Fail(Problems.Invalid("RECIPIENTS_REQUIRED", "Choose who it goes to."));
        var copyIds = request.CopyUserIds?.Distinct().Where(id => !userIds.Contains(id)).ToList() ?? [];
        var copies = members.Where(m => copyIds.Contains(m.UserId)).Select(m => new Addressee(m.UserId, null, m.Name, m.PartyName, RecipientKinds.Cc)).ToList();
        if (copies.Count != copyIds.Count) return Fail(Problems.Invalid("RECIPIENT_UNKNOWN", "Someone copied in is not active on this project."));

        var (issuedAt, notYet) = WorkingCalendar.Moment(clock, access.Project.TimeZone, request.IssuedOn);
        if (notYet is not null) return Fail(Problems.Invalid("DATE_IN_FUTURE", $"The date of issue cannot be later than today. {notYet}"));
        if (revisions.FirstOrDefault(r => r.ReleasedAt > issuedAt!.Value.Plus(Duration.FromHours(12))) is { } later)
            return Fail(Problems.Invalid("DATE_BEFORE_RELEASE", $"{Label(documents[later.DocumentId], later)} was released after that day."));
        Transmittal? answered = null, followed = null;
        if (request.InReplyToId is { } replyTo)
        {
            answered = await Visible(access).AsNoTracking().SingleOrDefaultAsync(t => t.Id == replyTo, cancellationToken);
            if (answered is null) return Fail(Problems.NotFound("TRANSMITTAL_NOT_FOUND", "The transmittal it answers does not exist or is not yours to see."));
            if (answered.IssuedAt > issuedAt!.Value.Plus(Duration.FromHours(12)))
                return Fail(Problems.Invalid("DATE_BEFORE_ANSWERED", $"It cannot be dated before {answered.Number}, which it answers."));
        }
        string? followKind = null;
        if (request.FollowsId is { } follows)
        {
            followed = await Visible(access).AsNoTracking().SingleOrDefaultAsync(t => t.Id == follows, cancellationToken);
            if (followed is null) return Fail(Problems.NotFound("TRANSMITTAL_NOT_FOUND", "The transmittal it follows does not exist or is not yours to see."));
            followKind = (request.FollowKind ?? "SUPPLEMENT").Trim().ToUpperInvariant();
            if (followKind is not ("SUPPLEMENT" or "REPLACES"))
                return Fail(Problems.Invalid("FOLLOW_KIND_INVALID", "A follow-up either supplements the transmittal (SUPPLEMENT) or replaces it (REPLACES)."));
        }

        // A request to add a document to a schedule action names an action of this project.
        if (request.ActivityId is { } activityId
            && !await db.Activities.AnyAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, cancellationToken))
            return Fail(Problems.NotFound("ACTIVITY_NOT_FOUND", "The action it is about is not in this project's schedule."));
        var ask = request.ActivityId is null ? null : request.ActivityAsk == "DISCIPLINE" ? "DISCIPLINE" : "DOCUMENT";

        // Placeholders: the one exception to "only released revisions travel" — a supplier's document with nothing
        // released yet, asked of that supplier (theirs alone, from the control function), with the day it is due.
        var placeholders = new List<(Document Document, LocalDate? Due)>();
        Party? supplierTo = null;
        if (placeholderIds.Count > 0)
        {
            var asked = await DocumentQueries.Visible(db, access, catalog.RestrictedLevels())
                .Where(d => placeholderIds.Contains(d.Id)).OrderBy(d => d.Number).ToListAsync(cancellationToken);
            if (asked.Count != placeholderIds.Count)
                return Fail(Problems.NotFound("DOCUMENT_NOT_FOUND", "A document chosen does not exist or is not yours to see."));
            if ((await Packages.Intake.ReadAsync(db, access.Project.Id, cancellationToken)).Mode == Packages.Intake.AsReceived)
                return Fail(Problems.Conflict("INTAKE_AS_RECEIVED", "This project takes other organizations' documents as they come: no placeholder is asked."));
            var standsIn = await StandIns.ExchangesAsync(db, access, cancellationToken);
            if (!standsIn && asked.FirstOrDefault(d => !access.Allows(Verbs.Control, d.Facts)) is { } notControl)
                return Fail(Problems.Forbidden("CONTROL_ONLY", $"The control function asks a supplier for {notControl.Number}."));
            var owners = asked.Select(d => d.Originator).Distinct().ToList();
            var owner = owners.Count == 1 && owners[0] is { } code
                ? await db.Parties.AsNoTracking().FirstOrDefaultAsync(p => p.Code == code && !p.IsInternal && p.Active, cancellationToken) : null;
            // To that supplier alone: the organization itself, or its own people.
            var theirs = owner is not null && parties.All(p => p.Id == owner.Id)
                && people.All(a => members.Any(m => m.UserId == a.UserId && m.PartyId == owner.Id));
            if (owner is null || !theirs)
                return Fail(Problems.Invalid("PLACEHOLDER_TO_ITS_SUPPLIER",
                    "A placeholder goes to the outside organization that owes it, alone: send one supplier's documents at a time, to that supplier or its people."));
            supplierTo = owner;
            var latestIds = asked.Where(d => d.LatestRevisionId != null).Select(d => d.LatestRevisionId!.Value).ToList();
            var inReview = await db.Revisions.AsNoTracking().Where(r => latestIds.Contains(r.Id) && r.State == RevisionStates.InReview)
                .Select(r => r.DocumentId).ToListAsync(cancellationToken);
            // Asked once: after that it is handed back and forth (asked back, sent for an update).
            var askedBefore = await db.TransmittalItems.AsNoTracking()
                .Where(i => i.DocumentId != null && placeholderIds.Contains(i.DocumentId.Value) && i.Kind == TransmittalItemKinds.Placeholder)
                .Select(i => i.DocumentId!.Value).ToListAsync(cancellationToken);
            if (asked.FirstOrDefault(d => askedBefore.Contains(d.Id)) is { } again)
                return Fail(Problems.Conflict("ALREADY_REQUESTED", $"{again.Number} was asked of its supplier already: to change it, ask for it back from its page."));
            if (asked.FirstOrDefault(d => inReview.Contains(d.Id)) is { } reviewing)
                return Fail(Problems.Conflict("IN_REVIEW", $"{reviewing.Number} is in review: withdraw it from review, or release it, first."));
            // Due as the request says, or as planned for that document.
            var asDue = request.ResponseDue is { } rd ? LocalDate.FromDateOnly(rd) : (LocalDate?)null;
            placeholders = asked.Select(d => (d, asDue ?? d.PlannedDate)).ToList();
            // What a placeholder is issued for is set by itself: for use (IFU), where the organization publishes it.
            if (catalog.IsActive(TransmittalSets.Reasons, PlaceholderReason)) reason = PlaceholderReason;
        }

        var items = revisions.Select(r => (documents[r.DocumentId], r)).OrderBy(i => i.Item1.Number).ToList();
        var subject = subjectGiven ? request.Subject!.Trim()
            : items.Count == 1 && placeholders.Count == 0 ? $"{Label(items[0].Item1, items[0].r)}, {items[0].r.StatusCode}"
            : items.Count == 0 && placeholders.Count > 0 ? $"{placeholders.Count} document{(placeholders.Count == 1 ? "" : "s")} submitted to {supplierTo!.Name}"
            : $"{items.Count + placeholders.Count} documents";
        var message = messageGiven ? request.Message!.Trim() : null;
        // An answer asked for by the sender is asked by a day: that day is what says whether it came in time.
        if (request.ResponseRequired == true && request.ResponseDue is null)
            return Fail(Problems.Invalid("ANSWER_DATE_REQUIRED", "Say by when the answer is due: it is how a late answer is seen."));
        var due = request.ResponseDue is { } d ? LocalDate.FromDateOnly(d) : (LocalDate?)null;
        return (new Prepared(reason, subject, message, due, items, people, parties, copies, issuedAt!.Value, answered?.Id, followed?.Id,
            followKind, Documents.OwnFields.Write(null, request.Extras), members, request.ActivityId, ask, placeholders, supplierTo), null);
    }
}
