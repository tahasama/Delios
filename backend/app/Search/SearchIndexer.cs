using Delios.Host.Platform;
using Prometheus;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Search;

/// <summary>How far each organization's register has been sent to the search index.</summary>
public sealed class SearchWatermark
{
    public Guid TenantId { get; set; }
    /// <summary>The <c>UpdatedAt</c> time of the last document sent to the index.</summary>
    public Instant IndexedUpTo { get; set; }
    /// <summary>Ties on the same instant are ordered by id, so none is skipped and none sent twice.</summary>
    public Guid LastId { get; set; }
}

/// <summary>
/// Entity Framework Core (EF Core, the database mapping library) setup for the <c>search_watermarks</c> table: one row
/// per organization.
/// </summary>
internal sealed class SearchWatermarkConfiguration : IEntityTypeConfiguration<SearchWatermark>
{
    /// <summary>Called by EF Core when it builds the database model at startup and for migrations.</summary>
    public void Configure(EntityTypeBuilder<SearchWatermark> b)
    {
        b.HasKey(x => x.TenantId);
        b.HasOne<Identity.Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// In the worker, when OpenSearch is switched on: sends the documents that changed, organization by organization, when
/// it is told one changed (<see cref="SearchSignal"/>), never by asking every few seconds. A change is sent at once and
/// looked at again a minute later (a change is stamped before its transaction commits); everything is caught up once
/// an hour, and at start. The register in Postgres stays the truth; the index can be dropped and rebuilt from it.
/// </summary>
public sealed class SearchIndexer(IServiceScopeFactory scopes, SearchSignal signal, ILogger<SearchIndexer> logger)
    : BackgroundService
{
    /// <summary>Most documents sent to the index in one request.</summary>
    public const int Batch = 500;

    /// <summary>How long after a change it is certain to be committed and visible; the mark stays this far behind.</summary>
    private static readonly Duration Settle = Duration.FromMinutes(1);
    /// <summary>The catch-up of every organization, in case a word was lost.</summary>
    private static readonly TimeSpan CatchUp = TimeSpan.FromHours(1);

    private readonly System.Threading.Channels.Channel<Guid> heard = System.Threading.Channels.Channel.CreateUnbounded<Guid>();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await signal.SubscribeAsync(id => heard.Writer.TryWrite(id));
        var lastCatchUp = DateTimeOffset.MinValue;
        // What was sent at once, to look at again once it has settled.
        var again = new Dictionary<Guid, DateTimeOffset>();
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var client = scope.ServiceProvider.GetRequiredService<OpenSearchClient>();
                // After a reindex the index is gone and is made again with its mapping.
                await client.EnsureIndexAsync(stoppingToken);
                var now = DateTimeOffset.UtcNow;
                var sent = 0;
                if (now - lastCatchUp >= CatchUp)
                {
                    sent += await SyncAllAsync(scopes, client, refresh: false, stoppingToken);
                    lastCatchUp = now;
                    again.Clear();
                }
                else
                {
                    var tenants = new HashSet<Guid>();
                    while (heard.Reader.TryRead(out var id)) { tenants.Add(id); again[id] = now + Settle.ToTimeSpan() + TimeSpan.FromSeconds(5); }
                    foreach (var (id, at) in again.Where(x => x.Value <= now).ToList()) { tenants.Add(id); again.Remove(id); }
                    foreach (var tenantId in tenants) sent += await SyncTenantAsync(scopes, client, tenantId, refresh: false, stoppingToken);
                }
                AppMetrics.SearchLastSync.SetToCurrentTimeUtc();
                if (sent > 0) logger.LogInformation("Sent {Count} document(s) to the search index", sent);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // The register works without the index; this pass is retried.
                logger.LogWarning(e, "Search index sync failed; retrying");
            }
            // Asleep until told, the next look at what was sent, or the hourly catch-up.
            var wake = again.Count > 0 ? again.Values.Min() - DateTimeOffset.UtcNow : lastCatchUp + CatchUp - DateTimeOffset.UtcNow;
            if (wake < TimeSpan.FromSeconds(1)) wake = TimeSpan.FromSeconds(1);
            using var nap = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
            nap.CancelAfter(wake);
            try { await heard.Reader.WaitToReadAsync(nap.Token); }
            catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested) { }
        }
    }

    /// <summary>Every change of one organization not sent yet.</summary>
    private static async Task<int> SyncTenantAsync(IServiceScopeFactory scopes, OpenSearchClient client, Guid tenantId, bool refresh, CancellationToken cancellationToken)
    {
        var sent = 0;
        while (true)
        {
            var count = await SyncBatchAsync(scopes, client, tenantId, refresh, cancellationToken);
            sent += count;
            if (count < Batch) return sent;
        }
    }

    /// <summary>One pass over every organization. Returns how many documents were sent.</summary>
    public static async Task<int> SyncAllAsync(IServiceScopeFactory scopes, OpenSearchClient client, bool refresh, CancellationToken cancellationToken)
    {
        List<Guid> tenants;
        await using (var scope = scopes.CreateAsyncScope())
        {
            tenants = await scope.ServiceProvider.GetRequiredService<DeliosDbContext>().Tenants.AsNoTracking()
                .Where(t => t.Active).Select(t => t.Id).ToListAsync(cancellationToken);
        }
        var sent = 0;
        foreach (var tenantId in tenants)
        {
            while (true)
            {
                var count = await SyncBatchAsync(scopes, client, tenantId, refresh, cancellationToken);
                sent += count;
                if (count < Batch) break;
            }
        }
        return sent;
    }

    /// <summary>
    /// Sends the next batch of changed documents for one organization, with the text read from their latest revision's
    /// files, then moves its watermark (the bookmark of how far it got). Returns how many were sent; fewer than
    /// <c>Batch</c> means it has caught up.
    /// </summary>
    private static async Task<int> SyncBatchAsync(
        IServiceScopeFactory scopes, OpenSearchClient client, Guid tenantId, bool refresh, CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
        var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var mark = await db.SearchWatermarks.SingleOrDefaultAsync(cancellationToken);
        var after = mark?.IndexedUpTo ?? Instant.MinValue;
        var afterId = mark?.LastId ?? Guid.Empty;
        var changed = await db.Documents.AsNoTracking()
            .Where(d => d.UpdatedAt > after || (d.UpdatedAt == after && d.Id.CompareTo(afterId) > 0))
            .OrderBy(d => d.UpdatedAt).ThenBy(d => d.Id).Take(Batch)
            .ToListAsync(cancellationToken);
        if (changed.Count == 0) return 0;

        // A document's details only: a file's content is never read (owner).
        await client.BulkAsync(changed.Select(d => new IndexedDocument(d.Id, d.TenantId, d.ProjectId, d.Number, d.Title,
            d.DeliverableType, d.DocType, d.Discipline, d.Originator, d.Subproject, d.State, d.LatestRevisionValue,
            d.LatestRevisionState, d.Confidentiality, d.UpdatedAt.ToDateTimeOffset())).ToList(), refresh, cancellationToken);

        // Moved only once the index has them: a failed pass sends the same documents again.
        // And never past a minute ago: a change is stamped before its transaction commits,
        // so a later-committing one could otherwise land behind the mark and be missed.
        // Recent changes are simply sent again next pass; that does no harm.
        var settled = SystemClock.Instance.GetCurrentInstant() - Settle;
        var upTo = changed.LastOrDefault(d => d.UpdatedAt <= settled);
        if (upTo is not null)
        {
            if (mark is null)
            {
                mark = new SearchWatermark { TenantId = tenantId };
                db.SearchWatermarks.Add(mark);
            }
            mark.IndexedUpTo = upTo.UpdatedAt;
            mark.LastId = upTo.Id;
            await db.SaveChangesAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        // Reaching recent changes means this pass has caught up.
        return upTo == changed[^1] ? changed.Count : Math.Min(changed.Count, Batch - 1);
    }

    /// <summary>Forget what was sent, so the next pass sends everything again.</summary>
    public static async Task ResetAsync(IServiceScopeFactory scopes, CancellationToken cancellationToken)
    {
        List<Guid> tenants;
        await using (var scope = scopes.CreateAsyncScope())
        {
            tenants = await scope.ServiceProvider.GetRequiredService<DeliosDbContext>().Tenants.AsNoTracking()
                .Select(t => t.Id).ToListAsync(cancellationToken);
        }
        foreach (var tenantId in tenants)
        {
            await using var scope = scopes.CreateAsyncScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenantId);
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            await db.SearchWatermarks.ExecuteDeleteAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
    }
}
