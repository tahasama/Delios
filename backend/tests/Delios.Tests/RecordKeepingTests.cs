using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Delios.Tests;

/// <summary>Voiding and its reassessment, an outside approval that holds a released revision, legal hold, readers, own fields and snapshots.</summary>
public sealed class RecordKeepingTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static string P(Prepared p, string rest) => $"/api/projects/{p.Project}{rest}";

    private static async Task ReleasedAsync(HttpClient engineer, HttpClient approver, HttpClient controller, Prepared p)
    {
        var (_, review) = await Flow.PostAsync(engineer, P(p, $"/revisions/{p.Revision}/reviews"), new { });
        var id = review.GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, P(p, $"/reviews/{id}/answer"), new { });
        await Flow.PostAsync(approver, P(p, $"/reviews/{id}/answer"), new { verdict = "C1", status = "IFC" });
        var (released, body) = await Flow.PostAsync(controller, P(p, $"/reviews/{id}/release"), new { });
        Assert.True(released == HttpStatusCode.OK, body.ToString());
    }

    private static async Task<JsonElement> RevisionAsync(HttpClient client, Prepared p) =>
        Flow.Revision(await client.GetFromJsonAsync<JsonElement>(P(p, $"/documents/{p.Document}")), p.Revision);

    [Fact]
    public async Task A_released_revision_is_voided_by_its_authority_and_stays_unresolved_until_reassessed()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        await ReleasedAsync(engineer, approver, controller, p);
        var path = P(p, $"/documents/{p.Document}/revisions/{p.Revision}/void");

        var (noReason, noReasonBody) = await Flow.PostAsync(approver, path, new { reason = "" });
        Assert.Equal("REASON_REQUIRED", Flow.Code(noReasonBody));
        // Not the author's to void once released (Document Control carries this out here); the one who approved it may.
        var (refused, _) = await Flow.PostAsync(engineer, path, new { reason = "Wrong datum" });
        Assert.Equal(HttpStatusCode.Forbidden, refused);
        var (voided, body) = await Flow.PostAsync(approver, path, new { reason = "Released against the wrong datum." });
        Assert.True(voided == HttpStatusCode.OK, body.ToString());
        var revision = await RevisionAsync(engineer, p);
        Assert.Equal(("VOID", "Aisha Approver"), (revision.GetProperty("state").GetString(), revision.GetProperty("voidAuthority").GetString()));

        var open = await controller.GetFromJsonAsync<JsonElement>(P(p, "/exposures/void"));
        Assert.Contains(open.EnumerateArray(), x => x.GetProperty("revisionId").GetGuid() == p.Revision);
        using (var r = await controller.PostAsJsonAsync(P(p, $"/revisions/{p.Revision}/reassessment"), new { note = "Two foundations re-checked; no change." }))
            Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        open = await controller.GetFromJsonAsync<JsonElement>(P(p, "/exposures/void"));
        Assert.DoesNotContain(open.EnumerateArray(), x => x.GetProperty("revisionId").GetGuid() == p.Revision);

        // The point it was voided is on record, as it was.
        var snapshots = await engineer.GetFromJsonAsync<JsonElement>(P(p, $"/documents/{p.Document}/snapshots"));
        Assert.True(snapshots.GetArrayLength() >= 3);
        Assert.Contains(snapshots.EnumerateArray(), s => s.GetProperty("eventType").GetString() == "VOIDED"
            && Flow.Revision(s.GetProperty("document"), p.Revision).GetProperty("state").GetString() == "VOID");
    }

    [Fact]
    public async Task An_outside_approval_asked_after_release_holds_it_until_they_approve_and_Document_Control_lifts_it()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var supplier = await app.SignedInAsync("supplier@acme.local");
        var p = await Flow.RevisionAsync(engineer);
        await ReleasedAsync(engineer, approver, controller, p);
        var distribution = await engineer.GetFromJsonAsync<JsonElement>(P(p, $"/documents/{p.Document}/distribution"));
        var acme = distribution.GetProperty("parties").EnumerateArray().Single(x => x.GetProperty("code").GetString() == "ACME").GetProperty("id").GetGuid();
        var viewer = distribution.GetProperty("proposed").EnumerateArray().Single(x => x.GetProperty("name").GetString() == "Victor Viewer").GetProperty("id").GetGuid();

        var (asked, request) = await Flow.PostAsync(controller, P(p, $"/revisions/{p.Revision}/issue-requests"),
            new { reason = "EXECUTION", userIds = new[] { viewer }, approverPartyId = acme });
        Assert.True(asked == HttpStatusCode.Created, request.ToString());
        Assert.Equal("WAITING", request.GetProperty("request").GetProperty("approvalState").GetString());
        var held = await RevisionAsync(engineer, p);
        Assert.Contains("Acme", held.GetProperty("heldReason").GetString());
        Assert.Empty(request.GetProperty("transmittals").EnumerateArray());

        var (early, earlyBody) = await Flow.PostAsync(controller, P(p, $"/revisions/{p.Revision}/hold/lift"), new { });
        Assert.Equal((HttpStatusCode.Conflict, "AWAITING_OUTSIDE_APPROVAL"), (early, Flow.Code(earlyBody)));

        // The party answers on its own review of one step.
        var work = await supplier.GetFromJsonAsync<JsonElement>(P(p, "/work"));
        var approval = work.GetProperty("steps").EnumerateArray().Single(x => x.GetProperty("documentId").GetGuid() == p.Document).GetProperty("reviewId").GetGuid();
        var (answered, answer) = await Flow.PostAsync(supplier, P(p, $"/reviews/{approval}/answer"), new { verdict = "C1" });
        Assert.True(answered == HttpStatusCode.OK, answer.ToString());
        Assert.Equal("RELEASED", answer.GetProperty("state").GetString());

        // Approved: still held until Document Control lifts it, and then what waited is sent.
        Assert.NotEqual(JsonValueKind.Null, (await RevisionAsync(engineer, p)).GetProperty("heldAt").ValueKind);
        using (var lift = await controller.PostAsJsonAsync(P(p, $"/revisions/{p.Revision}/hold/lift"), new { }))
            Assert.Equal(HttpStatusCode.NoContent, lift.StatusCode);
        Assert.Equal(JsonValueKind.Null, (await RevisionAsync(engineer, p)).GetProperty("heldAt").ValueKind);
        var requests = await engineer.GetFromJsonAsync<JsonElement>(P(p, $"/revisions/{p.Revision}/issue-requests"));
        Assert.Contains(requests.EnumerateArray(), r => r.GetProperty("approvalState").GetString() == "APPROVED" && r.GetProperty("status").GetString() == "DONE");
    }

    [Fact]
    public async Task A_held_revision_sent_back_stays_held_for_good()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        await ReleasedAsync(engineer, approver, controller, p);
        var distribution = await engineer.GetFromJsonAsync<JsonElement>(P(p, $"/documents/{p.Document}/distribution"));
        var acme = distribution.GetProperty("parties").EnumerateArray().Single(x => x.GetProperty("code").GetString() == "ACME").GetProperty("id").GetGuid();
        await Flow.PostAsync(controller, P(p, $"/revisions/{p.Revision}/issue-requests"), new { reason = "EXECUTION", approverPartyId = acme });

        var (noReason, noReasonBody) = await Flow.PostAsync(controller, P(p, $"/revisions/{p.Revision}/hold/return"), new { reason = "" });
        Assert.Equal("REASON_REQUIRED", Flow.Code(noReasonBody));
        using (var back = await controller.PostAsJsonAsync(P(p, $"/revisions/{p.Revision}/hold/return"), new { reason = "They want the pump moved." }))
            Assert.Equal(HttpStatusCode.NoContent, back.StatusCode);
        Assert.StartsWith("Not approved outside", (await RevisionAsync(engineer, p)).GetProperty("heldReason").GetString());
        var (lift, liftBody) = await Flow.PostAsync(controller, P(p, $"/revisions/{p.Revision}/hold/lift"), new { });
        Assert.Equal((HttpStatusCode.Conflict, "HELD_FOR_GOOD"), (lift, Flow.Code(liftBody)));
    }

    [Fact]
    public async Task Legal_hold_readers_and_own_fields_are_kept_with_the_document()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var viewer = await app.SignedInAsync("viewer@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var document = (await Api.RegisterAsync(engineer, project, new
        {
            title = "Confidential pump curves",
            deliverableType = "ENG",
            docType = "DWG",
            discipline = "ME",
            subproject = "10",
            confidentiality = "CONFIDENTIAL",
            previousNumber = "OLD-123",
            legacyScheme = "2019 scheme",
            appVersion = "AutoCAD 2026",
            extras = new Dictionary<string, string> { ["Room"] = "B12" },
        })).GetProperty("id").GetGuid();
        var path = $"/api/projects/{project}/documents/{document}";

        var view = await engineer.GetFromJsonAsync<JsonElement>(path);
        Assert.Equal(("OLD-123", "B12"), (view.GetProperty("previousNumber").GetString(), view.GetProperty("extras").GetProperty("Room").GetString()));
        using (var put = await engineer.PutAsJsonAsync(path, new { changes = new Dictionary<string, string?> { ["extra:Room"] = "C3", ["appVersion"] = "" } }))
            Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());
        view = await engineer.GetFromJsonAsync<JsonElement>(path);
        Assert.Equal("C3", view.GetProperty("extras").GetProperty("Room").GetString());
        Assert.Equal(JsonValueKind.Null, view.GetProperty("appVersion").ValueKind);

        // The viewer cannot read it until the author names them.
        using (var hidden = await viewer.GetAsync(path)) Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        var people = await engineer.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/holders?verb=READ");
        var victor = people.EnumerateArray().Single(x => x.GetProperty("name").GetString() == "Victor Viewer").GetProperty("id").GetGuid();
        var (named, namedBody) = await Flow.PostAsync(engineer, $"{path}/readers", new { userIds = new[] { victor }, reason = "Site lead" });
        Assert.True(named == HttpStatusCode.OK, namedBody.ToString());
        Assert.Equal(HttpStatusCode.OK, (await viewer.GetAsync(path)).StatusCode);
        var readers = await engineer.GetFromJsonAsync<JsonElement>($"{path}/readers");
        Assert.Equal(("Victor Viewer", "Site lead"), (readers[0].GetProperty("name").GetString(), readers[0].GetProperty("reason").GetString()));
        var (notTheirs, _) = await Flow.PostAsync(viewer, $"{path}/readers", new { userIds = new[] { victor } });
        Assert.Equal(HttpStatusCode.Forbidden, notTheirs);
        using (var removed = await engineer.DeleteAsync($"{path}/readers/{victor}")) Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
        using (var hiddenAgain = await viewer.GetAsync(path)) Assert.Equal(HttpStatusCode.NotFound, hiddenAgain.StatusCode);

        // Legal hold: Document Control's.
        var (engineerHold, _) = await Flow.PostAsync(engineer, $"{path}/legal-hold", new { on = true });
        Assert.Equal(HttpStatusCode.Forbidden, engineerHold);
        var (hold, _) = await Flow.PostAsync(controller, $"{path}/legal-hold", new { on = true, reason = "Claim 42" });
        Assert.Equal(HttpStatusCode.NoContent, hold);
        Assert.True((await controller.GetFromJsonAsync<JsonElement>(path)).GetProperty("legalHold").GetBoolean());
    }
}
