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
    // ── Threads, chasing ──────────────────────────────────────────────────────

    /// <summary>What a transmittal answers and follows, and what answered and followed it, among those the caller may see.</summary>
    public async Task<TransmittalThread> ThreadAsync(ProjectAccess access, Transmittal t, CancellationToken cancellationToken)
    {
        var related = await Visible(access).AsNoTracking()
            .Where(x => x.Id == t.InReplyToId || x.Id == t.FollowsId || x.InReplyToId == t.Id || x.FollowsId == t.Id)
            .Select(x => new ThreadRow(x.Id, x.Number, x.Subject, x.IssuedAt, x.Direction, x.FollowKind, x.InReplyToId, x.FollowsId, x.IssuedByName,
                x.FromName, x.Items.Count, x.Recipients.Count))
            .ToListAsync(cancellationToken);
        static TransmittalRef Ref(ThreadRow x) => new(x.Id, x.Number, x.Subject, x.IssuedAt.ToDateTimeOffset(), x.Direction, x.FollowKind,
            x.Items, x.Recipients, x.IssuedByName, x.FromName);
        return new TransmittalThread(
            related.Where(x => x.Id == t.InReplyToId).Select(Ref).FirstOrDefault(),
            related.Where(x => x.InReplyToId == t.Id).OrderBy(x => x.IssuedAt).Select(Ref).ToList(),
            related.Where(x => x.Id == t.FollowsId).Select(Ref).FirstOrDefault(),
            related.Where(x => x.FollowsId == t.Id).OrderBy(x => x.IssuedAt).Select(Ref).ToList());
    }

    private sealed record ThreadRow(Guid Id, string Number, string Subject, Instant IssuedAt, string Direction, string? FollowKind,
        Guid? InReplyToId, Guid? FollowsId, string IssuedByName, string? FromName, int Items, int Recipients);

    /// <summary>
    /// Tells the people it is for again, those who have not acknowledged it (or the ones named). Whoever issued it,
    /// or Document Control.
    /// </summary>
    public async Task<(Transmittal? Transmittal, IResult? Problem)> NotifyAgainAsync(
        ProjectAccess access, Guid id, Guid[]? recipientIds, CancellationToken cancellationToken)
    {
        var transmittal = await Visible(access).Include(t => t.Items).Include(t => t.Recipients).AsSplitQuery()
            .SingleOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (transmittal is null) return (null, NotFound());
        if (transmittal.IssuedById != access.UserId && !access.Holds(Verbs.Control))
            return (null, Problems.Forbidden("NOT_YOURS", "Whoever issued it, or Document Control, tells people again."));
        var chosen = transmittal.Recipients.Where(r => r.UserId is not null && r.Kind == RecipientKinds.To && r.AcknowledgedAt is null
            && (recipientIds is not { Length: > 0 } || recipientIds.Contains(r.Id))).ToList();
        if (chosen.Count == 0) return (null, Problems.Conflict("NOBODY_TO_TELL", "Everybody it is for has acknowledged it."));
        var now = clock.GetCurrentInstant();
        foreach (var r in chosen) r.NotifiedAt = now;
        await notifier.NotifyAsync(transmittal.TenantId, transmittal.ProjectId, chosen.Select(r => r.UserId!.Value),
            Notifications.NotificationKinds.TransmittalReceived, $"Reminder — {transmittal.Number}: {transmittal.Subject}",
            $"{transmittal.Reason} from {transmittal.IssuedByName}, waiting for you to acknowledge it"
            + (transmittal.ResponseDue is { } due ? $"; answer by {due:yyyy-MM-dd}." : "."),
            $"/transmittals/{transmittal.Id}", cancellationToken, Notifications.EmailKinds.Transmittal);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "TRANSMITTAL_CHASED", "Transmittal", transmittal.Id, transmittal.Number,
            $"Told again: {string.Join(", ", chosen.Select(r => r.Name))}.", transmittal.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (transmittal, null);
    }
}
