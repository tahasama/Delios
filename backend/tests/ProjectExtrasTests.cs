using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Delios.Tests;

/// <summary>
/// Numbers drawn from a range issued to a party; a voided revision's copy marked VOID; an administrator joining a
/// project they are not on; a project's kind; a family row of the matrix kept with its family.
/// </summary>
public sealed class ProjectExtrasTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task A_range_issued_for_a_prefix_is_drawn_down_before_the_counter()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(controller);
        var p = $"/api/projects/{project}";
        var first = (await Api.RegisterAsync(engineer, project, Api.Drawing("Before the range"))).GetProperty("number").GetString()!;
        var cut = first.LastIndexOf('-');
        var (prefix, digits) = (first[..cut], first.Length - cut - 1);

        var (issued, issuedBody) = await Flow.PostAsync(controller, $"{p}/number-ranges", new { prefix, from = 500, to = 501, issuedTo = "Acme Pumps" });
        Assert.True(issued == HttpStatusCode.OK || issued == HttpStatusCode.Created, issuedBody.ToString());
        string Number(int n) => $"{prefix}-{n.ToString().PadLeft(digits, '0')}";
        Assert.Equal(Number(500), (await Api.RegisterAsync(engineer, project, Api.Drawing("From the range"))).GetProperty("number").GetString());
        Assert.Equal(Number(501), (await Api.RegisterAsync(engineer, project, Api.Drawing("Last of the range"))).GetProperty("number").GetString());
        var after = (await Api.RegisterAsync(engineer, project, Api.Drawing("After the range"))).GetProperty("number").GetString();
        Assert.Equal(Number(int.Parse(first[(cut + 1)..]) + 1), after);

        var range = Assert.Single((await controller.GetFromJsonAsync<JsonElement>($"{p}/number-ranges")).EnumerateArray());
        Assert.Equal(("EXHAUSTED", 501), (range.GetProperty("status").GetString(), range.GetProperty("lastIssued").GetInt32()));
    }

    [Fact]
    public async Task A_voided_revision_gets_a_copy_marked_void()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var x = await Flow.RevisionAsync(engineer);
        var p = $"/api/projects/{x.Project}";
        var (_, review) = await Flow.PostAsync(engineer, $"{p}/revisions/{x.Revision}/reviews", new { });
        var id = review.GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, $"{p}/reviews/{id}/answer", new { });
        await Flow.PostAsync(approver, $"{p}/reviews/{id}/answer", new { verdict = "C1", status = "IFC" });
        await Flow.PostAsync(controller, $"{p}/reviews/{id}/release", new { });

        var (voided, body) = await Flow.PostAsync(controller, $"{p}/documents/{x.Document}/revisions/{x.Revision}/void", new { reason = "Issued against the wrong grid." });
        Assert.True(voided == HttpStatusCode.OK, body.ToString());
        var document = await Flow.UntilAsync(engineer, x.Project, x.Document,
            d => Flow.Revision(d, x.Revision).GetProperty("files").EnumerateArray().Any(f => f.GetProperty("kind").GetString() == "VOID"));
        Assert.Contains(Flow.Revision(document, x.Revision).GetProperty("files").EnumerateArray(), f => f.GetProperty("kind").GetString() == "VOID");
    }

    [Fact]
    public async Task An_administrator_joins_a_project_they_are_not_on_and_its_kind_is_kept()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var admin = await app.SignedInAsync("admin@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var (created, project) = await Flow.PostAsync(admin, "/api/admin/projects", new { code = "NP9", name = "North pier", kind = "infrastructure" });
        Assert.True(created == HttpStatusCode.Created, project.ToString());
        var id = project.GetProperty("id").GetGuid();
        await using (var scope = app.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            scope.ServiceProvider.GetRequiredService<TenantContext>().Set(await db.Tenants.Select(t => t.Id).SingleAsync());
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.Memberships.Where(m => m.ProjectId == id).ExecuteDeleteAsync();
            await tx.CommitAsync();
        }
        Assert.DoesNotContain((await admin.GetFromJsonAsync<JsonElement>("/api/me")).GetProperty("projects").EnumerateArray(), x => x.GetProperty("id").GetGuid() == id);

        var (notAdmin, _) = await Flow.PostAsync(engineer, $"/api/admin/projects/{id}/join", new { });
        Assert.Equal(HttpStatusCode.Forbidden, notAdmin);
        var (joined, joinedBody) = await Flow.PostAsync(admin, $"/api/admin/projects/{id}/join", new { });
        Assert.True(joined == HttpStatusCode.NoContent, joinedBody.ToString());
        var mine = (await admin.GetFromJsonAsync<JsonElement>("/api/me")).GetProperty("projects").EnumerateArray().Single(x => x.GetProperty("id").GetGuid() == id);
        Assert.Equal("INFRASTRUCTURE", mine.GetProperty("kind").GetString());
        Assert.Contains("CONFIGURE", mine.GetProperty("verbs").EnumerateArray().Select(v => v.GetString()));
    }

    [Fact]
    public async Task A_rule_keeps_the_family_it_was_written_about_and_where_it_came_from()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var admin = await app.SignedInAsync("admin@demo.local");
        var (made, function) = await Flow.PostAsync(admin, "/api/admin/functions", new { name = "Site Observer" });
        Assert.True(made == HttpStatusCode.Created, function.ToString());
        using var put = await admin.PutAsJsonAsync($"/api/admin/functions/{function.GetProperty("id")}", new
        {
            rules = new[] { new { verbs = new[] { "READ" }, docType = "DWG", family = "D", note = "Read from a filled-in distribution matrix" } },
        });
        Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());
        var functions = await admin.GetFromJsonAsync<JsonElement>("/api/admin/functions");
        var rule = functions.EnumerateArray().Single(f => f.GetProperty("id").GetGuid() == function.GetProperty("id").GetGuid()).GetProperty("rules")[0];
        Assert.Equal(("D", "Read from a filled-in distribution matrix"), (rule.GetProperty("family").GetString(), rule.GetProperty("note").GetString()));
    }
}

/// <summary>A function's clearance: documents above it are read only where the person is named on them.</summary>
public sealed class ClearanceTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task A_document_above_a_functions_clearance_is_read_only_where_the_person_is_named()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var admin = await app.SignedInAsync("admin@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var viewer = await app.SignedInAsync("viewer@demo.local");
        var me = await viewer.GetFromJsonAsync<JsonElement>("/api/me");
        var function = me.GetProperty("projects")[0].GetProperty("function").GetProperty("id").GetGuid();
        var viewerId = me.GetProperty("user").GetProperty("id").GetGuid();
        var project = await Api.ProjectIdAsync(engineer);
        var p = $"/api/projects/{project}";
        var document = (await Api.RegisterAsync(engineer, project, Api.Drawing("Internal pump layout"))).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.OK, (await viewer.GetAsync($"{p}/documents/{document}")).StatusCode);

        using (var unknown = await admin.PutAsJsonAsync($"/api/admin/functions/{function}", new { clearance = "SECRET" }))
            Assert.Equal(HttpStatusCode.UnprocessableEntity, unknown.StatusCode);
        using (var set = await admin.PutAsJsonAsync($"/api/admin/functions/{function}", new { clearance = "PUBLIC" }))
            Assert.True(set.IsSuccessStatusCode, await set.Content.ReadAsStringAsync());
        Assert.Equal("PUBLIC", (await viewer.GetFromJsonAsync<JsonElement>("/api/me")).GetProperty("projects")[0].GetProperty("function").GetProperty("clearance").GetString());

        // INTERNAL is above PUBLIC: gone from the viewer's register and from the distribution proposed for it.
        Assert.Equal(HttpStatusCode.NotFound, (await viewer.GetAsync($"{p}/documents/{document}")).StatusCode);
        var spread = await engineer.GetFromJsonAsync<JsonElement>($"{p}/documents/{document}/distribution");
        Assert.DoesNotContain(spread.GetProperty("proposed").EnumerateArray(), x => x.GetProperty("id").GetGuid() == viewerId);

        // Named on it, they read it.
        var (named, namedBody) = await Flow.PostAsync(engineer, $"{p}/documents/{document}/readers", new { userIds = new[] { viewerId }, reason = "Needs the layout." });
        Assert.True(named == HttpStatusCode.OK || named == HttpStatusCode.NoContent || named == HttpStatusCode.Created, namedBody.ToString());
        Assert.Equal(HttpStatusCode.OK, (await viewer.GetAsync($"{p}/documents/{document}")).StatusCode);

        // Empty takes the limit away.
        using (var clear = await admin.PutAsJsonAsync($"/api/admin/functions/{function}", new { clearance = "" }))
            Assert.True(clear.IsSuccessStatusCode, await clear.Content.ReadAsStringAsync());
        Assert.Equal(JsonValueKind.Null, (await viewer.GetFromJsonAsync<JsonElement>("/api/me")).GetProperty("projects")[0].GetProperty("function").GetProperty("clearance").ValueKind);
    }
}

/// <summary>Correspondence: filed, numbered like our own documents, released without a review.</summary>
public sealed class CorrespondenceTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    [Fact]
    public async Task Minutes_are_numbered_and_sent_on_for_release_without_a_review()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var registered = await Api.RegisterAsync(engineer, project, new
        {
            title = "Kick-off meeting minutes",
            deliverableType = "COR",
            docType = "MOM",
            discipline = "PM",
            subproject = "10",
        });
        Assert.EndsWith("-PM-MOM-00001", registered.GetProperty("number").GetString());
        var p = await Flow.RevisionAsync(engineer, registered.GetProperty("id").GetGuid());

        var (sent, review) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/revisions/{p.Revision}/send-on", new { status = "IFI" });
        Assert.True(sent == HttpStatusCode.Created, review.ToString());
        var (released, body) = await Flow.PostAsync(controller, $"/api/projects/{p.Project}/reviews/{review.GetProperty("id")}/release", new { });
        Assert.True(released == HttpStatusCode.OK, body.ToString());

        // A drawing is reviewed: it cannot skip its review the same way.
        var drawing = await Flow.RevisionAsync(engineer);
        var (refused, refusedBody) = await Flow.PostAsync(engineer, $"/api/projects/{drawing.Project}/revisions/{drawing.Revision}/send-on", new { status = "IFI" });
        Assert.Equal((HttpStatusCode.Conflict, "TYPE_IS_REVIEWED"), (refused, Flow.Code(refusedBody)));
    }
}
