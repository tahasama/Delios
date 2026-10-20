using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Reviews;
using Delios.Host.Actions;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Transmittals;

/// <summary>
/// A transmittal as its page shows it: the transmittal itself, where it stands (DRAFT, ISSUED; what came in: ISSUED
/// while something waits on the check or on registering, then REJECTED or ACCEPTED), who checked it and why it was
/// returned, the organization it is from, each document it carried, the files that came with it, and the request it
/// carried out. <c>Parties</c>: how each organization it went to takes things outside the system.
/// </summary>
public sealed record TransmittalPage(TransmittalView Transmittal, string Status, string IssuingParty, string? CheckedBy, DateTimeOffset? CheckedAt,
    string? ReturnedReason, IReadOnlyList<CarriedItem> Carried, IReadOnlyList<ArrivedFile> Files, IReadOnlyList<CarriedRequest> IssueRequests,
    IReadOnlyDictionary<Guid, PartyHabits> Parties, bool MayCheck = false, bool AsReceived = false,
    IReadOnlyDictionary<Guid, MatchedBefore>? MatchedBefore = null, TransmittalAsk? Ask = null);

/// <summary>One of our documents a number of theirs was matched to before: proposed for what came under it again.</summary>
public sealed record MatchedBefore(Guid Id, string Number, string Title, string? Revision);

/// <summary>
/// A document a transmittal carried, as it stands now: its revision's state (REQUESTED for a placeholder), the newest
/// revision of the document, the actions that need it, how often it went out before, the check on arrival, and the
/// review this transmittal led to (on what came in, the latest started since it arrived; on what went for a review step,
/// that review).
/// </summary>
public sealed record CarriedItem(Guid Id, string Kind, Guid DocumentId, Guid? RevisionId, string Number, string Title, string Revision,
    string? Status, string RevisionState, string? CurrentRevision, IReadOnlyList<CarriedAction> NeededFor, int SentBefore, ArrivalView? Arrival,
    CarriedReview? Review, IReadOnlyList<ItemFileView> Files);

public sealed record CarriedAction(string Code, string Name);
public sealed record CarriedReview(Guid Id, DateTimeOffset StartedAt, bool Open);
public sealed record CarriedRequest(Guid Id, string Reason, string? Note);
public sealed record PartyHabits(string? ExternalSystem, bool EvidenceRequired);

/// <summary>A file that came with what arrived, or that the control function kept with it later; who kept it, when.</summary>
public sealed record ArrivedFile(Guid Id, string Name, long Size, string Sha256, string KeptBy, DateTimeOffset KeptAt);

public static class TransmittalStatuses
{
    public const string Draft = "DRAFT", Issued = "ISSUED", Rejected = "REJECTED", Accepted = "ACCEPTED";
}

public sealed partial class TransmittalService
{
    /// <summary>The page of one transmittal, sent or still a draft. Only documents the reader may see are described.</summary>
    public async Task<TransmittalPage> PageAsync(ProjectAccess access, TransmittalView t, CancellationToken cancellationToken)
    {
        var incoming = t.Direction == TransmittalDirections.Incoming;
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var documentIds = t.Items.Where(i => i.DocumentId is not null).Select(i => i.DocumentId!.Value).Distinct().ToList();
        var visible = access.Holds(Verbs.Read)
            ? await DocumentQueries.Visible(db, access).Where(d => documentIds.Contains(d.Id))
                .Select(d => d.Id).ToListAsync(cancellationToken)
            : [];
        var revisions = await db.Revisions.AsNoTracking().Where(r => visible.Contains(r.DocumentId)).ToListAsync(cancellationToken);
        var byId = revisions.ToDictionary(r => r.Id);
        var newest = revisions.GroupBy(r => r.DocumentId).ToDictionary(g => g.Key, g => g.MaxBy(r => r.CreatedAt)!.Value);
        var reviews = (await db.Reviews.AsNoTracking().Where(r => visible.Contains(r.DocumentId))
            .Select(r => new { r.Id, r.RevisionId, r.State, r.StartedAt }).ToListAsync(cancellationToken)).ToLookup(r => r.RevisionId);
        var actions = (await (from n in db.Requirements
                              join a in db.Activities on n.ActivityId equals a.Id
                              where visible.Contains(n.DocumentId) && a.State == ActivityStates.Active
                              orderby n.NeededBy
                              select new { n.DocumentId, a.Code, a.Name }).ToListAsync(cancellationToken)).ToLookup(n => n.DocumentId);
        var issuedAt = NodaTime.Instant.FromDateTimeOffset(t.IssuedAt);
        var before = (await (from i in db.TransmittalItems
                             join o in db.Transmittals on i.TransmittalId equals o.Id
                             where i.DocumentId != null && visible.Contains(i.DocumentId.Value) && o.Id != t.Id
                                 && o.Direction == TransmittalDirections.Outgoing && o.IssuedAt < issuedAt
                             select new { DocumentId = i.DocumentId!.Value, o.Id }).Distinct().ToListAsync(cancellationToken))
            .GroupBy(x => x.DocumentId).ToDictionary(g => g.Key, g => g.Count());

        // Something unplanned matched or registered reads under our number (the item keeps theirs, as it came).
        var looseIds = t.Items.Where(i => i.Kind == TransmittalItemKinds.Unplanned && i.DocumentId is not null).Select(i => i.DocumentId!.Value).ToList();
        var ourNumbers = looseIds.Count == 0 ? new Dictionary<Guid, string>()
            : await db.Documents.AsNoTracking().Where(d => looseIds.Contains(d.Id) && visible.Contains(d.Id)).ToDictionaryAsync(d => d.Id, d => d.Number, cancellationToken);
        // Only what is in the register is carried; something unplanned waits on the transmittal, as files that came with it.
        var carried = t.Items.Where(i => i.DocumentId is not null).Select(item =>
        {
            var documentId = item.DocumentId!.Value;
            var revision = item.RevisionId is { } id ? byId.GetValueOrDefault(id) : null;
            var review = item.RevisionId is { } rid
                ? reviews[rid].Where(r => incoming ? r.StartedAt >= issuedAt : t.ReviewStepId is not null).MaxBy(r => r.StartedAt)
                : null;
            return new CarriedItem(item.Id, item.Kind, documentId, item.RevisionId, ourNumbers.GetValueOrDefault(documentId, item.DocumentNumber), item.Title, item.Revision, item.Status,
                item.Kind == TransmittalItemKinds.Placeholder ? "REQUESTED" : revision?.State ?? RevisionStates.Released,
                newest.GetValueOrDefault(documentId),
                actions[documentId].DistinctBy(a => a.Code).Select(a => new CarriedAction(a.Code, a.Name)).ToList(),
                before.GetValueOrDefault(documentId),
                Arrivals.Of(item.Kind, item.Submission, revision, catalog),
                review is null ? null : new CarriedReview(review.Id, review.StartedAt.ToDateTimeOffset(),
                    review.State is not (ReviewStates.Released or ReviewStates.Returned or ReviewStates.Withdrawn)),
                item.Files);
        }).ToList();

        var files = t.Items.Where(i => i.Kind is TransmittalItemKinds.Unplanned or TransmittalItemKinds.Attachment).SelectMany(item =>
            item.Files.Select(f => new ArrivedFile(f.Id, f.Name, f.Size, f.Sha256,
                item.Kind == TransmittalItemKinds.Attachment ? item.RegisteredBy ?? t.IssuedBy : t.IssuedBy,
                item.Kind == TransmittalItemKinds.Attachment && item.RegisteredAt is { } kept ? kept : t.IssuedAt))).ToList();

        var arrivals = carried.Select(i => i.Arrival).OfType<ArrivalView>().ToList();
        var unregistered = t.Items.Any(i => i.Kind == TransmittalItemKinds.Unplanned && i.RegisteredAt is null && i.ReturnedAt is null);
        // Something unplanned returned by the check (taken as it comes) reads as returned, with why.
        var returnedLoose = t.Items.FirstOrDefault(i => i.Kind == TransmittalItemKinds.Unplanned && i.ReturnedAt is not null);
        var returned = arrivals.FirstOrDefault(a => a.State == Arrivals.Returned);
        var status = t.State == TransmittalStatuses.Draft ? TransmittalStatuses.Draft
            : !incoming || unregistered || arrivals.Any(a => a.State == Arrivals.ToCheck) ? TransmittalStatuses.Issued
            : returned is not null || returnedLoose is not null ? TransmittalStatuses.Rejected : TransmittalStatuses.Accepted;
        // Who checked it: whoever last accepted, returned or registered what came.
        var check = status is TransmittalStatuses.Accepted or TransmittalStatuses.Rejected
            ? arrivals.Where(a => a.At is not null).Select(a => (By: a.By, At: a.At!.Value))
                .Concat(t.Items.Where(i => i.RegisteredAt is not null).Select(i => (By: i.RegisteredBy, At: i.RegisteredAt!.Value)))
                .OrderByDescending(c => c.At).Cast<(string? By, DateTimeOffset At)?>().FirstOrDefault()
            : null;

        var requests = t.IssueRequestId is { } requestId
            ? await db.IssueRequests.AsNoTracking().Where(r => r.Id == requestId && r.ProjectId == access.Project.Id)
                .Select(r => new CarriedRequest(r.Id, r.Reason, r.Note)).ToListAsync(cancellationToken)
            : [];
        var partyIds = t.Recipients.Where(r => r.PartyId is not null && r.UserId is null).Select(r => r.PartyId!.Value).Distinct().ToList();
        var parties = await db.Parties.AsNoTracking().Where(p => partyIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => new PartyHabits(p.ExternalSystem, p.EvidenceRequired), cancellationToken);

        // Who checks what arrived: the control function; with none on the project, whoever it was for (anyone of ours
        // when it named nobody), as ControlService.ArrivalAsync allows.
        var mayCheck = incoming && (access.Holds(Verbs.Control)
            || await StandIns.ArrivalAsync(db, access, t.Id, cancellationToken));
        // On a project taking documents as they come: the check accepts or returns what came unplanned, all at once.
        var asReceived = incoming && t.Items.Any(i => i.Kind == TransmittalItemKinds.Unplanned)
            && (await Packages.Intake.ReadAsync(db, access.Project.Id, cancellationToken)).Mode == Packages.Intake.AsReceived;
        // What came unplanned under a number of theirs matched before to one of ours: that one is proposed.
        var matchedBefore = new Dictionary<Guid, MatchedBefore>();
        var fromParty = incoming && access.IsInternal
            ? await db.Transmittals.Where(x => x.Id == t.Id).Select(x => x.FromPartyId).SingleOrDefaultAsync(cancellationToken) : null;
        if (fromParty is { } from)
            foreach (var loose in t.Items.Where(i => i.Kind == TransmittalItemKinds.Unplanned && i.RegisteredAt is null && i.DocumentNumber.Length > 0))
                if (await Equivalents.FindAsync(db, access.Project.Id, from, loose.DocumentNumber, cancellationToken) is { } ours)
                    matchedBefore[loose.Id] = await db.Documents.Where(d => d.Id == ours)
                        .Select(d => new MatchedBefore(d.Id, d.Number, d.Title, d.LatestRevisionValue)).SingleAsync(cancellationToken);

        return new TransmittalPage(t, status, incoming ? t.From ?? t.IssuedBy : await OurNameAsync(access, cancellationToken),
            check?.By, check?.At, status == TransmittalStatuses.Rejected ? returned?.Note ?? returnedLoose?.ReturnedReason : null, carried, files, requests,
            parties, mayCheck, asReceived, matchedBefore, await Asks.OfAsync(db, access, t.Id, cancellationToken));
    }

    /// <summary>Our organization's name as the reader knows it: their own party when it is ours, else the organization's.</summary>
    private async Task<string> OurNameAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        var party = await db.Users.AsNoTracking().Where(u => u.Id == access.UserId && u.Party != null && u.Party.IsInternal)
            .Select(u => u.Party!.Name).FirstOrDefaultAsync(cancellationToken);
        return party ?? await db.Tenants.AsNoTracking().Where(x => x.Id == access.Project.TenantId).Select(x => x.Name)
            .FirstOrDefaultAsync(cancellationToken) ?? "Our organization";
    }
}
