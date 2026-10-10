using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Transmittals;

/// <summary>Somebody who received a replaced revision; <c>Via</c> is the transmittal it came on.</summary>
public sealed record UntoldRecipient(string Key, string Name, string? Organization, Guid? UserId, string Via);
public sealed record UntoldCurrent(Guid Id, string Value, string? StatusCode);
/// <summary>A replaced revision, and who still holds it without having been told.</summary>
public sealed record Untold(Guid DocumentId, string DocumentNumber, string Title, Guid OldRevisionId, string OldValue,
    DateTimeOffset? SupersededAt, UntoldCurrent? Current, string? Reason, IReadOnlyList<UntoldRecipient> Recipients);

/// <summary>
/// When a revision is replaced, everyone who received it must be told. Somebody with an account here is told in the
/// app when the replacement is released; an organization with nobody here is told only by being sent the current
/// revision (or a later one) on a transmittal. Whoever is left holds an out-of-date revision without knowing.
/// </summary>
public sealed class Supersession(DeliosDbContext db, Notifications.Notifier notifier)
{
    /// <summary>At a release: the people with an account who received a revision it replaces are told.</summary>
    public async Task TellReplacedAsync(Document document, Revision current, IReadOnlyCollection<Revision> replaced, CancellationToken cancellationToken)
    {
        if (replaced.Count == 0) return;
        var ids = replaced.Select(r => r.Id).ToList();
        var people = await (from t in db.Transmittals
                            from i in t.Items
                            from p in t.Recipients
                            where t.Direction == TransmittalDirections.Outgoing && i.RevisionId != null && ids.Contains(i.RevisionId.Value)
                                && p.UserId != null
                            select p.UserId!.Value).Distinct().ToListAsync(cancellationToken);
        var old = string.Join(", ", replaced.Select(r => r.Value));
        await notifier.NotifyAsync(document.TenantId, document.ProjectId, people, Notifications.NotificationKinds.Released,
            $"{document.Number}: rev {old} replaced by rev {current.Value}",
            $"Stop using rev {old} of {document.Number} ({document.Title}) and discard any copy of it. Rev {current.Value} replaces it.",
            $"/documents/{document.Id}", cancellationToken);
    }

    /// <summary>A document withdrawn: everyone with an account who was sent any of its revisions is told to stop using it.</summary>
    public async Task TellWithdrawnAsync(Document document, string reason, CancellationToken cancellationToken)
    {
        var people = await (from t in db.Transmittals
                            from i in t.Items
                            from p in t.Recipients
                            join r in db.Revisions on i.RevisionId equals r.Id
                            where t.Direction == TransmittalDirections.Outgoing && r.DocumentId == document.Id && p.UserId != null
                            select p.UserId!.Value).Distinct().ToListAsync(cancellationToken);
        await notifier.NotifyAsync(document.TenantId, document.ProjectId, people, Notifications.NotificationKinds.Released,
            $"{document.Number} is withdrawn",
            $"Stop using {document.Number} ({document.Title}) and discard any copy of it, whatever revision you hold. Why: {reason}",
            $"/documents/{document.Id}", cancellationToken);
    }

    /// <summary>A withdrawn document reinstated: those told to stop using it are told it counts again.</summary>
    public async Task TellReinstatedAsync(Document document, string reason, CancellationToken cancellationToken)
    {
        var people = await (from t in db.Transmittals
                            from i in t.Items
                            from p in t.Recipients
                            join r in db.Revisions on i.RevisionId equals r.Id
                            where t.Direction == TransmittalDirections.Outgoing && r.DocumentId == document.Id && p.UserId != null
                            select p.UserId!.Value).Distinct().ToListAsync(cancellationToken);
        await notifier.NotifyAsync(document.TenantId, document.ProjectId, people, Notifications.NotificationKinds.Released,
            $"{document.Number} is back in use",
            $"Its withdrawal was taken back: {document.Number} ({document.Title}) counts again. Why: {reason}",
            $"/documents/{document.Id}", cancellationToken);
    }

    /// <summary>Every replaced revision on the project still held by an organization that was never sent a newer one.</summary>
    public async Task<IReadOnlyList<Untold>> UntoldAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        var restricted = (await Catalog.LoadAsync(db, cancellationToken)).RestrictedLevels();
        var visible = DocumentQueries.Visible(db, access, restricted).Select(d => d.Id);
        var replaced = await (from r in db.Revisions
                              join d in db.Documents on r.DocumentId equals d.Id
                              where r.ProjectId == access.Project.Id && r.State == RevisionStates.Superseded && visible.Contains(d.Id)
                              select new { Revision = r, d.Number, d.Title }).AsNoTracking().ToListAsync(cancellationToken);
        if (replaced.Count == 0) return [];
        var documentIds = replaced.Select(x => x.Revision.DocumentId).Distinct().ToList();
        // What went out of each document: which revision, to whom, on which transmittal.
        var sent = await (from t in db.Transmittals
                          from i in t.Items
                          from p in t.Recipients
                          join r in db.Revisions on i.RevisionId equals r.Id
                          where t.ProjectId == access.Project.Id && t.Direction == TransmittalDirections.Outgoing && documentIds.Contains(r.DocumentId)
                          select new
                          {
                              r.DocumentId,
                              RevisionId = r.Id,
                              RevisionCreatedAt = r.CreatedAt,
                              t.Number,
                              t.Reason,
                              t.IssuedAt,
                              p.UserId,
                              p.PartyId,
                              p.Name,
                              p.Organization,
                          }).AsNoTracking().ToListAsync(cancellationToken);
        var released = await db.Revisions.AsNoTracking()
            .Where(r => documentIds.Contains(r.DocumentId) && r.State == RevisionStates.Released)
            .Select(r => new { r.DocumentId, r.Id, r.Value, r.StatusCode, r.CreatedAt }).ToListAsync(cancellationToken);
        static string Key(Guid? party, string name) => party?.ToString() ?? name.Trim().ToLowerInvariant();

        var rows = new List<Untold>();
        foreach (var x in replaced.OrderByDescending(x => x.Revision.SupersededAt))
        {
            var old = x.Revision;
            var held = sent.Where(s => s.RevisionId == old.Id && s.UserId == null).ToList();
            if (held.Count == 0) continue;
            var later = sent.Where(s => s.DocumentId == old.DocumentId && s.RevisionCreatedAt > old.CreatedAt)
                .Select(s => Key(s.PartyId, s.Name)).ToHashSet();
            var untold = held.Where(s => !later.Contains(Key(s.PartyId, s.Name)))
                .GroupBy(s => Key(s.PartyId, s.Name))
                .Select(g => g.OrderBy(s => s.IssuedAt).First())
                .Select(s => new UntoldRecipient(Key(s.PartyId, s.Name), s.Name, s.Organization, null, s.Number)).ToList();
            if (untold.Count == 0) continue;
            var current = released.Where(r => r.DocumentId == old.DocumentId).OrderByDescending(r => r.CreatedAt).FirstOrDefault();
            rows.Add(new Untold(old.DocumentId, x.Number, x.Title, old.Id, old.Value, old.SupersededAt?.ToDateTimeOffset(),
                current is null ? null : new UntoldCurrent(current.Id, current.Value, current.StatusCode),
                held.OrderBy(s => s.IssuedAt).First().Reason, untold));
        }
        return rows;
    }
}
