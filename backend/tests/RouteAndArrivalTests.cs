using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NodaTime;

namespace Delios.Tests;

/// <summary>
/// What arrived returned without a published outcome and files kept with it later; a route's own verdict list and
/// people named on a step; the warning before a step falls due; who still holds a replaced revision without knowing.
/// </summary>
public sealed class RouteAndArrivalTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task What_arrived_is_returned_without_an_outcome_and_files_are_kept_with_it_later()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var controller = await app.SignedInAsync("controller@demo.local");
        var supplier = await app.SignedInAsync("supplier@acme.local");
        var project = await Api.ProjectIdAsync(controller);
        var p = $"/api/projects/{project}";
        var document = (await Api.RegisterAsync(controller, project, new
        {
            title = "Standby pump datasheet",
            deliverableType = "SUP",
            docType = "DAS",
            discipline = "ME",
            subproject = "20",
            originator = "ACME",
            contractRef = "PO101",
            receivedDate = "2026-10-01",
        })).GetProperty("id").GetGuid();
        var file = await Flow.UploadAsync(supplier, project, document, "datasheet.pdf", Flow.Pdf(), "application/pdf");
        var (_, sent) = await Supply.SendAsync(supplier, project, document, file, "IFR");
        var revision = Supply.RevisionOf(sent);
        await Flow.UntilAsync(controller, project, document, d => Flow.Revision(d, revision).GetProperty("filesState").GetString() != "PROCESSING");

        var (returned, returnedBody) = await Flow.PostAsync(controller, $"{p}/revisions/{revision}/arrival", new { @return = true, note = "Wrong template." });
        Assert.True(returned == HttpStatusCode.OK, returnedBody.ToString());
        Assert.Equal("CORRECTING", returnedBody.GetProperty("state").GetString());

        var transmittal = sent.GetProperty("id").GetGuid();
        var letter = await Supply.LooseAsync(supplier, project, "their-letter.pdf", Flow.Pdf());
        var (notTheirs, _) = await Flow.PostAsync(supplier, $"{p}/transmittals/{transmittal}/attachments", new { fileIds = new[] { letter } });
        Assert.Equal(HttpStatusCode.Forbidden, notTheirs);
        var kept = await Supply.LooseAsync(controller, project, "covering-email.pdf", Flow.Pdf());
        var (attached, attachedBody) = await Flow.PostAsync(controller, $"{p}/transmittals/{transmittal}/attachments", new { fileIds = new[] { kept } });
        Assert.True(attached == HttpStatusCode.OK, attachedBody.ToString());
        var view = await controller.GetFromJsonAsync<JsonElement>($"{p}/transmittals/{transmittal}");
        var item = view.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("kind").GetString() == "ATTACHMENT");
        Assert.Equal("covering-email.pdf", Assert.Single(item.GetProperty("files").EnumerateArray()).GetProperty("name").GetString());
    }

    [Fact]
    public async Task A_route_decides_from_its_own_verdict_list_by_the_people_named_on_it()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var admin = await app.SignedInAsync("admin@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        foreach (var (code, proceed) in new[] { ("A", true), ("R", false) })
        {
            using var put = await admin.PutAsJsonAsync("/api/admin/values", new { setKey = "SHOP_CODES", code, label = code, props = new { proceed } });
            Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());
        }
        var p = await Flow.RevisionAsync(engineer);
        var path = $"/api/projects/{p.Project}";
        var people = await engineer.GetFromJsonAsync<JsonElement>($"{path}/addressees");
        var aisha = people.GetProperty("people").EnumerateArray().Single(x => x.GetProperty("name").GetString() == "Aisha Approver").GetProperty("id").GetGuid();

        var (unknown, unknownBody) = await Flow.PostAsync(admin, "/api/admin/routes", new
        {
            name = "Shop drawings",
            verdictSet = "NO_SUCH_LIST",
            steps = new[] { new { title = "Decide", mode = "ANY", userIds = new[] { aisha } } },
        });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "VERDICT_SET_EMPTY"), (unknown, Flow.Code(unknownBody)));
        var (created, route) = await Flow.PostAsync(admin, "/api/admin/routes", new
        {
            name = "Shop drawings",
            verdictSet = "SHOP_CODES",
            steps = new[] { new { title = "Decide", mode = "ANY", userIds = new[] { aisha } } },
        });
        Assert.True(created == HttpStatusCode.Created, route.ToString());

        var (_, review) = await Flow.PostAsync(engineer, $"{path}/revisions/{p.Revision}/reviews", new { routeId = route.GetProperty("id").GetGuid() });
        var id = review.GetProperty("id").GetGuid();
        Assert.Equal("SHOP_CODES", review.GetProperty("verdictSet").GetString());
        Assert.Equal("Aisha Approver", Assert.Single(review.GetProperty("steps")[0].GetProperty("participants").EnumerateArray()).GetProperty("name").GetString());

        var (wrongList, wrongBody) = await Flow.PostAsync(approver, $"{path}/reviews/{id}/answer", new { verdict = "C1", status = "IFC" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "VALUE_NOT_PUBLISHED"), (wrongList, Flow.Code(wrongBody)));
        var (_, decided) = await Flow.PostAsync(approver, $"{path}/reviews/{id}/answer", new { verdict = "A", status = "IFC" });
        Assert.Equal(("DECIDED", "IFC"), (decided.GetProperty("state").GetString(), decided.GetProperty("grantedStatus").GetString()));
    }

    [Fact]
    public async Task The_people_on_a_step_are_warned_once_the_working_day_before_it_falls_due()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var (_, review) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/revisions/{p.Revision}/reviews", new { });
        var id = review.GetProperty("id").GetGuid();

        await using (var scope = app.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            scope.ServiceProvider.GetRequiredService<TenantContext>().Set(await db.Tenants.Select(t => t.Id).SingleAsync());
            await using var tx = await db.Database.BeginTransactionAsync();
            var project = await db.Projects.SingleAsync(x => x.Id == p.Project);
            var clock = scope.ServiceProvider.GetRequiredService<IClock>();
            var tomorrow = WorkingCalendar.AddWorkingDays(WorkingCalendar.Today(clock, project.TimeZone), 1, project.WeekendDays);
            var step = await db.ReviewSteps.SingleAsync(s => s.ReviewId == id && s.Index == 0);
            step.DueDate = tomorrow;
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        }
        var scopes = app.Factory.Services.GetRequiredService<IServiceScopeFactory>();
        Assert.Equal(1, await ReviewWarnings.WarnDueAsync(scopes, CancellationToken.None));
        Assert.Equal(0, await ReviewWarnings.WarnDueAsync(scopes, CancellationToken.None));

        var mine = await engineer.GetFromJsonAsync<JsonElement>("/api/me/notifications");
        Assert.Contains(mine.GetProperty("rows").EnumerateArray(), n => n.GetProperty("title").GetString()!.StartsWith("Due on "));
        var view = await engineer.GetFromJsonAsync<JsonElement>($"/api/projects/{p.Project}/reviews/{id}");
        Assert.NotEqual(JsonValueKind.Null, view.GetProperty("steps")[0].GetProperty("warnedAt").ValueKind);
    }

    [Fact]
    public async Task An_organization_sent_a_replaced_revision_is_listed_until_it_is_sent_the_current_one()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var viewer = await app.SignedInAsync("viewer@demo.local");
        var first = await Flow.RevisionAsync(engineer);
        var p = $"/api/projects/{first.Project}";

        async Task ReleaseAsync(Prepared x)
        {
            var (_, review) = await Flow.PostAsync(engineer, $"{p}/revisions/{x.Revision}/reviews", new { });
            var id = review.GetProperty("id").GetGuid();
            await Flow.PostAsync(engineer, $"{p}/reviews/{id}/answer", new { });
            await Flow.PostAsync(approver, $"{p}/reviews/{id}/answer", new { verdict = "C1", status = "IFC" });
            var (released, body) = await Flow.PostAsync(controller, $"{p}/reviews/{id}/release", new { });
            Assert.True(released == HttpStatusCode.OK, body.ToString());
        }

        await ReleaseAsync(first);
        var addressees = await controller.GetFromJsonAsync<JsonElement>($"{p}/addressees");
        var victor = addressees.GetProperty("people").EnumerateArray().Single(x => x.GetProperty("name").GetString() == "Victor Viewer").GetProperty("id").GetGuid();
        var client = addressees.GetProperty("parties").EnumerateArray().Single(x => x.GetProperty("code").GetString() == "NWU").GetProperty("id").GetGuid();
        var (sent, sentBody) = await Flow.PostAsync(controller, $"{p}/transmittals",
            new { revisionIds = new[] { first.Revision }, userIds = new[] { victor }, partyIds = new[] { client }, reason = "INFORMATION" });
        Assert.True(sent == HttpStatusCode.OK, sentBody.ToString());

        var second = await Flow.RevisionAsync(engineer, first.Document);
        await ReleaseAsync(second);

        var untold = await controller.GetFromJsonAsync<JsonElement>($"{p}/exposures/untold");
        var row = Assert.Single(untold.EnumerateArray());
        Assert.Equal(first.Revision, row.GetProperty("oldRevisionId").GetGuid());
        Assert.Equal(second.Revision, row.GetProperty("current").GetProperty("id").GetGuid());
        Assert.Equal("Northwater Utility", Assert.Single(row.GetProperty("recipients").EnumerateArray()).GetProperty("name").GetString());
        // Victor has an account: he was told in the app.
        var his = await viewer.GetFromJsonAsync<JsonElement>("/api/me/notifications");
        Assert.Contains(his.GetProperty("rows").EnumerateArray(), n => n.GetProperty("title").GetString()!.Contains("replaced by rev"));

        await Flow.PostAsync(controller, $"{p}/transmittals", new { revisionIds = new[] { second.Revision }, partyIds = new[] { client }, reason = "INFORMATION" });
        Assert.Empty((await controller.GetFromJsonAsync<JsonElement>($"{p}/exposures/untold")).EnumerateArray());
    }
}
