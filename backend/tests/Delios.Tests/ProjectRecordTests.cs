using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Delios.Tests;

/// <summary>Assets, exceptions, number ranges, calls to departments and readiness, lists issued to senders, uploaded lists for a decision.</summary>
public sealed class ProjectRecordTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static string Day(int days) => DateTime.UtcNow.Date.AddDays(days).ToString("dd-MMM-yy", CultureInfo.InvariantCulture);

    [Fact]
    public async Task Assets_are_kept_by_Document_Control_and_documents_are_linked_to_them()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(controller);
        var p = $"/api/projects/{project}";

        var (refused, _) = await Flow.PostAsync(engineer, $"{p}/assets", new { code = "P-101", name = "Duty pump" });
        Assert.Equal(HttpStatusCode.Forbidden, refused);
        var (added, asset) = await Flow.PostAsync(controller, $"{p}/assets", new { code = "p-101", name = "Duty pump", area = "Pump house" });
        Assert.True(added == HttpStatusCode.Created, asset.ToString());
        Assert.Equal("P-101", asset.GetProperty("code").GetString());
        var (twice, twiceBody) = await Flow.PostAsync(controller, $"{p}/assets", new { code = "P-101", name = "Again" });
        Assert.Equal((HttpStatusCode.Conflict, "ASSET_EXISTS"), (twice, Flow.Code(twiceBody)));

        var document = (await Api.RegisterAsync(engineer, project, Api.Drawing("Pump house GA"))).GetProperty("id").GetGuid();
        var (linked, linkedBody) = await Flow.PostAsync(engineer, $"{p}/documents/{document}/assets", new { assetCode = "P-101" });
        Assert.True(linked == HttpStatusCode.NoContent, linkedBody.ToString());
        var links = await engineer.GetFromJsonAsync<JsonElement>($"{p}/documents/{document}/assets");
        Assert.Equal("P-101", links[0].GetProperty("code").GetString());
        var detail = await engineer.GetFromJsonAsync<JsonElement>($"{p}/assets/{asset.GetProperty("id")}");
        Assert.Equal(document, detail.GetProperty("documents")[0].GetProperty("id").GetGuid());

        var (inUse, inUseBody) = await Flow.PostAsync(controller, $"{p}/assets/{asset.GetProperty("id")}/retire", new { });
        Assert.Equal("ASSET_IN_USE", Flow.Code(inUseBody));
        using (var unlink = await engineer.DeleteAsync($"{p}/document-assets/{links[0].GetProperty("id")}"))
            Assert.Equal(HttpStatusCode.NoContent, unlink.StatusCode);
        var (retired, _) = await Flow.PostAsync(controller, $"{p}/assets/{asset.GetProperty("id")}/retire", new { });
        Assert.Equal(HttpStatusCode.NoContent, retired);
        Assert.Empty((await controller.GetFromJsonAsync<JsonElement>($"{p}/assets")).EnumerateArray());

        // Exceptions and number ranges.
        var (exception, exceptionBody) = await Flow.PostAsync(controller, $"{p}/exceptions", new
        {
            item = "Vendor drawings",
            clauses = "7.3",
            reason = "Vendor portal numbering",
            authority = "Project director",
            startDate = "2026-10-01",
        });
        Assert.True(exception == HttpStatusCode.OK, exceptionBody.ToString());
        var (range, _) = await Flow.PostAsync(controller, $"{p}/number-ranges", new { prefix = "P1001-ACME-ME-DWG", from = 1, to = 99, issuedTo = "Acme Pumps" });
        Assert.Equal(HttpStatusCode.OK, range);
        var (overlap, overlapBody) = await Flow.PostAsync(controller, $"{p}/number-ranges", new { prefix = "P1001-ACME-ME-DWG", from = 50, to = 150, issuedTo = "Other" });
        Assert.Equal("RANGE_OVERLAPS", Flow.Code(overlapBody));
    }

    [Fact]
    public async Task Departments_are_asked_once_per_activity_and_confirm_readiness_before_it()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var p = $"/api/projects/{project}";

        var schedule = (await Api.RegisterAsync(engineer, project, new
        {
            title = "Construction programme",
            deliverableType = "ENG",
            docType = "SCH",
            discipline = "PM",
            subproject = "00",
        })).GetProperty("id").GetGuid();
        using (var named = await controller.PutAsJsonAsync($"{p}/schedule", new { documentId = schedule }))
            Assert.True(named.IsSuccessStatusCode);
        var pdf = await Flow.UploadAsync(engineer, project, schedule, "Programme.pdf", Flow.Pdf(), "application/pdf");
        var csv = await Flow.UploadAsync(engineer, project, schedule, "Programme.csv", Encoding.UTF8.GetBytes(
            "Activity ID,Activity Name,Start,Finish,Responsible,Departments\n"
            + $"A100,Pour inlet base slab,{Day(20)},{Day(25)},Site team,CI\n"
            + $"A200,Install switchgear,{Day(40)},{Day(45)},Electrical,\n"), "text/csv");
        var (_, revision) = await Flow.PostAsync(engineer, $"{p}/documents/{schedule}/revisions", new { fileIds = new[] { pdf, csv } });
        var revisionId = revision.GetProperty("id").GetGuid();
        await Flow.UntilAsync(engineer, project, schedule, d => Flow.Revision(d, revisionId).GetProperty("filesState").GetString() != "PROCESSING");
        var (_, review) = await Flow.PostAsync(engineer, $"{p}/revisions/{revisionId}/reviews", new { });
        var reviewId = review.GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, $"{p}/reviews/{reviewId}/answer", new { });
        await Flow.PostAsync(approver, $"{p}/reviews/{reviewId}/answer", new { verdict = "C1", status = "IFC" });
        await Flow.PostAsync(controller, $"{p}/reviews/{reviewId}/release", new { });
        JsonElement activities = default;
        for (var i = 0; i < 150 && activities.ValueKind != JsonValueKind.Array | (activities.ValueKind == JsonValueKind.Array && activities.GetArrayLength() < 2); i++)
        {
            activities = await engineer.GetFromJsonAsync<JsonElement>($"{p}/activities");
            if (activities.GetArrayLength() < 2) await Task.Delay(200);
        }
        var a200 = activities.EnumerateArray().Single(a => a.GetProperty("code").GetString() == "A200").GetProperty("id").GetGuid();
        var a100 = activities.EnumerateArray().Single(a => a.GetProperty("code").GetString() == "A100").GetProperty("id").GetGuid();

        // The project manager's list tags A200 with EL.
        using (var tag = await controller.PutAsJsonAsync($"{p}/activities/{a200}/departments", new { departments = new[] { "el" } }))
            Assert.Equal(HttpStatusCode.NoContent, tag.StatusCode);

        var due = DateTime.UtcNow.Date.AddDays(5).ToString("yyyy-MM-dd");
        var (asked, calls) = await Flow.PostAsync(controller, $"{p}/requirement-calls", new { departments = new[] { "CI", "EL" }, dueOn = due });
        Assert.True(asked == HttpStatusCode.OK, calls.ToString());
        Assert.Equal(2, calls.GetArrayLength());
        // Asked once: a second call has nothing new to ask.
        var (again, againBody) = await Flow.PostAsync(controller, $"{p}/requirement-calls", new { departments = new[] { "CI" }, dueOn = due });
        Assert.Equal("NOTHING_TO_ASK", Flow.Code(againBody));
        var ci = calls.EnumerateArray().Single(c => c.GetProperty("department").GetString() == "CI").GetProperty("id").GetGuid();
        var (_, reminded) = await Flow.PostAsync(controller, $"{p}/requirement-calls/{ci}/remind", new { });
        Assert.Equal(1, reminded.GetProperty("reminders").GetInt32());
        var (_, answered) = await Flow.PostAsync(controller, $"{p}/requirement-calls/{ci}/answer", new { note = "Nothing needed." });
        Assert.NotEqual(JsonValueKind.Null, answered.GetProperty("answeredAt").ValueKind);

        // Readiness: a shortage needs words.
        var (noNote, noNoteBody) = await Flow.PostAsync(controller, $"{p}/activities/{a100}/readiness", new { department = "CI", available = false });
        Assert.Equal("NOTE_REQUIRED", Flow.Code(noNoteBody));
        var (confirmed, confirmedBody) = await Flow.PostAsync(controller, $"{p}/activities/{a100}/readiness", new { department = "CI", available = true });
        Assert.True(confirmed == HttpStatusCode.OK, confirmedBody.ToString());
        var (notTheirs, _) = await Flow.PostAsync(engineer, $"{p}/activities/{a100}/readiness", new { department = "CI", available = true });
        Assert.Equal(HttpStatusCode.Forbidden, notTheirs);
        var readiness = await controller.GetFromJsonAsync<JsonElement>($"{p}/readiness");
        Assert.True(readiness[0].GetProperty("available").GetBoolean());
        var (told, toldBody) = await Flow.PostAsync(controller, $"{p}/activities/{a100}/notify-departments", new { });
        Assert.True(told == HttpStatusCode.OK, toldBody.ToString());
    }

    [Fact]
    public async Task An_uploaded_list_waits_as_a_draft_then_is_approved_or_rejected_with_a_reason()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var controller = await app.SignedInAsync("controller@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(controller);
        var p = $"/api/projects/{project}";
        var upload = new { kind = "ACTION_DEPARTMENTS", title = "Departments per action", payload = new[] { new { actionCode = "A100", departments = new[] { "CI" } } }, rowCount = 1 };

        var (refused, _) = await Flow.PostAsync(engineer, $"{p}/controlled", upload);
        Assert.Equal(HttpStatusCode.Forbidden, refused);
        var (_, first) = await Flow.PostAsync(controller, $"{p}/controlled", upload);
        Assert.Equal(("v1", "DRAFT"), (first.GetProperty("versionLabel").GetString(), first.GetProperty("state").GetString()));
        var (_, submitted) = await Flow.PostAsync(controller, $"/api/controlled/{first.GetProperty("id")}/submit", new { });
        Assert.Equal("SUBMITTED", submitted.GetProperty("state").GetString());
        var (_, approved) = await Flow.PostAsync(controller, $"/api/controlled/{first.GetProperty("id")}/decide", new { approve = true, appliedSummary = "1 activity tagged." });
        Assert.Equal("APPROVED", approved.GetProperty("state").GetString());

        var (_, second) = await Flow.PostAsync(controller, $"{p}/controlled", upload);
        Assert.Equal("v2", second.GetProperty("versionLabel").GetString());
        var (noReason, noReasonBody) = await Flow.PostAsync(controller, $"/api/controlled/{second.GetProperty("id")}/decide", new { approve = false });
        Assert.Equal("REASON_REQUIRED", Flow.Code(noReasonBody));
        var (_, rejected) = await Flow.PostAsync(controller, $"/api/controlled/{second.GetProperty("id")}/decide", new { approve = false, reason = "Wrong file." });
        Assert.Equal("REJECTED", rejected.GetProperty("state").GetString());
        var list = await controller.GetFromJsonAsync<JsonElement>($"{p}/controlled?kind=ACTION_DEPARTMENTS");
        Assert.Contains(list.EnumerateArray(), v => v.GetProperty("versionLabel").GetString() == "v1" && v.GetProperty("state").GetString() == "APPROVED");
    }
}
