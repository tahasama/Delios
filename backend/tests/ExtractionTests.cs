using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Delios.Host.Extraction;
using Microsoft.Extensions.DependencyInjection;

namespace Delios.Tests;

/// <summary>
/// Files are never read (owner: "never ever read the files… forbidden forever, unless I get back on that with a
/// client's request"): no switch turns reading on, nothing is asked of the extraction service, and search finds a
/// document by its number and title only.
/// </summary>
public sealed class ExtractionTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static Task<TestApp> StartAsync(Infrastructure infrastructure, FakeTika tika) =>
        TestApp.StartAsync(infrastructure, s => s["Extraction:Url"] = "http://tika.test",
            s => s.AddHttpClient(ExtractionProcessor.HttpClientName).ConfigurePrimaryHttpMessageHandler(() => tika));

    private static async Task<IReadOnlyList<string>> FoundAsync(HttpClient client, Guid project, string q)
    {
        var result = await client.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/search?q={Uri.EscapeDataString(q)}");
        return result.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("title").GetString()!).ToList();
    }

    [Fact]
    public async Task Files_are_never_read_whatever_is_asked_and_search_reads_the_number_and_title()
    {
        var tika = new FakeTika("Duty pump curve: duty point 42 m head at 120 l/s.");
        await using var app = await StartAsync(infrastructure, tika);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var admin = await app.SignedInAsync("admin@demo.local");
        var p = await Flow.RevisionAsync(engineer);

        // No switch turns reading on.
        foreach (var mode in new[] { "ON_DEMAND", "AUTOMATIC" })
        {
            using var switched = await admin.PutAsJsonAsync($"/api/admin/projects/{p.Project}/extraction", new { mode });
            Assert.Equal((HttpStatusCode.Conflict, "CONTENT_NOT_READ"), await Api.ProblemAsync(switched));
        }

        // Asking for a revision or the whole project to be read is refused.
        var (one, oneBody) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/revisions/{p.Revision}/extract", new { });
        Assert.Equal((HttpStatusCode.Conflict, "CONTENT_NOT_READ"), (one, Flow.Code(oneBody)));
        var (all, allBody) = await Flow.PostAsync(admin, $"/api/projects/{p.Project}/extract", new { });
        Assert.Equal((HttpStatusCode.Conflict, "CONTENT_NOT_READ"), (all, Flow.Code(allBody)));

        // Nothing was sent to the service; search finds the title, never what the file says.
        Assert.Empty(tika.Requests);
        Assert.Equal(["Inlet works general arrangement"], await FoundAsync(engineer, p.Project, "inlet works"));
        Assert.Empty(await FoundAsync(engineer, p.Project, "duty point"));
    }
}

/// <summary>Stands in for Apache Tika: answers PUT /tika with the same text for any file.</summary>
public sealed class FakeTika(string text) : HttpMessageHandler
{
    public sealed record Seen(string? OcrStrategy, string? Language, string? ContentType);
    public ConcurrentQueue<Seen> Requests { get; } = new();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method != HttpMethod.Put || request.RequestUri!.AbsolutePath != "/tika") return new HttpResponseMessage(HttpStatusCode.NotFound);
        await request.Content!.ReadAsByteArrayAsync(cancellationToken);
        Requests.Enqueue(new Seen(
            request.Headers.TryGetValues("X-Tika-PDFOcrStrategy", out var s) ? s.Single() : null,
            request.Headers.TryGetValues("X-Tika-OCRLanguage", out var l) ? l.Single() : null,
            request.Content.Headers.ContentType?.MediaType));
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(text) };
    }
}
