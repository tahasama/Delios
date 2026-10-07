using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Delios.Host.Documents;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Delios.Tests;

public sealed class PackageTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static async Task<JsonElement> GetAsync(HttpClient client, string path)
    {
        using var response = await client.GetAsync(path);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(response.IsSuccessStatusCode, body.ToString());
        return body;
    }

    private static async Task<(Guid Engineer, Guid Approver, Guid Client)> PeopleAsync(HttpClient client, Guid project, Guid document)
    {
        var distribution = await GetAsync(client, $"/api/projects/{project}/documents/{document}/distribution");
        var everyone = distribution.GetProperty("proposed").EnumerateArray().Concat(distribution.GetProperty("others").EnumerateArray()).ToList();
        Guid Id(string name) => everyone.Single(x => x.GetProperty("name").GetString() == name).GetProperty("id").GetGuid();
        var client2 = distribution.GetProperty("parties").EnumerateArray().Single(x => x.GetProperty("code").GetString() == "NWU");
        return (Id("Eli Engineer"), Id("Aisha Approver"), client2.GetProperty("id").GetGuid());
    }

    private static async Task ReleaseAsync(HttpClient engineer, HttpClient approver, HttpClient controller, Prepared p)
    {
        var (_, review) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/revisions/{p.Revision}/reviews", new { });
        var id = review.GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/reviews/{id}/answer", new { });
        await Flow.PostAsync(approver, $"/api/projects/{p.Project}/reviews/{id}/answer", new { verdict = "C1", status = "IFC" });
        var (status, body) = await Flow.PostAsync(controller, $"/api/projects/{p.Project}/reviews/{id}/release", new { });
        Assert.True(status == HttpStatusCode.OK, body.ToString());
    }

    [Fact]
    public async Task A_package_goes_only_with_what_is_ready_or_what_its_acceptance_authority_agreed_to_go_without()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var ready = await Flow.RevisionAsync(engineer);
        await ReleaseAsync(engineer, approver, controller, ready);
        var late = (await Api.RegisterAsync(engineer, ready.Project, Api.Drawing("Inlet works sections"))).GetProperty("id").GetGuid();
        var (engineerId, approverId, clientId) = await PeopleAsync(engineer, ready.Project, ready.Document);
        var packages = $"/api/projects/{ready.Project}/packages";

        // Nobody accepts their own work.
        var (same, sameBody) = await Flow.PostAsync(engineer, packages, new
        {
            title = "Inlet works construction set",
            reason = "EXECUTION",
            requiredStatuses = new[] { "IFC" },
            ownerIds = new[] { engineerId },
            acceptorIds = new[] { engineerId },
        });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "ACCEPTOR_IS_OWNER"), (same, Flow.Code(sameBody)));

        var (created, package) = await Flow.PostAsync(engineer, packages, new
        {
            title = "Inlet works construction set",
            reason = "EXECUTION",
            requiredStatuses = new[] { "IFC", "AFC" },
            ownerIds = new[] { engineerId },
            acceptorIds = new[] { approverId },
            recipientPartyIds = new[] { clientId },
        });
        Assert.True(created == HttpStatusCode.Created, package.ToString());
        Assert.Equal("P1001-PK-001", package.GetProperty("number").GetString());
        var p = $"{packages}/{package.GetProperty("id").GetGuid()}";

        var (_, added) = await Flow.PostAsync(engineer, $"{p}/members", new { documentIds = new[] { ready.Document, late } });
        Assert.Equal(2, added.GetProperty("members").GetArrayLength());
        var (notAssessed, notAssessedBody) = await Flow.PostAsync(engineer, $"{p}/deliver", new { });
        Assert.Equal((HttpStatusCode.Conflict, "NOT_ASSESSED"), (notAssessed, Flow.Code(notAssessedBody)));

        var (_, assessed) = await Flow.PostAsync(engineer, $"{p}/assess", new { });
        var shortfall = assessed.GetProperty("shortfall").EnumerateArray().Single();
        Assert.Equal(late, shortfall.GetProperty("documentId").GetGuid());
        var (unsent, unsentBody) = await Flow.PostAsync(engineer, $"{p}/deliver", new { });
        Assert.Equal((HttpStatusCode.Conflict, "SHORTFALL_NOT_ISSUED"), (unsent, Flow.Code(unsentBody)));
        await Flow.PostAsync(engineer, $"{p}/shortfall/issue", new { });
        var (waiting, waitingBody) = await Flow.PostAsync(engineer, $"{p}/deliver", new { });
        Assert.Equal((HttpStatusCode.Conflict, "SHORTFALL_NOT_ACCEPTED"), (waiting, Flow.Code(waitingBody)));

        // The owner may not accept the shortfall; the acceptance authority does.
        var (owner, ownerBody) = await Flow.PostAsync(engineer, $"{p}/shortfall/accept", new { });
        Assert.Equal((HttpStatusCode.Forbidden, "ACCEPTOR_ONLY"), (owner, Flow.Code(ownerBody)));
        var (_, agreed) = await Flow.PostAsync(approver, $"{p}/shortfall/accept", new { note = "Sections follow next week." });
        Assert.Equal("Aisha Approver", agreed.GetProperty("shortfallAcceptedBy").GetString());

        var (deliveredStatus, delivered) = await Flow.PostAsync(engineer, $"{p}/deliver", new { note = "Sections to follow." });
        Assert.True(deliveredStatus == HttpStatusCode.OK, delivered.ToString());
        Assert.Equal("DELIVERED", delivered.GetProperty("state").GetString());
        var number = delivered.GetProperty("transmittals").EnumerateArray().Single().GetString();
        Assert.Equal("P1001-DEMO-NWU-TR-0001", number);

        // One transmittal, carrying only what was ready; its contents are now fixed.
        var log = await GetAsync(controller, $"/api/projects/{ready.Project}/transmittals");
        var transmittal = await GetAsync(controller,
            $"/api/projects/{ready.Project}/transmittals/{log.EnumerateArray().Single(t => t.GetProperty("number").GetString() == number).GetProperty("id").GetGuid()}");
        Assert.Equal(ready.Revision, transmittal.GetProperty("items").EnumerateArray().Single().GetProperty("revisionId").GetGuid());
        Assert.Equal("EXECUTION", transmittal.GetProperty("reason").GetString());
        var (fixedStatus, fixedBody) = await Flow.PostAsync(engineer, $"{p}/members/remove", new { documentIds = new[] { ready.Document } });
        Assert.Equal((HttpStatusCode.Conflict, "PACKAGE_CLOSED"), (fixedStatus, Flow.Code(fixedBody)));

        var (_, accepted) = await Flow.PostAsync(approver, $"{p}/accept", new { });
        Assert.Equal(("ACCEPTED", "Aisha Approver"), (accepted.GetProperty("state").GetString(), accepted.GetProperty("acceptedBy").GetString()));

        // A delivered package is an issue: the released revision is no longer "never sent".
        var notIssued = await GetAsync(controller, $"/api/projects/{ready.Project}/not-issued");
        Assert.DoesNotContain(notIssued.EnumerateArray(), x => x.GetProperty("revisionId").GetGuid() == ready.Revision);
    }

    [Fact]
    public async Task A_package_with_a_rule_fills_itself_and_one_taken_out_stays_out()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var first = (await Api.RegisterAsync(engineer, project, Api.Drawing("Switchroom layout", "EL"))).GetProperty("id").GetGuid();
        await Api.RegisterAsync(engineer, project, Api.Drawing("Inlet works plan", "CI"));
        var (engineerId, approverId, _) = await PeopleAsync(engineer, project, first);
        var packages = $"/api/projects/{project}/packages";

        var (_, package) = await Flow.PostAsync(engineer, packages, new
        {
            title = "Electrical handover",
            reason = "RECORD",
            requiredStatuses = new[] { "IFC" },
            ownerIds = new[] { engineerId },
            acceptorIds = new[] { approverId },
            rule = new { disciplines = new[] { "EL" } },
        });
        var p = $"{packages}/{package.GetProperty("id").GetGuid()}";
        Assert.Equal(first, package.GetProperty("members").EnumerateArray().Single().GetProperty("documentId").GetGuid());

        // Registered later and matching: it joins by itself.
        var second = (await Api.RegisterAsync(engineer, project, Api.Drawing("Cable schedule", "EL"))).GetProperty("id").GetGuid();
        var now = await GetAsync(engineer, p);
        Assert.Equal(2, now.GetProperty("members").GetArrayLength());

        var (_, removed) = await Flow.PostAsync(engineer, $"{p}/members/remove", new { documentIds = new[] { second } });
        Assert.Single(removed.GetProperty("members").EnumerateArray());
        Assert.Single((await GetAsync(engineer, p)).GetProperty("members").EnumerateArray());

        // Nothing is ready, and nobody to deliver to: it closes once the rule is said to stop.
        await Flow.PostAsync(engineer, $"{p}/assess", new { });
        await Flow.PostAsync(engineer, $"{p}/shortfall/issue", new { });
        var approver = await app.SignedInAsync("approver@demo.local");
        await Flow.PostAsync(approver, $"{p}/shortfall/accept", new { });
        var (still, stillBody) = await Flow.PostAsync(engineer, $"{p}/deliver", new { });
        Assert.Equal((HttpStatusCode.Conflict, "RULE_STILL_ADMITTING"), (still, Flow.Code(stillBody)));
        var (_, closed) = await Flow.PostAsync(engineer, $"{p}/deliver", new { ruleCeased = true });
        Assert.Equal("CLOSED", closed.GetProperty("state").GetString());
    }

    [Fact]
    public async Task Record_numbers_without_a_scheme_still_never_repeat()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        await using var scope = app.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
        scope.ServiceProvider.GetRequiredService<TenantContext>().Set(await db.Tenants.Select(t => t.Id).SingleAsync());
        await using var tx = await db.Database.BeginTransactionAsync();
        var project = await db.Projects.SingleAsync();
        await db.SchemeRoutings.Where(r => r.DeliverableType == RecordKinds.Package).ExecuteDeleteAsync();
        var numbering = scope.ServiceProvider.GetRequiredService<Numbering>();

        var numbers = new List<string>();
        for (var i = 0; i < 3; i++)
        {
            numbers.Add(await numbering.RecordAsync(project.TenantId, project.Id, RecordKinds.Package,
                NumberFields.ForRecord(project.Code), "PK", default));
        }

        Assert.Equal(["P1001-PK-0001", "P1001-PK-0002", "P1001-PK-0003"], numbers);
    }
}
