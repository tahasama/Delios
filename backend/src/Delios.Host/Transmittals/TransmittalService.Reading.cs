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
    // ── Reading, acknowledging, dispatching ───────────────────────────────────

    /// <summary>
    /// The transmittals the caller may see, newest first, at most 200, with counts for the list page.
    /// </summary>
    public async Task<IReadOnlyList<TransmittalSummary>> ListAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        var rows = await Visible(access).OrderByDescending(t => t.IssuedAt).Take(200)
            .Select(t => new
            {
                t.Id,
                t.Number,
                t.Reason,
                t.Subject,
                t.ToName,
                t.IssuedAt,
                t.IssuedByName,
                t.ResponseDue,
                Items = t.Items.Count,
                Recipients = t.Recipients.Count,
                Acknowledged = t.Recipients.Count(r => r.AcknowledgedAt != null),
                Awaiting = t.Recipients.Count(r => r.UserId == null && r.DispatchedAt == null),
            })
            .ToListAsync(cancellationToken);
        return rows.Select(t => new TransmittalSummary(t.Id, t.Number, t.Reason, t.Subject, t.ToName,
            t.IssuedAt.ToDateTimeOffset(), t.IssuedByName, t.ResponseDue?.ToDateOnly(), t.Items, t.Recipients, t.Acknowledged,
            t.Awaiting)).ToList();
    }

    /// <summary>Opening it is recorded for a recipient: the first time is read evidence.</summary>
    public async Task<Transmittal?> ReadAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var transmittal = await Visible(access).Include(t => t.Items).Include(t => t.Recipients).AsSplitQuery()
            .SingleOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (transmittal?.Recipients.SingleOrDefault(r => r.UserId == access.UserId) is { } mine)
        {
            var now = clock.GetCurrentInstant();
            mine.OpenedAt ??= now;
            mine.LastViewedAt = now;
            mine.ViewCount++;
            await db.SaveChangesAsync(cancellationToken);
        }
        return transmittal;
    }

    /// <summary>
    /// Records that the caller, a recipient, acknowledged the transmittal. Doing it twice changes nothing. Called by
    /// the acknowledge endpoint.
    /// </summary>
    public async Task<(Transmittal? Transmittal, IResult? Problem)> AcknowledgeAsync(
        ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var transmittal = await ReadAsync(access, id, cancellationToken);
        if (transmittal is null) return (null, NotFound());
        var mine = transmittal.Recipients.SingleOrDefault(r => r.UserId == access.UserId);
        if (mine is null) return (null, Problems.Forbidden("NOT_A_RECIPIENT", "Only the people it went to acknowledge it."));
        if (mine.AcknowledgedAt is null)
        {
            mine.AcknowledgedAt = clock.GetCurrentInstant();
            await audit.WriteAsync(new Actor(access.UserId, access.UserName), "TRANSMITTAL_ACKNOWLEDGED", "Transmittal",
                transmittal.Id, transmittal.Number, null, transmittal.ProjectId, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
        }
        return (transmittal, null);
    }

    /// <summary>One of ours records that it went to an organization with nobody here, by whatever channel they use.</summary>
    public async Task<(Transmittal? Transmittal, IResult? Problem)> DispatchAsync(
        ProjectAccess access, Guid id, Guid recipientId, DispatchRequest request, CancellationToken cancellationToken)
    {
        var transmittal = await ReadAsync(access, id, cancellationToken);
        var recipient = transmittal?.Recipients.SingleOrDefault(r => r.Id == recipientId);
        if (transmittal is null || recipient is null) return (null, NotFound());
        if (recipient.PartyId is not { } partyId || !await CarriesAsync(access, partyId, cancellationToken))
            return (null, Problems.Forbidden("NOT_CUSTODIAN", "Whoever carries the exchange with that organization records that it went."));
        if (!recipient.AwaitsDispatch)
            return (null, Problems.Conflict("ALREADY_DISPATCHED", "It is already recorded as sent."));
        var channel = request.Channel?.Trim() ?? "";
        if (channel.Length == 0)
            return (null, Problems.Invalid("CHANNEL_REQUIRED", "Say how it went: email, their portal, by hand."));
        var item = transmittal.Items[0];
        if (request.ProofFileId is { } proof
            && await BindEvidenceAsync(access, proof, item.RevisionId, cancellationToken) is { } bad) return (null, bad);

        var (went, notYet) = WorkingCalendar.Moment(clock, access.Project.TimeZone, request.DispatchedOn);
        if (notYet is not null) return (null, Problems.Invalid("DATE_IN_FUTURE", $"The day it went cannot be later than today. {notYet}"));
        if (went!.Value.Plus(Duration.FromHours(12)) < transmittal.IssuedAt)
            return (null, Problems.Invalid("DATE_BEFORE_ISSUE", "It cannot have gone before the transmittal was issued."));
        recipient.DispatchedAt = went;
        recipient.DispatchChannel = channel;
        recipient.DispatchRef = request.Reference?.Trim();
        recipient.DispatchedByName = access.UserName;
        recipient.ProofFileId = request.ProofFileId;
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "TRANSMITTAL_DISPATCHED", "Transmittal", transmittal.Id,
            transmittal.Number, $"Sent to {recipient.Name} by {channel}{(recipient.DispatchRef is null ? "" : $", their reference {recipient.DispatchRef}")}.",
            transmittal.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (transmittal, null);
    }

    /// <summary>
    /// Gives an upload link for proof that a transmittal was sent to an outside organization. Only someone who carries
    /// the exchange with one of its organizations may upload. The proof is filed against the first item's revision.
    /// </summary>
    public async Task<(UploadTicket? Ticket, IResult? Problem)> TransmittalEvidenceAsync(
        ProjectAccess access, Guid id, UploadRequest request, CancellationToken cancellationToken)
    {
        var transmittal = await ReadAsync(access, id, cancellationToken);
        if (transmittal is null) return (null, NotFound());
        var carried = transmittal.Recipients.Where(r => r.PartyId is not null).Select(r => r.PartyId!.Value).Distinct().ToList();
        var mayFile = false;
        foreach (var party in carried) mayFile |= await CarriesAsync(access, party, cancellationToken);
        if (!mayFile)
            return (null, Problems.Forbidden("NOT_CUSTODIAN", "Whoever carries the exchange with that organization files its proof."));
        var item = transmittal.Items[0];
        return await EvidenceTicketAsync(access, item.DocumentId, item.RevisionId, request, cancellationToken);
    }
}
