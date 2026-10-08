using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Delios.Tests;

/// <summary>Document Control's own check: on arrival, and at the end of a review. A problem in the submission keeps its revision.</summary>
public sealed class ControlTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static async Task<(HttpStatusCode, JsonElement)> ResubmitAsync(HttpClient client, Prepared p, string name = "GA-corrected.pdf")
    {
        var file = await Flow.UploadAsync(client, p.Project, p.Document, name, Flow.Pdf(), "application/pdf");
        return await Flow.PostAsync(client, $"/api/projects/{p.Project}/documents/{p.Document}/revisions/{p.Revision}/submissions",
            new { fileIds = new[] { file } });
    }

    private static async Task<JsonElement> RevisionAsync(HttpClient client, Prepared p) =>
        Flow.Revision(await Flow.UntilAsync(client, p.Project, p.Document,
            d => Flow.Revision(d, p.Revision).GetProperty("filesState").GetString() != "PROCESSING"), p.Revision);

    private static async Task<JsonElement> DecidedAsync(HttpClient engineer, HttpClient approver, Prepared p, string verdict, string? status)
    {
        var (_, review) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/revisions/{p.Revision}/reviews", new { });
        var id = review.GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/reviews/{id}/answer", new { });
        var (_, decided) = await Flow.PostAsync(approver, $"/api/projects/{p.Project}/reviews/{id}/answer", new { verdict, status });
        Assert.Equal("DECIDED", decided.GetProperty("state").GetString());
        return decided;
    }

    [Fact]
    public async Task What_a_supplier_sends_is_accepted_before_review_or_returned_and_comes_back_under_the_same_revision()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var controller = await app.SignedInAsync("controller@demo.local");
        var supplier = await app.SignedInAsync("supplier@acme.local");
        var project = await Api.ProjectIdAsync(controller);
        var document = (await Api.RegisterAsync(controller, project, new
        {
            title = "Duty pump datasheet",
            deliverableType = "SUP",
            docType = "DAS",
            discipline = "ME",
            subproject = "20",
            originator = "ACME",
            contractRef = "PO101",
            receivedDate = "2026-10-01",
        })).GetProperty("id").GetGuid();

        // Starting a revision outside a transmittal is refused: what a supplier sends comes with a receipt.
        var direct = await Flow.UploadAsync(supplier, project, document, "datasheet.pdf", Flow.Pdf(), "application/pdf");
        var (outside, outsideBody) = await Flow.PostAsync(supplier, $"/api/projects/{project}/documents/{document}/revisions",
            new { fileIds = new[] { direct } });
        Assert.Equal((HttpStatusCode.Conflict, "SEND_ON_TRANSMITTAL"), (outside, Flow.Code(outsideBody)));
        var (_, sent) = await Supply.SendAsync(supplier, project, document, direct, "IFR");
        var p = new Prepared(project, document, Supply.RevisionOf(sent));
        var revision = await RevisionAsync(supplier, p);
        Assert.Equal(("RECEIVED", "IFR"), (revision.GetProperty("state").GetString(), revision.GetProperty("statusCode").GetString()));

        // Nobody reviews what Document Control has not accepted.
        var (early, earlyBody) = await Flow.PostAsync(controller, $"/api/projects/{project}/revisions/{p.Revision}/reviews", new { });
        Assert.Equal((HttpStatusCode.Conflict, "REVISION_NOT_IN_PREPARATION"), (early, Flow.Code(earlyBody)));
        var work = await controller.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/work");
        Assert.Contains(work.GetProperty("revisions").EnumerateArray(), x => x.GetProperty("kind").GetString() == "ACCEPT_SUBMISSION");

        var arrival = $"/api/projects/{project}/revisions/{p.Revision}/arrival";
        var (silent, silentBody) = await Flow.PostAsync(controller, arrival, new { outcome = "RETURNED_TO_SENDER" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "NOTE_REQUIRED"), (silent, Flow.Code(silentBody)));
        var (notMine, notMineBody) = await Flow.PostAsync(supplier, arrival, new { });
        Assert.Equal((HttpStatusCode.Forbidden, "CONTROL_ONLY"), (notMine, Flow.Code(notMineBody)));
        var (_, returned) = await Flow.PostAsync(controller, arrival, new { outcome = "RETURNED_TO_SENDER", note = "Not on the project datasheet template." });
        Assert.Equal(("CORRECTING", "RETURNED_TO_SENDER"), (returned.GetProperty("state").GetString(), returned.GetProperty("controlOutcome").GetString()));

        var supplierWork = await supplier.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/work");
        var task = supplierWork.GetProperty("revisions").EnumerateArray().Single();
        Assert.Equal(("CORRECT_AND_RESUBMIT", "Not on the project datasheet template."), (task.GetProperty("kind").GetString(), task.GetProperty("note").GetString()));

        // The corrected file comes back under the same revision, as its second submission.
        var corrected = await Flow.UploadAsync(supplier, project, document, "datasheet-template.pdf", Flow.Pdf(), "application/pdf");
        var (resubmitted, resubmittedBody) = await Supply.SendAsync(supplier, project, document, corrected, "IFR");
        Assert.True(resubmitted == HttpStatusCode.Created, resubmittedBody.ToString());
        Assert.Equal(2, resubmittedBody.GetProperty("items")[0].GetProperty("submission").GetInt32());
        revision = await RevisionAsync(supplier, p);
        Assert.Equal(("A", 2, "RECEIVED"), (revision.GetProperty("value").GetString(), revision.GetProperty("submission").GetInt32(),
            revision.GetProperty("state").GetString()));
        var history = revision.GetProperty("submissions").EnumerateArray().ToList();
        Assert.Equal(("RETURNED_TO_SENDER", "Carla Control"), (history[0].GetProperty("outcome").GetString(), history[0].GetProperty("decidedBy").GetString()));
        Assert.Equal(2, revision.GetProperty("files").EnumerateArray().Count(f => f.GetProperty("kind").GetString() == "RENDITION"));

        var (_, accepted) = await Flow.PostAsync(controller, arrival, new { note = "In order." });
        Assert.Equal(("IN_PREPARATION", "ACCEPTED"), (accepted.GetProperty("state").GetString(), accepted.GetProperty("controlOutcome").GetString()));
        var (started, startedBody) = await Flow.PostAsync(controller, $"/api/projects/{project}/revisions/{p.Revision}/reviews", new { });
        Assert.True(started == HttpStatusCode.Created, startedBody.ToString());
    }

    [Fact]
    public async Task An_approved_document_with_a_fault_in_its_submission_is_corrected_under_the_same_revision_and_reviewed_again()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        Assert.Equal("IN_PREPARATION", (await RevisionAsync(engineer, p)).GetProperty("state").GetString());
        var decided = await DecidedAsync(engineer, approver, p, "C1", "IFC");

        var (_, returned) = await Flow.PostAsync(controller, $"/api/projects/{p.Project}/reviews/{decided.GetProperty("id").GetGuid()}/return",
            new { note = "The title block carries the wrong document number." });
        Assert.Equal("RETURNED", returned.GetProperty("state").GetString());
        var revision = await RevisionAsync(engineer, p);
        Assert.Equal(("CORRECTING", "RETURNED_TO_INITIATOR"), (revision.GetProperty("state").GetString(),
            revision.GetProperty("controlOutcome").GetString()));

        // No new revision may start beside it; the correction comes back under A.
        var other = await Flow.UploadAsync(engineer, p.Project, p.Document, "B.pdf", Flow.Pdf(), "application/pdf");
        var (beside, besideBody) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/documents/{p.Document}/revisions",
            new { fileIds = new[] { other } });
        Assert.Equal((HttpStatusCode.Conflict, "REVISION_IN_MOTION"), (beside, Flow.Code(besideBody)));
        await ResubmitAsync(engineer, p);
        revision = await RevisionAsync(engineer, p);
        Assert.Equal(("A", 2, "IN_PREPARATION"), (revision.GetProperty("value").GetString(), revision.GetProperty("submission").GetInt32(),
            revision.GetProperty("state").GetString()));

        // The route runs again from the start on the corrected file, which is the one stamped.
        var again = await DecidedAsync(engineer, approver, p, "C1", "IFC");
        var (_, released) = await Flow.PostAsync(controller, $"/api/projects/{p.Project}/reviews/{again.GetProperty("id").GetGuid()}/release", new { });
        Assert.Equal("RELEASED", released.GetProperty("state").GetString());
        var document = await Flow.UntilAsync(engineer, p.Project, p.Document, d =>
            Flow.Revision(d, p.Revision).GetProperty("files").EnumerateArray().Any(f => f.GetProperty("kind").GetString() == "STAMPED"));
        var files = Flow.Revision(document, p.Revision).GetProperty("files").EnumerateArray().ToList();
        var stamped = files.Single(f => f.GetProperty("kind").GetString() == "STAMPED");
        var source = files.Single(f => f.GetProperty("id").GetGuid() == stamped.GetProperty("derivedFromId").GetGuid());
        Assert.Equal(2, source.GetProperty("submission").GetInt32());
        Assert.Equal("RELEASED", Flow.Revision(document, p.Revision).GetProperty("controlOutcome").GetString());
    }

    [Fact]
    public async Task A_verdict_asking_for_changes_always_needs_a_new_revision()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var decided = await DecidedAsync(engineer, approver, p, "C3", null);
        var path = $"/api/projects/{p.Project}/reviews/{decided.GetProperty("id").GetGuid()}/return";

        var (refused, refusedBody) = await Flow.PostAsync(controller, path, new { note = "Rejected, and the template is wrong.", outcome = "RETURNED_TO_INITIATOR" });
        Assert.Equal((HttpStatusCode.Conflict, "VERDICT_NEEDS_NEW_REVISION"), (refused, Flow.Code(refusedBody)));
        await Flow.PostAsync(controller, path, new { note = "Rejected, and the template is wrong." });

        var revision = await RevisionAsync(engineer, p);
        Assert.Equal(("RETURNED", "RETURNED_FOR_REVISION"), (revision.GetProperty("state").GetString(),
            revision.GetProperty("controlOutcome").GetString()));
        var (corrected, correctedBody) = await ResubmitAsync(engineer, p);
        Assert.Equal((HttpStatusCode.Conflict, "NOT_RETURNED_FOR_CORRECTION"), (corrected, Flow.Code(correctedBody)));
    }
}
