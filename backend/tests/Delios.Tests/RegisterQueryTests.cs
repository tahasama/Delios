using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Delios.Tests;

public sealed class RegisterQueryTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static async Task<JsonElement> GetAsync(HttpClient client, string path)
    {
        using var response = await client.GetAsync(path);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(response.IsSuccessStatusCode, body.ToString());
        return body;
    }

    private static List<string> Numbers(JsonElement page) =>
        page.GetProperty("rows").EnumerateArray().Select(r => r.GetProperty("number").GetString()!).ToList();

    [Fact]
    public async Task The_register_filters_sorts_pages_keeps_views_and_exports()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");

        // One drawing released for construction; two more registered, nothing started.
        var released = await Flow.RevisionAsync(engineer);
        var p = $"/api/projects/{released.Project}";
        var (_, review) = await Flow.PostAsync(engineer, $"{p}/revisions/{released.Revision}/reviews", new { });
        var reviewId = review.GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, $"{p}/reviews/{reviewId}/answer", new { });
        await Flow.PostAsync(approver, $"{p}/reviews/{reviewId}/answer", new { verdict = "C1", status = "IFC" });
        await Flow.PostAsync(controller, $"{p}/reviews/{reviewId}/release", new { });
        await Api.RegisterAsync(engineer, released.Project, Api.Drawing("Switchroom layout", "EL"));
        await Api.RegisterAsync(engineer, released.Project, Api.Drawing("Pump bay sections"));

        var all = await GetAsync(engineer, $"{p}/register");
        Assert.Equal(3, all.GetProperty("total").GetInt32());
        var row = all.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("revisionState").GetString() == "RELEASED");
        Assert.Equal(("IFC", "C1", "Approver"),
            (row.GetProperty("releasedStatus").GetString(), row.GetProperty("verdict").GetString(), row.GetProperty("decidedBy").GetString()));
        Assert.Contains(all.GetProperty("lists").GetProperty("values").GetProperty("STATUSES").EnumerateArray(), v => v.GetProperty("code").GetString() == "IFC");

        // Alternatives with commas; every word of one must appear.
        Assert.Single(Numbers(await GetAsync(engineer, $"{p}/register?q=switchroom")));
        Assert.Equal(2, Numbers(await GetAsync(engineer, $"{p}/register?q=switchroom, pump bay")).Count);
        Assert.Empty(Numbers(await GetAsync(engineer, $"{p}/register?q=pump switchroom")));
        Assert.Equal(2, (await GetAsync(engineer, $"{p}/register?rev=NONE")).GetProperty("total").GetInt32());
        Assert.Single(Numbers(await GetAsync(engineer, $"{p}/register?status=IFC")));
        Assert.Single(Numbers(await GetAsync(engineer, $"{p}/register?verdict=C1")));
        Assert.Single(Numbers(await GetAsync(engineer, $"{p}/register?discipline=EL")));
        var today = DateTime.UtcNow.ToString("yyyy-MM-dd");
        Assert.Single(Numbers(await GetAsync(engineer, $"{p}/register?on=released&from={today}")));
        Assert.Empty(Numbers(await GetAsync(engineer, $"{p}/register?on=released&to=2000-01-01")));

        // Sorted by number either way, and paged.
        var ascending = Numbers(await GetAsync(engineer, $"{p}/register?sort=docNumber&dir=asc"));
        Assert.Equal(ascending.Order(StringComparer.Ordinal), ascending);
        Assert.Equal(ascending.AsEnumerable().Reverse(), Numbers(await GetAsync(engineer, $"{p}/register?sort=docNumber&dir=desc")));
        var paged = await GetAsync(engineer, $"{p}/register?sort=docNumber&dir=asc&per=25&page=9");
        Assert.Equal((1, 1), (paged.GetProperty("page").GetInt32(), paged.GetProperty("pages").GetInt32()));

        // A view is the person's own.
        using (var saved = await engineer.PutAsJsonAsync($"{p}/register/views", new { name = "Electrical", query = "?discipline=EL&page=3" }))
            Assert.Equal(HttpStatusCode.NoContent, saved.StatusCode);
        var views = await GetAsync(engineer, $"{p}/register/views");
        Assert.Equal("discipline=EL", views[0].GetProperty("query").GetString());
        Assert.Empty((await GetAsync(controller, $"{p}/register/views")).EnumerateArray());
        using (var notMine = await controller.DeleteAsync($"{p}/register/views/{views[0].GetProperty("id").GetGuid()}"))
            Assert.Equal(HttpStatusCode.NotFound, notMine.StatusCode);

        // Around one document: its review and its history.
        var context = await GetAsync(engineer, $"{p}/documents/{released.Document}/context");
        Assert.Equal(("C1", "RELEASED"), (context.GetProperty("reviews")[0].GetProperty("verdict").GetString(), context.GetProperty("reviews")[0].GetProperty("state").GetString()));
        Assert.Contains(context.GetProperty("history").EnumerateArray(), e => e.GetProperty("action").GetString() == "REGISTER_ENTRY");
        var supplier = await app.SignedInAsync("supplier@acme.local");
        using (var hidden = await supplier.GetAsync($"{p}/documents/{released.Document}/context"))
            Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);

        // The reviews list: the released one is closed; a new one waits on the engineer.
        var waiting = await Flow.RevisionAsync(engineer, (await Api.RegisterAsync(engineer, released.Project, Api.Drawing("Screen house plan"))).GetProperty("id").GetGuid());
        var (_, started) = await Flow.PostAsync(engineer, $"{p}/revisions/{waiting.Revision}/reviews", new { });
        var me = await GetAsync(engineer, $"{p}/reviews/{started.GetProperty("id").GetGuid()}/me");
        Assert.Equal((true, false, false), (me.GetProperty("seated").GetBoolean(), me.GetProperty("answered").GetBoolean(), me.GetProperty("control").GetBoolean()));
        Assert.True((await GetAsync(controller, $"{p}/reviews/{started.GetProperty("id").GetGuid()}/me")).GetProperty("control").GetBoolean());
        var reviews = await GetAsync(engineer, $"{p}/reviews");
        Assert.Equal(2, reviews.GetProperty("total").GetInt32());
        var closed = (await GetAsync(engineer, $"{p}/reviews?status=CLOSED")).GetProperty("rows").EnumerateArray().Single();
        Assert.Equal(("C1", "IFC", "Approver"), (closed.GetProperty("verdict").GetString(), closed.GetProperty("grantedStatus").GetString(), closed.GetProperty("decidedBy").GetString()));
        var open = (await GetAsync(engineer, $"{p}/reviews?status=OPEN&q=screen house")).GetProperty("rows").EnumerateArray().Single();
        Assert.Equal(("Eli Engineer", false), (open.GetProperty("reviewers")[0].GetProperty("name").GetString(), open.GetProperty("reviewers")[0].GetProperty("done").GetBoolean()));
        Assert.Equal(2, Encoding.UTF8.GetString(await engineer.GetByteArrayAsync($"{p}/reviews/export?status=OPEN"))
            .TrimStart('\uFEFF').ReplaceLineEndings("\n").Split('\n', StringSplitOptions.RemoveEmptyEntries).Length - 1);

        // The export carries the same rows.
        var csv = Encoding.UTF8.GetString(await engineer.GetByteArrayAsync($"{p}/register/export?format=csv&discipline=EL"));
        var lines = csv.TrimStart('﻿').ReplaceLineEndings("\n").Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(3, lines.Length);
        Assert.Contains("Switchroom layout", lines[2]);
    }
}
