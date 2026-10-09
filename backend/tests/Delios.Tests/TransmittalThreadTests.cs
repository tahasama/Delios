using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Delios.Tests;

/// <summary>Copies, drafts, letters, chosen dates, answers and follow-ups, telling again, and what an arrival notes.</summary>
public sealed class TransmittalThreadTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static string P(Prepared p, string rest) => $"/api/projects/{p.Project}{rest}";

    private static async Task ReleasedAsync(HttpClient engineer, HttpClient approver, HttpClient controller, Prepared p)
    {
        var (_, review) = await Flow.PostAsync(engineer, P(p, $"/revisions/{p.Revision}/reviews"), new { });
        var id = review.GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, P(p, $"/reviews/{id}/answer"), new { });
        await Flow.PostAsync(approver, P(p, $"/reviews/{id}/answer"), new { verdict = "C1", status = "IFC" });
        await Flow.PostAsync(controller, P(p, $"/reviews/{id}/release"), new { });
    }

    private static async Task<(Guid Viewer, Guid Approver, Guid Acme)> PeopleAsync(HttpClient client, Prepared p)
    {
        var distribution = await client.GetFromJsonAsync<JsonElement>(P(p, $"/documents/{p.Document}/distribution"));
        Guid Find(string list, string name) => distribution.GetProperty(list).EnumerateArray()
            .Single(x => x.GetProperty("name").GetString() == name).GetProperty("id").GetGuid();
        return (Find("proposed", "Victor Viewer"), Find("others", "Aisha Approver"),
            distribution.GetProperty("parties").EnumerateArray().Single(x => x.GetProperty("code").GetString() == "ACME").GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task A_draft_is_seen_by_nobody_it_names_until_issued_and_copies_are_not_asked_to_acknowledge()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var viewer = await app.SignedInAsync("viewer@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        await ReleasedAsync(engineer, approver, controller, p);
        var (viewerId, approverId, _) = await PeopleAsync(engineer, p);

        var (saved, drafts) = await Flow.PostAsync(controller, P(p, "/transmittals"), new
        {
            revisionIds = new[] { p.Revision },
            userIds = new[] { viewerId },
            copyUserIds = new[] { approverId },
            reason = "EXECUTION",
            subject = "For construction",
            message = "Please build from this.",
            draft = true,
        });
        Assert.True(saved == HttpStatusCode.OK, drafts.ToString());
        var draftId = drafts[0].GetProperty("id").GetGuid();
        var draft = await controller.GetFromJsonAsync<JsonElement>(P(p, $"/transmittals/{draftId}"));
        Assert.Equal(("DRAFT", "Draft"), (draft.GetProperty("state").GetString(), draft.GetProperty("number").GetString()));
        using (var hidden = await viewer.GetAsync(P(p, $"/transmittals/{draftId}"))) Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        Assert.Empty((await viewer.GetFromJsonAsync<JsonElement>(P(p, "/transmittals"))).EnumerateArray());

        var (issued, sent) = await Flow.PostAsync(controller, P(p, $"/transmittals/{draftId}/issue"), new { });
        Assert.True(issued == HttpStatusCode.OK, sent.ToString());
        var id = sent[0].GetProperty("id").GetGuid();
        var (again, againBody) = await Flow.PostAsync(controller, P(p, $"/transmittals/{draftId}/issue"), new { });
        Assert.Equal((HttpStatusCode.Conflict, "ALREADY_ISSUED"), (again, Flow.Code(againBody)));

        var t = await controller.GetFromJsonAsync<JsonElement>(P(p, $"/transmittals/{id}"));
        var copied = t.GetProperty("recipients").EnumerateArray().Single(r => r.GetProperty("name").GetString() == "Aisha Approver");
        Assert.Equal(("CC", approverId), (copied.GetProperty("kind").GetString(), copied.GetProperty("userId").GetGuid()));
        // The copy is not asked to acknowledge; the one it is for is, and is told again.
        var work = await approver.GetFromJsonAsync<JsonElement>(P(p, "/work"));
        Assert.DoesNotContain(work.GetProperty("issues").EnumerateArray(), x => x.GetProperty("kind").GetString() == "ACKNOWLEDGE_TRANSMITTAL");
        var (chased, chasedBody) = await Flow.PostAsync(controller, P(p, $"/transmittals/{id}/notify-again"), new { });
        Assert.True(chased == HttpStatusCode.OK, chasedBody.ToString());

        // Each opening counts.
        await viewer.GetAsync(P(p, $"/transmittals/{id}"));
        var seen = await viewer.GetFromJsonAsync<JsonElement>(P(p, $"/transmittals/{id}"));
        Assert.Equal(2, seen.GetProperty("recipients").EnumerateArray().Single(r => r.GetProperty("name").GetString() == "Victor Viewer")
            .GetProperty("viewCount").GetInt32());
    }

    [Fact]
    public async Task A_letter_answers_another_a_follow_up_replaces_it_and_both_are_dated_as_told()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(controller);
        var p = new Prepared(project, Guid.Empty, Guid.Empty);
        var addressees = await controller.GetFromJsonAsync<JsonElement>(P(p, "/addressees"));
        var eli = addressees.GetProperty("people").EnumerateArray().Single(x => x.GetProperty("name").GetString() == "Eli Engineer").GetProperty("id").GetGuid();

        var (noWords, noWordsBody) = await Flow.PostAsync(controller, P(p, "/transmittals"), new { userIds = new[] { eli }, reason = "INFORMATION" });
        Assert.Equal("ITEMS_REQUIRED", Flow.Code(noWordsBody));
        var yesterday = DateTime.UtcNow.AddDays(-1).ToString("yyyy-MM-dd");
        var (_, first) = await Flow.PostAsync(controller, P(p, "/transmittals"), new
        {
            userIds = new[] { eli },
            reason = "INFORMATION",
            subject = "Site access",
            message = "Gate 3 is closed this week.",
            issuedOn = yesterday,
        });
        var firstId = first[0].GetProperty("id").GetGuid();
        var letter = await controller.GetFromJsonAsync<JsonElement>(P(p, $"/transmittals/{firstId}"));
        Assert.Equal(yesterday, letter.GetProperty("issuedAt").GetDateTimeOffset().UtcDateTime.ToString("yyyy-MM-dd"));
        Assert.Empty(letter.GetProperty("items").EnumerateArray());

        var tomorrow = DateTime.UtcNow.AddDays(2).ToString("yyyy-MM-dd");
        var (future, futureBody) = await Flow.PostAsync(controller, P(p, "/transmittals"), new
        {
            userIds = new[] { eli },
            reason = "INFORMATION",
            subject = "x",
            message = "y",
            issuedOn = tomorrow,
        });
        Assert.Equal("DATE_IN_FUTURE", Flow.Code(futureBody));

        var addresseesBack = await controller.GetFromJsonAsync<JsonElement>(P(p, "/addressees"));
        var carla = addresseesBack.GetProperty("people").EnumerateArray().Single(x => x.GetProperty("name").GetString() == "Carla Control").GetProperty("id").GetGuid();
        var (_, answer) = await Flow.PostAsync(controller, P(p, "/transmittals"), new
        {
            userIds = new[] { carla },
            reason = "INFORMATION",
            subject = "Re: Site access",
            message = "Noted.",
            inReplyToId = firstId,
        });
        var (_, replacing) = await Flow.PostAsync(controller, P(p, "/transmittals"), new
        {
            userIds = new[] { eli },
            reason = "INFORMATION",
            subject = "Site access (corrected)",
            message = "Gate 4, not 3.",
            followsId = firstId,
            followKind = "REPLACES",
        });
        var thread = await controller.GetFromJsonAsync<JsonElement>(P(p, $"/transmittals/{firstId}"));
        Assert.Equal(answer[0].GetProperty("id").GetGuid(), thread.GetProperty("answers")[0].GetProperty("id").GetGuid());
        Assert.Equal("REPLACES", thread.GetProperty("followedBy")[0].GetProperty("followKind").GetString());
        var follow = await controller.GetFromJsonAsync<JsonElement>(P(p, $"/transmittals/{replacing[0].GetProperty("id")}"));
        Assert.Equal(firstId, follow.GetProperty("follows").GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task What_arrives_keeps_how_it_came_and_tells_who_it_is_for()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var controller = await app.SignedInAsync("controller@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var project = await Api.ProjectIdAsync(controller);
        var p = new Prepared(project, Guid.Empty, Guid.Empty);
        var addressees = await controller.GetFromJsonAsync<JsonElement>(P(p, "/addressees"));
        var acme = addressees.GetProperty("parties").EnumerateArray().Single(x => x.GetProperty("code").GetString() == "ACME").GetProperty("id").GetGuid();
        var eli = addressees.GetProperty("people").EnumerateArray().Single(x => x.GetProperty("name").GetString() == "Eli Engineer").GetProperty("id").GetGuid();

        var (status, t) = await Flow.PostAsync(controller, P(p, "/transmittals/incoming"), new
        {
            reason = "INFORMATION",
            message = "Our delivery slot moves to Friday.",
            fromPartyId = acme,
            note = "Came by email to the site office.",
            userIds = new[] { eli },
            receivedOn = DateTime.UtcNow.ToString("yyyy-MM-dd"),
        });
        Assert.True(status == HttpStatusCode.Created, t.ToString());
        Assert.Equal("Came by email to the site office.", t.GetProperty("receiptNote").GetString());
        var forEli = t.GetProperty("recipients").EnumerateArray().Single();
        Assert.Equal(("Eli Engineer", "CC"), (forEli.GetProperty("name").GetString(), forEli.GetProperty("kind").GetString()));
        var mine = await engineer.GetFromJsonAsync<JsonElement>("/api/me/notifications");
        Assert.Contains(mine.GetProperty("rows").EnumerateArray(), n => n.GetProperty("link").GetString() == $"/transmittals/{t.GetProperty("id")}");
    }
}
