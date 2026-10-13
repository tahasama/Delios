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
    // ── Queues ────────────────────────────────────────────────────────────────

    /// <summary>
    /// One released revision that has never been sent to anyone, with how many issue requests are still open for it.
    /// </summary>
    public sealed record NotIssued(Guid DocumentId, string DocumentNumber, string Title, Guid RevisionId, string Revision,
        string? Status, DateTimeOffset? ReleasedAt, int OpenRequests);

    /// <summary>
    /// Released, never sent: in use, and nobody has been told. The responsibility
    /// for that sits with whoever did not ask, and this is where it shows.
    /// </summary>
    public async Task<IReadOnlyList<NotIssued>> NotIssuedAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        var restricted = (await Catalog.LoadAsync(db, cancellationToken)).RestrictedLevels();
        var rows = await (
            from d in DocumentQueries.Visible(db, access, restricted)
            join r in db.Revisions on d.Id equals r.DocumentId
            where r.State == RevisionStates.Released
                && !db.TransmittalItems.Any(i => i.RevisionId == r.Id
                    && db.Transmittals.Any(t => t.Id == i.TransmittalId && t.ReviewStepId == null))
            orderby r.ReleasedAt
            select new
            {
                d.Id,
                d.Number,
                d.Title,
                RevisionId = r.Id,
                r.Value,
                r.StatusCode,
                r.ReleasedAt,
                Open = db.IssueRequests.Count(q => q.RevisionId == r.Id && q.Status == IssueRequestStatuses.Open),
            }).Take(500).ToListAsync(cancellationToken);
        return rows.Select(x => new NotIssued(x.Id, x.Number, x.Title, x.RevisionId, x.Value, x.StatusCode,
            x.ReleasedAt?.ToDateTimeOffset(), x.Open)).ToList();
    }

    /// <summary>
    /// One task waiting for a person in issuing. <c>Kind</c> is CARRY_OUT_REQUEST, DISPATCH_TRANSMITTAL,
    /// ACKNOWLEDGE_TRANSMITTAL, REGISTER_UNPLANNED, SEND_PLACEHOLDER (a placeholder, or the next revision a review asked
    /// of a supplier) or ANSWER_HAND_BACK (the holder of a supplier's document asked to hand it back); the ids say which
    /// record it points to.
    /// </summary>
    public sealed record IssueWork(string Kind, Guid? RequestId, Guid? TransmittalId, Guid? RecipientId, string Label,
        string Reason, string? Who, DateOnly? DueDate, DateTimeOffset Since, Guid? DocumentId = null);

    /// <summary>
    /// What waits on this person in issuing: requests to carry out, organizations
    /// to send things to by hand, and transmittals to acknowledge.
    /// </summary>
    public async Task<IReadOnlyList<IssueWork>> WorkAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        var work = new List<IssueWork>();
        var projectId = access.Project.Id;
        if (access.IsInternal && (access.Holds(Verbs.Control) || access.Holds(Verbs.Transmit)))
        {
            var requests = await (
                from q in db.IssueRequests
                join d in db.Documents on q.DocumentId equals d.Id
                join r in db.Revisions on q.RevisionId equals r.Id
                where q.ProjectId == projectId && q.Status == IssueRequestStatuses.Open && r.State == RevisionStates.Released && !q.Delegated
                orderby q.RaisedAt
                select new { q.Id, DocumentId = d.Id, d.Number, r.Value, q.Reason, q.RaisedByName, q.RaisedAt }).ToListAsync(cancellationToken);
            work.AddRange(requests.Select(q => new IssueWork("CARRY_OUT_REQUEST", q.Id, null, null, $"{q.Number} rev {q.Value}",
                q.Reason, q.RaisedByName, null, q.RaisedAt.ToDateTimeOffset(), q.DocumentId)));
        }

        // "Who receives it" was left to whoever started the revision's review (the author when it was never reviewed):
        // until they say, nothing is sent.
        var leftToMe = await (
            from q in db.IssueRequests
            join d in db.Documents on q.DocumentId equals d.Id
            join r in db.Revisions on q.RevisionId equals r.Id
            where q.ProjectId == projectId && q.Status == IssueRequestStatuses.Open && q.Delegated
                && (db.Reviews.Where(v => v.RevisionId == r.Id).OrderByDescending(v => v.StartedAt).Select(v => (Guid?)v.StartedById).FirstOrDefault()
                    ?? r.AuthoredById) == access.UserId
            orderby q.RaisedAt
            select new { q.Id, DocumentId = d.Id, d.Number, r.Value, q.Reason, q.RaisedByName, q.RaisedAt }).ToListAsync(cancellationToken);
        work.AddRange(leftToMe.Select(q => new IssueWork("SAY_WHO_RECEIVES", q.Id, null, null, $"{q.Number} rev {q.Value}",
            q.Reason, q.RaisedByName, null, q.RaisedAt.ToDateTimeOffset(), q.DocumentId)));

        var carried = await CarriedPartiesAsync(access, cancellationToken);
        if (carried.Count > 0)
        {
            var dispatch = await (
                from x in db.TransmittalRecipients
                join t in db.Transmittals on x.TransmittalId equals t.Id
                where t.ProjectId == projectId && t.ReviewStepId == null && x.UserId == null && x.DispatchedAt == null
                    && x.PartyId != null && carried.Contains(x.PartyId.Value)
                orderby t.IssuedAt
                select new { t.Id, RecipientId = x.Id, t.Number, t.Reason, x.Name, t.ResponseDue, t.IssuedAt })
                .ToListAsync(cancellationToken);
            work.AddRange(dispatch.Select(x => new IssueWork("DISPATCH_TRANSMITTAL", null, x.Id, x.RecipientId, x.Number,
                x.Reason, x.Name, x.ResponseDue?.ToDateOnly(), x.IssuedAt.ToDateTimeOffset())));
        }

        // What came in unplanned waits for Document Control to put it in the register.
        if (access.IsInternal && access.Holds(Verbs.Control))
        {
            var unplanned = await (
                from i in db.TransmittalItems
                join t in db.Transmittals on i.TransmittalId equals t.Id
                where t.ProjectId == projectId && i.Kind == TransmittalItemKinds.Unplanned && i.RegisteredAt == null
                orderby t.IssuedAt
                select new { t.Id, i.DocumentNumber, i.Title, t.Number, t.FromName, t.IssuedAt }).ToListAsync(cancellationToken);
            work.AddRange(unplanned.Select(x => new IssueWork("REGISTER_UNPLANNED", null, x.Id, null,
                x.DocumentNumber.Length > 0 ? $"{x.DocumentNumber} {x.Title}" : x.Title, x.Number, x.FromName, null,
                x.IssuedAt.ToDateTimeOffset())));

            // A supplier asks for one of their documents back to update it: Document Control answers.
            var asksToUs = await (from a in db.HandBackRequests
                                  join d in db.Documents on a.DocumentId equals d.Id
                                  where a.ProjectId == projectId && a.FromSupplier && a.AnsweredAt == null
                                  orderby a.AskedAt
                                  select new { a.Id, DocumentId = d.Id, d.Number, d.Title, a.Reason, a.AskedByName, a.AskedAt }).ToListAsync(cancellationToken);
            work.AddRange(asksToUs.Select(x => new IssueWork("ANSWER_HAND_BACK", null, null, null, $"{x.Number} {x.Title}",
                x.Reason, x.AskedByName, null, x.AskedAt.ToDateTimeOffset(), x.DocumentId)));
        }

        // Another organization: the placeholders it was asked for and has not sent yet, with when each is due.
        if (!access.IsInternal && access.PartyCode is { } code)
        {
            var asked = await (
                from i in db.TransmittalItems
                join t in db.Transmittals on i.TransmittalId equals t.Id
                join d in db.Documents on i.DocumentId equals d.Id
                where t.ProjectId == projectId && i.Kind == TransmittalItemKinds.Placeholder && d.Originator == code
                    && (d.State == DocumentStates.Planned || d.State == DocumentStates.Active)
                    // A placeholder to fill, or the next revision a review asked of them (they hold it after it).
                    && (d.IsPlaceholder || (d.WithSupplier == true
                        && (d.LatestRevisionState == RevisionStates.Returned || d.LatestRevisionState == RevisionStates.Released)))
                    // Only while they hold it: with us, they ask for it back first.
                    && d.WithSupplier != false
                select new { t.Id, DocumentId = d.Id, d.Number, d.Title, Number_ = t.Number, i.DueDate, t.IssuedAt }).ToListAsync(cancellationToken);
            work.AddRange(asked.GroupBy(x => x.DocumentId).Select(g => g.OrderByDescending(x => x.IssuedAt).First())
                .OrderBy(x => x.DueDate ?? LocalDate.MaxIsoValue).ThenBy(x => x.Number)
                .Select(x => new IssueWork("SEND_PLACEHOLDER", null, x.Id, null, $"{x.Number} {x.Title}", x.Number_, null,
                    x.DueDate?.ToDateOnly(), x.IssuedAt.ToDateTimeOffset(), x.DocumentId)));

            // We asked them to hand one of their documents back: they answer.
            var asksToThem = await (from a in db.HandBackRequests
                                    join d in db.Documents on a.DocumentId equals d.Id
                                    where a.ProjectId == projectId && !a.FromSupplier && a.AnsweredAt == null && d.Originator == code
                                    orderby a.AskedAt
                                    select new { DocumentId = d.Id, d.Number, d.Title, a.Reason, a.AskedByName, a.AskedAt }).ToListAsync(cancellationToken);
            work.AddRange(asksToThem.Select(x => new IssueWork("ANSWER_HAND_BACK", null, null, null, $"{x.Number} {x.Title}",
                x.Reason, x.AskedByName, null, x.AskedAt.ToDateTimeOffset(), x.DocumentId)));
        }

        var me = access.UserId;
        var unacknowledged = await (
            from x in db.TransmittalRecipients
            join t in db.Transmittals on x.TransmittalId equals t.Id
            where t.ProjectId == projectId && x.UserId == me && x.AcknowledgedAt == null && x.Kind == RecipientKinds.To
            orderby t.IssuedAt
            select new { t.Id, t.Number, t.Reason, t.IssuedByName, t.ResponseDue, t.IssuedAt }).ToListAsync(cancellationToken);
        work.AddRange(unacknowledged.Select(x => new IssueWork("ACKNOWLEDGE_TRANSMITTAL", null, x.Id, null, x.Number,
            x.Reason, x.IssuedByName, x.ResponseDue?.ToDateOnly(), x.IssuedAt.ToDateTimeOffset())));
        return work;
    }
}
