using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Delios.Tests;

/// <summary>Handing a step over, changing or taking back a comment before the step is answered, and releasing a type that is not reviewed.</summary>
public sealed class DelegationTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static string R(Prepared p, Guid review, string act = "") => $"/api/projects/{p.Project}/reviews/{review}{act}";

    private static async Task<Guid> StartAsync(HttpClient engineer, Prepared p)
    {
        var (status, review) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/revisions/{p.Revision}/reviews", new { });
        Assert.True(status == HttpStatusCode.Created, review.ToString());
        return review.GetProperty("id").GetGuid();
    }

    private static string Until(int days) => DateTime.UtcNow.AddDays(days).ToString("yyyy-MM-dd");

    [Fact]
    public async Task A_step_handed_over_waits_for_Document_Control_then_the_delegate_answers_in_the_holders_place()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var review = await StartAsync(engineer, p);

        // The matrix's people first, anyone else flagged; never Document Control.
        var options = await engineer.GetFromJsonAsync<JsonElement>(R(p, review, "/delegation-options"));
        Assert.True(options.GetProperty("throughControl").GetBoolean());
        var candidates = options.GetProperty("candidates").EnumerateArray().ToList();
        Assert.True(candidates[0].GetProperty("inMatrix").GetBoolean());
        Assert.DoesNotContain(candidates, c => c.GetProperty("name").GetString() == "Carla Control");
        var aisha = candidates.Single(c => c.GetProperty("name").GetString() == "Aisha Approver").GetProperty("id").GetGuid();

        // Where Document Control carries it out, it waits for them.
        var (asked, delegation) = await Flow.PostAsync(engineer, R(p, review, "/delegations"), new { toUserId = aisha, endDate = Until(7), reason = "On leave" });
        Assert.True(asked == HttpStatusCode.OK, delegation.ToString());
        Assert.Equal("OPEN", delegation.GetProperty("status").GetString());
        var id = delegation.GetProperty("id").GetGuid();
        var (early, earlyBody) = await Flow.PostAsync(approver, R(p, review, "/answer"), new { });
        Assert.Equal((HttpStatusCode.Forbidden, "NOT_ON_OPEN_STEP"), (early, Flow.Code(earlyBody)));

        // Only Document Control puts it in force.
        var (notMine, _) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/delegations/{id}/grant", new { });
        Assert.Equal(HttpStatusCode.Forbidden, notMine);
        var (granted, grantedBody) = await Flow.PostAsync(controller, $"/api/projects/{p.Project}/delegations/{id}/grant", new { });
        Assert.Equal((HttpStatusCode.OK, "ACTIVE"), (granted, grantedBody.GetProperty("status").GetString()));

        var me = await approver.GetFromJsonAsync<JsonElement>(R(p, review, "/me"));
        Assert.True(me.GetProperty("seated").GetBoolean());
        Assert.Equal("Eli Engineer", me.GetProperty("onBehalfOf").GetString());

        // The delegate writes and answers; the record says both names.
        var (commented, comment) = await Flow.PostAsync(approver, R(p, review, "/comments"), new { text = "Check the datum.", @class = "NON_BLOCKING" });
        Assert.True(commented == HttpStatusCode.Created || commented == HttpStatusCode.OK, comment.ToString());
        Assert.Equal("Aisha Approver for Eli Engineer", comment.GetProperty("author").GetString());
        var (answered, body) = await Flow.PostAsync(approver, R(p, review, "/answer"), new { });
        Assert.True(answered == HttpStatusCode.OK, body.ToString());
        Assert.Equal(2, body.GetProperty("currentStep").GetInt32());
        var seat = body.GetProperty("steps")[0].GetProperty("participants").EnumerateArray().Single();
        Assert.Equal(("Eli Engineer", "Aisha Approver"), (seat.GetProperty("name").GetString(), seat.GetProperty("answeredBy").GetString()));

        var list = await controller.GetFromJsonAsync<JsonElement>(R(p, review, "/delegations"));
        Assert.Equal("ACTIVE", list[0].GetProperty("status").GetString());
    }

    [Fact]
    public async Task Declining_needs_a_reason_and_the_giver_ends_a_hand_over()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var review = await StartAsync(engineer, p);
        var options = await engineer.GetFromJsonAsync<JsonElement>(R(p, review, "/delegation-options"));
        var victor = options.GetProperty("candidates").EnumerateArray().Single(c => c.GetProperty("name").GetString() == "Victor Viewer");
        Assert.False(victor.GetProperty("inMatrix").GetBoolean());

        var (_, first) = await Flow.PostAsync(engineer, R(p, review, "/delegations"), new { toUserId = victor.GetProperty("id").GetGuid(), endDate = Until(3) });
        Assert.Contains("does not name", first.GetProperty("flag").GetString());
        var (noReason, noReasonBody) = await Flow.PostAsync(controller, $"/api/projects/{p.Project}/delegations/{first.GetProperty("id")}/refuse", new { reason = "" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "REASON_REQUIRED"), (noReason, Flow.Code(noReasonBody)));
        var (_, refused) = await Flow.PostAsync(controller, $"/api/projects/{p.Project}/delegations/{first.GetProperty("id")}/refuse", new { reason = "Not a reviewer" });
        Assert.Equal("REFUSED", refused.GetProperty("status").GetString());

        var (past, pastBody) = await Flow.PostAsync(engineer, R(p, review, "/delegations"), new { toUserId = victor.GetProperty("id").GetGuid(), endDate = Until(-2) });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "END_DATE_PAST"), (past, Flow.Code(pastBody)));
        var (_, second) = await Flow.PostAsync(engineer, R(p, review, "/delegations"), new { toUserId = victor.GetProperty("id").GetGuid(), endDate = Until(3) });
        var (again, againBody) = await Flow.PostAsync(engineer, R(p, review, "/delegations"), new { toUserId = victor.GetProperty("id").GetGuid(), endDate = Until(3) });
        Assert.Equal((HttpStatusCode.Conflict, "ALREADY_DELEGATED"), (again, Flow.Code(againBody)));
        var (_, ended) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/delegations/{second.GetProperty("id")}/end", new { });
        Assert.Equal("WITHDRAWN", ended.GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_comment_is_changed_or_taken_back_until_its_step_is_answered()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var review = await StartAsync(engineer, p);

        var (_, kept) = await Flow.PostAsync(engineer, R(p, review, "/comments"), new { text = "Dimension missing.", @class = "NON_BLOCKING" });
        var (_, dropped) = await Flow.PostAsync(engineer, R(p, review, "/comments"), new { text = "Wrong sheet?", @class = "NON_BLOCKING" });

        // Somebody else's comment is not theirs to change.
        using (var other = await approver.PutAsJsonAsync(R(p, review, $"/comments/{kept.GetProperty("id")}"), new { text = "x" }))
            Assert.Equal(HttpStatusCode.Forbidden, other.StatusCode);
        using (var edit = await engineer.PutAsJsonAsync(R(p, review, $"/comments/{kept.GetProperty("id")}"), new { text = "Dimension A missing on section 2." }))
            Assert.Equal(HttpStatusCode.NoContent, edit.StatusCode);
        using (var take = await engineer.DeleteAsync(R(p, review, $"/comments/{dropped.GetProperty("id")}")))
            Assert.Equal(HttpStatusCode.NoContent, take.StatusCode);

        var view = await engineer.GetFromJsonAsync<JsonElement>(R(p, review));
        var comments = view.GetProperty("comments").EnumerateArray().ToList();
        Assert.Equal("Dimension A missing on section 2.", Assert.Single(comments).GetProperty("text").GetString());

        // Once the step is answered, it is a record.
        await Flow.PostAsync(engineer, R(p, review, "/answer"), new { });
        using var late = await engineer.PutAsJsonAsync(R(p, review, $"/comments/{kept.GetProperty("id")}"), new { text = "Changed after." });
        Assert.Equal(HttpStatusCode.Conflict, late.StatusCode);
    }

    [Fact]
    public async Task A_type_that_is_not_reviewed_is_sent_on_and_Document_Control_releases_it()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var admin = await app.SignedInAsync("admin@demo.local");
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        using (var put = await admin.PutAsJsonAsync("/api/admin/values",
            new { setKey = "DOCUMENT_TYPES", code = "NRV", label = "Not reviewed", props = new { review = false } }))
            Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());

        // A reviewed type is refused.
        var reviewed = await Flow.RevisionAsync(engineer);
        var (refused, refusedBody) = await Flow.PostAsync(engineer, $"/api/projects/{reviewed.Project}/revisions/{reviewed.Revision}/send-on", new { status = "IFI" });
        Assert.Equal((HttpStatusCode.Conflict, "TYPE_IS_REVIEWED"), (refused, Flow.Code(refusedBody)));

        var project = await Api.ProjectIdAsync(engineer);
        var document = (await Api.RegisterAsync(engineer, project, new
        {
            title = "Site memo",
            deliverableType = "ENG",
            docType = "NRV",
            discipline = "CI",
            subproject = "10",
        })).GetProperty("id").GetGuid();
        var p = await Flow.RevisionAsync(engineer, document);
        var (sent, review) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/revisions/{p.Revision}/send-on", new { status = "IFI" });
        Assert.True(sent == HttpStatusCode.Created, review.ToString());
        Assert.Equal(("DECIDED", "IFI"), (review.GetProperty("state").GetString(), review.GetProperty("grantedStatus").GetString()));

        // Not a review to list; Document Control's to release.
        var listed = await controller.GetFromJsonAsync<JsonElement>($"/api/projects/{p.Project}/reviews?per=200");
        Assert.DoesNotContain(listed.GetProperty("rows").EnumerateArray(), r => r.GetProperty("id").GetGuid() == review.GetProperty("id").GetGuid());
        var (released, body) = await Flow.PostAsync(controller, $"/api/projects/{p.Project}/reviews/{review.GetProperty("id")}/release", new { });
        Assert.True(released == HttpStatusCode.OK, body.ToString());
        Assert.Equal("RELEASED", body.GetProperty("state").GetString());
    }
}
