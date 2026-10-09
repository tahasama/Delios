using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace Delios.Host.Search;

/// <summary>Settings for search, read from the <c>Search</c> section of configuration.</summary>
public sealed class SearchOptions
{
    public const string Section = "Search";
    public const string Postgres = "postgres";
    public const string OpenSearch = "opensearch";

    /// <summary>postgres (the default: the register's own indexes) or opensearch.</summary>
    public string Provider { get; set; } = Postgres;
    /// <summary>Address of the OpenSearch server; used only when Provider is opensearch.</summary>
    public string Url { get; set; } = "http://opensearch:9200";
    /// <summary>Name of the OpenSearch index that holds the documents.</summary>
    public string Index { get; set; } = "delios-documents";
    /// <summary>How often the worker sends what changed to the index.</summary>
    public int SyncSeconds { get; set; } = 10;

    /// <summary>True when Provider is opensearch (any letter case).</summary>
    public bool UsesOpenSearch => string.Equals(Provider, OpenSearch, StringComparison.OrdinalIgnoreCase);
}

/// <summary>What the index holds about a document: its register entry, never its content unless extraction is switched on.</summary>
public sealed record IndexedDocument(
    Guid Id, Guid TenantId, Guid ProjectId, string Number, string Title, string DeliverableType, string DocType,
    string Discipline, string? Originator, string? Subproject, string State, string? LatestRevision,
    string? LatestRevisionState, string? Confidentiality, DateTimeOffset UpdatedAt, string? Content = null);

/// <summary>OpenSearch over its REST interface: no client library to keep in step with the server.</summary>
public sealed class OpenSearchClient(HttpClient http, IOptions<SearchOptions> options)
{
    /// <summary>
    /// A name for this client's HTTP connection. The client is registered as a typed HttpClient at startup, so this
    /// constant does not appear to be used.
    /// </summary>
    public const string HttpClientName = "opensearch";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private string Index => options.Value.Index;

    /// <summary>Creates the index with its mapping if it is not there yet.</summary>
    public async Task EnsureIndexAsync(CancellationToken cancellationToken)
    {
        using var head = await http.SendAsync(new HttpRequestMessage(HttpMethod.Head, Index), cancellationToken);
        if (head.IsSuccessStatusCode) return;
        var keyword = new { type = "keyword" };
        var body = new
        {
            settings = new { number_of_shards = 1, number_of_replicas = 0 },
            mappings = new
            {
                dynamic = "strict",
                properties = new Dictionary<string, object>
                {
                    ["id"] = keyword,
                    ["tenantId"] = keyword,
                    ["projectId"] = keyword,
                    ["number"] = new { type = "text", fields = new { raw = keyword } },
                    ["title"] = new { type = "text" },
                    ["deliverableType"] = keyword,
                    ["docType"] = keyword,
                    ["discipline"] = keyword,
                    ["originator"] = keyword,
                    ["subproject"] = keyword,
                    ["state"] = keyword,
                    ["latestRevision"] = keyword,
                    ["latestRevisionState"] = keyword,
                    ["confidentiality"] = keyword,
                    ["updatedAt"] = new { type = "date" },
                    ["content"] = new { type = "text" },
                },
            },
        };
        using var put = await http.PutAsync(Index, JsonContent(body), cancellationToken);
        // Another worker may have created it a moment ago.
        if (!put.IsSuccessStatusCode && !(await put.Content.ReadAsStringAsync(cancellationToken)).Contains("resource_already_exists"))
            throw new InvalidOperationException($"Could not create index {Index}: {(int)put.StatusCode}");
    }

    /// <summary>
    /// Deletes the whole index. A missing index is not an error. Called by the <c>reindex</c> command line command.
    /// </summary>
    public async Task DeleteIndexAsync(CancellationToken cancellationToken)
    {
        using var response = await http.DeleteAsync(Index, cancellationToken);
        if (!response.IsSuccessStatusCode && response.StatusCode != HttpStatusCode.NotFound)
            throw new InvalidOperationException($"Could not delete index {Index}: {(int)response.StatusCode}");
    }

    /// <summary>Writes documents; one that is already there is replaced.</summary>
    public async Task BulkAsync(IReadOnlyList<IndexedDocument> documents, bool refresh, CancellationToken cancellationToken)
    {
        if (documents.Count == 0) return;
        var body = new StringBuilder();
        foreach (var d in documents)
        {
            body.Append(JsonSerializer.Serialize(new { index = new { _index = Index, _id = d.Id, routing = d.TenantId } }, Json)).Append('\n');
            body.Append(JsonSerializer.Serialize(d, Json)).Append('\n');
        }
        using var response = await http.PostAsync($"_bulk{(refresh ? "?refresh=wait_for" : "")}",
            new StringContent(body.ToString(), Encoding.UTF8, "application/x-ndjson"), cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode || JsonNode.Parse(text)?["errors"]?.GetValue<bool>() == true)
            throw new InvalidOperationException($"Bulk indexing failed: {(int)response.StatusCode} {text[..Math.Min(text.Length, 500)]}");
    }

    /// <summary>Document ids for a project, best match first. Tenant and project are filters, never left to the words.</summary>
    public async Task<IReadOnlyList<Guid>> QueryAsync(Guid tenantId, Guid projectId, string words, int size, CancellationToken cancellationToken)
    {
        var body = new
        {
            size,
            _source = false,
            query = new
            {
                @bool = new
                {
                    filter = new object[] { new { term = new { tenantId } }, new { term = new { projectId } } },
                    should = new object[]
                    {
                        new { multi_match = new { query = words, fields = new[] { "number^3", "title^2", "content" }, @operator = "and" } },
                        new { multi_match = new { query = words, fields = new[] { "title", "content" }, fuzziness = "AUTO" } },
                        new { prefix = new { number_raw = new { value = words.Trim().ToUpperInvariant(), boost = 4 } } },
                    },
                    minimum_should_match = 1,
                },
            },
        };
        var json = JsonSerializer.Serialize(body, Json).Replace("\"number_raw\"", "\"number.raw\"");
        using var response = await http.PostAsync($"{Index}/_search?routing={tenantId}",
            new StringContent(json, Encoding.UTF8, "application/json"), cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"Search failed: {(int)response.StatusCode}");
        return JsonNode.Parse(text)!["hits"]!["hits"]!.AsArray().Select(h => Guid.Parse(h!["_id"]!.GetValue<string>())).ToList();
    }

    /// <summary>Asks the cluster for its health. True for green or yellow, false for red or an error answer.</summary>
    public async Task<bool> HealthyAsync(CancellationToken cancellationToken)
    {
        using var response = await http.GetAsync("_cluster/health", cancellationToken);
        if (!response.IsSuccessStatusCode) return false;
        var status = JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellationToken))?["status"]?.GetValue<string>();
        return status is "green" or "yellow";
    }

    /// <summary>Serializes an object to a JSON request body.</summary>
    private static StringContent JsonContent(object body) =>
        new(JsonSerializer.Serialize(body, Json), Encoding.UTF8, "application/json");
}

/// <summary>
/// Health check for the OpenSearch cluster, reported on the app's health endpoint. Registered only when OpenSearch is
/// switched on.
/// </summary>
public sealed class OpenSearchHealthCheck(OpenSearchClient client) : Microsoft.Extensions.Diagnostics.HealthChecks.IHealthCheck
{
    /// <summary>
    /// Called by the health check system. Healthy when the cluster is green or yellow; otherwise reports the failure
    /// status registered for this check.
    /// </summary>
    public async Task<Microsoft.Extensions.Diagnostics.HealthChecks.HealthCheckResult> CheckHealthAsync(
        Microsoft.Extensions.Diagnostics.HealthChecks.HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            return await client.HealthyAsync(cancellationToken)
                ? Microsoft.Extensions.Diagnostics.HealthChecks.HealthCheckResult.Healthy()
                : new(context.Registration.FailureStatus, "The search cluster is red.");
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return new(context.Registration.FailureStatus, "The search cluster cannot be reached.", e);
        }
    }
}
