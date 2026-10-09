using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Delios.Tests;

/// <summary>Records confirmed and corrected, an approval withdrawn, a comment reclassified, and packages with several reasons, tags and a reason to delete.</summary>
public sealed class GovernanceTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task A_record_is_confirmed_once_and_corrected_by_a_further_record()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var p = $"/api/projects/{project}";
        var record = (await Api.RegisterAsync(engineer, project, new
        {
            title = "Concrete cube test results, pour 3",
            deliverableType = "ENG",
            docType = "REP",
            discipline = "CI",
            subproject = "10",
            kind = "RECORD",
        })).GetProperty("id").GetGuid();

        var (confirmed, body) = await Flow.PostAsync(engineer, $"{p}/documents/{record}/confirm", new { });
        Assert.True(confirmed == HttpStatusCode.NoContent, body.ToString());
        var (twice, twiceBody) = await Flow.PostAsync(engineer, $"{p}/documents/{record}/confirm", new { });
        Assert.Equal("ALREADY_CONFIRMED", Flow.Code(twiceBody));
        var view = await engineer.GetFromJsonAsync<JsonElement>($"{p}/documents/{record}");
        Assert.Equal("Eli Engineer", view.GetProperty("confirmedByName").GetString());

        var (corrected, correction) = await Flow.PostAsync(engineer, $"{p}/documents/{record}/correction", new { title = "Concrete cube test results, pour 3 (corrected)" });
        Assert.True(corrected == HttpStatusCode.OK, correction.ToString());
        var newer = await engineer.GetFromJsonAsync<JsonElement>($"{p}/documents/{correction.GetProperty("id")}");
        Assert.Equal((record, "RECORD"), (newer.GetProperty("correctsId").GetGuid(), newer.GetProperty("kind").GetString()));
    }

    [Fact]
    public async Task Document_Control_withdraws_an_approval_and_a_comment_is_reclassified()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var path = $"/api/projects/{p.Project}";
        var (_, review) = await Flow.PostAsync(engineer, $"{path}/revisions/{p.Revision}/reviews", new { });
        var id = review.GetProperty("id").GetGuid();
        var (_, comment) = await Flow.PostAsync(engineer, $"{path}/reviews/{id}/comments", new { text = "Datum missing.", @class = "NON_BLOCKING" });

        // The author forces it to stop the release; what it was is kept.
        var (re, reBody) = await Flow.PostAsync(engineer, $"{path}/reviews/{id}/comments/{comment.GetProperty("id")}/reclassify", new { blocking = true, note = "It changes the levels." });
        Assert.True(re == HttpStatusCode.NoContent, reBody.ToString());
        var after = (await engineer.GetFromJsonAsync<JsonElement>($"{path}/reviews/{id}")).GetProperty("comments")[0];
        Assert.True(after.GetProperty("blocking").GetBoolean());
        Assert.False(after.GetProperty("originalBlocking").GetBoolean());
        await Flow.PostAsync(engineer, $"{path}/reviews/{id}/comments/{comment.GetProperty("id")}/close", new { resolution = "Added." });

        await Flow.PostAsync(engineer, $"{path}/reviews/{id}/answer", new { });
        await Flow.PostAsync(approver, $"{path}/reviews/{id}/answer", new { verdict = "C1", status = "IFC" });
        await Flow.PostAsync(controller, $"{path}/reviews/{id}/release", new { });

        var (notTheirs, _) = await Flow.PostAsync(engineer, $"{path}/revisions/{p.Revision}/withdraw-approval", new { reason = "x" });
        Assert.Equal(HttpStatusCode.Forbidden, notTheirs);
        var (withdrawn, withdrawnBody) = await Flow.PostAsync(controller, $"{path}/revisions/{p.Revision}/withdraw-approval", new { reason = "Wrong load case." });
        Assert.True(withdrawn == HttpStatusCode.NoContent, withdrawnBody.ToString());
        Assert.Equal("WITHDRAWN", (await engineer.GetFromJsonAsync<JsonElement>($"{path}/documents/{p.Document}")).GetProperty("state").GetString());
        Assert.Equal("Wrong load case.", (await engineer.GetFromJsonAsync<JsonElement>($"{path}/reviews/{id}")).GetProperty("approvalWithdrawnReason").GetString());
    }

    [Fact]
    public async Task A_package_carries_several_reasons_fills_by_tag_and_says_why_it_was_deleted()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(controller);
        var p = $"/api/projects/{project}";
        var (_, asset) = await Flow.PostAsync(controller, $"{p}/assets", new { code = "P-101", name = "Duty pump" });
        var tagged = (await Api.RegisterAsync(engineer, project, Api.Drawing("Pump house GA"))).GetProperty("id").GetGuid();
        await Api.RegisterAsync(engineer, project, Api.Drawing("Gate house GA"));
        await Flow.PostAsync(engineer, $"{p}/documents/{tagged}/assets", new { assetCode = "P-101" });
        var people = await controller.GetFromJsonAsync<JsonElement>($"{p}/addressees");
        Guid Person(string name) => people.GetProperty("people").EnumerateArray().Single(x => x.GetProperty("name").GetString() == name).GetProperty("id").GetGuid();
        var ours = people.GetProperty("ours").GetProperty("id").GetGuid();

        var (created, package) = await Flow.PostAsync(controller, $"{p}/packages", new
        {
            title = "Pump house handover",
            reasons = new[] { "INFORMATION", "REVIEW" },
            requiredStatuses = new[] { "IFC" },
            ownerIds = new[] { Person("Carla Control") },
            acceptorIds = new[] { Person("Aisha Approver") },
            recipientPartyIds = new[] { ours },
            completionDate = DateTime.UtcNow.Date.AddDays(30).ToString("yyyy-MM-dd"),
            rule = new { assetIds = new[] { asset.GetProperty("id").GetGuid() } },
            extras = new Dictionary<string, string> { ["Area"] = "71" },
        });
        Assert.True(created == HttpStatusCode.Created || created == HttpStatusCode.OK, package.ToString());
        Assert.Equal(["INFORMATION", "REVIEW"], package.GetProperty("reasons").EnumerateArray().Select(x => x.GetString()));
        var view = await controller.GetFromJsonAsync<JsonElement>($"{p}/packages/{package.GetProperty("id")}");
        Assert.Equal(tagged, Assert.Single(view.GetProperty("members").EnumerateArray()).GetProperty("documentId").GetGuid());
        Assert.Equal("71", view.GetProperty("extras").GetProperty("Area").GetString());
    }
}
