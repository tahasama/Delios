using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Delios.Tests;

/// <summary>The organization's directory and published rules, kept by its administrators; and the document edits the screens make.</summary>
public sealed class AdminTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static async Task<(HttpStatusCode Status, JsonElement Body)> PutAsync(HttpClient client, string path, object body)
    {
        using var response = await client.PutAsJsonAsync(path, body);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, text.Length == 0 ? default : JsonDocument.Parse(text).RootElement);
    }

    [Fact]
    public async Task An_administrator_adds_a_person_puts_them_on_a_project_and_they_sign_in_to_it()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var admin = await app.SignedInAsync("admin@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(engineer);

        // Only an administrator keeps the directory.
        var (refused, refusal) = await Flow.PostAsync(engineer, "/api/admin/users", new { name = "Nobody", email = "nobody@demo.local", password = "secret-123" });
        Assert.Equal((HttpStatusCode.Forbidden, "ADMIN_ONLY"), (refused, Flow.Code(refusal)));

        // An email signs one person in to one organization.
        var (taken, takenBody) = await Flow.PostAsync(admin, "/api/admin/users", new { name = "Twin", email = "Engineer@demo.local", password = "secret-123" });
        Assert.Equal((HttpStatusCode.Conflict, "EMAIL_TAKEN"), (taken, Flow.Code(takenBody)));

        var (created, body) = await Flow.PostAsync(admin, "/api/admin/users", new { name = "Nora New", email = "nora@demo.local", password = "secret-123" });
        Assert.True(created == HttpStatusCode.Created, body.ToString());
        var nora = body.GetProperty("id").GetGuid();

        var functions = await admin.GetFromJsonAsync<JsonElement>("/api/admin/functions");
        var reviewer = functions.EnumerateArray().First(f => f.GetProperty("rules").EnumerateArray()
            .Any(r => r.GetProperty("verbs").EnumerateArray().Any(v => v.GetString() == "REVIEW"))).GetProperty("id").GetGuid();
        var (placed, placedBody) = await PutAsync(admin, $"/api/admin/projects/{project}/members", new { userId = nora, functionId = reviewer, department = "CI" });
        Assert.True(placed == HttpStatusCode.NoContent, placedBody.ToString());

        var noraClient = await app.SignedInAsync("nora@demo.local", "secret-123");
        var me = await noraClient.GetFromJsonAsync<JsonElement>("/api/me");
        Assert.Contains(me.GetProperty("projects").EnumerateArray(), p => p.GetProperty("id").GetGuid() == project);

        // Switched off, they no longer get in, and every change is on the record.
        var (off, offBody) = await PutAsync(admin, $"/api/admin/users/{nora}", new { active = false });
        Assert.True(off == HttpStatusCode.NoContent, offBody.ToString());
        using var after = await noraClient.GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
        var (self, selfBody) = await PutAsync(admin, $"/api/admin/users/{(await admin.GetFromJsonAsync<JsonElement>("/api/me")).GetProperty("user").GetProperty("id").GetGuid()}", new { active = false });
        Assert.Equal((HttpStatusCode.Conflict, "SELF_LOCKOUT"), (self, Flow.Code(selfBody)));

        var audit = await admin.GetFromJsonAsync<JsonElement>("/api/admin/audit?q=Nora");
        var acts = audit.GetProperty("rows").EnumerateArray().Select(r => r.GetProperty("action").GetString()).ToList();
        Assert.Contains("USER_CREATED", acts);
        Assert.Contains("MEMBERSHIP_CHANGED", acts);
        Assert.Contains("USER_UPDATED", acts);
    }

    [Fact]
    public async Task An_administrator_publishes_values_routes_and_numbering_and_the_matrix_decides_who_may()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var admin = await app.SignedInAsync("admin@demo.local");

        // A value is published, relabelled and retired; never deleted.
        var (published, publishedBody) = await PutAsync(admin, "/api/admin/values", new { setKey = "DISCIPLINES", code = "GT", label = "Geotech" });
        Assert.True(published == HttpStatusCode.NoContent, publishedBody.ToString());
        await PutAsync(admin, "/api/admin/values", new { setKey = "DISCIPLINES", code = "GT", label = "Geotechnical", status = "RETIRED" });
        var values = await admin.GetFromJsonAsync<JsonElement>("/api/values?sets=DISCIPLINES");
        var gt = values.GetProperty("DISCIPLINES").EnumerateArray().Single(v => v.GetProperty("code").GetString() == "GT");
        Assert.Equal(("Geotechnical", "RETIRED"), (gt.GetProperty("label").GetString(), gt.GetProperty("status").GetString()));

        // A route is answered by a function in use, or by an organization; never by nobody.
        var (badRoute, badRouteBody) = await Flow.PostAsync(admin, "/api/admin/routes", new
        {
            name = "Broken",
            steps = new[] { new { title = "Decide", mode = "ANY" } },
        });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "STEP_ANSWERER_REQUIRED"), (badRoute, Flow.Code(badRouteBody)));
        var functions = await admin.GetFromJsonAsync<JsonElement>("/api/admin/functions");
        var code = functions.EnumerateArray().First().GetProperty("code").GetString();
        var (route, routeBody) = await Flow.PostAsync(admin, "/api/admin/routes", new
        {
            name = "Short check",
            steps = new[] { new { title = "Decide", functionCode = code, mode = "ANY" } },
        });
        Assert.True(route == HttpStatusCode.Created, routeBody.ToString());
        var routes = await admin.GetFromJsonAsync<JsonElement>("/api/admin/routes");
        Assert.Contains(routes.EnumerateArray(), r => r.GetProperty("name").GetString() == "Short check");

        // A number needs exactly one sequence.
        var (noSequence, noSequenceBody) = await Flow.PostAsync(admin, "/api/admin/numbering/schemes", new
        {
            name = "No sequence",
            fields = new[] { new { label = "Project", source = "PROJECT" } },
        });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "SEQUENCE_REQUIRED"), (noSequence, Flow.Code(noSequenceBody)));

        // A function with no matrix rows may do nothing; its rows replace as a whole.
        var (made, madeBody) = await Flow.PostAsync(admin, "/api/admin/functions", new { name = "Site Observer" });
        Assert.True(made == HttpStatusCode.Created, madeBody.ToString());
        var observer = madeBody.GetProperty("id").GetGuid();
        var (badVerb, badVerbBody) = await PutAsync(admin, $"/api/admin/functions/{observer}", new { rules = new[] { new { verbs = new[] { "FLY" } } } });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "VERB_UNKNOWN"), (badVerb, Flow.Code(badVerbBody)));
        await PutAsync(admin, $"/api/admin/functions/{observer}", new { rules = new[] { new { verbs = new[] { "READ" }, discipline = "CI" } } });
        var rules = (await admin.GetFromJsonAsync<JsonElement>("/api/admin/functions")).EnumerateArray()
            .Single(f => f.GetProperty("id").GetGuid() == observer).GetProperty("rules");
        Assert.Equal(("READ", "CI"), (rules[0].GetProperty("verbs")[0].GetString(), rules[0].GetProperty("discipline").GetString()));
    }

    [Fact]
    public async Task A_document_is_edited_field_by_field_and_ended_with_a_reason()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var document = (await Api.RegisterAsync(engineer, project, Api.Drawing())).GetProperty("id").GetGuid();
        var path = $"/api/projects/{project}/documents/{document}";

        var (generic, genericBody) = await PutAsync(engineer, path, new { changes = new Dictionary<string, string?> { ["title"] = "Drawing" } });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "TITLE_GENERIC"), (generic, Flow.Code(genericBody)));
        var (unpublished, unpublishedBody) = await PutAsync(engineer, path, new { changes = new Dictionary<string, string?> { ["discipline"] = "ZZ" } });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "VALUE_NOT_PUBLISHED"), (unpublished, Flow.Code(unpublishedBody)));
        var (fixedNumber, fixedNumberBody) = await PutAsync(engineer, path, new { changes = new Dictionary<string, string?> { ["deliverableType"] = "SUP" } });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "FIELD_NOT_EDITABLE"), (fixedNumber, Flow.Code(fixedNumberBody)));

        var (edited, editedBody) = await PutAsync(engineer, path, new
        {
            changes = new Dictionary<string, string?> { ["title"] = "Inlet works general arrangement, sheet 2", ["receivedDate"] = "2026-10-05" },
        });
        Assert.True(edited == HttpStatusCode.NoContent, editedBody.ToString());
        var doc = await engineer.GetFromJsonAsync<JsonElement>(path);
        Assert.Equal(("Inlet works general arrangement, sheet 2", "2026-10-05"), (doc.GetProperty("title").GetString(), doc.GetProperty("receivedDate").GetString()));
        var history = await engineer.GetFromJsonAsync<JsonElement>($"{path}/context");
        Assert.Contains(history.GetProperty("history").EnumerateArray(), h => h.GetProperty("action").GetString() == "METADATA_CHANGE"
            && h.GetProperty("detail").GetString()!.StartsWith("title: Inlet works general arrangement →"));

        var (noReason, noReasonBody) = await Flow.PostAsync(engineer, $"{path}/end", new { state = "CANCELLED" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "REASON_REQUIRED"), (noReason, Flow.Code(noReasonBody)));
        var (ended, endedBody) = await Flow.PostAsync(engineer, $"{path}/end", new { state = "CANCELLED", reason = "Scope removed by variation 12." });
        Assert.True(ended == HttpStatusCode.NoContent, endedBody.ToString());
        Assert.Equal("CANCELLED", (await engineer.GetFromJsonAsync<JsonElement>(path)).GetProperty("state").GetString());
        var (closed, closedBody) = await PutAsync(engineer, path, new { changes = new Dictionary<string, string?> { ["title"] = "Something else entirely" } });
        Assert.Equal((HttpStatusCode.Conflict, "DOCUMENT_NOT_OPEN"), (closed, Flow.Code(closedBody)));
    }

    [Fact]
    public async Task A_revision_started_ahead_of_its_files_takes_them_while_in_preparation_and_not_after()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var document = (await Api.RegisterAsync(engineer, project, Api.Drawing())).GetProperty("id").GetGuid();
        var path = $"/api/projects/{project}/documents/{document}";

        var (none, noneBody) = await Flow.PostAsync(engineer, $"{path}/revisions", new { fileIds = Array.Empty<Guid>() });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "FILES_REQUIRED"), (none, Flow.Code(noneBody)));
        var (started, revision) = await Flow.PostAsync(engineer, $"{path}/revisions", new { filesLater = true, changeDescription = "First go" });
        Assert.True(started == HttpStatusCode.Created, revision.ToString());
        var id = revision.GetProperty("id").GetGuid();
        Assert.Equal("NONE", revision.GetProperty("filesState").GetString());

        // Nothing to review yet.
        var (early, earlyBody) = await Flow.PostAsync(engineer, $"/api/projects/{project}/revisions/{id}/reviews", new { });
        Assert.Equal(HttpStatusCode.Conflict, early);
        Assert.NotNull(Flow.Code(earlyBody));

        var file = await Flow.UploadAsync(engineer, project, document, "GA.pdf", Flow.Pdf(), "application/pdf");
        var (attached, attachedBody) = await Flow.PostAsync(engineer, $"{path}/revisions/{id}/files", new { fileIds = new[] { file } });
        Assert.True(attached == HttpStatusCode.OK, attachedBody.ToString());
        await Flow.UntilAsync(engineer, project, document, d => Flow.Revision(d, id).GetProperty("filesState").GetString() == "READY");
        var (review, reviewBody) = await Flow.PostAsync(engineer, $"/api/projects/{project}/revisions/{id}/reviews", new { });
        Assert.True(review == HttpStatusCode.Created, reviewBody.ToString());

        // In review, what was reviewed is fixed: the next revision carries new files.
        var late = await Flow.UploadAsync(engineer, project, document, "GA-2.pdf", Flow.Pdf(2), "application/pdf");
        var (refused, refusedBody) = await Flow.PostAsync(engineer, $"{path}/revisions/{id}/files", new { fileIds = new[] { late } });
        Assert.Equal((HttpStatusCode.Conflict, "REVISION_NOT_IN_PREPARATION"), (refused, Flow.Code(refusedBody)));
    }
}
