using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;

namespace Delios.Tests;

/// <summary>A single-node OpenSearch, started only for the tests that switch it on.</summary>
public sealed class OpenSearchFixture : IAsyncLifetime
{
    public IContainer Container { get; } = new ContainerBuilder("opensearchproject/opensearch:2.19.2")
        .WithEnvironment("discovery.type", "single-node")
        .WithEnvironment("DISABLE_SECURITY_PLUGIN", "true")
        .WithEnvironment("DISABLE_INSTALL_DEMO_CONFIG", "true")
        .WithEnvironment("OPENSEARCH_JAVA_OPTS", "-Xms512m -Xmx512m")
        .WithPortBinding(9200, true)
        .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(r => r.ForPort(9200).ForPath("/_cluster/health")))
        .Build();

    public string Url => $"http://{Container.Hostname}:{Container.GetMappedPublicPort(9200)}";

    public Task InitializeAsync() => Container.StartAsync();
    public async Task DisposeAsync() => await Container.DisposeAsync();
}

public sealed class SearchTests(Infrastructure infrastructure, OpenSearchFixture opensearch)
    : IClassFixture<Infrastructure>, IClassFixture<OpenSearchFixture>
{
    private static async Task<JsonElement> SearchAsync(HttpClient client, Guid project, string q)
    {
        using var response = await client.GetAsync($"/api/projects/{project}/search?q={Uri.EscapeDataString(q)}");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(response.IsSuccessStatusCode, body.ToString());
        return body;
    }

    private static IEnumerable<string> Titles(JsonElement result) =>
        result.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("title").GetString()!);

    [Fact]
    public async Task Without_OpenSearch_the_register_answers_every_word_from_Postgres()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        await Api.RegisterAsync(engineer, project, Api.Drawing("Inlet works general arrangement"));
        await Api.RegisterAsync(engineer, project, Api.Drawing("Pump room layout plan"));

        var result = await SearchAsync(engineer, project, "pump layout");
        Assert.Equal("postgres", result.GetProperty("provider").GetString());
        Assert.Equal(["Pump room layout plan"], Titles(result));
        using var shortQuery = await engineer.GetAsync($"/api/projects/{project}/search?q=x");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, shortQuery.StatusCode);
    }

    [Fact]
    public async Task With_the_index_unreachable_searches_still_answer_from_Postgres()
    {
        await using var app = await TestApp.StartAsync(infrastructure, s =>
        {
            s["Search:Provider"] = "opensearch";
            s["Search:Url"] = "http://127.0.0.1:1";
        });
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        await Api.RegisterAsync(engineer, project, Api.Drawing("Pump room layout plan"));

        var result = await SearchAsync(engineer, project, "pump");
        Assert.Equal("postgres", result.GetProperty("provider").GetString());
        Assert.Single(Titles(result));
    }

    [Fact]
    public async Task With_OpenSearch_switched_on_matches_are_ranked_forgiving_and_still_limited_to_what_one_may_see()
    {
        var index = "delios-test-" + Guid.NewGuid().ToString("N")[..8];
        await using var app = await TestApp.StartAsync(infrastructure, s =>
        {
            s["Search:Provider"] = "opensearch";
            s["Search:Url"] = opensearch.Url;
            s["Search:Index"] = index;
            s["Search:SyncSeconds"] = "1";
        });
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var supplier = await app.SignedInAsync("supplier@acme.local");
        var project = await Api.ProjectIdAsync(engineer);
        await Api.RegisterAsync(engineer, project, Api.Drawing("Inlet works general arrangement"));
        var pump = await Api.RegisterAsync(engineer, project, Api.Drawing("Pump room layout plan"));

        // The worker sends what changed; the API asks the index.
        JsonElement result = default;
        for (var i = 0; i < 60; i++)
        {
            result = await SearchAsync(engineer, project, "pump room");
            if (result.GetProperty("items").GetArrayLength() > 0) break;
            await Task.Delay(500);
        }
        Assert.Equal("opensearch", result.GetProperty("provider").GetString());
        Assert.Equal("Pump room layout plan", Titles(result).First());

        // A misspelling still finds it; so does the start of its number.
        Assert.Contains("Pump room layout plan", Titles(await SearchAsync(engineer, project, "pmup")));
        var number = pump.GetProperty("number").GetString()!;
        Assert.Equal("Pump room layout plan", Titles(await SearchAsync(engineer, project, number)).First());

        // The index holds it, but the supplier may not see it, so it is not found.
        Assert.Empty(Titles(await SearchAsync(supplier, project, "pump room")));
    }
}
