using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Actions;

/// <summary>
/// Requests, confirmations and answers about actions and people travel as transmittals, words alone, in one thread:
/// a request starts it, and each answer replies to it. The people it goes to are told by the transmittal itself (a
/// notification and the whole transmittal by email), and its page keeps who read and acknowledged it.
/// </summary>
public static class ActionLetters
{
    /// <summary>Asks for something: a confirmation, a decision to confirm.</summary>
    public const string Request = "REQUEST";
    /// <summary>Gives it: a confirmation.</summary>
    public const string Confirmation = "CONFIRMATION";
    /// <summary>Answers it otherwise: done, refused, nothing to add, taken back.</summary>
    public const string Answer = "ANSWER";

    /// <summary>
    /// Raises one information transmittal from <paramref name="actor"/> to the people named, and those copied in.
    /// Nobody is addressed to themselves; someone both addressed and copied in is addressed. Returns null when nobody
    /// is left to send it to. Does not save: the caller does.
    /// </summary>
    public static async Task<Transmittal?> SendAsync(DeliosDbContext db, TransmittalService transmittals, IClock clock, Project project, Actor actor,
        string reason, string subject, string message, IEnumerable<Guid> to, IEnumerable<Guid> copies, Guid? inReplyToId,
        CancellationToken cancellationToken)
    {
        var addressed = to.Where(id => id != Guid.Empty && id != actor.Id).Distinct().ToList();
        var copied = copies.Where(id => id != Guid.Empty && id != actor.Id && !addressed.Contains(id)).Distinct().ToList();
        if (addressed.Count == 0)
        {
            addressed = copied;
            copied = [];
        }
        if (addressed.Count == 0) return null;
        var everyone = addressed.Concat(copied).ToList();
        var people = await db.Users.AsNoTracking().Where(u => everyone.Contains(u.Id) && u.Active)
            .Select(u => new { u.Id, u.Name, Organization = u.Party == null ? null : u.Party.Name }).ToListAsync(cancellationToken);
        var recipients = people.Where(p => addressed.Contains(p.Id))
            .Select(p => new TransmittalService.Addressee(p.Id, null, p.Name, p.Organization, RecipientKinds.To))
            .Concat(people.Where(p => copied.Contains(p.Id))
                .Select(p => new TransmittalService.Addressee(p.Id, null, p.Name, p.Organization, RecipientKinds.Cc)))
            .ToList();
        if (recipients.Count == 0) return null;
        // Answering a transmittal one was asked on is acknowledging it.
        if (inReplyToId is { } replied)
        {
            var now = clock.GetCurrentInstant();
            var mine = await db.Set<TransmittalRecipient>().Where(r => r.TransmittalId == replied && r.UserId == actor.Id && r.AcknowledgedAt == null)
                .ToListAsync(cancellationToken);
            foreach (var row in mine)
            {
                row.OpenedAt ??= now;
                row.AcknowledgedAt = now;
            }
        }
        return await transmittals.RaiseAsync(new TransmittalService.Raise(project, actor, reason, subject, message, null,
            "Internal distribution", [], recipients, InReplyToId: inReplyToId), cancellationToken);
    }
}
