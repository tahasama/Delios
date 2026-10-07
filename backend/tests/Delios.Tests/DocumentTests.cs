using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Delios.Host.Documents;

namespace Delios.Tests;

public static class Api
{
    public static async Task<Guid> ProjectIdAsync(HttpClient client)
    {
        var me = await client.GetFromJsonAsync<JsonElement>("/api/me");
        return me.GetProperty("projects")[0].GetProperty("id").GetGuid();
    }

    public static object Drawing(string title = "Inlet works general arrangement", string discipline = "CI") => new
    {
        title,
        deliverableType = "ENG",
        docType = "DWG",
        discipline,
        subproject = "10",
    };

    public static async Task<JsonElement> RegisterAsync(HttpClient client, Guid project, object request)
    {
        using var response = await client.PostAsJsonAsync($"/api/projects/{project}/documents", request);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(response.StatusCode == HttpStatusCode.Created, body.ToString());
        return body;
    }

    public static async Task<(HttpStatusCode Status, string? Code)> ProblemAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return (response.StatusCode, body.TryGetProperty("code", out var code) ? code.GetString() : null);
    }
}

public sealed class RegisterTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task Registering_allocates_the_next_number_from_the_routed_scheme()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var client = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(client);

        var first = await Api.RegisterAsync(client, project, Api.Drawing());
        var second = await Api.RegisterAsync(client, project, Api.Drawing("Inlet works sections"));

        Assert.Equal("P1001-10-CI-DWG-00001", first.GetProperty("number").GetString());
        Assert.Equal("P1001-10-CI-DWG-00002", second.GetProperty("number").GetString());
        Assert.True(first.GetProperty("isPlaceholder").GetBoolean());
        Assert.Equal("PLANNED", first.GetProperty("state").GetString());
        Assert.Equal("INTERNAL", first.GetProperty("confidentiality").GetString());
        Assert.Equal("PROJECT_DURATION", first.GetProperty("retentionClass").GetString());
    }

    [Fact]
    public async Task Supplier_data_uses_the_supplier_scheme_and_retention_follows_criticality()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var client = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(client);

        var doc = await Api.RegisterAsync(client, project, new
        {
            title = "Duty pump datasheet",
            deliverableType = "SUP",
            docType = "DAS",
            discipline = "ME",
            subproject = "20",
            originator = "ACME",
            contractRef = "PO101",
            receivedDate = "2026-10-01",
            criticality = "A",
        });

        Assert.Equal("P1001-20-ACME-PO101-ME-DAS-00001", doc.GetProperty("number").GetString());
        Assert.Equal("PERMANENT", doc.GetProperty("retentionClass").GetString());
    }

    [Theory]
    [InlineData("Drawing", "ENG", "DWG", "CI", "10", "TITLE_GENERIC")]
    [InlineData("Pump room layout", "ENG", "DWG", "XX", "10", "VALUE_NOT_PUBLISHED")]
    [InlineData("Pump room layout", "ENG", "DWG", "CI", null, "NUMBER_FIELD_MISSING")]
    [InlineData("Pump datasheet", "SUP", "DAS", "ME", "10", "FIELDS_REQUIRED")]
    [InlineData("", "ENG", "DWG", "CI", "10", "TITLE_REQUIRED")]
    public async Task The_rules_refuse_with_a_code(
        string title, string deliverableType, string docType, string discipline, string? subproject, string code)
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var client = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(client);

        using var response = await client.PostAsJsonAsync($"/api/projects/{project}/documents",
            new { title, deliverableType, docType, discipline, subproject });

        Assert.Equal((HttpStatusCode.UnprocessableEntity, code), await Api.ProblemAsync(response));
    }

    [Theory]
    [InlineData("viewer@demo.local")]
    [InlineData("supplier@acme.local")]
    public async Task Only_a_function_holding_create_registers(string email)
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var client = await app.SignedInAsync(email);
        var project = await Api.ProjectIdAsync(client);

        using var response = await client.PostAsJsonAsync($"/api/projects/{project}/documents", Api.Drawing());

        Assert.Equal((HttpStatusCode.Forbidden, "CREATE_NOT_ALLOWED"), await Api.ProblemAsync(response));
    }

    [Fact]
    public async Task A_project_you_are_not_on_does_not_exist()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var client = await app.SignedInAsync("engineer@demo.local");

        using var response = await client.GetAsync(new Uri($"/api/projects/{Guid.NewGuid()}/documents", UriKind.Relative));

        Assert.Equal((HttpStatusCode.NotFound, "PROJECT_NOT_FOUND"), await Api.ProblemAsync(response));
    }

    [Fact]
    public async Task Registering_at_the_same_moment_never_shares_a_number()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var client = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(client);

        var docs = await Task.WhenAll(Enumerable.Range(1, 20)
            .Select(i => Api.RegisterAsync(client, project, Api.Drawing($"Pipe rack section {i}"))));

        var numbers = docs.Select(d => d.GetProperty("number").GetString()).Order().ToList();
        Assert.Equal(Enumerable.Range(1, 20).Select(i => $"P1001-10-CI-DWG-{i:00000}"), numbers);
    }

    [Fact]
    public async Task A_retried_request_with_the_same_key_registers_once()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var client = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(client);

        async Task<HttpResponseMessage> Send(object body)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/projects/{project}/documents")
            {
                Content = JsonContent.Create(body),
            };
            request.Headers.Add("Idempotency-Key", "key-1");
            return await client.SendAsync(request);
        }

        using var first = await Send(Api.Drawing());
        using var again = await Send(Api.Drawing());
        using var other = await Send(Api.Drawing("Something else entirely"));
        var page = await client.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/documents");

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.Created, again.StatusCode);
        Assert.Equal("true", again.Headers.GetValues("Idempotent-Replayed").Single());
        Assert.Equal((await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid(),
            (await again.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid());
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "IDEMPOTENCY_KEY_REUSED"), await Api.ProblemAsync(other));
        Assert.Equal(1, page.GetProperty("items").GetArrayLength());
    }
}

public sealed class RegisterReadTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task The_register_pages_by_number()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var client = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(client);
        for (var i = 1; i <= 5; i++) await Api.RegisterAsync(client, project, Api.Drawing($"Pump bay section {i}"));

        var numbers = new List<string>();
        string? next = null;
        do
        {
            var page = await client.GetFromJsonAsync<JsonElement>(
                $"/api/projects/{project}/documents?limit=2" + (next is null ? "" : $"&after={next}"));
            numbers.AddRange(page.GetProperty("items").EnumerateArray().Select(d => d.GetProperty("number").GetString()!));
            next = page.GetProperty("next").GetString();
        } while (next is not null);

        Assert.Equal(Enumerable.Range(1, 5).Select(i => $"P1001-10-CI-DWG-{i:00000}"), numbers);
    }

    [Fact]
    public async Task A_confidential_document_is_read_by_its_creator_and_document_control_only()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var doc = await Api.RegisterAsync(engineer, project, new
        {
            title = "Land purchase valuation",
            deliverableType = "ENG",
            docType = "REP",
            discipline = "PM",
            subproject = "00",
            confidentiality = "CONFIDENTIAL",
        });
        var path = $"/api/projects/{project}/documents/{doc.GetProperty("id").GetGuid()}";

        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        using var hidden = await approver.GetAsync(new Uri(path, UriKind.Relative));
        var approverPage = await approver.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/documents");
        using var shown = await controller.GetAsync(new Uri(path, UriKind.Relative));
        using var own = await engineer.GetAsync(new Uri(path, UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        Assert.Equal(0, approverPage.GetProperty("items").GetArrayLength());
        Assert.Equal(HttpStatusCode.OK, shown.StatusCode);
        Assert.Equal(HttpStatusCode.OK, own.StatusCode);
    }

    [Fact]
    public async Task Another_party_reads_only_what_it_produces()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(controller);
        await Api.RegisterAsync(controller, project, Api.Drawing());
        await Api.RegisterAsync(controller, project, new
        {
            title = "Duty pump datasheet",
            deliverableType = "SUP",
            docType = "DAS",
            discipline = "ME",
            subproject = "20",
            originator = "ACME",
            contractRef = "PO101",
            receivedDate = "2026-10-01",
        });

        var supplier = await app.SignedInAsync("supplier@acme.local");
        var page = await supplier.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/documents");

        var numbers = page.GetProperty("items").EnumerateArray().Select(d => d.GetProperty("number").GetString());
        Assert.Equal(["P1001-20-ACME-PO101-ME-DAS-00001"], numbers);
    }
}

public sealed class RevisionTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.7\nInlet works general arrangement\n%%EOF\n");

    [Fact]
    public async Task An_uploaded_file_is_scanned_and_its_revision_becomes_ready()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var client = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(client);
        var doc = (await Api.RegisterAsync(client, project, Api.Drawing())).GetProperty("id").GetGuid();

        var fileId = await UploadAsync(client, project, doc, "GA.pdf", Pdf);
        using var started = await client.PostAsJsonAsync($"/api/projects/{project}/documents/{doc}/revisions", new { fileIds = new[] { fileId } });
        var revision = await started.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.Created, started.StatusCode);
        Assert.Equal("A", revision.GetProperty("value").GetString());
        Assert.Equal("PROCESSING", revision.GetProperty("filesState").GetString());

        var ready = await WaitForFilesAsync(client, project, doc);
        Assert.Equal("READY", ready.GetProperty("filesState").GetString());
        var file = ready.GetProperty("files")[0];
        Assert.Equal("CLEAN", file.GetProperty("status").GetString());
        Assert.Equal("application/pdf", file.GetProperty("detectedType").GetString());
        Assert.Equal("RENDITION", file.GetProperty("kind").GetString());

        var ticket = await client.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/files/{fileId}/download");
        using var raw = new HttpClient();
        Assert.Equal(Pdf, await raw.GetByteArrayAsync(new Uri(ticket.GetProperty("url").GetString()!)));

        using var second = await client.PostAsJsonAsync($"/api/projects/{project}/documents/{doc}/revisions",
            new { fileIds = new[] { await UploadAsync(client, project, doc, "GA-2.pdf", Pdf) } });
        Assert.Equal((HttpStatusCode.Conflict, "REVISION_IN_MOTION"), await Api.ProblemAsync(second));
    }

    [Fact]
    public async Task An_infected_file_rejects_its_revision_and_cannot_be_downloaded()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var client = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(client);
        var doc = (await Api.RegisterAsync(client, project, Api.Drawing())).GetProperty("id").GetGuid();

        var fileId = await UploadAsync(client, project, doc, "notes.txt", Encoding.ASCII.GetBytes("X5O " + FakeScanner.Marker));
        using var _ = await client.PostAsJsonAsync($"/api/projects/{project}/documents/{doc}/revisions", new { fileIds = new[] { fileId } });

        var revision = await WaitForFilesAsync(client, project, doc);
        Assert.Equal("REJECTED", revision.GetProperty("filesState").GetString());
        Assert.Equal("INFECTED", revision.GetProperty("files")[0].GetProperty("status").GetString());
        using var download = await client.GetAsync(new Uri($"/api/projects/{project}/files/{fileId}/download", UriKind.Relative));
        Assert.Equal((HttpStatusCode.Conflict, "FILE_NOT_AVAILABLE"), await Api.ProblemAsync(download));
    }

    [Fact]
    public async Task Bytes_that_do_not_match_the_declared_checksum_are_rejected()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var client = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(client);
        var doc = (await Api.RegisterAsync(client, project, Api.Drawing())).GetProperty("id").GetGuid();

        var fileId = await UploadAsync(client, project, doc, "GA.pdf", Pdf, declaredSha256: new string('a', 64));
        using var _ = await client.PostAsJsonAsync($"/api/projects/{project}/documents/{doc}/revisions", new { fileIds = new[] { fileId } });

        var revision = await WaitForFilesAsync(client, project, doc);
        Assert.Equal("REJECTED", revision.GetProperty("files")[0].GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_revision_can_name_a_series_of_the_scheme()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var client = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(client);
        var doc = (await Api.RegisterAsync(client, project, Api.Drawing())).GetProperty("id").GetGuid();

        using var unknown = await client.PostAsJsonAsync($"/api/projects/{project}/documents/{doc}/revisions",
            new { fileIds = new[] { await UploadAsync(client, project, doc, "GA-1.pdf", Pdf) }, series = "AS_BUILT" });
        using var execution = await client.PostAsJsonAsync($"/api/projects/{project}/documents/{doc}/revisions",
            new { fileIds = new[] { await UploadAsync(client, project, doc, "GA-2.pdf", Pdf) }, series = "EXECUTION" });
        var revision = await execution.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal((HttpStatusCode.UnprocessableEntity, "REVISION_SERIES_UNKNOWN"), await Api.ProblemAsync(unknown));
        Assert.Equal(HttpStatusCode.Created, execution.StatusCode);
        Assert.Equal(("0", "EXECUTION"), (revision.GetProperty("value").GetString(), revision.GetProperty("series").GetString()));
    }

    [Fact]
    public async Task A_revision_cannot_start_before_its_file_has_arrived()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var client = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(client);
        var doc = (await Api.RegisterAsync(client, project, Api.Drawing())).GetProperty("id").GetGuid();

        using var ticket = await client.PostAsJsonAsync($"/api/projects/{project}/documents/{doc}/uploads", new
        {
            fileName = "GA.pdf",
            size = Pdf.Length,
            contentType = "application/pdf",
            sha256 = Convert.ToHexStringLower(SHA256.HashData(Pdf)),
        });
        var fileId = (await ticket.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("fileId").GetGuid();
        using var started = await client.PostAsJsonAsync($"/api/projects/{project}/documents/{doc}/revisions", new { fileIds = new[] { fileId } });

        Assert.Equal((HttpStatusCode.UnprocessableEntity, "FILE_NOT_UPLOADED"), await Api.ProblemAsync(started));
    }

    private static async Task<Guid> UploadAsync(
        HttpClient client, Guid project, Guid doc, string name, byte[] bytes, string? declaredSha256 = null)
    {
        var contentType = name.EndsWith(".pdf", StringComparison.Ordinal) ? "application/pdf" : "text/plain";
        using var response = await client.PostAsJsonAsync($"/api/projects/{project}/documents/{doc}/uploads", new
        {
            fileName = name,
            size = bytes.Length,
            contentType,
            sha256 = declaredSha256 ?? Convert.ToHexStringLower(SHA256.HashData(bytes)),
        });
        var ticket = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(response.IsSuccessStatusCode, ticket.ToString());

        // The browser's part: straight to storage, not through the API.
        using var raw = new HttpClient();
        using var body = new ByteArrayContent(bytes);
        body.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
        using var put = await raw.PutAsync(new Uri(ticket.GetProperty("url").GetString()!), body);
        put.EnsureSuccessStatusCode();
        return ticket.GetProperty("fileId").GetGuid();
    }

    private static async Task<JsonElement> WaitForFilesAsync(HttpClient client, Guid project, Guid doc)
    {
        for (var i = 0; i < 100; i++)
        {
            var document = await client.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/documents/{doc}");
            var revision = document.GetProperty("revisions")[0];
            if (revision.GetProperty("filesState").GetString() != FilesStates.Processing) return revision;
            await Task.Delay(200);
        }
        throw new TimeoutException("The worker did not finish the revision's files.");
    }
}

public sealed class RevisionSchemeTests
{
    private static RevisionSeriesRule Letters(string code, string prefix = "", string start = "A", params string[] excluded) =>
        new() { Code = code, Label = code, Kind = SeriesKinds.Letters, Prefix = prefix, Start = start, ExcludedLetters = excluded };

    private static RevisionSeriesRule Numbers(string code, string prefix = "", string start = "0", int width = 0) =>
        new() { Code = code, Label = code, Kind = SeriesKinds.Numbers, Prefix = prefix, Start = start, Width = width };

    private static readonly RevisionScheme Recommended = new()
    {
        Name = "Recommended",
        Series = [Letters("DESIGN", excluded: ["I", "O", "Q", "S", "X", "Z"]), Numbers("EXECUTION")],
    };

    private static string Next(RevisionScheme scheme, string? series, params (string, string)[] existing) =>
        Assert.IsType<NextValue.Value>(RevisionValues.Next(scheme, existing, series)).Text;

    [Fact]
    public void The_recommendation_skips_letters_that_read_as_digits()
    {
        Assert.Equal("A", Next(Recommended, null));
        Assert.Equal("J", Next(Recommended, null, ("DESIGN", "H")));
        Assert.Equal("AA", Next(Recommended, null, ("DESIGN", "Y")));
        Assert.Equal("AB", Next(Recommended, null, ("DESIGN", "AA")));
        Assert.Equal("0", Next(Recommended, "EXECUTION", ("DESIGN", "B")));
        Assert.Equal("1", Next(Recommended, null, ("DESIGN", "B"), ("EXECUTION", "0")));
    }

    [Fact]
    public void An_organization_can_number_every_revision_1_2_3()
    {
        var digits = new RevisionScheme { Name = "Digits", Series = [Numbers("ALL", start: "1")] };

        Assert.Equal("1", Next(digits, null));
        Assert.Equal("4", Next(digits, null, ("ALL", "1"), ("ALL", "2"), ("ALL", "3")));
    }

    [Fact]
    public void Phases_design_and_client_can_each_have_their_own_series()
    {
        var scheme = new RevisionScheme
        {
            Name = "Phased",
            ForwardOnly = false,
            Series = [Numbers("PHASE", prefix: "P", start: "1", width: 2), Letters("DESIGN", start: "a"), Letters("CLIENT", prefix: "C")],
        };
        scheme.Series[1].Lowercase = true;

        Assert.Equal("P01", Next(scheme, null));
        Assert.Equal("P02", Next(scheme, "PHASE", ("PHASE", "P01")));
        Assert.Equal("a", Next(scheme, "DESIGN", ("PHASE", "P01")));
        Assert.Equal("b", Next(scheme, "DESIGN", ("PHASE", "P01"), ("DESIGN", "a")));
        Assert.Equal("CA", Next(scheme, "CLIENT", ("DESIGN", "a")));
        Assert.Equal("CB", Next(scheme, "CLIENT", ("DESIGN", "a"), ("CLIENT", "CA")));
    }

    [Fact]
    public void A_forward_only_scheme_refuses_to_go_back_to_an_earlier_series() =>
        Assert.IsType<NextValue.Backwards>(RevisionValues.Next(Recommended, [("EXECUTION", "0")], "DESIGN"));

    [Fact]
    public void A_series_the_scheme_does_not_have_is_refused() =>
        Assert.IsType<NextValue.UnknownSeries>(RevisionValues.Next(Recommended, [], "AS_BUILT"));

    [Theory]
    [InlineData(SeriesKinds.Letters, "1")]
    [InlineData(SeriesKinds.Numbers, "A")]
    [InlineData("ROMAN", "I")]
    public void A_series_that_cannot_produce_values_is_reported(string kind, string start) =>
        Assert.NotNull(RevisionValues.Problem(new RevisionSeriesRule { Code = "X", Label = "X", Kind = kind, Start = start }));

    [Theory]
    [InlineData("Drawings", true)]
    [InlineData("  report ", true)]
    [InlineData("Pump room layout", false)]
    public void Titles_that_are_only_a_listed_word_are_generic(string title, bool generic) =>
        Assert.Equal(generic, Titles.IsGeneric(title, new HashSet<string> { "drawing", "report" }));
}
