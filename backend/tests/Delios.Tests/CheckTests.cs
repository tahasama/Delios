using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Delios.Host.Checks;
using Delios.Host.Documents;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Delios.Tests;

public sealed class CheckTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    internal static async Task<JsonElement> RunAsync(HttpClient controller, Guid project)
    {
        var (status, run) = await Flow.PostAsync(controller, $"/api/projects/{project}/checks/run", new { });
        Assert.True(status == HttpStatusCode.Accepted, run.ToString());
        var id = run.GetProperty("id").GetGuid();
        for (var i = 0; i < 150; i++)
        {
            var current = await controller.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/checks/runs/{id}");
            if (current.GetProperty("status").GetString() is "DONE" or "FAILED") return current;
            await Task.Delay(200);
        }
        throw new TimeoutException("The check run did not finish.");
    }

    internal static string? Result(JsonElement run, string checkId) =>
        run.GetProperty("results").EnumerateArray().SingleOrDefault(r => r.GetProperty("checkId").GetString() == checkId) is var r
            && r.ValueKind == JsonValueKind.Object ? r.GetProperty("result").GetString() : null;

    private static async Task<List<JsonElement>> DefectsAsync(HttpClient client, Guid project, string query = "") =>
        (await client.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/defects{query}")).EnumerateArray().ToList();

    private static async Task ReleaseAsync(HttpClient engineer, HttpClient approver, HttpClient controller, Prepared p)
    {
        var (_, review) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/revisions/{p.Revision}/reviews", new { });
        var id = review.GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/reviews/{id}/answer", new { });
        await Flow.PostAsync(approver, $"/api/projects/{p.Project}/reviews/{id}/answer", new { verdict = "C1", status = "IFC" });
        await Flow.PostAsync(controller, $"/api/projects/{p.Project}/reviews/{id}/release", new { });
    }

    [Fact]
    public async Task The_checks_find_what_is_wrong_open_defects_and_score_the_register()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        await ReleaseAsync(engineer, approver, controller, p);
        await Api.RegisterAsync(engineer, p.Project, Api.Drawing("Inlet works sections"));

        // This project does not grade documents by criticality: it says so, and the check is not asked.
        using (var noCriticality = await controller.PutAsJsonAsync($"/api/projects/{p.Project}/checks/CL-05/opt-out",
            new { reason = "Criticality is not used on this project." }))
            Assert.Equal(HttpStatusCode.NoContent, noCriticality.StatusCode);

        var (notControl, notControlBody) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/checks/run", new { });
        Assert.Equal((HttpStatusCode.Forbidden, "CONTROL_ONLY"), (notControl, Flow.Code(notControlBody)));

        var run = await RunAsync(controller, p.Project);
        Assert.Equal("DONE", run.GetProperty("status").GetString());
        // Only a PDF was kept, and the release went to nobody.
        Assert.Equal("FAIL", Result(run, "FM-01"));
        Assert.Equal("FAIL", Result(run, "IS-11"));
        // The register holds together: one current revision, its decision on record, files intact, audit unbroken.
        foreach (var id in new[] { "RV-08", "AP-01", "ST-03", "FM-06", "FM-07", "RG-01", "ST-04", "RO-01", "RV-01", "ID-05" })
            Assert.Equal("PASS", Result(run, id));
        // One of two documents carries a Major defect.
        Assert.Equal(50.0m, run.GetProperty("integrity").GetDecimal());
        Assert.Equal(0, run.GetProperty("openCritical").GetInt32());

        var defects = await DefectsAsync(controller, p.Project);
        var missingNative = defects.Single(d => d.GetProperty("checkId").GetString() == "FM-01");
        Assert.Equal(("MAJOR", "OPEN", p.Document), (missingNative.GetProperty("severity").GetString(),
            missingNative.GetProperty("status").GetString(), missingNative.GetProperty("documentId").GetGuid()));

        // The project decides it keeps PDFs only: the check is switched off, with the reason, and its finding closes.
        using (var off = await controller.PutAsJsonAsync($"/api/projects/{p.Project}/checks/FM-01/opt-out",
            new { reason = "The client's contract asks for PDF only." }))
            Assert.Equal(HttpStatusCode.NoContent, off.StatusCode);
        // Never sent: accepted as it is, with a reason; it stays counted.
        var unsent = defects.Single(d => d.GetProperty("checkId").GetString() == "IS-11");
        var (accepted, acceptedBody) = await Flow.PostAsync(controller,
            $"/api/projects/{p.Project}/defects/{unsent.GetProperty("id").GetGuid()}/accept", new { reason = "Issued with the package next week." });
        Assert.True(accepted == HttpStatusCode.OK, acceptedBody.ToString());

        run = await RunAsync(controller, p.Project);
        Assert.Equal("OFF", Result(run, "FM-01"));
        Assert.Equal(100.0m, run.GetProperty("integrity").GetDecimal());
        defects = await DefectsAsync(controller, p.Project);
        Assert.DoesNotContain(defects, d => d.GetProperty("checkId").GetString() == "FM-01");
        Assert.Equal("ACCEPTED", defects.Single(d => d.GetProperty("checkId").GetString() == "IS-11").GetProperty("status").GetString());
        var catalog = await controller.GetFromJsonAsync<JsonElement>($"/api/projects/{p.Project}/checks");
        Assert.Equal("The client's contract asks for PDF only.", catalog.GetProperty("checks").EnumerateArray()
            .Single(c => c.GetProperty("id").GetString() == "FM-01").GetProperty("offBecause").GetString());
    }

    [Fact]
    public async Task A_defect_closes_by_itself_when_the_register_is_put_right_and_reopens_if_it_comes_back()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        await Api.RegisterAsync(engineer, project, Api.Drawing("Inlet works general arrangement"));

        async Task SetCivilAsync(string status)
        {
            await using var scope = app.Factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            scope.ServiceProvider.GetRequiredService<TenantContext>().Set(await db.Tenants.Select(t => t.Id).SingleAsync());
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.ValueEntries.Where(v => v.SetKey == ValueSets.Disciplines && v.Code == "CI")
                .ExecuteUpdateAsync(v => v.SetProperty(x => x.Status, status));
            await tx.CommitAsync();
        }

        // Civil retired from the list while a document still carries it.
        await SetCivilAsync(ValueStatus.Retired);
        Assert.Equal("FAIL", Result(await RunAsync(controller, project), "MD-06"));
        var defect = (await DefectsAsync(controller, project, "?checkId=MD-06")).Single();
        Assert.Contains("Discipline 'CI'", defect.GetProperty("description").GetString());

        await SetCivilAsync(ValueStatus.Active);
        Assert.Equal("PASS", Result(await RunAsync(controller, project), "MD-06"));
        Assert.Equal("CLOSED", (await DefectsAsync(controller, project, "?checkId=MD-06&status=CLOSED")).Single().GetProperty("status").GetString());

        await SetCivilAsync(ValueStatus.Retired);
        await RunAsync(controller, project);
        var back = (await DefectsAsync(controller, project, "?checkId=MD-06")).Single();
        Assert.Equal((defect.GetProperty("id").GetGuid(), "OPEN"), (back.GetProperty("id").GetGuid(), back.GetProperty("status").GetString()));
    }

    [Fact]
    public async Task Every_project_is_checked_once_a_day_by_itself_and_never_queued_twice()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        var scopes = app.Factory.Services.GetRequiredService<IServiceScopeFactory>();

        Assert.Equal(1, await CheckScheduler.QueueDueAsync(scopes, default));
        Assert.Equal(0, await CheckScheduler.QueueDueAsync(scopes, default));

        var controller = await app.SignedInAsync("controller@demo.local");
        var (busy, body) = await Flow.PostAsync(controller, $"/api/projects/{await Api.ProjectIdAsync(controller)}/checks/run", new { });
        Assert.Equal((HttpStatusCode.Conflict, "CHECKS_ALREADY_RUNNING"), (busy, Flow.Code(body)));
    }
}
