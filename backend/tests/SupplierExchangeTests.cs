using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

namespace Delios.Tests;

/// <summary>Sending to us as another organization does: on an incoming transmittal, which is its receipt.</summary>
public static class Supply
{
    /// <summary>Fills (or corrects) one placeholder on an incoming transmittal.</summary>
    public static Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpClient client, Guid project, Guid document, Guid file, string status) =>
        Flow.PostAsync(client, $"/api/projects/{project}/transmittals/incoming", new
        {
            reason = "APPROVAL",
            planned = new[] { new { documentId = document, fileIds = new[] { file }, status } },
        });

    /// <summary>The revision the first item of an incoming transmittal made or updated.</summary>
    public static Guid RevisionOf(JsonElement transmittal) => transmittal.GetProperty("items")[0].GetProperty("revisionId").GetGuid();

    /// <summary>The supplier's package under an order, made by itself with its first document (owner).</summary>
    public static async Task<JsonElement> PackageAsync(HttpClient controller, Guid project, string order = "PO101")
    {
        var packages = await controller.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/packages");
        var row = packages.EnumerateArray().Single(x => x.GetProperty("kind").GetString() == "SUPPLY"
            && x.GetProperty("purchaseOrder").GetString() == order);
        return await controller.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/packages/{row.GetProperty("id").GetGuid()}");
    }

    /// <summary>
    /// Asks the supplier for these documents of its package: shared with it first (once), then asked on a transmittal.
    /// Until then the supplier sees none of them.
    /// </summary>
    public static async Task AskAsync(HttpClient controller, Guid project, params Guid[] documents)
    {
        var package = await PackageAsync(controller, project);
        var p = $"/api/projects/{project}/packages/{package.GetProperty("id").GetGuid()}";
        if (!package.TryGetProperty("sharedAt", out var at) || at.ValueKind == JsonValueKind.Null)
        {
            var (shared, sharedBody) = await Flow.PostAsync(controller, $"{p}/share", new { });
            Assert.True(shared == HttpStatusCode.OK, sharedBody.ToString());
        }
        var (asked, askedBody) = await Flow.PostAsync(controller, $"{p}/request", new { documentIds = documents });
        Assert.True(asked == HttpStatusCode.OK, askedBody.ToString());
    }

    /// <summary>Uploads a file that belongs to no document yet (an unplanned item's, or a covering letter).</summary>
    public static async Task<Guid> LooseAsync(HttpClient client, Guid project, string name, byte[] bytes, bool proof = false)
    {
        using var response = await client.PostAsJsonAsync($"/api/projects/{project}/incoming/uploads", new
        {
            fileName = name,
            size = bytes.Length,
            contentType = "application/pdf",
            sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)),
            proof,
        });
        var ticket = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(response.IsSuccessStatusCode, ticket.ToString());
        await Flow.PutAsync(ticket, bytes);
        return ticket.GetProperty("fileId").GetGuid();
    }
}

public sealed class SupplierExchangeTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static object Placeholder(string title) => new
    {
        title,
        deliverableType = "SUP",
        docType = "DAS",
        discipline = "ME",
        subproject = "20",
        originator = "ACME",
        contractRef = "PO101",
        receivedDate = "2026-10-01",
        plannedDate = "2026-11-02",
    };

    private static async Task<(Guid Engineer, Guid Approver, Guid Acme)> PeopleAsync(HttpClient client, Guid project)
    {
        var addressees = await client.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/addressees");
        Guid Person(string name) => addressees.GetProperty("people").EnumerateArray()
            .Single(x => x.GetProperty("name").GetString() == name).GetProperty("id").GetGuid();
        var acme = addressees.GetProperty("parties").EnumerateArray().Single(x => x.GetProperty("code").GetString() == "ACME");
        return (Person("Eli Engineer"), Person("Aisha Approver"), acme.GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task A_supplier_is_asked_on_a_transmittal_and_what_it_sends_back_comes_on_its_own_with_a_receipt()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var supplier = await app.SignedInAsync("supplier@acme.local");
        var project = await Api.ProjectIdAsync(engineer);
        var datasheet = (await Api.RegisterAsync(controller, project, Placeholder("Duty pump datasheet"))).GetProperty("id").GetGuid();
        var curve = (await Api.RegisterAsync(controller, project, Placeholder("Duty pump performance curve"))).GetProperty("id").GetGuid();
        // Theirs, but under no order: not in a package for order PO101.
        var otherOrder = (await Api.RegisterAsync(controller, project, new
        {
            title = "Sump pump datasheet",
            deliverableType = "ENG",
            docType = "DAS",
            discipline = "ME",
            subproject = "20",
            originator = "ACME",
        })).GetProperty("id").GetGuid();
        var ours = (await Api.RegisterAsync(engineer, project, Api.Drawing())).GetProperty("id").GetGuid();

        // The supplier's package for its order is made by itself with its first document, and takes its documents under
        // that order, and nothing else (owner).
        var package = await Supply.PackageAsync(controller, project);
        var p = $"/api/projects/{project}/packages/{package.GetProperty("id").GetGuid()}";
        Assert.Equal(("SUPPLY", "Acme Pumps"), (package.GetProperty("kind").GetString(), package.GetProperty("supplier").GetString()));
        Assert.Equal(new[] { curve, datasheet }.Order(), package.GetProperty("members").EnumerateArray().Select(m => m.GetProperty("documentId").GetGuid()).Order());
        var (foreign, foreignBody) = await Flow.PostAsync(controller, $"{p}/members", new { documentIds = new[] { ours } });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "NOT_THE_SUPPLIERS"), (foreign, Flow.Code(foreignBody)));
        Assert.DoesNotContain(package.GetProperty("members").EnumerateArray(), m => m.GetProperty("documentId").GetGuid() == otherOrder);

        // Not shared yet, it cannot be asked; shared, the supplier sees its own package, and may not change it.
        var (notShared, notSharedBody) = await Flow.PostAsync(controller, $"{p}/request", new { });
        Assert.Equal((HttpStatusCode.Conflict, "NOT_SHARED"), (notShared, Flow.Code(notSharedBody)));
        await Flow.PostAsync(controller, $"{p}/share", new { });
        var theirs = await supplier.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/packages");
        Assert.Equal(package.GetProperty("id").GetGuid(), theirs.EnumerateArray().Single().GetProperty("id").GetGuid());
        var (meddle, meddleBody) = await Flow.PostAsync(supplier, $"{p}/request", new { });
        Assert.Equal((HttpStatusCode.Forbidden, "CONTROL_ONLY"), (meddle, Flow.Code(meddleBody)));

        // Asking: one transmittal to the supplier, each placeholder with its date.
        var (asked, askedBody) = await Flow.PostAsync(controller, $"{p}/request", new { message = "Please send by the dates shown." });
        Assert.True(asked == HttpStatusCode.OK, askedBody.ToString());
        var request = askedBody.GetProperty("transmittals").EnumerateArray().Single();
        Assert.Equal(("OUTGOING", 2), (request.GetProperty("direction").GetString(), request.GetProperty("items").GetInt32()));
        var (again, againBody) = await Flow.PostAsync(controller, $"{p}/request", new { });
        Assert.Equal((HttpStatusCode.Conflict, "NOTHING_TO_REQUEST"), (again, Flow.Code(againBody)));
        var requestView = await supplier.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/transmittals/{request.GetProperty("id").GetGuid()}");
        Assert.All(requestView.GetProperty("items").EnumerateArray(), i =>
            Assert.Equal(("PLACEHOLDER", "2026-11-02"), (i.GetProperty("kind").GetString(), i.GetProperty("dueDate").GetString())));
        var toSend = (await supplier.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/work")).GetProperty("issues").EnumerateArray()
            .Where(x => x.GetProperty("kind").GetString() == "SEND_PLACEHOLDER").ToList();
        Assert.Equal(2, toSend.Count);

        // The supplier fills one placeholder and sends an RFI nobody planned, quoting its own reference.
        var bytes = Flow.Pdf();
        var file = await Flow.UploadAsync(supplier, project, datasheet, "datasheet.pdf", bytes, "application/pdf");
        var rfi = await Supply.LooseAsync(supplier, project, "rfi-012.pdf", Flow.Pdf(2));
        var (bad, badBody) = await Flow.PostAsync(supplier, $"/api/projects/{project}/transmittals/incoming", new
        {
            reason = "APPROVAL",
            planned = new[] { new { documentId = ours, fileIds = new[] { file }, status = "IFA" } },
        });
        Assert.Equal((HttpStatusCode.Forbidden, "NOT_THEIRS"), (bad, Flow.Code(badBody)));
        var (sent, incoming) = await Flow.PostAsync(supplier, $"/api/projects/{project}/transmittals/incoming", new
        {
            reason = "APPROVAL",
            theirReference = "ACME-TR-0007",
            message = "Datasheet for approval, and a question.",
            planned = new[] { new { documentId = datasheet, fileIds = new[] { file }, status = "IFA" } },
            unplanned = new[] { new { title = "RFI on the pump base plate", docType = "REP", reference = "ACME-RFI-012", fileIds = new[] { rfi } } },
        });
        Assert.True(sent == HttpStatusCode.Created, incoming.ToString());
        Assert.Equal(("INCOMING", "Acme Pumps", "ACME-TR-0007"), (incoming.GetProperty("direction").GetString(),
            incoming.GetProperty("from").GetString(), incoming.GetProperty("theirReference").GetString()));
        Assert.Contains("ACME", incoming.GetProperty("number").GetString());
        var items = incoming.GetProperty("items").EnumerateArray().ToList();
        var submission = items.Single(i => i.GetProperty("kind").GetString() == "SUBMISSION");
        Assert.Equal(("IFA", 1), (submission.GetProperty("status").GetString(), submission.GetProperty("submission").GetInt32()));
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(bytes)), submission.GetProperty("files")[0].GetProperty("sha256").GetString());
        var transmittal = $"/api/projects/{project}/transmittals/{incoming.GetProperty("id").GetGuid()}";

        // Our register shows it at once, at the status proposed, waiting for the check on arrival.
        var document = await Flow.UntilAsync(controller, project, datasheet, d => d.GetProperty("revisions").GetArrayLength() == 1);
        var revision = document.GetProperty("revisions")[0];
        Assert.Equal(("RECEIVED", "IFA"), (revision.GetProperty("state").GetString(), revision.GetProperty("statusCode").GetString()));

        // The receipt, for both sides.
        foreach (var reader in new[] { supplier, controller })
        {
            using var receipt = await reader.GetAsync($"{transmittal}/receipt");
            Assert.Equal(HttpStatusCode.OK, receipt.StatusCode);
            Assert.Equal("application/pdf", receipt.Content.Headers.ContentType?.MediaType);
            Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString((await receipt.Content.ReadAsByteArrayAsync())[..4]));
        }
        Assert.Single((await supplier.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/work")).GetProperty("issues").EnumerateArray(),
            x => x.GetProperty("kind").GetString() == "SEND_PLACEHOLDER");

        // The RFI waits on the transmittal until Document Control registers it, under our numbering.
        var work = await controller.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/work");
        Assert.Contains(work.GetProperty("issues").EnumerateArray(), x => x.GetProperty("kind").GetString() == "REGISTER_UNPLANNED");
        var log = await controller.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/transmittals/log?direction=INCOMING&status=TO_REGISTER");
        var row = log.GetProperty("rows").EnumerateArray().Single();
        Assert.Equal(("Acme Pumps", "ACME-TR-0007"), (row.GetProperty("from").GetString(), row.GetProperty("theirReference").GetString()));
        var unplanned = items.Single(i => i.GetProperty("kind").GetString() == "UNPLANNED");
        Assert.Equal(("ACME-RFI-012", JsonValueKind.Null), (unplanned.GetProperty("documentNumber").GetString(), unplanned.GetProperty("documentId").ValueKind));
        for (var i = 0; i < 150; i++)
        {
            var now = await controller.GetFromJsonAsync<JsonElement>(transmittal);
            var files = now.GetProperty("items").EnumerateArray().Single(x => x.GetProperty("kind").GetString() == "UNPLANNED").GetProperty("files");
            if (files.EnumerateArray().All(f => f.GetProperty("status").GetString() == "CLEAN")) break;
            await Task.Delay(200);
        }
        var register = $"{transmittal}/items/{unplanned.GetProperty("id").GetGuid()}/register";
        var (notYours, notYoursBody) = await Flow.PostAsync(supplier, register, new { });
        Assert.Equal((HttpStatusCode.Forbidden, "CONTROL_ONLY"), (notYours, Flow.Code(notYoursBody)));
        var (registered, registeredBody) = await Flow.PostAsync(controller, register, new
        {
            deliverableType = "SUP",
            discipline = "ME",
            subproject = "20",
            contractRef = "PO101",
            criticality = "C",
        });
        Assert.True(registered == HttpStatusCode.OK, registeredBody.ToString());
        var item = registeredBody.GetProperty("items").EnumerateArray().Single(x => x.GetProperty("kind").GetString() == "UNPLANNED");
        Assert.Equal("Carla Control", item.GetProperty("registeredBy").GetString());
        var made = await controller.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/documents/{item.GetProperty("documentId").GetGuid()}");
        Assert.Equal(("ACME", "RFI on the pump base plate", "REP"), (made.GetProperty("originator").GetString(),
            made.GetProperty("title").GetString(), made.GetProperty("docType").GetString()));
        var first = made.GetProperty("revisions").EnumerateArray().Single();
        Assert.Equal(("IN_PREPARATION", "READY"), (first.GetProperty("state").GetString(), first.GetProperty("filesState").GetString()));
        var (twice, twiceBody) = await Flow.PostAsync(controller, register, new { deliverableType = "SUP", discipline = "ME", subproject = "20", contractRef = "PO101" });
        Assert.Equal((HttpStatusCode.Conflict, "ALREADY_REGISTERED"), (twice, Flow.Code(twiceBody)));

        // The package shows the request and what came back; what came unplanned is not something they owed.
        var now2 = await engineer.GetFromJsonAsync<JsonElement>(p);
        Assert.Equal(2, now2.GetProperty("members").GetArrayLength());
        Assert.Equal(new[] { "OUTGOING", "INCOMING" }, now2.GetProperty("transmittals").EnumerateArray().Select(t => t.GetProperty("direction").GetString()));
        var member = now2.GetProperty("members").EnumerateArray().Single(m => m.GetProperty("documentId").GetGuid() == datasheet);
        Assert.Equal(("A", "RECEIVED"), (member.GetProperty("latestRevision").GetString(), member.GetProperty("latestState").GetString()));
    }

    [Fact]
    public async Task Document_Control_records_what_an_organization_sent_outside_the_system_with_its_covering_letter()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var controller = await app.SignedInAsync("controller@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(controller);
        var datasheet = (await Api.RegisterAsync(controller, project, Placeholder("Duty pump datasheet"))).GetProperty("id").GetGuid();
        var (_, _, acme) = await PeopleAsync(controller, project);

        var file = await Flow.UploadAsync(controller, project, datasheet, "datasheet.pdf", Flow.Pdf(), "application/pdf");
        var letter = await Supply.LooseAsync(controller, project, "covering-letter.pdf", Flow.Pdf(), proof: true);
        var body = new
        {
            reason = "APPROVAL",
            theirReference = "ACME-TR-0008",
            fromPartyId = acme,
            proofFileId = letter,
            planned = new[] { new { documentId = datasheet, fileIds = new[] { file }, status = "IFA" } },
        };
        var (outsider, outsiderBody) = await Flow.PostAsync(engineer, $"/api/projects/{project}/transmittals/incoming", body);
        Assert.Equal((HttpStatusCode.Forbidden, "SEND_NOT_ALLOWED"), (outsider, Flow.Code(outsiderBody)));
        var (sent, incoming) = await Flow.PostAsync(controller, $"/api/projects/{project}/transmittals/incoming", body);
        Assert.True(sent == HttpStatusCode.Created, incoming.ToString());
        Assert.Equal(("Carla Control, for Acme Pumps", letter), (incoming.GetProperty("issuedBy").GetString(), incoming.GetProperty("proofFileId").GetGuid()));
        var document = await Flow.UntilAsync(controller, project, datasheet, d => d.GetProperty("revisions").GetArrayLength() == 1);
        // Recorded for them, it is still checked on arrival like anything they send.
        Assert.Equal("RECEIVED", document.GetProperty("revisions")[0].GetProperty("state").GetString());
    }

    [Fact]
    public async Task A_package_is_changed_by_the_control_function_and_removed_until_it_goes_out()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var (engineerId, approverId, _) = await PeopleAsync(engineer, project);
        var drawing = (await Api.RegisterAsync(engineer, project, Api.Drawing())).GetProperty("id").GetGuid();
        var (_, package) = await Flow.PostAsync(controller, $"/api/projects/{project}/packages", new
        {
            title = "Handover",
            reason = "EXECUTION",
            requiredStatuses = new[] { "IFC" },
            ownerIds = new[] { engineerId },
            acceptorIds = new[] { approverId },
        });
        var p = $"/api/projects/{project}/packages/{package.GetProperty("id").GetGuid()}";

        // Those putting it together only add and take out its documents; the control function changes the rest.
        var rename = new { title = "Operations handover — inlet works", description = "For the operator." };
        using (var notTheirs = await engineer.PutAsJsonAsync(p, rename))
            Assert.Equal((HttpStatusCode.Forbidden, "CONTROL_ONLY"), await Api.ProblemAsync(notTheirs));
        using (var renamed = await controller.PutAsJsonAsync(p, rename))
        {
            var view = await renamed.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(("Operations handover — inlet works", "For the operator."), (view.GetProperty("title").GetString(), view.GetProperty("description").GetString()));
        }
        await Flow.PostAsync(engineer, $"{p}/members", new { documentIds = new[] { drawing } });

        // Never delivered to anyone, it is removed even filled (owner); its documents stay in the register.
        using (var gone = await controller.DeleteAsync(p)) Assert.Equal(HttpStatusCode.NoContent, gone.StatusCode);
        using (var missing = await engineer.GetAsync(p)) Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        using (var kept = await engineer.GetAsync($"/api/projects/{project}/documents/{drawing}")) Assert.Equal(HttpStatusCode.OK, kept.StatusCode);

        // A supplier's package that asked its supplier stays.
        var placeholder = (await Api.RegisterAsync(controller, project, Placeholder("Duty pump datasheet"))).GetProperty("id").GetGuid();
        await Supply.AskAsync(controller, project, placeholder);
        var supply = await Supply.PackageAsync(controller, project);
        using (var sentOut = await controller.DeleteAsync($"/api/projects/{project}/packages/{supply.GetProperty("id").GetGuid()}"))
            Assert.Equal((HttpStatusCode.Conflict, "SENT_TO_SUPPLIER"), await Api.ProblemAsync(sentOut));
    }
}
