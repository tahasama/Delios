using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Delios.Host.Extraction;
using Microsoft.Extensions.DependencyInjection;

namespace Delios.Tests;

/// <summary>Reading inside files: off unless the project's client allows it, and nothing kept once switched off.</summary>
public sealed class ExtractionTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static Task<TestApp> StartAsync(Infrastructure infrastructure, FakeTika tika, bool installed = true) =>
        TestApp.StartAsync(infrastructure, s => { if (installed) s["Extraction:Url"] = "http://tika.test"; },
            s => s.AddHttpClient(ExtractionProcessor.HttpClientName).ConfigurePrimaryHttpMessageHandler(() => tika));

    private static async Task<IReadOnlyList<string>> FoundAsync(HttpClient client, Guid project, string q)
    {
        var result = await client.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/search?q={Uri.EscapeDataString(q)}");
        return result.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("title").GetString()!).ToList();
    }

    private static async Task<IReadOnlyList<string>> UntilFoundAsync(HttpClient client, Guid project, string q)
    {
        for (var i = 0; i < 100; i++)
        {
            var found = await FoundAsync(client, project, q);
            if (found.Count > 0) return found;
            await Task.Delay(200);
        }
        return [];
    }

    private static async Task<HttpStatusCode> ModeAsync(HttpClient admin, Guid project, string mode)
    {
        using var response = await admin.PutAsJsonAsync($"/api/admin/projects/{project}/extraction", new { mode });
        return response.StatusCode;
    }

    [Fact]
    public async Task Files_are_read_only_once_the_project_allows_it_and_forgotten_when_it_stops()
    {
        var tika = new FakeTika("Duty pump curve: duty point 42 m head at 120 l/s.");
        await using var app = await StartAsync(infrastructure, tika);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var admin = await app.SignedInAsync("admin@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var extract = $"/api/projects/{p.Project}/revisions/{p.Revision}/extract";

        // Off by default: nothing is read, and asking is refused.
        var (off, offBody) = await Flow.PostAsync(engineer, extract, new { });
        Assert.Equal((HttpStatusCode.Conflict, "EXTRACTION_OFF"), (off, Flow.Code(offBody)));
        Assert.Empty(tika.Requests);
        Assert.Equal(HttpStatusCode.Forbidden, await ModeAsync(engineer, p.Project, "ON_DEMAND"));

        // On demand: read when somebody asks, then found by what it says.
        Assert.Equal(HttpStatusCode.OK, await ModeAsync(admin, p.Project, "ON_DEMAND"));
        var (queued, body) = await Flow.PostAsync(engineer, extract, new { });
        Assert.Equal(HttpStatusCode.Accepted, queued);
        Assert.Equal(1, body.GetProperty("queued").GetInt32());
        Assert.Equal(["Inlet works general arrangement"], await UntilFoundAsync(engineer, p.Project, "duty point"));
        var request = tika.Requests.Single();
        Assert.Equal(("auto", "eng"), (request.OcrStrategy, request.Language));

        // Asking again reads nothing twice.
        var (_, again) = await Flow.PostAsync(engineer, extract, new { });
        Assert.Equal(0, again.GetProperty("queued").GetInt32());

        // Switched off: every text read is deleted, and searches stop finding it.
        using var switched = await admin.PutAsJsonAsync($"/api/admin/projects/{p.Project}/extraction", new { mode = "OFF" });
        Assert.Equal(1, (await switched.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("purged").GetInt32());
        Assert.Empty(await FoundAsync(engineer, p.Project, "duty point"));
    }

    [Fact]
    public async Task On_automatic_every_new_file_is_read_once_it_has_passed_scanning()
    {
        var tika = new FakeTika("Cable schedule for the inlet switchroom.");
        await using var app = await StartAsync(infrastructure, tika);
        app.StartWorker();
        var admin = await app.SignedInAsync("admin@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        Assert.Equal(HttpStatusCode.OK, await ModeAsync(admin, await Api.ProjectIdAsync(engineer), "AUTOMATIC"));
        var p = await Flow.RevisionAsync(engineer);

        Assert.Equal(["Inlet works general arrangement"], await UntilFoundAsync(engineer, p.Project, "switchroom"));
    }

    [Fact]
    public async Task Without_the_extraction_service_installed_asking_says_so()
    {
        await using var app = await StartAsync(infrastructure, new FakeTika(""), installed: false);
        var admin = await app.SignedInAsync("admin@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        await ModeAsync(admin, project, "ON_DEMAND");
        var status = await admin.GetFromJsonAsync<JsonElement>($"/api/admin/projects/{project}/extraction");
        Assert.False(status.GetProperty("installed").GetBoolean());

        var (refused, body) = await Flow.PostAsync(engineer, $"/api/projects/{project}/revisions/{Guid.NewGuid()}/extract", new { });

        Assert.Equal((HttpStatusCode.Conflict, "EXTRACTION_NOT_INSTALLED"), (refused, Flow.Code(body)));
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
