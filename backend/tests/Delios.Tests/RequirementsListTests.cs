using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Delios.Tests;

/// <summary>The document requirements list as a controlled document: reviewed, and read when released.</summary>
public sealed class RequirementsListTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static string Day(int days) => DateTime.UtcNow.Date.AddDays(days).ToString("dd-MMM-yy", CultureInfo.InvariantCulture);

    private static async Task<JsonElement> UntilAsync(HttpClient client, string path, Func<JsonElement, bool> done)
    {
        for (var i = 0; i < 200; i++)
        {
            var current = await client.GetFromJsonAsync<JsonElement>(path);
            if (done(current)) return current;
            await Task.Delay(200);
        }
        throw new TimeoutException($"{path} did not get there.");
    }

    /// <summary>A revision carrying a printed PDF and its spreadsheet, scanned and ready for review.</summary>
    private static async Task<Guid> RevisionAsync(HttpClient client, Guid project, Guid document, string csvName, string csv)
    {
        var pdf = await Flow.UploadAsync(client, project, document, "Printed.pdf", Flow.Pdf(), "application/pdf");
        var export = await Flow.UploadAsync(client, project, document, csvName, Encoding.UTF8.GetBytes(csv), "text/csv");
        var (status, revision) = await Flow.PostAsync(client, $"/api/projects/{project}/documents/{document}/revisions", new { fileIds = new[] { pdf, export } });
        Assert.True(status == HttpStatusCode.Created, revision.ToString());
        var id = revision.GetProperty("id").GetGuid();
        await Flow.UntilAsync(client, project, document, d => Flow.Revision(d, id).GetProperty("filesState").GetString() != "PROCESSING");
        return id;
    }

    private static async Task ReleaseAsync(HttpClient engineer, HttpClient approver, HttpClient controller, Guid project, Guid revision)
    {
        var (_, review) = await Flow.PostAsync(engineer, $"/api/projects/{project}/revisions/{revision}/reviews", new { });
        var id = review.GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, $"/api/projects/{project}/reviews/{id}/answer", new { });
        await Flow.PostAsync(approver, $"/api/projects/{project}/reviews/{id}/answer", new { verdict = "C1", status = "IFC" });
        var (released, body) = await Flow.PostAsync(controller, $"/api/projects/{project}/reviews/{id}/release", new { });
        Assert.True(released == HttpStatusCode.OK, body.ToString());
    }

    [Fact]
    public async Task A_released_requirements_list_becomes_what_each_activity_needs_or_nothing_if_a_line_is_wrong()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var admin = await app.SignedInAsync("admin@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var p = $"/api/projects/{project}";

        // The schedule first: the list says what its activities need.
        var schedule = (await Api.RegisterAsync(engineer, project, new { title = "Construction programme", deliverableType = "ENG", docType = "SCH", discipline = "PM", subproject = "00" }))
            .GetProperty("id").GetGuid();
        using (var named = await controller.PutAsJsonAsync($"{p}/schedule", new { documentId = schedule }))
            Assert.True(named.IsSuccessStatusCode, await named.Content.ReadAsStringAsync());
        await ReleaseAsync(engineer, approver, controller, project, await RevisionAsync(engineer, project, schedule, "Programme.csv",
            "Activity ID,Activity Name,Start,Finish,Departments\n" + $"A100,Pour inlet base slab,{Day(30)},{Day(35)},CI\n"));
        var activities = await UntilAsync(engineer, $"{p}/activities", a => a.GetArrayLength() == 1);
        var a100 = activities[0].GetProperty("id").GetGuid();

        // A document type marked as the requirements list.
        using (var put = await admin.PutAsJsonAsync("/api/admin/values", new { setKey = "DOCUMENT_TYPES", code = "RQL", label = "Document requirements list", props = new { readsRequirements = true } }))
            Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());
        var slab = (await Api.RegisterAsync(engineer, project, Api.Drawing("Inlet base slab reinforcement"))).GetProperty("number").GetString();
        var list = (await Api.RegisterAsync(engineer, project, new { title = "Civil document requirements", deliverableType = "ENG", docType = "RQL", discipline = "CI", subproject = "00" }))
            .GetProperty("id").GetGuid();
        var header = "Department,Action Code,Document,Discipline,Type,Supplier,Date of delivery,Required Status,Sub-project\n";

        // One wrong line: nothing is applied, and Document Control is told why.
        await ReleaseAsync(engineer, approver, controller, project, await RevisionAsync(engineer, project, list, "Requirements.csv",
            header + $"CI,A100,{slab},CI,,,,IFC,\n" + "CI,A999,Kerb details,CI,DWG,,,IFC,10\n"));
        var told = await UntilAsync(controller, "/api/me/notifications", n => n.GetProperty("rows").EnumerateArray().Any(x => x.GetProperty("title").GetString()!.Contains("was not read")));
        Assert.Contains("A999", told.GetProperty("rows").EnumerateArray().First(x => x.GetProperty("title").GetString()!.Contains("was not read")).GetProperty("body").GetString());
        Assert.Empty((await engineer.GetFromJsonAsync<JsonElement>($"{p}/activities/{a100}")).GetProperty("needs").EnumerateArray());

        // The corrected list: one document in the register, one that is not yet, registered as a placeholder.
        await ReleaseAsync(engineer, approver, controller, project, await RevisionAsync(engineer, project, list, "Requirements.csv",
            header + $"CI,A100,{slab},CI,,,,IFC,\n" + $",,Kerb details,CI,DWG,,{DateTime.UtcNow.Date.AddDays(20):yyyy-MM-dd},IFC,10\n"));
        var activity = await UntilAsync(engineer, $"{p}/activities/{a100}", a => a.GetProperty("needs").GetArrayLength() == 2);
        Assert.Contains(activity.GetProperty("needs").EnumerateArray(), n => n.ToString().Contains("Kerb details"));
    }
}
