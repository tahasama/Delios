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
    // ── Readers of a closed document ──────────────────────────────────────────

    /// <summary>The people named to read a document, by name.</summary>
    public async Task<IReadOnlyList<ReaderView>?> ReadersAsync(ProjectAccess access, Guid documentId, CancellationToken cancellationToken)
    {
        if (await VisibleAsync(access, documentId, cancellationToken) is null) return null;
        return await (from a in db.DocumentAccess
                      join u in db.Users on a.UserId equals u.Id
                      where a.DocumentId == documentId
                      orderby u.Name
                      select new ReaderView(a.Id, a.UserId, u.Name, a.AddedByName, a.Reason, a.CreatedAt.ToDateTimeOffset()))
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// Names people who may read a closed document. Only whoever is answerable for its
    /// content names them: the person who registered it, whoever authored a revision of
    /// it, or an administrator. Each reader is told.
    /// </summary>
    public async Task<IResult> AddReadersAsync(
        HttpContext http, ProjectAccess access, Guid documentId, ReadersRequest request, CancellationToken cancellationToken)
    {
        var document = await VisibleAsync(access, documentId, cancellationToken);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (!await MayNameAsync(http, access, document, cancellationToken))
        {
            return Problems.Forbidden("NOT_ANSWERABLE",
                "Only the person who registered this document, or whoever authored a revision of it, says who may read it.");
        }
        var ids = request.UserIds?.Distinct().ToList() ?? [];
        if (ids.Count == 0) return Problems.Invalid("READERS_REQUIRED", "Say who.");
        var people = await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id) && u.Active)
            .Where(u => db.Memberships.Any(m => m.UserId == u.Id && m.ProjectId == access.Project.Id && m.Active))
            .Select(u => new { u.Id, u.Name }).ToListAsync(cancellationToken);
        if (people.Count != ids.Count) return Problems.Invalid("READER_NOT_ON_PROJECT", "Some people chosen have no active place on this project.");
        var already = await db.DocumentAccess.Where(a => a.DocumentId == documentId && ids.Contains(a.UserId)).Select(a => a.UserId)
            .ToListAsync(cancellationToken);
        var reason = request.Reason?.Trim() is { Length: > 0 } why ? why : null;
        var added = people.Where(p => !already.Contains(p.Id)).ToList();
        foreach (var person in added)
        {
            db.DocumentAccess.Add(new DocumentAccess
            {
                TenantId = document.TenantId,
                DocumentId = document.Id,
                UserId = person.Id,
                AddedById = access.UserId,
                AddedByName = access.UserName,
                Reason = reason,
                CreatedAt = clock.GetCurrentInstant(),
            });
            await audit.WriteAsync(new Actor(access.UserId, access.UserName), "ACCESS_GRANTED", "Document", document.Id, document.Number,
                $"{person.Name} may read it. {reason ?? "Named as a reader of a closed document."}", access.Project.Id, cancellationToken);
        }
        await notifier.NotifyAsync(document.TenantId, document.ProjectId, added.Select(p => p.Id), Notifications.NotificationKinds.General,
            $"You may now read {document.Number}", document.Title, $"/documents/{document.Id}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { added = added.Select(p => p.Name), already = people.Where(p => already.Contains(p.Id)).Select(p => p.Name) });
    }

    /// <summary>Takes somebody off a document's readers. Same people as naming them.</summary>
    public async Task<IResult> RemoveReaderAsync(
        HttpContext http, ProjectAccess access, Guid documentId, Guid userId, CancellationToken cancellationToken)
    {
        var document = await VisibleAsync(access, documentId, cancellationToken);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (!await MayNameAsync(http, access, document, cancellationToken))
            return Problems.Forbidden("NOT_ANSWERABLE", "Only whoever is answerable for this document's content says who may read it.");
        var row = await db.DocumentAccess.SingleOrDefaultAsync(a => a.DocumentId == documentId && a.UserId == userId, cancellationToken);
        if (row is null) return Results.NoContent();
        var name = await db.Users.Where(u => u.Id == userId).Select(u => u.Name).SingleAsync(cancellationToken);
        db.DocumentAccess.Remove(row);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "ACCESS_REVOKED", "Document", document.Id, document.Number,
            $"{name} may no longer read it.", access.Project.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private async Task<bool> MayNameAsync(HttpContext http, ProjectAccess access, Document document, CancellationToken cancellationToken) =>
        document.CreatedById == access.UserId || await Keepers.ConfiguresAsync(http)
        || await db.Revisions.AnyAsync(r => r.DocumentId == document.Id && r.AuthoredById == access.UserId, cancellationToken);

    /// <summary>Everybody of ours who was sent this revision on a transmittal.</summary>
    private Task<List<Guid>> ReceivedByAsync(Guid revisionId, CancellationToken cancellationToken) =>
        (from i in db.TransmittalItems
         join r in db.TransmittalRecipients on i.TransmittalId equals r.TransmittalId
         where i.RevisionId == revisionId && r.UserId != null
         select r.UserId!.Value).Distinct().ToListAsync(cancellationToken);

    private async Task<Document?> VisibleAsync(ProjectAccess access, Guid documentId, CancellationToken cancellationToken)
    {
        var restricted = (await Catalog.LoadAsync(db, cancellationToken)).RestrictedLevels();
        return await DocumentQueries.Visible(db, access, restricted).SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
    }
}
