using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Delios.Tests;

public sealed class TransmittalLogTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static async Task<JsonElement> GetAsync(HttpClient client, string path)
    {
        using var response = await client.GetAsync(path);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(response.IsSuccessStatusCode, body.ToString());
        return body;
    }

    [Fact]
    public async Task Document_Control_composes_a_transmittal_and_the_log_says_what_each_waits_on()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var viewer = await app.SignedInAsync("viewer@demo.local");
        var released = await Flow.RevisionAsync(engineer);
        var p = $"/api/projects/{released.Project}";
        var (_, review) = await Flow.PostAsync(engineer, $"{p}/revisions/{released.Revision}/reviews", new { });
        var reviewId = review.GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, $"{p}/reviews/{reviewId}/answer", new { });
        await Flow.PostAsync(approver, $"{p}/reviews/{reviewId}/answer", new { verdict = "C1", status = "IFC" });
        await Flow.PostAsync(controller, $"{p}/reviews/{reviewId}/release", new { });
        var draft = await Flow.RevisionAsync(engineer, (await Api.RegisterAsync(engineer, released.Project, Api.Drawing("Not released yet"))).GetProperty("id").GetGuid());

        var addressees = await GetAsync(controller, $"{p}/addressees");
        var victor = addressees.GetProperty("people").EnumerateArray().Single(x => x.GetProperty("name").GetString() == "Victor Viewer").GetProperty("id").GetGuid();
        var client = addressees.GetProperty("parties").EnumerateArray().Single(x => x.GetProperty("code").GetString() == "NWU").GetProperty("id").GetGuid();

        var (notReleased, notReleasedBody) = await Flow.PostAsync(controller, $"{p}/transmittals",
            new { revisionIds = new[] { released.Revision, draft.Revision }, userIds = new[] { victor }, reason = "INFORMATION" });
        Assert.Equal((HttpStatusCode.Conflict, "NOT_RELEASED"), (notReleased, Flow.Code(notReleasedBody)));
        var (engineerTries, engineerBody) = await Flow.PostAsync(engineer, $"{p}/transmittals",
            new { revisionIds = new[] { released.Revision }, userIds = new[] { victor }, reason = "INFORMATION" });
        Assert.Equal(HttpStatusCode.Forbidden, engineerTries);

        var (sentStatus, sent) = await Flow.PostAsync(controller, $"{p}/transmittals", new
        {
            revisionIds = new[] { released.Revision },
            userIds = new[] { victor },
            partyIds = new[] { client },
            reason = "INFORMATION",
            message = "For your files.",
        });
        Assert.True(sentStatus == HttpStatusCode.OK, sent.ToString());
        Assert.Equal(2, sent.GetArrayLength());

        var log = await GetAsync(controller, $"{p}/transmittals/log");
        Assert.Equal(2, log.GetProperty("total").GetInt32());
        var toSend = (await GetAsync(controller, $"{p}/transmittals/log?status=TO_SEND")).GetProperty("rows").EnumerateArray().Single();
        Assert.Equal("Northwater Utility", toSend.GetProperty("toName").GetString());
        var internalOne = (await GetAsync(controller, $"{p}/transmittals/log?status=AWAITING_ACK")).GetProperty("rows").EnumerateArray().Single();
        Assert.Equal("Internal distribution", internalOne.GetProperty("toName").GetString());

        // The viewer opens it and acknowledges it: nothing left on it.
        await GetAsync(viewer, $"{p}/transmittals/{internalOne.GetProperty("id").GetGuid()}");
        await Flow.PostAsync(viewer, $"{p}/transmittals/{internalOne.GetProperty("id").GetGuid()}/acknowledge", new { });
        Assert.Equal("Internal distribution", (await GetAsync(controller, $"{p}/transmittals/log?status=COMPLETE")).GetProperty("rows")[0].GetProperty("toName").GetString());
        Assert.Single((await GetAsync(controller, $"{p}/transmittals/log?party=NWU")).GetProperty("rows").EnumerateArray());
        Assert.Single((await GetAsync(viewer, $"{p}/transmittals/log")).GetProperty("rows").EnumerateArray());
    }
}
