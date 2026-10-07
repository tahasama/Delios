using Delios.Host.Documents;
using Prometheus;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Delios.Host.Search;

/// <summary>Answer of a search: which provider answered (postgres or opensearch) and the matching documents.</summary>
public sealed record SearchResult(string Provider, IReadOnlyList<DocumentSummary> Items);

/// <summary>
/// Finding documents by words. With OpenSearch switched on, it ranks the matches;
/// either way, what a person may see is decided in Postgres, by the same rules as
/// the register, so the index never widens anyone's view. If the index cannot be
/// reached, the search falls back to Postgres rather than failing.
/// </summary>
public sealed class SearchService(
    ReadDatabase reads, DocumentService documents, IServiceProvider services, IOptions<SearchOptions> options,
    ILogger<SearchService> logger)
{
    /// <summary>Most results one search returns.</summary>
    public const int MaxResults = 100;

    /// <summary>
    /// Finds documents in a project whose number, title or file text contain the words. Uses OpenSearch (a separate
    /// search server) when switched on, then filters the hits through the register's visibility rules; otherwise, or
    /// when the index fails, searches Postgres directly. Called by the search endpoint.
    /// </summary>
    public async Task<SearchResult> SearchAsync(ProjectAccess access, string words, int limit, CancellationToken cancellationToken)
    {
        var size = Math.Clamp(limit, 1, MaxResults);
        var restricted = await documents.RestrictedAsync(cancellationToken);
        if (options.Value.UsesOpenSearch)
        {
            using var timer = AppMetrics.SearchSeconds.WithLabels(SearchOptions.OpenSearch).NewTimer();
            try
            {
                var ranked = await services.GetRequiredService<OpenSearchClient>()
                    .QueryAsync(access.Project.TenantId, access.Project.Id, words, size * 3, cancellationToken);
                var visible = await reads.ReadAsync(source => DocumentQueries.Visible(source, access, restricted).AsNoTracking()
                    .Where(d => ranked.Contains(d.Id)).Select(Summary).ToListAsync(cancellationToken), cancellationToken);
                var order = ranked.Select((id, i) => (id, i)).ToDictionary(x => x.id, x => x.i);
                return new SearchResult(SearchOptions.OpenSearch, visible.OrderBy(d => order[d.Id]).Take(size).ToList());
            }
            catch (Exception e) when (e is HttpRequestException or InvalidOperationException or TaskCanceledException
                && !cancellationToken.IsCancellationRequested)
            {
                AppMetrics.SearchFallbacks.Inc();
                logger.LogWarning(e, "Search index unavailable; answering from Postgres");
            }
        }

        using var postgres = AppMetrics.RegisterQuerySeconds.WithLabels("yes").NewTimer();
        using var _ = AppMetrics.SearchSeconds.WithLabels(SearchOptions.Postgres).NewTimer();
        // Every word must appear in the number, the title, or (where the organization
        // lets its files be read) the text of the latest revision.
        var terms = words.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(8)
            .Select(w => "%" + w.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%").ToList();
        var items = await reads.ReadAsync(source =>
        {
            var query = DocumentQueries.Visible(source, access, restricted).AsNoTracking();
            foreach (var term in terms)
            {
                query = query.Where(d => EF.Functions.ILike(d.Number, term) || EF.Functions.ILike(d.Title, term)
                    || source.FileTexts.Any(t => t.DocumentId == d.Id && t.RevisionId == d.LatestRevisionId && EF.Functions.ILike(t.Text, term)));
            }
            return query.OrderBy(d => d.Number).Take(size).Select(Summary).ToListAsync(cancellationToken);
        }, cancellationToken);
        return new SearchResult(SearchOptions.Postgres, items);
    }

    /// <summary>
    /// How a document row becomes a <c>DocumentSummary</c>, written as an expression so EF Core can turn it into SQL.
    /// </summary>
    private static readonly System.Linq.Expressions.Expression<Func<Document, DocumentSummary>> Summary = d => new DocumentSummary(
        d.Id, d.Number, d.Title, d.DeliverableType, d.DocType, d.Discipline, d.Originator, d.State, d.Kind, d.IsPlaceholder,
        d.Confidentiality, d.LatestRevisionValue, d.LatestRevisionState, d.UpdatedAt.ToDateTimeOffset());
}

/// <summary>The search HTTP endpoint. Mapped at startup.</summary>
public static class SearchEndpoints
{
    /// <summary>
    /// Registers <c>GET /api/projects/{projectId}/search?q=...&amp;limit=...</c>. The caller needs the Read permission
    /// and at least two characters.
    /// </summary>
    public static void MapSearchEndpoints(this IEndpointRouteBuilder app) =>
        app.MapGroup("/api/projects/{projectId:guid}").WithTags("Search")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>()
            .MapGet("/search", async (HttpContext http, SearchService search, string? q, int? limit, CancellationToken cancellationToken) =>
            {
                var access = ProjectAccessFilter.Of(http);
                if (!access.Holds(Verbs.Read)) return Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register.");
                if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
                    return Problems.Invalid("SEARCH_TOO_SHORT", "Type at least two characters.");
                return Results.Ok(await search.SearchAsync(access, q.Trim(), limit ?? 25, cancellationToken));
            });
}
