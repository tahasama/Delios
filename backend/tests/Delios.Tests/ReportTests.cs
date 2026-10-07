using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using ClosedXML.Excel;

namespace Delios.Tests;

public sealed class ReportTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static async Task<JsonElement> GetAsync(HttpClient client, string path)
    {
        using var response = await client.GetAsync(path);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(response.IsSuccessStatusCode, body.ToString());
        return body;
    }

    private static string Figure(JsonElement report, string label) =>
        report.GetProperty("figures").EnumerateArray().Single(f => f.GetProperty("label").GetString() == label).GetProperty("value").GetString()!;

    private static List<List<string>> Rows(JsonElement report) =>
        report.GetProperty("rows").EnumerateArray().Select(r => r.EnumerateArray().Select(c => c.GetProperty("text").GetString()!).ToList()).ToList();

    [Fact]
    public async Task Reports_count_the_register_as_it_stands_and_export_the_same_rows()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");

        // One released, one in review, one planned for yesterday and not started.
        var released = await Flow.RevisionAsync(engineer);
        var p = $"/api/projects/{released.Project}";
        var (_, review) = await Flow.PostAsync(engineer, $"{p}/revisions/{released.Revision}/reviews", new { });
        var reviewId = review.GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, $"{p}/reviews/{reviewId}/answer", new { });
        await Flow.PostAsync(approver, $"{p}/reviews/{reviewId}/answer", new { verdict = "C1", status = "IFC" });
        await Flow.PostAsync(controller, $"{p}/reviews/{reviewId}/release", new { });
        var inReview = await Flow.RevisionAsync(engineer, await Api.RegisterAsync(engineer, released.Project, Api.Drawing("Inlet works sections"))
            .ContinueWith(t => t.Result.GetProperty("id").GetGuid()));
        await Flow.PostAsync(engineer, $"{p}/revisions/{inReview.Revision}/reviews", new { });
        var yesterday = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1));
        var late = await Api.RegisterAsync(engineer, released.Project, new
        {
            title = "Pump datasheet",
            deliverableType = "ENG",
            docType = "DAS",
            discipline = "ME",
            subproject = "20",
            plannedDate = yesterday,
        });
        var lateNumber = late.GetProperty("number").GetString()!;

        var list = await GetAsync(engineer, $"{p}/reports");
        Assert.Equal(["register", "deliveries", "reviews", "transmittals", "readiness"], list.EnumerateArray().Select(r => r.GetProperty("id").GetString()));

        var register = await GetAsync(engineer, $"{p}/reports/register");
        Assert.Equal(("3", "33%", "1", "1"),
            (Figure(register, "Documents"), Figure(register, "Released"), Figure(register, "In review"), Figure(register, "Not started")));
        // Grouped under the discipline's own name, from the organization's list.
        var bars = register.GetProperty("chart").GetProperty("bars").EnumerateArray().Select(b => b.GetProperty("label").GetString()).ToList();
        Assert.Equal(["Civil", "Mechanical"], bars);
        var releasedRow = Rows(register).Single(r => r[3] == "Released");
        Assert.Equal("Issued for construction", releasedRow[5]);
        var link = register.GetProperty("rows")[0][0];
        Assert.Equal("document", link.GetProperty("kind").GetString());

        var deliveries = await GetAsync(engineer, $"{p}/reports/deliveries");
        var overdue = Rows(deliveries).Single();
        Assert.Equal((lateNumber, "Overdue", "1 d"), (overdue[0], overdue[6], overdue[5]));
        Assert.Equal("1", Figure(deliveries, "Overdue now"));

        var reviews = await GetAsync(engineer, $"{p}/reports/reviews");
        var waiting = Rows(reviews).Single();
        Assert.Equal(("Eli Engineer", "0 d"), (waiting[5], waiting[8]));
        Assert.Equal("1", Figure(reviews, "Decided (90 days)"));
        // The windows are the reader's to change, within reason.
        var narrow = await GetAsync(engineer, $"{p}/reports/reviews?warnDays=3&lateDays=5");
        Assert.Contains(narrow.GetProperty("figures").EnumerateArray(), f => f.GetProperty("label").GetString() == "Over 5 days");
        using (var wrong = await engineer.GetAsync($"{p}/reports/reviews?warnDays=10&lateDays=5"))
            Assert.Equal(HttpStatusCode.UnprocessableEntity, wrong.StatusCode);
        using (var unknown = await engineer.GetAsync($"{p}/reports/everything"))
            Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);

        var transmittals = await GetAsync(engineer, $"{p}/reports/transmittals");
        Assert.Equal(6, transmittals.GetProperty("chart").GetProperty("bars").GetArrayLength());
        var readiness = await GetAsync(engineer, $"{p}/reports/readiness?horizonDays=60");
        Assert.Equal("Are the activities of the next 60 days covered by their documents?", readiness.GetProperty("question").GetString());

        // A text narrows the rows; the export carries exactly those rows.
        var filtered = await GetAsync(engineer, $"{p}/reports/register?q=datasheet");
        Assert.Equal(lateNumber, Rows(filtered).Single()[0]);
        var csv = Encoding.UTF8.GetString(await engineer.GetByteArrayAsync($"{p}/reports/register/export?format=csv&q=datasheet"));
        var lines = csv.TrimStart('﻿').Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Concat([]).SelectMany(l => l.Split('\n')).Where(l => l.Length > 0).ToList();
        Assert.StartsWith("\"Register status, P1001, counted ", lines[0]);
        Assert.Equal("Document,Title,Discipline,Stage,Current revision,Status,Released", lines[1]);
        Assert.StartsWith($"{lateNumber},Pump datasheet,Mechanical,Not started", lines[2]);
        Assert.Equal(3, lines.Count);

        using var xlsx = new XLWorkbook(new MemoryStream(await engineer.GetByteArrayAsync($"{p}/reports/deliveries/export?format=xlsx")));
        var sheet = xlsx.Worksheets.First();
        Assert.Equal(("Document", lateNumber), (sheet.Cell(3, 1).GetString(), sheet.Cell(4, 1).GetString()));

        // Another organization's people do not read the project's reports.
        var supplier = await app.SignedInAsync("supplier@acme.local");
        using (var refused = await supplier.GetAsync($"{p}/reports/register"))
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
    }
}
