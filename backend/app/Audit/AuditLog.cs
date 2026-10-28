using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Audit;

/// <summary>Who did something, as written to the audit trail: a user's id and display name, or <see cref="Actor.System"/>.</summary>
public sealed record Actor(Guid? Id, string Name)
{
    /// <summary>The actor used when the application acts by itself, such as the background worker scanning a file.</summary>
    public static readonly Actor System = new(null, "System");
}

/// <summary>
/// Writes to the audit trail inside the caller's transaction, so the record and
/// the change it describes commit together or not at all. The database stamps
/// the time and extends the tenant's hash chain.
/// </summary>
public sealed class AuditLog(DeliosDbContext db, TenantContext tenant, Documents.SnapshotRecorder snapshots)
{
    /// <summary>
    /// Appends one event to the audit trail by calling the <c>audit_append</c> database function.
    /// Called by the services right after they change something (registering a document, a download, a scan result).
    /// It uses the request's open transaction, so if the change rolls back, the audit row does too.
    /// </summary>
    public async Task WriteAsync(
        Actor actor, string action,
        string? entityType = null, Guid? entityId = null, string? entityLabel = null,
        string? detail = null, Guid? projectId = null, CancellationToken cancellationToken = default)
    {
        // Opening and downloading are only said (who, what, when): they change nothing, so no point of the document's
        // history is taken for them (owner: "just a saying what happened when and by whom").
        if (!OutsideChain.Contains(action)) snapshots.Note(entityType, entityId, action, detail, actor.Name);
        // Reading (opened, downloaded) changes nothing: kept outside the locked chain, so a reader never waits behind
        // every other act of the organization (owner). Every other act extends the chain, one writer at a time.
        if (OutsideChain.Contains(action))
        {
            await PruneOnceADayAsync(cancellationToken);
            await db.Database.ExecuteSqlAsync($"""
                SELECT audit_note({tenant.Required}::uuid, {projectId}::uuid, {actor.Id}::uuid, {actor.Name}::text,
                    {action}::text, {entityType}::text, {entityId}::uuid, {entityLabel}::text, {detail}::text)
                """, cancellationToken);
        }
        else
            await db.Database.ExecuteSqlAsync($"""
                SELECT audit_append({tenant.Required}::uuid, {projectId}::uuid, {actor.Id}::uuid, {actor.Name}::text,
                    {action}::text, {entityType}::text, {entityId}::uuid, {entityLabel}::text, {detail}::text)
                """, cancellationToken);
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<Guid, DateOnly> Pruned = new();

    /// <summary>
    /// How long activity is kept (<c>TRACK_KEEP_DAYS</c>, the organization's): what was opened and downloaded past it is
    /// removed by the act of reading itself, once a day per organization in each process, never by a clock. Only those
    /// rows, outside the chain and each sealed alone, may go (<c>audit_prune</c>); every act that changed something stays.
    /// </summary>
    private async Task PruneOnceADayAsync(CancellationToken cancellationToken)
    {
        var id = tenant.Required;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        if (Pruned.TryGetValue(id, out var last) && last == today) return;
        Pruned[id] = today;
        await db.Database.ExecuteSqlAsync($"SELECT audit_prune({id}::uuid)", cancellationToken);
    }

    /// <summary>The acts of reading, kept outside the chain: the kinds Opened and Downloaded (<see cref="AuditKinds"/>).</summary>
    public static readonly HashSet<string> OutsideChain = [.. AuditKinds.CodesOf("READING"), .. AuditKinds.CodesOf("DOWNLOADED")];

    /// <summary>The id of the first row whose hash does not match, or null when the chain is intact.</summary>
    public Task<long?> FirstBrokenLinkAsync(CancellationToken cancellationToken = default) =>
        db.Database.SqlQuery<long?>($"SELECT audit_verify({tenant.Required}::uuid) AS \"Value\"")
            .SingleAsync(cancellationToken);

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<Guid, (DateTime At, long? Broken)> Verified = new();

    /// <summary>
    /// As <see cref="FirstBrokenLinkAsync"/>, verified once for the organization however many of its projects are
    /// checked in the hour (the chain is the organization's, not a project's): never once per project.
    /// </summary>
    public async Task<long?> FirstBrokenLinkOnceAsync(CancellationToken cancellationToken = default)
    {
        var id = tenant.Required;
        if (Verified.TryGetValue(id, out var kept) && DateTime.UtcNow - kept.At < TimeSpan.FromHours(1)) return kept.Broken;
        var broken = await FirstBrokenLinkAsync(cancellationToken);
        Verified[id] = (DateTime.UtcNow, broken);
        return broken;
    }
}
