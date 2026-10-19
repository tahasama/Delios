using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Identity;

/// <summary>
/// Who carries the control function's acts out on a project that has none (nobody named, no function carrying CONTROL):
/// the people doing the work, never nobody. Each act asks the stand-in it needs, so what the control function does is
/// never left waiting on a project that chose to work without one.
/// </summary>
public static class StandIns
{
    /// <summary>Whether the project has nobody acting as the control function.</summary>
    public static async Task<bool> NoControlAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken) =>
        !await db.Memberships.AnyAsync(m => m.ProjectId == projectId && m.Active && m.Function!.Active
            && (m.ActsAsControl || m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control)))
            && db.Users.Any(u => u.Id == m.UserId && u.Active), cancellationToken);

    /// <summary>
    /// What we exchange with other organizations (a supplier's package, asking for its documents, handing them back and
    /// forth, replies by email): with no control function, anyone of ours who may send or register documents.
    /// </summary>
    public static async Task<bool> ExchangesAsync(DeliosDbContext db, ProjectAccess access, CancellationToken cancellationToken) =>
        access.IsInternal && (access.Holds(Verbs.Transmit) || access.Holds(Verbs.Create))
        && await NoControlAsync(db, access.Project.Id, cancellationToken);

    /// <summary>
    /// What arrived on a transmittal (its check, registering what came unplanned, keeping files with it): with no
    /// control function, whoever it was for, or anyone of ours when it named nobody of ours.
    /// </summary>
    public static async Task<bool> ArrivalAsync(DeliosDbContext db, ProjectAccess access, Guid transmittalId, CancellationToken cancellationToken)
    {
        if (!access.IsInternal || !await NoControlAsync(db, access.Project.Id, cancellationToken)) return false;
        var named = db.TransmittalRecipients.Where(t => t.TransmittalId == transmittalId && t.UserId != null);
        return !await named.AnyAsync(cancellationToken) || await named.AnyAsync(t => t.UserId == access.UserId, cancellationToken);
    }

    /// <summary>The same, for a revision that came in: whoever the transmittal carrying it was for.</summary>
    public static async Task<bool> ArrivedRevisionAsync(DeliosDbContext db, ProjectAccess access, Guid revisionId, CancellationToken cancellationToken)
    {
        if (!access.IsInternal || !await NoControlAsync(db, access.Project.Id, cancellationToken)) return false;
        var named = db.TransmittalRecipients.Where(t => t.UserId != null
            && db.TransmittalItems.Any(i => i.RevisionId == revisionId && i.TransmittalId == t.TransmittalId));
        return !await named.AnyAsync(cancellationToken) || await named.AnyAsync(t => t.UserId == access.UserId, cancellationToken);
    }
}
