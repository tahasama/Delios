using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

/// <summary>
/// What another organization's people read of a document they may see (security review, owner: "loopholes"). Of a
/// document that is theirs (its originator), everything, as before. Of one of ours, only what was sent to them: the
/// revisions a transmittal carried to them, never a draft, our reviews or our own exchanges about it. A review is theirs
/// to read when the document is theirs or they answer one of its steps.
/// </summary>
public static class OutsideReading
{
    /// <summary>Whether this reader is one of ours, or the document is theirs: nothing is narrowed.</summary>
    public static bool Whole(ProjectAccess access, string? originator) =>
        access.IsInternal || (access.PartyCode is { } code && originator == code);

    /// <summary>The revisions a transmittal carried to this person.</summary>
    public static IQueryable<Guid> SentRevisions(DeliosDbContext db, ProjectAccess access) =>
        db.TransmittalItems.Where(i => i.RevisionId != null
                && db.TransmittalRecipients.Any(r => r.TransmittalId == i.TransmittalId && r.UserId == access.UserId))
            .Select(i => i.RevisionId!.Value);

    /// <summary>The revisions of this document the reader reads; null when every one.</summary>
    public static async Task<HashSet<Guid>?> RevisionsAsync(DeliosDbContext db, ProjectAccess access, Guid documentId, string? originator,
        CancellationToken cancellationToken) =>
        Whole(access, originator) ? null
            : (await SentRevisions(db, access).Where(id => db.Revisions.Any(r => r.Id == id && r.DocumentId == documentId))
                .Distinct().ToListAsync(cancellationToken)).ToHashSet();

    /// <summary>The reviews this reader reads: all for ours; for another organization, of its own documents or a step it answers.</summary>
    public static IQueryable<Review> Reviews(DeliosDbContext db, ProjectAccess access, IQueryable<Review> reviews)
    {
        if (access.IsInternal) return reviews;
        var code = access.PartyCode ?? "\u0000";
        var me = access.UserId;
        return reviews.Where(r => db.Documents.Any(d => d.Id == r.DocumentId && d.Originator == code)
            || r.Steps.Any(s => s.Participants.Any(p => p.UserId == me)
                || (s.PartyId != null && db.Parties.Any(x => x.Id == s.PartyId && x.Code == code))));
    }
}
