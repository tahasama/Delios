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

        // The starter setup publishes the requirements list as a document type, marked to be read when released.
        var types = await admin.GetFromJsonAsync<JsonElement>("/api/values?sets=DOCUMENT_TYPES");
        var rql = types.GetProperty("DOCUMENT_TYPES").EnumerateArray().Single(v => v.GetProperty("code").GetString() == "RQL");
        Assert.True(rql.GetProperty("props").GetProperty("readsRequirements").GetBoolean());
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

    [Fact]
    public async Task A_released_disciplines_list_tags_the_activities_and_a_schedule_without_departments_keeps_them()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var admin = await app.SignedInAsync("admin@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var p = $"/api/projects/{project}";

        // A schedule with no departments column: the activities come untagged.
        var schedule = (await Api.RegisterAsync(engineer, project, new { title = "Construction programme", deliverableType = "ENG", docType = "SCH", discipline = "PM", subproject = "00" }))
            .GetProperty("id").GetGuid();
        using (var named = await controller.PutAsJsonAsync($"{p}/schedule", new { documentId = schedule }))
            Assert.True(named.IsSuccessStatusCode, await named.Content.ReadAsStringAsync());
        var programme = "Activity ID,Activity Name,Start,Finish\n" + $"A100,Pour inlet base slab,{Day(30)},{Day(35)}\n" + $"A200,Energise MCC,{Day(40)},{Day(41)}\n";
        await ReleaseAsync(engineer, approver, controller, project, await RevisionAsync(engineer, project, schedule, "Programme.csv", programme));
        var activities = await UntilAsync(engineer, $"{p}/activities", a => a.GetArrayLength() == 2);
        Assert.All(activities.EnumerateArray(), a => Assert.Empty(a.GetProperty("departments").EnumerateArray()));
        string[] Tags(JsonElement list, string code) => list.EnumerateArray().Single(a => a.GetProperty("code").GetString() == code)
            .GetProperty("departments").EnumerateArray().Select(d => d.GetString()!).ToArray();

        // The starter setup publishes the list as a document type, marked to be read when released.
        var types = await admin.GetFromJsonAsync<JsonElement>("/api/values?sets=DOCUMENT_TYPES");
        var dpa = types.GetProperty("DOCUMENT_TYPES").EnumerateArray().Single(v => v.GetProperty("code").GetString() == "DPA");
        Assert.True(dpa.GetProperty("props").GetProperty("readsDepartments").GetBoolean());
        var list = (await Api.RegisterAsync(engineer, project, new { title = "Disciplines per action", deliverableType = "ENG", docType = "DPA", discipline = "PM", subproject = "00" }))
            .GetProperty("id").GetGuid();

        // One wrong line: nothing is applied, and Document Control is told why.
        await ReleaseAsync(engineer, approver, controller, project, await RevisionAsync(engineer, project, list, "Disciplines.csv",
            "Action Code,Departments\nA100,CI\nA999,EL\n"));
        var told = await UntilAsync(controller, "/api/me/notifications", n => n.GetProperty("rows").EnumerateArray().Any(x => x.GetProperty("title").GetString()!.Contains("disciplines list was not read")));
        Assert.Contains("A999", told.GetProperty("rows").EnumerateArray().First(x => x.GetProperty("title").GetString()!.Contains("disciplines list was not read")).GetProperty("body").GetString());
        Assert.Empty(Tags(await engineer.GetFromJsonAsync<JsonElement>($"{p}/activities"), "A100"));

        // The corrected list tags both; a discipline may be named by its label.
        await ReleaseAsync(engineer, approver, controller, project, await RevisionAsync(engineer, project, list, "Disciplines.csv",
            "Action Code,Departments\nA100,CI\nA200,\"Electrical, ME\"\n"));
        activities = await UntilAsync(engineer, $"{p}/activities", a => Tags(a, "A200").Length == 2);
        Assert.Equal(["CI"], Tags(activities, "A100"));
        Assert.Equal(["EL", "ME"], Tags(activities, "A200"));

        // A new schedule revision without the column moves the dates and keeps the tags.
        await ReleaseAsync(engineer, approver, controller, project, await RevisionAsync(engineer, project, schedule, "Programme.csv",
            "Activity ID,Activity Name,Start,Finish\n" + $"A100,Pour inlet base slab,{Day(32)},{Day(36)}\n" + $"A200,Energise MCC,{Day(40)},{Day(41)}\n"));
        var source = await UntilAsync(engineer, $"{p}/schedule", s => s.GetProperty("imports").GetArrayLength() == 2);
        Assert.Equal("DONE", source.GetProperty("imports")[0].GetProperty("status").GetString());
        activities = await engineer.GetFromJsonAsync<JsonElement>($"{p}/activities");
        Assert.Equal(["CI"], Tags(activities, "A100"));
        Assert.Equal(["EL", "ME"], Tags(activities, "A200"));
    }

    [Fact]
    public async Task A_list_uploaded_without_a_register_document_needs_the_uploaders_word_and_is_applied_whole()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var p = $"/api/projects/{project}";
        static string B64(string text) => Convert.ToBase64String(Encoding.UTF8.GetBytes(text));
        var programme = "Activity ID,Activity Name,Start,Finish\n" + $"A100,Pour inlet base slab,{Day(30)},{Day(35)}\n" + $"A200,Energise MCC,{Day(40)},{Day(41)}\n";

        // Only Document Control, and only with their word that it is not a register document, and why.
        var (engineerTried, engineerBody) = await Flow.PostAsync(engineer, $"{p}/schedule/lists", new { kind = "SCHEDULE", fileName = "Programme.csv", contentBase64 = B64(programme), aware = true, reason = "No schedule document yet" });
        Assert.Equal((HttpStatusCode.Forbidden, "PLAN_NOT_ALLOWED"), (engineerTried, Flow.Code(engineerBody)));
        var (unaware, unawareBody) = await Flow.PostAsync(controller, $"{p}/schedule/lists", new { kind = "SCHEDULE", fileName = "Programme.csv", contentBase64 = B64(programme), aware = false, reason = "x" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "NOT_AWARE"), (unaware, Flow.Code(unawareBody)));
        var (silent, silentBody) = await Flow.PostAsync(controller, $"{p}/schedule/lists", new { kind = "SCHEDULE", fileName = "Programme.csv", contentBase64 = B64(programme), aware = true, reason = " " });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "REASON_REQUIRED"), (silent, Flow.Code(silentBody)));

        // The schedule, applied at once.
        var (read, readBody) = await Flow.PostAsync(controller, $"{p}/schedule/lists", new { kind = "SCHEDULE", fileName = "Programme.csv", contentBase64 = B64(programme), aware = true, reason = "The planner sent it by email; the schedule document comes next week." });
        Assert.True(read == HttpStatusCode.OK, readBody.ToString());
        Assert.Equal(2, (await engineer.GetFromJsonAsync<JsonElement>($"{p}/activities")).GetArrayLength());

        // A wrong line: nothing is applied.
        var (wrong, wrongBody) = await Flow.PostAsync(controller, $"{p}/schedule/lists", new { kind = "DEPARTMENTS", fileName = "Disciplines.csv", contentBase64 = B64("Action Code,Departments\nA100,CI\nA999,EL\n"), aware = true, reason = "Sent by the project manager" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "LIST_NOT_READ"), (wrong, Flow.Code(wrongBody)));
        Assert.All((await engineer.GetFromJsonAsync<JsonElement>($"{p}/activities")).EnumerateArray(), a => Assert.Empty(a.GetProperty("departments").EnumerateArray()));

        // The corrected list is applied, and kept with who uploaded it and why.
        var (tagged, taggedBody) = await Flow.PostAsync(controller, $"{p}/schedule/lists", new { kind = "DEPARTMENTS", fileName = "Disciplines.csv", contentBase64 = B64("Action Code,Departments\nA100,CI\nA200,EL\n"), aware = true, reason = "Sent by the project manager" });
        Assert.True(tagged == HttpStatusCode.OK, taggedBody.ToString());
        var activities = await engineer.GetFromJsonAsync<JsonElement>($"{p}/activities");
        Assert.Contains(activities.EnumerateArray(), a => a.GetProperty("code").GetString() == "A200" && a.GetProperty("departments")[0].GetString() == "EL");
        var kept = await controller.GetFromJsonAsync<JsonElement>($"{p}/controlled?kind=ACTION_DEPARTMENTS");
        Assert.Contains(kept.EnumerateArray(), v => v.GetProperty("decisionReason").GetString() == "Sent by the project manager" && v.GetProperty("createdBy").GetString() == "Carla Control");
    }

    [Fact]
    public async Task The_spreadsheet_of_a_released_revision_is_uploaded_on_the_schedule_and_read_against_that_revision()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var p = $"/api/projects/{project}";
        static string B64(string text) => Convert.ToBase64String(Encoding.UTF8.GetBytes(text));
        async Task<Guid> ReleasedPdfOnlyAsync(Guid document)
        {
            var pdf = await Flow.UploadAsync(engineer, project, document, "Printed.pdf", Flow.Pdf(), "application/pdf");
            var (_, revision) = await Flow.PostAsync(engineer, $"{p}/documents/{document}/revisions", new { fileIds = new[] { pdf } });
            var id = revision.GetProperty("id").GetGuid();
            await Flow.UntilAsync(engineer, project, document, d => Flow.Revision(d, id).GetProperty("filesState").GetString() != "PROCESSING");
            await ReleaseAsync(engineer, approver, controller, project, id);
            return id;
        }

        // The schedule document, released as a PDF only: its read fails for want of a spreadsheet.
        var schedule = (await Api.RegisterAsync(engineer, project, new { title = "Construction programme", deliverableType = "ENG", docType = "SCH", discipline = "PM", subproject = "00" }))
            .GetProperty("id").GetGuid();
        using (var named = await controller.PutAsJsonAsync($"{p}/schedule", new { documentId = schedule }))
            Assert.True(named.IsSuccessStatusCode, await named.Content.ReadAsStringAsync());
        var revA = await ReleasedPdfOnlyAsync(schedule);
        await UntilAsync(engineer, $"{p}/schedule", s => s.GetProperty("imports").GetArrayLength() == 1);

        // Its spreadsheet, uploaded on the schedule for rev A: the uploader vouches for it, or says why it differs.
        var programme = "Activity ID,Activity Name,Start,Finish\n" + $"A100,Pour inlet base slab,{Day(30)},{Day(35)}\n" + $"A200,Energise MCC,{Day(40)},{Day(41)}\n";
        var (unvouched, unvouchedBody) = await Flow.PostAsync(controller, $"{p}/schedule/lists", new { kind = "SCHEDULE", fileName = "Programme.csv", contentBase64 = B64(programme), revisionId = revA });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "CONFIRM_OR_REASON"), (unvouched, Flow.Code(unvouchedBody)));
        var (read, readBody) = await Flow.PostAsync(controller, $"{p}/schedule/lists", new { kind = "SCHEDULE", fileName = "Programme.csv", contentBase64 = B64(programme), revisionId = revA, confirmed = true });
        Assert.True(read == HttpStatusCode.OK, readBody.ToString());
        Assert.Equal(2, (await engineer.GetFromJsonAsync<JsonElement>($"{p}/activities")).GetArrayLength());
        var imports = (await engineer.GetFromJsonAsync<JsonElement>($"{p}/schedule")).GetProperty("imports");
        Assert.Equal(("DONE", 1), (imports[0].GetProperty("status").GetString(), imports.GetArrayLength()));

        // A file that differs from rev A as released says why.
        var (reasoned, reasonedBody) = await Flow.PostAsync(controller, $"{p}/schedule/lists", new { kind = "SCHEDULE", fileName = "Programme.csv", contentBase64 = B64(programme), revisionId = revA, reason = "The first export missed a column" });
        Assert.True(reasoned == HttpStatusCode.OK, reasonedBody.ToString());

        // The schedule's revision is not a disciplines list.
        var (wrong, wrongBody) = await Flow.PostAsync(controller, $"{p}/schedule/lists", new { kind = "DEPARTMENTS", fileName = "Disciplines.csv", contentBase64 = B64("Action Code,Departments\nA100,CI\n"), revisionId = revA, confirmed = true });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "NOT_THIS_LIST"), (wrong, Flow.Code(wrongBody)));

        // The disciplines list, released as a PDF only, then its spreadsheet: kept against its revision.
        var list = (await Api.RegisterAsync(engineer, project, new { title = "Disciplines per action", deliverableType = "ENG", docType = "DPA", discipline = "PM", subproject = "00" }));
        var listRev = await ReleasedPdfOnlyAsync(list.GetProperty("id").GetGuid());
        var (tagged, taggedBody) = await Flow.PostAsync(controller, $"{p}/schedule/lists", new { kind = "DEPARTMENTS", fileName = "Disciplines.csv", contentBase64 = B64("Action Code,Departments\nA100,CI\nA200,EL\n"), revisionId = listRev, confirmed = true });
        Assert.True(tagged == HttpStatusCode.OK, taggedBody.ToString());
        var kept = await controller.GetFromJsonAsync<JsonElement>($"{p}/controlled?kind=ACTION_DEPARTMENTS");
        Assert.Contains(kept.EnumerateArray(), v => v.GetProperty("sourceName").GetString() == $"{list.GetProperty("number").GetString()} rev A");
    }
}
