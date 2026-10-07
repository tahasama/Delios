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
    public Instant IndexedUpTo { get; set; }
    /// <summary>Ties on the same instant are ordered by id, so none is skipped and none sent twice.</summary>
    public Guid LastId { get; set; }
}

internal sealed class SearchWatermarkConfiguration : IEntityTypeConfiguration<SearchWatermark>
{
    public void Configure(EntityTypeBuilder<SearchWatermark> b)
    {
        b.HasKey(x => x.TenantId);
        b.HasOne<Identity.Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// In the worker, when OpenSearch is switched on: sends every document that
/// changed since the last pass, organization by organization. The register in
/// Postgres stays the truth; the index can be dropped and rebuilt from it at any time.
/// </summary>
public sealed class SearchIndexer(IServiceScopeFactory scopes, IOptions<SearchOptions> options, ILogger<SearchIndexer> logger)
    : BackgroundService
{
    public const int Batch = 500;
    private const int MaxContent = 1_000_000;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var client = scope.ServiceProvider.GetRequiredService<OpenSearchClient>();
                // Every pass: after a reindex the index is gone and is made again with its mapping.
                await client.EnsureIndexAsync(stoppingToken);
                var sent = await SyncAllAsync(scopes, client, refresh: false, stoppingToken);
                AppMetrics.SearchLastSync.SetToCurrentTimeUtc();
                if (sent > 0) logger.LogInformation("Sent {Count} document(s) to the search index", sent);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // The register works without the index; this pass is retried.
                logger.LogWarning(e, "Search index sync failed; retrying");
            }
            await Task.Delay(TimeSpan.FromSeconds(options.Value.SyncSeconds), stoppingToken);
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

        // The text read from the latest revision's files, where the organization lets them be read.
        var latest = changed.Where(d => d.LatestRevisionId != null).Select(d => d.LatestRevisionId!.Value).ToList();
        var texts = (await db.FileTexts.AsNoTracking().Where(t => t.RevisionId != null && latest.Contains(t.RevisionId.Value))
                .Select(t => new { t.DocumentId, t.RevisionId, t.Text }).ToListAsync(cancellationToken))
            .GroupBy(t => t.DocumentId)
            .ToDictionary(g => g.Key, g => Cap(string.Join('\n', g.Select(t => t.Text))));

        await client.BulkAsync(changed.Select(d => new IndexedDocument(d.Id, d.TenantId, d.ProjectId, d.Number, d.Title,
            d.DeliverableType, d.DocType, d.Discipline, d.Originator, d.Subproject, d.State, d.LatestRevisionValue,
            d.LatestRevisionState, d.Confidentiality, d.UpdatedAt.ToDateTimeOffset(),
            texts.GetValueOrDefault(d.Id))).ToList(), refresh, cancellationToken);

        // Moved only once the index has them: a failed pass sends the same documents again.
        if (mark is null)
        {
            mark = new SearchWatermark { TenantId = tenantId };
            db.SearchWatermarks.Add(mark);
        }
        mark.IndexedUpTo = changed[^1].UpdatedAt;
        mark.LastId = changed[^1].Id;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return changed.Count;
    }

    private static string Cap(string text) => text.Length > MaxContent ? text[..MaxContent] : text;

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
