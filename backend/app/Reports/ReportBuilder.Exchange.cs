using Delios.Host.Documents;
using Delios.Host.Reviews;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Reports;

public sealed partial class ReportBuilder
{
    // ── Who owes what ─────────────────────────────────────────────────────────

    /// <summary>
    /// What each other organization still owes us, and what we owe it: its documents, read in the supplier's own stages
    /// (<see cref="RegisterEndpoints.SupplierStage"/>: asked and not sent, to correct, to revise, next revision due on one of
    /// ours / to check, to send for review, in review), and the answers each side asked of the other on a transmittal
    /// and has not had. Read by our people for every organization; by another organization's people for their own,
    /// in their words.
    /// </summary>
    private async Task<Report> ExchangeAsync(ReportOptions options, CancellationToken cancellationToken)
    {
        var outside = options.Party is not null;
        var parties = await db.Parties.AsNoTracking().Where(p => !p.IsInternal && (options.Party == null || p.Code == options.Party))
            .Select(p => new { p.Id, p.Code, p.Name }).ToListAsync(cancellationToken);
        var nameOf = parties.ToDictionary(p => p.Code, p => p.Name);
        var codeOf = parties.ToDictionary(p => p.Id, p => p.Code);
        var codes = parties.Select(p => p.Code).ToList();

        var docs = await db.Documents.AsNoTracking()
            .Where(d => d.ProjectId == _project.Id && d.Originator != null && codes.Contains(d.Originator)
                && d.State != DocumentStates.Cancelled && d.State != DocumentStates.Withdrawn)
            .Select(d => new { d.Id, d.Number, d.Title, Originator = d.Originator!, d.WithSupplier, d.LatestRevisionId, d.PlannedDate })
            .ToListAsync(cancellationToken);
        var ids = docs.Select(d => d.Id).ToList();
        var latestIds = docs.Where(d => d.LatestRevisionId != null).Select(d => d.LatestRevisionId!.Value).ToList();
        var latest = await db.Revisions.AsNoTracking().Where(r => latestIds.Contains(r.Id))
            .Select(r => new { r.Id, r.Value, r.State, r.ResentAt, r.ReturnedAt, r.ReleasedAt, r.CreatedAt, r.Submissions })
            .ToDictionaryAsync(r => r.Id, cancellationToken);
        var asked = await (from i in db.TransmittalItems
                           join t in db.Transmittals on i.TransmittalId equals t.Id
                           where i.DocumentId != null && ids.Contains(i.DocumentId.Value) && i.Kind == TransmittalItemKinds.Placeholder
                           group t by i.DocumentId!.Value into g
                           select new { DocumentId = g.Key, At = g.Min(t => t.IssuedAt) }).ToDictionaryAsync(x => x.DocumentId, x => x.At, cancellationToken);
        var inReview = await db.Reviews.AsNoTracking().Where(r => latestIds.Contains(r.RevisionId) && r.State == ReviewStates.InProgress)
            .Select(r => new { r.RevisionId, r.StartedAt }).ToListAsync(cancellationToken);
        var decidedAt = await db.Reviews.AsNoTracking().Where(r => latestIds.Contains(r.RevisionId) && r.DecidedAt != null)
            .GroupBy(r => r.RevisionId).Select(g => new { RevisionId = g.Key, At = g.Max(r => r.DecidedAt) }).ToDictionaryAsync(x => x.RevisionId, x => x.At, cancellationToken);
        var needed = await NeededByAsync(cancellationToken);

        var items = new List<Owed>();
        foreach (var d in docs)
        {
            var due = Earliest(d.PlannedDate, needed.GetValueOrDefault(d.Id));
            var r = d.LatestRevisionId is { } id ? latest.GetValueOrDefault(id) : null;
            var lastIn = r?.Submissions.Count > 0 ? r.Submissions.Max(s => s.SubmittedAt) : (Instant?)null;
            // Asked of them and nothing sent yet; a document never asked is owed by nobody.
            var stage = r is null ? (asked.ContainsKey(d.Id) ? "SENT" : null) : RegisterEndpoints.SupplierStage(true, r.State, r.ResentAt, r.ReturnedAt);
            (bool Theirs, string What, Instant? Since)? owed = stage switch
            {
                "SENT" => (true, r is null ? "To send" : "To send again", r?.ResentAt ?? asked.GetValueOrDefault(d.Id)),
                "RETURNED_CHECK" => (true, "To correct (returned by the check)", r!.ReturnedAt),
                "RETURNED_REVIEW" => (true, "To revise (returned by the review)", r!.ReturnedAt ?? decidedAt.GetValueOrDefault(r.Id)),
                "RELEASED" when d.WithSupplier == true => (true, "Next revision due (comments to take in)", r!.ReleasedAt),
                "ACCEPTED" when d.WithSupplier == true => (true, "To update (handed back)", r!.CreatedAt),
                "RECEIVED" => (false, "To check", lastIn),
                "ACCEPTED" => (false, "To send for review", lastIn ?? r!.CreatedAt),
                "IN_REVIEW" => (false, "In review", inReview.FirstOrDefault(x => x.RevisionId == r!.Id)?.StartedAt ?? lastIn),
                _ => null,
            };
            if (owed is not { } o) continue;
            items.Add(new Owed(d.Originator, o.Theirs, o.What, o.Since, due,
                new Cell(r is null ? d.Number : $"{d.Number} rev {r.Value}", Kind: "document", Id: d.Id), d.Title));
        }

        // Answers asked on a transmittal and not had: what we sent them, they owe; what they sent us, we owe.
        var partyIds = parties.Select(p => p.Id).ToList();
        var theirPeople = (await db.Users.AsNoTracking().Where(u => u.PartyId != null && partyIds.Contains(u.PartyId.Value))
            .Select(u => new { u.Id, PartyId = u.PartyId!.Value }).ToListAsync(cancellationToken)).ToDictionary(u => u.Id, u => u.PartyId);
        var asking = await db.Transmittals.AsNoTracking()
            .Where(t => t.ProjectId == _project.Id && t.ResponseRequired)
            .Select(t => new { t.Id, t.Number, t.Subject, t.ToPartyId, t.FromPartyId, t.IssuedById, t.IssuedAt, t.ResponseDue, t.ReviewStepId })
            .ToListAsync(cancellationToken);
        var askingIds = asking.Select(t => t.Id).ToList();
        var replies = await db.Transmittals.AsNoTracking()
            .Where(a => (a.InReplyToId != null && askingIds.Contains(a.InReplyToId.Value)) || (a.FollowsId != null && askingIds.Contains(a.FollowsId.Value)))
            .Select(a => new { a.InReplyToId, a.FollowsId, a.IssuedById }).ToListAsync(cancellationToken);
        var stepIds = asking.Where(t => t.ReviewStepId != null).Select(t => t.ReviewStepId!.Value).ToList();
        var stepsDone = (await db.ReviewSteps.AsNoTracking().Where(s => stepIds.Contains(s.Id) && s.CompletedAt != null)
            .Select(s => s.Id).ToListAsync(cancellationToken)).ToHashSet();
        foreach (var t in asking)
        {
            var answered = t.ReviewStepId is { } step ? stepsDone.Contains(step)
                : replies.Any(a => a.InReplyToId == t.Id || (a.FollowsId == t.Id && a.IssuedById != t.IssuedById));
            if (answered) continue;
            var from = t.FromPartyId ?? (t.IssuedById is { } by && theirPeople.TryGetValue(by, out var p) ? p : null);
            var (party, theirs) = from is { } f && codeOf.ContainsKey(f) ? (codeOf[f], false)
                : t.ToPartyId is { } to && codeOf.ContainsKey(to) ? (codeOf[to], true)
                : (null, false);
            if (party is null) continue;
            items.Add(new Owed(party, theirs, "An answer", t.IssuedAt, t.ResponseDue, new Cell(t.Number, Kind: "transmittal", Id: t.Id), t.Subject));
        }

        // In the reader's words: ours say "they" and "we"; theirs say "you" and "the project team".
        var (theyOwe, weOwe) = outside ? ("You owe", "Owed to you") : ("They owe us", "We owe them");
        Segment[] segments = [new("theirs", theyOwe, "warn"), new("ours", weOwe, "info")];
        var bars = new SortedDictionary<string, Bar>(StringComparer.Ordinal);
        var lines = new List<(bool Late, Instant? Since, string Bar, IReadOnlyList<Cell> Row)>();
        foreach (var x in items)
        {
            var organization = nameOf.GetValueOrDefault(x.Party, x.Party);
            // Ours: one bar per organization. Theirs (one organization): one bar per thing owed.
            var group = outside ? x.What : organization;
            (bars.TryGetValue(group, out var bar) ? bar : bars[group] = new Bar(group, [])).Add(x.Theirs ? "theirs" : "ours");
            var late = x.Due < _today;
            var waited = x.Since is { } since ? Period.Between(since.InZone(_zone).Date, _today, PeriodUnits.Days).Days : (int?)null;
            lines.Add((late, x.Since, group,
            [
                x.Reference, x.Title, organization,
                new Cell(x.Theirs ? (outside ? "You" : organization) : (outside ? "The project team" : "Us"), x.Theirs ? "warn" : null),
                x.What, Date(x.Since),
                x.Due is { } d ? new Cell(d.ToString("yyyy-MM-dd", null), late ? "bad" : null) : "—",
                waited is { } w ? $"{w} d" : "—",
            ]));
        }
        int Count(bool theirs, bool lateOnly = false) => items.Count(x => x.Theirs == theirs && (!lateOnly || x.Due < _today));
        return Make(ReportIds.Exchange, "Who owes what", "What does each side still owe the other?",
            outside ? "What your organization still owes the project team, and what it owes you: documents and answers."
                : "Expediting and supplier meetings: what each organization still owes us, and what we owe it.",
            [
                new(theyOwe, Count(true).ToString(), Count(true) > 0 ? "warn" : "good"),
                new($"{theyOwe}, late", Count(true, lateOnly: true).ToString(), Count(true, lateOnly: true) > 0 ? "bad" : "good"),
                new(weOwe, Count(false).ToString(), Count(false) > 0 ? "warn" : "good"),
                new($"{weOwe}, late", Count(false, lateOnly: true).ToString(), Count(false, lateOnly: true) > 0 ? "bad" : "good"),
            ],
            new Chart(outside ? "What is owed, by what it is" : "What is owed, by organization", segments, [.. bars.Values]),
            ["Document or transmittal", "Title or subject", "Organization", "Who acts", "What", "Since", "Due", "Waiting"],
            [.. lines.OrderByDescending(l => l.Late).ThenBy(l => l.Since).Select(l => ((string?)l.Bar, l.Row))],
            outside ? "Nothing is owed either way." : "No organization owes us anything, and we owe none of them anything.");
    }

    /// <summary>One thing owed: by whom (<see cref="Theirs"/>: the other organization; else us), what, since when, by when.</summary>
    private sealed record Owed(string Party, bool Theirs, string What, Instant? Since, LocalDate? Due, Cell Reference, string Title);
}
