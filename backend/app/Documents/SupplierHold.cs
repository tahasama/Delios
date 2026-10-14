using System.Text.Json;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

/// <summary>
/// Who holds a document exchanged with a supplier (<see cref="Document.WithSupplier"/>), read from what the
/// organization's lists mean, never from their codes.
/// </summary>
public static class SupplierHold
{
    /// <summary>
    /// Whether a review's verdict hands the supplier's document back to them: one that sends it back (work may not
    /// proceed), or one whose comments go into the next revision. Accepted, or taken for information, it stays with
    /// us. Every verdict list says one of those four meanings, whatever it calls them.
    /// </summary>
    /// <summary>A status for update (IFU): released at it, the document goes back to its author or supplier to update.</summary>
    public static bool ForUpdate(Catalog catalog, string? status) =>
        status is not null && catalog.Prop(ReviewSets.Statuses, status, "update") is { ValueKind: JsonValueKind.True };

    public static bool HandsToSupplier(Catalog catalog, string verdictSet, string verdict) =>
        catalog.Prop(verdictSet, verdict, "proceed") is not { ValueKind: JsonValueKind.True }
        || catalog.Prop(verdictSet, verdict, "resubmit") is { ValueKind: JsonValueKind.True };

    /// <summary>
    /// The people of the organization a document came from, on its project: told whenever it is handed back to them
    /// (returned by the check, sent back by its review, or released with comments for their next revision).
    /// </summary>
    public static async Task<List<Guid>> PeopleAsync(DeliosDbContext db, Document document, Revision revision, CancellationToken cancellationToken)
    {
        var party = revision.AuthoredByParty ?? document.Originator;
        if (party is null) return [];
        return await (from u in db.Users
                      join p in db.Parties on u.PartyId equals p.Id
                      join m in db.Memberships on u.Id equals m.UserId
                      where p.Code == party && !p.IsInternal && u.Active && m.ProjectId == document.ProjectId && m.Active && m.PendingSince == null
                      select u.Id).Distinct().ToListAsync(cancellationToken);
    }
}
