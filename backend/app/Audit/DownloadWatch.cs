using Delios.Host.Notifications;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Audit;

/// <summary>
/// Downloads are always recorded (owner: the files are to be protected, whatever is kept about reading), and the
/// administrators are told when one person takes many files in an hour (owner: 200): recorded as it happens, with the
/// download that makes it so, never looked for afterwards. Told once an hour per person (DOWNLOADS_MANY).
/// </summary>
public static class DownloadWatch
{
    /// <summary>Files one person downloads in an hour before the administrators are told.</summary>
    public const int PerHour = 200;

    /// <summary>Called right after a download is recorded: tells the administrators when it is the one that reaches the limit.</summary>
    public static async Task CountAsync(DeliosDbContext db, AuditLog audit, Notifier notifier, IClock clock, Actor actor,
        Guid? projectId, CancellationToken cancellationToken)
    {
        if (actor.Id is not { } who) return;
        var since = clock.GetCurrentInstant() - Duration.FromHours(1);
        var taken = await db.AuditEvents.AsNoTracking()
            .CountAsync(e => e.ActorId == who && e.Action == "DOWNLOAD" && e.At > since, cancellationToken);
        if (taken < PerHour) return;
        if (await db.AuditEvents.AsNoTracking().AnyAsync(e => e.EntityId == who && e.Action == "DOWNLOADS_MANY" && e.At > since, cancellationToken))
            return;
        // Our own administrators: an account standing for another organization never keeps ours.
        var admins = await db.Users.AsNoTracking().Where(u => u.Active && u.IsAdmin && u.HomeTenantId == null && u.PartyId == null)
            .Select(u => u.Id).ToListAsync(cancellationToken);
        var tenant = await db.Users.AsNoTracking().Where(u => u.Id == who).Select(u => u.TenantId).SingleAsync(cancellationToken);
        await audit.WriteAsync(Actor.System, "DOWNLOADS_MANY", "User", who, actor.Name,
            $"{taken} files downloaded in the last hour", projectId, cancellationToken);
        await notifier.NotifyAsync(tenant, null, admins, "DOWNLOADS_MANY",
            $"{actor.Name} downloaded {taken} files in the last hour",
            $"That is more than the {PerHour} an hour after which you are told. If it was not expected, see what they took on their activity, and switch off their sign-in on People if needed.",
            $"/settings/users/{who}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
    }
}
