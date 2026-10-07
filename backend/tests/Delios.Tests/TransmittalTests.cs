using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Delios.Tests;

public sealed class TransmittalTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static string P(Prepared p, string path) => $"/api/projects/{p.Project}{path}";

    private static async Task<JsonElement> GetAsync(HttpClient client, string path)
    {
        using var response = await client.GetAsync(path);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(response.IsSuccessStatusCode, body.ToString());
        return body;
    }

    /// <summary>Through a two-step review to release at IFC, optionally with the decider asking for it to be issued.</summary>
    private static async Task<Guid> ReleasedAsync(HttpClient engineer, HttpClient approver, HttpClient? controller, Prepared p,
        object? issue = null)
    {
        var (_, review) = await Flow.PostAsync(engineer, P(p, $"/revisions/{p.Revision}/reviews"), new { });
        var id = review.GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, P(p, $"/reviews/{id}/answer"), new { });
        var (status, decided) = await Flow.PostAsync(approver, P(p, $"/reviews/{id}/answer"), new { verdict = "C1", status = "IFC", issue });
        Assert.True(status == HttpStatusCode.OK, decided.ToString());
        if (controller is not null)
        {
            var (released, body) = await Flow.PostAsync(controller, P(p, $"/reviews/{id}/release"), new { });
            Assert.True(released == HttpStatusCode.OK, body.ToString());
        }
        return id;
    }

    private static async Task<(Guid Viewer, Guid Acme, Guid Client)> RecipientsAsync(HttpClient client, Prepared p)
    {
        var distribution = await GetAsync(client, P(p, $"/documents/{p.Document}/distribution"));
        var viewer = distribution.GetProperty("proposed").EnumerateArray().Single(x => x.GetProperty("name").GetString() == "Victor Viewer");
        var parties = distribution.GetProperty("parties").EnumerateArray().ToList();
        return (viewer.GetProperty("id").GetGuid(),
            parties.Single(x => x.GetProperty("code").GetString() == "ACME").GetProperty("id").GetGuid(),
            parties.Single(x => x.GetProperty("code").GetString() == "NWU").GetProperty("id").GetGuid());
    }

    private static IEnumerable<JsonElement> Issues(JsonElement work, string kind) =>
        work.GetProperty("issues").EnumerateArray().Where(x => x.GetProperty("kind").GetString() == kind);

    [Fact]
    public async Task A_released_revision_is_not_issued_until_someone_asks_and_Document_Control_sends_it()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var viewer = await app.SignedInAsync("viewer@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        await ReleasedAsync(engineer, approver, controller, p);

        // Released, never sent: in use, and nobody told.
        var notIssued = await GetAsync(controller, P(p, "/not-issued"));
        Assert.Contains(notIssued.EnumerateArray(), x => x.GetProperty("revisionId").GetGuid() == p.Revision);

        // The matrix proposes who receives it; anyone else needs a reason.
        var (viewerId, _, _) = await RecipientsAsync(engineer, p);
        var distribution = await GetAsync(engineer, P(p, $"/documents/{p.Document}/distribution"));
        var approverId = distribution.GetProperty("others").EnumerateArray()
            .Single(x => x.GetProperty("name").GetString() == "Aisha Approver").GetProperty("id").GetGuid();
        var (off, offBody) = await Flow.PostAsync(engineer, P(p, $"/revisions/{p.Revision}/issue-requests"),
            new { reason = "INFORMATION", userIds = new[] { viewerId, approverId } });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "OFF_DISTRIBUTION_REASON_REQUIRED"), (off, Flow.Code(offBody)));
        var (badReason, badReasonBody) = await Flow.PostAsync(engineer, P(p, $"/revisions/{p.Revision}/issue-requests"),
            new { reason = "WHIM", userIds = new[] { viewerId } });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "VALUE_NOT_PUBLISHED"), (badReason, Flow.Code(badReasonBody)));

        // The engineer asks; Document Control sends.
        var (asked, request) = await Flow.PostAsync(engineer, P(p, $"/revisions/{p.Revision}/issue-requests"),
            new { reason = "INFORMATION", userIds = new[] { viewerId }, note = "For the site file." });
        Assert.True(asked == HttpStatusCode.Created, request.ToString());
        Assert.Equal("OPEN", request.GetProperty("request").GetProperty("status").GetString());
        Assert.Empty(request.GetProperty("transmittals").EnumerateArray());
        var requestId = request.GetProperty("request").GetProperty("id").GetGuid();

        var (notControl, notControlBody) = await Flow.PostAsync(engineer, P(p, $"/issue-requests/{requestId}/carry-out"), new { });
        Assert.Equal((HttpStatusCode.Forbidden, "CONTROL_ONLY"), (notControl, Flow.Code(notControlBody)));
        Assert.Single(Issues(await GetAsync(controller, P(p, "/work")), "CARRY_OUT_REQUEST"));
        var (carried, outcome) = await Flow.PostAsync(controller, P(p, $"/issue-requests/{requestId}/carry-out"), new { });
        Assert.True(carried == HttpStatusCode.OK, outcome.ToString());
        Assert.Equal("P1001-DEMO-DEMO-TR-0001", outcome.GetProperty("transmittals")[0].GetString());
        Assert.Equal("DONE", outcome.GetProperty("request").GetProperty("status").GetString());

        notIssued = await GetAsync(controller, P(p, "/not-issued"));
        Assert.DoesNotContain(notIssued.EnumerateArray(), x => x.GetProperty("revisionId").GetGuid() == p.Revision);

        // The viewer has it to acknowledge; opening it is recorded, then the acknowledgement.
        Assert.Single(Issues(await GetAsync(viewer, P(p, "/work")), "ACKNOWLEDGE_TRANSMITTAL"));
        var list = await GetAsync(viewer, P(p, "/transmittals"));
        var transmittalId = list.EnumerateArray().Single().GetProperty("id").GetGuid();
        var opened = await GetAsync(viewer, P(p, $"/transmittals/{transmittalId}"));
        var me = opened.GetProperty("recipients").EnumerateArray().Single();
        Assert.NotEqual(JsonValueKind.Null, me.GetProperty("openedAt").ValueKind);
        Assert.Equal(JsonValueKind.Null, me.GetProperty("acknowledgedAt").ValueKind);
        Assert.Equal("IFC", opened.GetProperty("items")[0].GetProperty("status").GetString());
        var (_, acknowledged) = await Flow.PostAsync(viewer, P(p, $"/transmittals/{transmittalId}/acknowledge"), new { });
        Assert.NotEqual(JsonValueKind.Null, acknowledged.GetProperty("recipients")[0].GetProperty("acknowledgedAt").ValueKind);
        Assert.Empty(Issues(await GetAsync(viewer, P(p, "/work")), "ACKNOWLEDGE_TRANSMITTAL"));

        // Someone who was not sent it does not see it.
        Assert.Empty((await GetAsync(approver, P(p, "/transmittals"))).EnumerateArray());
    }

    [Fact]
    public async Task The_decider_says_who_receives_it_and_the_release_sends_it_to_people_and_organizations()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var supplier = await app.SignedInAsync("supplier@acme.local");
        var p = await Flow.RevisionAsync(engineer);
        var (viewerId, acmeId, clientId) = await RecipientsAsync(engineer, p);

        // Another party sees only what it produces, until something is sent to it.
        using (var hidden = await supplier.GetAsync(P(p, $"/documents/{p.Document}")))
            Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);

        await ReleasedAsync(engineer, approver, controller, p,
            issue: new { reason = "EXECUTION", userIds = new[] { viewerId }, partyIds = new[] { acmeId, clientId } });

        var requests = await GetAsync(engineer, P(p, $"/revisions/{p.Revision}/issue-requests"));
        var request = requests.EnumerateArray().Single();
        Assert.Equal("DONE", request.GetProperty("status").GetString());
        Assert.Equal("Aisha Approver", request.GetProperty("raisedBy").GetString());
        var numbers = request.GetProperty("transmittals").EnumerateArray().Select(n => n.GetString()).ToList();
        Assert.Equal(["P1001-DEMO-DEMO-TR-0001", "P1001-DEMO-ACME-TR-0001", "P1001-DEMO-NWU-TR-0001"], numbers);

        // Acme's people answer here: they receive it and can now read it.
        using (var visible = await supplier.GetAsync(P(p, $"/documents/{p.Document}")))
            Assert.Equal(HttpStatusCode.OK, visible.StatusCode);
        Assert.Single((await GetAsync(supplier, P(p, "/transmittals"))).EnumerateArray());

        // The client has nobody here: Document Control sends it by hand and records it.
        var work = await GetAsync(controller, P(p, "/work"));
        var dispatch = Issues(work, "DISPATCH_TRANSMITTAL").Single();
        var transmittalId = dispatch.GetProperty("transmittalId").GetGuid();
        var recipientId = dispatch.GetProperty("recipientId").GetGuid();
        var (noChannel, noChannelBody) = await Flow.PostAsync(controller,
            P(p, $"/transmittals/{transmittalId}/recipients/{recipientId}/dispatch"), new { });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "CHANNEL_REQUIRED"), (noChannel, Flow.Code(noChannelBody)));
        var (_, sent) = await Flow.PostAsync(controller, P(p, $"/transmittals/{transmittalId}/recipients/{recipientId}/dispatch"),
            new { channel = "Client portal", reference = "NWU-IN-118" });
        var client = sent.GetProperty("recipients").EnumerateArray().Single();
        Assert.Equal(("Client portal", "NWU-IN-118", "Carla Control"), (client.GetProperty("dispatchChannel").GetString(),
            client.GetProperty("dispatchRef").GetString(), client.GetProperty("dispatchedBy").GetString()));
        Assert.Empty(Issues(await GetAsync(controller, P(p, "/work")), "DISPATCH_TRANSMITTAL"));
    }

    [Fact]
    public async Task A_client_answering_by_proxy_is_sent_the_revision_then_its_answer_is_recorded_with_proof()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var registered = await Api.RegisterAsync(engineer, project, new
        {
            title = "Inlet works process flow diagram",
            deliverableType = "ENG",
            docType = "DWG",
            discipline = "PR",
            subproject = "20",
            criticality = "A",
        });
        var p = await Flow.RevisionAsync(engineer, registered.GetProperty("id").GetGuid());

        var (_, review) = await Flow.PostAsync(engineer, P(p, $"/revisions/{p.Revision}/reviews"), new { });
        Assert.Equal("Discipline check, then client approval", review.GetProperty("route").GetString());
        var id = review.GetProperty("id").GetGuid();
        var clientStep = review.GetProperty("steps")[1];
        Assert.Equal(("Northwater Utility", "BY_PROXY"), (clientStep.GetProperty("party").GetString(),
            clientStep.GetProperty("participation").GetString()));
        await Flow.PostAsync(engineer, P(p, $"/reviews/{id}/answer"), new { });

        // Document Control carries the exchange: first it goes, and the clock starts.
        var (early, earlyBody) = await Flow.PostAsync(controller, P(p, $"/reviews/{id}/answer"), new { verdict = "C1", status = "AFC" });
        Assert.Equal((HttpStatusCode.Conflict, "NOT_DISPATCHED"), (early, Flow.Code(earlyBody)));
        var work = await GetAsync(controller, P(p, "/work"));
        Assert.Contains(work.GetProperty("steps").EnumerateArray(), x => x.GetProperty("kind").GetString() == "DISPATCH_STEP");
        var (_, dispatched) = await Flow.PostAsync(controller, P(p, $"/reviews/{id}/dispatch"),
            new { channel = "Client portal", reference = "NWU-SUB-0042" });
        var step = dispatched.GetProperty("steps")[1];
        Assert.Equal("NWU-SUB-0042", step.GetProperty("dispatchRef").GetString());
        Assert.NotEqual(JsonValueKind.Null, step.GetProperty("dueDate").ValueKind);
        var transmittal = await GetAsync(controller, P(p, $"/transmittals/{step.GetProperty("transmittalId").GetGuid()}"));
        Assert.Equal(("P1001-DEMO-NWU-TR-0001", "APPROVAL"), (transmittal.GetProperty("number").GetString(),
            transmittal.GetProperty("reason").GetString()));

        // Their answer carries its proof.
        var (bare, bareBody) = await Flow.PostAsync(controller, P(p, $"/reviews/{id}/answer"), new { verdict = "C1", status = "AFC" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "EVIDENCE_REQUIRED"), (bare, Flow.Code(bareBody)));
        var proof = await UploadEvidenceAsync(controller, P(p, $"/reviews/{id}/evidence"), Flow.Pdf());
        await Flow.PostAsync(controller, P(p, $"/reviews/{id}/comments"), new { text = "Label the bypass line.", @class = "NON_BLOCKING" });
        var (recordedStatus, recorded) = await Flow.PostAsync(controller, P(p, $"/reviews/{id}/answer"),
            new { verdict = "C2", status = "AFC", foreignAnswer = "Code 2: approved with comments", evidenceFileId = proof });
        Assert.True(recordedStatus == HttpStatusCode.OK, recorded.ToString());
        step = recorded.GetProperty("steps")[1];
        Assert.Equal(("Code 2: approved with comments", "Carla Control"), (step.GetProperty("foreignAnswer").GetString(),
            step.GetProperty("recordedBy").GetString()));
        Assert.Equal("Northwater Utility (recorded by Carla Control)", recorded.GetProperty("comments")[0].GetProperty("author").GetString());
        Assert.Equal("DECIDED", recorded.GetProperty("state").GetString());

        var (_, released) = await Flow.PostAsync(controller, P(p, $"/reviews/{id}/release"), new { });
        Assert.Equal("RELEASED", released.GetProperty("state").GetString());

        // The proof is filed against the revision and scanned; the revision's own files are untouched.
        var document = await Flow.UntilAsync(engineer, p.Project, p.Document, d => Flow.Revision(d, p.Revision)
            .GetProperty("files").EnumerateArray().Any(f => f.GetProperty("kind").GetString() == "EVIDENCE"
                && f.GetProperty("status").GetString() == "CLEAN"));
        Assert.Equal(("READY", "AFC"), (Flow.Revision(document, p.Revision).GetProperty("filesState").GetString(),
            Flow.Revision(document, p.Revision).GetProperty("statusCode").GetString()));
    }

    [Fact]
    public async Task A_party_answering_here_is_sent_the_revision_and_answers_it_itself()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        await using (var scope = app.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            var tenant = await db.Tenants.Select(t => t.Id).SingleAsync();
            scope.ServiceProvider.GetRequiredService<TenantContext>().Set(tenant);
            await using var tx = await db.Database.BeginTransactionAsync();
            db.ReviewRoutes.Add(new ReviewRoute
            {
                TenantId = tenant,
                Name = "Vendor check",
                Patterns = [new() { Discipline = "EL" }],
                Steps =
                [
                    new() { Title = "Discipline check", FunctionCode = "ENG" },
                    new() { Title = "Vendor confirmation", PartyCode = "ACME", Reason = "REVIEW", Days = 5 },
                ],
            });
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        }
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var supplier = await app.SignedInAsync("supplier@acme.local");
        var project = await Api.ProjectIdAsync(engineer);
        var registered = await Api.RegisterAsync(engineer, project, Api.Drawing("Pump starter panel wiring", "EL"));
        var p = await Flow.RevisionAsync(engineer, registered.GetProperty("id").GetGuid());

        var (_, review) = await Flow.PostAsync(engineer, P(p, $"/revisions/{p.Revision}/reviews"), new { });
        var id = review.GetProperty("id").GetGuid();
        using (var before = await supplier.GetAsync(P(p, $"/reviews/{id}")))
            Assert.Equal(HttpStatusCode.NotFound, before.StatusCode);
        var (_, advised) = await Flow.PostAsync(engineer, P(p, $"/reviews/{id}/answer"), new { });
        Assert.Equal("Sam Supplier", advised.GetProperty("steps")[1].GetProperty("participants")[0].GetProperty("name").GetString());

        // The step went to them on a transmittal, which is what lets them read it.
        var transmittals = await GetAsync(supplier, P(p, "/transmittals"));
        Assert.Equal("REVIEW", transmittals.EnumerateArray().Single().GetProperty("reason").GetString());
        await GetAsync(supplier, P(p, $"/reviews/{id}"));
        var (status, decided) = await Flow.PostAsync(supplier, P(p, $"/reviews/{id}/answer"), new { verdict = "C1", status = "IFC" });
        Assert.True(status == HttpStatusCode.OK, decided.ToString());
        Assert.Equal("DECIDED", decided.GetProperty("state").GetString());

        // A review transmittal is not an issue: the release is still not sent.
        var controller = await app.SignedInAsync("controller@demo.local");
        await Flow.PostAsync(controller, P(p, $"/reviews/{id}/release"), new { });
        var notIssued = await GetAsync(controller, P(p, "/not-issued"));
        Assert.Contains(notIssued.EnumerateArray(), x => x.GetProperty("revisionId").GetGuid() == p.Revision);
    }

    [Fact]
    public async Task Without_Document_Control_whoever_asks_sends_it_themselves()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        await using (var scope = app.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            scope.ServiceProvider.GetRequiredService<TenantContext>().Set(await db.Tenants.Select(t => t.Id).SingleAsync());
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.Memberships.Where(m => m.Function!.Code == "DC").ExecuteUpdateAsync(m => m.SetProperty(x => x.Active, false));
            await tx.CommitAsync();
        }
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        await ReleasedAsync(engineer, approver, null, p);
        var (viewerId, _, _) = await RecipientsAsync(engineer, p);

        var (asked, outcome) = await Flow.PostAsync(engineer, P(p, $"/revisions/{p.Revision}/issue-requests"),
            new { reason = "INFORMATION", userIds = new[] { viewerId } });

        Assert.True(asked == HttpStatusCode.Created, outcome.ToString());
        Assert.Equal("DONE", outcome.GetProperty("request").GetProperty("status").GetString());
        Assert.Single(outcome.GetProperty("transmittals").EnumerateArray());
    }

    [Fact]
    public async Task Nothing_is_issued_while_its_review_runs()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        await Flow.PostAsync(engineer, P(p, $"/revisions/{p.Revision}/reviews"), new { });
        var (viewerId, _, _) = await RecipientsAsync(engineer, p);

        var (status, problem) = await Flow.PostAsync(engineer, P(p, $"/revisions/{p.Revision}/issue-requests"),
            new { reason = "INFORMATION", userIds = new[] { viewerId } });

        Assert.Equal((HttpStatusCode.Conflict, "NOT_ISSUABLE"), (status, Flow.Code(problem)));
    }

    private static async Task<Guid> UploadEvidenceAsync(HttpClient client, string path, byte[] bytes)
    {
        using var response = await client.PostAsJsonAsync(path, new
        {
            fileName = "client-stamped.pdf",
            size = bytes.Length,
            contentType = "application/pdf",
            sha256 = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(bytes)),
        });
        var ticket = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(response.IsSuccessStatusCode, ticket.ToString());
        using var raw = new HttpClient();
        using var body = new ByteArrayContent(bytes);
        body.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf");
        (await raw.PutAsync(new Uri(ticket.GetProperty("url").GetString()!), body)).EnsureSuccessStatusCode();
        return ticket.GetProperty("fileId").GetGuid();
    }
}
