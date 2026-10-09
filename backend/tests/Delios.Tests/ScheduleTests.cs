using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using ClosedXML.Excel;
using Delios.Host.Platform;
using Delios.Host.Schedules;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NodaTime;

namespace Delios.Tests;

public sealed class ScheduleTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static readonly DateTime Today = DateTime.UtcNow.Date;

    private static string Day(int days) => Today.AddDays(days).ToString("dd-MMM-yy", CultureInfo.InvariantCulture);

    private static async Task<JsonElement> GetAsync(HttpClient client, string path)
    {
        using var response = await client.GetAsync(path);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(response.IsSuccessStatusCode, body.ToString());
        return body;
    }

    private static async Task<JsonElement> UntilAsync(HttpClient client, string path, Func<JsonElement, bool> done)
    {
        for (var i = 0; i < 150; i++)
        {
            var current = await GetAsync(client, path);
            if (done(current)) return current;
            await Task.Delay(200);
        }
        throw new TimeoutException($"{path} did not get there.");
    }

    /// <summary>A revision carrying the printed schedule and its export, scanned and ready for review.</summary>
    private static async Task<Guid> ScheduleRevisionAsync(HttpClient client, Guid project, Guid document, string csv)
    {
        var pdf = await Flow.UploadAsync(client, project, document, "Programme.pdf", Flow.Pdf(), "application/pdf");
        var export = await Flow.UploadAsync(client, project, document, "Programme.csv", Encoding.UTF8.GetBytes(csv), "text/csv");
        var (status, revision) = await Flow.PostAsync(client, $"/api/projects/{project}/documents/{document}/revisions",
            new { fileIds = new[] { pdf, export } });
        Assert.True(status == HttpStatusCode.Created, revision.ToString());
        var id = revision.GetProperty("id").GetGuid();
        await Flow.UntilAsync(client, project, document, d => Flow.Revision(d, id).GetProperty("filesState").GetString() != "PROCESSING");
        return id;
    }

    private static async Task ReleaseAsync(HttpClient engineer, HttpClient approver, HttpClient controller, Guid project, Guid revision, string status = "IFC")
    {
        var (_, review) = await Flow.PostAsync(engineer, $"/api/projects/{project}/revisions/{revision}/reviews", new { });
        var id = review.GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, $"/api/projects/{project}/reviews/{id}/answer", new { });
        await Flow.PostAsync(approver, $"/api/projects/{project}/reviews/{id}/answer", new { verdict = "C1", status });
        var (released, body) = await Flow.PostAsync(controller, $"/api/projects/{project}/reviews/{id}/release", new { });
        Assert.True(released == HttpStatusCode.OK, body.ToString());
    }

    private static JsonElement ByCode(JsonElement activities, string code) =>
        activities.EnumerateArray().Single(a => a.GetProperty("code").GetString() == code);

    [Fact]
    public async Task A_released_schedule_becomes_activities_whose_needs_turn_them_ready_waived_or_at_risk()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var p = $"/api/projects/{project}";

        // The schedule is a controlled document like any other.
        var schedule = (await Api.RegisterAsync(engineer, project, new
        {
            title = "Construction programme",
            deliverableType = "ENG",
            docType = "SCH",
            discipline = "PM",
            subproject = "00",
        })).GetProperty("id").GetGuid();
        using (var named = await engineer.PutAsJsonAsync($"{p}/schedule", new { documentId = schedule }))
        {
            Assert.Equal(HttpStatusCode.Forbidden, named.StatusCode);
        }
        using (var named = await controller.PutAsJsonAsync($"{p}/schedule", new { documentId = schedule }))
        {
            Assert.True(named.IsSuccessStatusCode, await named.Content.ReadAsStringAsync());
        }

        var first = await ScheduleRevisionAsync(engineer, project, schedule,
            "Activity ID,Activity Name,Start,Finish,Responsible,Departments\n"
            + $"A100,Pour inlet base slab,{Day(5)} A,{Day(8)},Site team,Civil\n"
            + $"A200,Install switchgear,{Day(60)}*,{Day(70)},Electrical,el\n"
            + $"A300,Backfill and compact,{Day(30)},{Day(40)},Site team,\"CI, Quality\"\n");
        // Nothing is read before release: an unreleased schedule is not the plan.
        Assert.Empty((await GetAsync(engineer, $"{p}/activities")).EnumerateArray());
        await ReleaseAsync(engineer, approver, controller, project, first);
        var activities = await UntilAsync(engineer, $"{p}/activities", a => a.GetArrayLength() == 3);
        var a100 = ByCode(activities, "A100");
        Assert.Equal(DateOnly.FromDateTime(Today.AddDays(5)), a100.GetProperty("start").Deserialize<DateOnly>());
        // A department is a discipline, named by code or by name; one that is not is left off and listed.
        Assert.Equal(["CI"], ByCode(activities, "A300").GetProperty("departments").EnumerateArray().Select(d => d.GetString()));
        Assert.Equal(["EL"], ByCode(activities, "A200").GetProperty("departments").EnumerateArray().Select(d => d.GetString()));
        var firstRead = (await GetAsync(controller, $"{p}/schedule")).GetProperty("imports")[0];
        Assert.Equal(["Quality"], firstRead.GetProperty("unmatchedDepartments").EnumerateArray().Select(d => d.GetString()));
        Assert.Equal("NONE", a100.GetProperty("readiness").GetString());

        // What each activity needs, and what for.
        var slab = (await Api.RegisterAsync(engineer, project, Api.Drawing("Inlet base slab reinforcement"))).GetProperty("id").GetGuid();
        var layout = (await Api.RegisterAsync(engineer, project, Api.Drawing("Switchroom layout", "EL"))).GetProperty("id").GetGuid();
        var compaction = (await Api.RegisterAsync(engineer, project, Api.Drawing("Compaction test results"))).GetProperty("id").GetGuid();
        var a = (string code) => $"{p}/activities/{ByCode(activities, code).GetProperty("id").GetGuid()}";

        var (unknown, unknownBody) = await Flow.PostAsync(engineer, $"{a("A100")}/needs", new { documentId = slab, purpose = "WHATEVER" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "VALUE_NOT_PUBLISHED"), (unknown, Flow.Code(unknownBody)));
        var (_, slabNeed) = await Flow.PostAsync(engineer, $"{a("A100")}/needs", new { documentId = slab, purpose = "EXECUTION" });
        Assert.Equal("AT_RISK", slabNeed.GetProperty("activity").GetProperty("readiness").GetString());
        Assert.Equal(DateOnly.FromDateTime(Today.AddDays(-2)), slabNeed.GetProperty("needs")[0].GetProperty("neededBy").Deserialize<DateOnly>());
        var (again, againBody) = await Flow.PostAsync(engineer, $"{a("A100")}/needs", new { documentId = slab, purpose = "EXECUTION" });
        Assert.Equal((HttpStatusCode.Conflict, "NEED_EXISTS"), (again, Flow.Code(againBody)));

        var (plumbing, plumbingBody) = await Flow.PostAsync(engineer, $"{a("A200")}/needs",
            new { documentId = layout, purpose = "INFORMATION", department = "Plumbing" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "VALUE_NOT_PUBLISHED"), (plumbing, Flow.Code(plumbingBody)));
        var (_, layoutNeed) = await Flow.PostAsync(engineer, $"{a("A200")}/needs",
            new { documentId = layout, purpose = "INFORMATION", department = "Electrical" });
        Assert.Equal("EL", layoutNeed.GetProperty("needs")[0].GetProperty("department").GetString());
        Assert.Equal("PENDING", layoutNeed.GetProperty("activity").GetProperty("readiness").GetString());

        // A test result is needed after the work: counted from the finish.
        var (_, testNeed) = await Flow.PostAsync(engineer, $"{a("A300")}/needs",
            new { documentId = compaction, purpose = "RECORD", anchor = "FINISH", offsetDays = 7 });
        Assert.Equal(DateOnly.FromDateTime(Today.AddDays(47)), testNeed.GetProperty("needs")[0].GetProperty("neededBy").Deserialize<DateOnly>());

        // Released for construction: the slab can be poured.
        var slabRevision = (await Flow.RevisionAsync(engineer, slab)).Revision;
        await ReleaseAsync(engineer, approver, controller, project, slabRevision, "IFC");
        var ready = await UntilAsync(engineer, a("A100"), x => x.GetProperty("activity").GetProperty("readiness").GetString() == "READY");
        Assert.Equal("MET", ready.GetProperty("needs")[0].GetProperty("state").GetString());

        // A waiver: only the department concerned or Document Control, and always with a reason.
        var layoutNeedId = layoutNeed.GetProperty("needs")[0].GetProperty("id").GetGuid();
        var waive = $"{a("A200")}/needs/{layoutNeedId}/waive";
        var (outsider, outsiderBody) = await Flow.PostAsync(engineer, waive, new { note = "Not needed." });
        Assert.Equal((HttpStatusCode.Forbidden, "WAIVER_NOT_ALLOWED"), (outsider, Flow.Code(outsiderBody)));
        await using (var scope = app.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            scope.ServiceProvider.GetRequiredService<TenantContext>().Set(await db.Tenants.Select(t => t.Id).SingleAsync());
            await using var tx = await db.Database.BeginTransactionAsync();
            var engineerId = await db.Users.Where(u => u.Email == "engineer@demo.local").Select(u => u.Id).SingleAsync();
            await db.Memberships.Where(m => m.UserId == engineerId).ExecuteUpdateAsync(m => m.SetProperty(x => x.Department, "EL"));
            await tx.CommitAsync();
        }
        var (silent, silentBody) = await Flow.PostAsync(engineer, waive, new { note = " " });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "NOTE_REQUIRED"), (silent, Flow.Code(silentBody)));
        var (_, waived) = await Flow.PostAsync(engineer, waive, new { note = "Received from the supplier by email; will be uploaded later." });
        Assert.Equal("READY_WITH_WAIVERS", waived.GetProperty("activity").GetProperty("readiness").GetString());
        Assert.Equal(("WAIVED", "Eli Engineer"),
            (waived.GetProperty("needs")[0].GetProperty("state").GetString(), waived.GetProperty("needs")[0].GetProperty("waivedBy").GetString()));
        var green = await GetAsync(engineer, $"{p}/activities?readiness=READY_WITH_WAIVERS");
        Assert.Equal("A200", green.EnumerateArray().Single().GetProperty("code").GetString());

        // A decision when documents were missing: one the organization published, who carries it and why.
        var (unpublished, unpublishedBody) = await Flow.PostAsync(controller, $"{a("A300")}/decisions",
            new { decision = "MAYBE", responsibleName = "Site manager", reason = "Unsure." });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "VALUE_NOT_PUBLISHED"), (unpublished, Flow.Code(unpublishedBody)));
        var (incomplete, incompleteBody) = await Flow.PostAsync(controller, $"{a("A300")}/decisions", new { decision = "CARRIED" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "DECISION_INCOMPLETE"), (incomplete, Flow.Code(incompleteBody)));
        var (_, decided) = await Flow.PostAsync(controller, $"{a("A300")}/decisions", new
        {
            decision = "CARRIED",
            responsibleName = "Site manager",
            reason = "Backfill proceeds; tests follow.",
            delayOwedBy = "Lab",
            delayReason = "Lab booked out",
        });
        Assert.Equal("Site manager", decided.GetProperty("decisions")[0].GetProperty("responsibleName").GetString());

        // How the slab drawing's chain went: sent for review, each step, released, issued.
        var lateness = await GetAsync(engineer, $"{a("A100")}/lateness");
        var chain = lateness[0].GetProperty("checkpoints").EnumerateArray().Select(c => c.GetProperty("name").GetString()).ToList();
        Assert.Equal("Sent for review", chain[0]);
        Assert.Equal(["Released", "Issued"], chain[^2..]);
        // Needed two days ago with an eight-day route: it was late going in, and that is the cause.
        var cause = lateness[0].GetProperty("cause");
        Assert.Equal(("Sent for review", "Eli Engineer"), (cause.GetProperty("name").GetString(), cause.GetProperty("owedBy").GetString()));

        // The next revision of the schedule: what moved, what is new, what went.
        var second = await ScheduleRevisionAsync(engineer, project, schedule,
            "Activity ID;Activity Name;Start;Finish\n"
            + $"A100;Pour inlet base slab;{Day(12)};{Day(15)}\n"
            + $"a200;Install switchgear;{Day(60)};{Day(70)}\n"
            + $"A400;Commission pumps;{Day(90)};\n");
        await ReleaseAsync(engineer, approver, controller, project, second);
        var imports = await UntilAsync(controller, $"{p}/schedule", s => s.GetProperty("imports").GetArrayLength() == 2);
        var latest = imports.GetProperty("imports")[0];
        Assert.Equal("DONE", latest.GetProperty("status").GetString());
        Assert.Equal((1, 1, 1, 1),
            (latest.GetProperty("added").GetInt32(), latest.GetProperty("moved").GetInt32(), latest.GetProperty("removed").GetInt32(),
                latest.GetProperty("changed").GetInt32()));
        var now = await GetAsync(engineer, $"{p}/activities");
        // "a200" is A200 written in another case: the same activity, not a new one.
        Assert.Equal(["A100", "A200", "A400"], now.EnumerateArray().Select(x => x.GetProperty("code").GetString()!.ToUpperInvariant()).Order());
        var gone = (await GetAsync(engineer, $"{p}/activities?includeRemoved=true")).EnumerateArray().Single(x => x.GetProperty("code").GetString() == "A300");
        var (removed, removedBody) = await Flow.PostAsync(controller, $"{p}/activities/{gone.GetProperty("id").GetGuid()}/decisions",
            new { decision = "CARRIED", responsibleName = "Site manager", reason = "Too late." });
        Assert.Equal((HttpStatusCode.Conflict, "ACTIVITY_REMOVED"), (removed, Flow.Code(removedBody)));
        var moved = await GetAsync(engineer, a("A100"));
        Assert.Equal(DateOnly.FromDateTime(Today.AddDays(5)), moved.GetProperty("needs")[0].GetProperty("neededBy").Deserialize<DateOnly>());
        var (reread, rereadBody) = await Flow.PostAsync(controller, $"{p}/schedule/import", new { });
        Assert.Equal((HttpStatusCode.Conflict, "SCHEDULE_ALREADY_READ"), (reread, Flow.Code(rereadBody)));

        // The look-ahead report: the same needs, in the organization's own words.
        var report = await GetAsync(engineer, $"{p}/reports/readiness?horizonDays=60");
        var lines = report.GetProperty("rows").EnumerateArray()
            .Select(r => r.EnumerateArray().Select(c => c.GetProperty("text").GetString()).ToList()).ToList();
        Assert.Equal([("A100", "For execution", "There"), ("a200", "For information", "Waived, still followed up")],
            lines.Select(l => (l[0], l[4], l[7])));
        Assert.Equal("Electrical", lines[1][3]);
    }

    [Fact]
    public async Task The_checks_find_an_activity_that_started_without_its_documents_and_a_schedule_that_could_not_be_read()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var project = await Api.ProjectIdAsync(engineer);
        var p = $"/api/projects/{project}";
        var schedule = (await Api.RegisterAsync(engineer, project, new
        {
            title = "Construction programme",
            deliverableType = "ENG",
            docType = "SCH",
            discipline = "PM",
            subproject = "00",
        })).GetProperty("id").GetGuid();
        using (await controller.PutAsJsonAsync($"{p}/schedule", new { documentId = schedule })) { }
        await ReleaseAsync(engineer, approver, controller, project, await ScheduleRevisionAsync(engineer, project, schedule,
            $"Activity ID,Activity Name,Start\nB100,Excavate pump pit,{Day(-3)}\n"));
        var activities = await UntilAsync(engineer, $"{p}/activities", a => a.GetArrayLength() == 1);
        var b100 = $"{p}/activities/{ByCode(activities, "B100").GetProperty("id").GetGuid()}";
        var drawing = (await Api.RegisterAsync(engineer, project, Api.Drawing("Pump pit excavation"))).GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, $"{b100}/needs", new { documentId = drawing, purpose = "EXECUTION" });

        var run = await CheckTests.RunAsync(controller, project);
        Assert.Equal(("FAIL", "PASS", "PASS"), (CheckTests.Result(run, "SC-02"), CheckTests.Result(run, "SC-01"), CheckTests.Result(run, "SC-04")));
        await Flow.PostAsync(controller, $"{b100}/decisions", new { decision = "STOPPED", responsibleName = "Site manager", reason = "No drawing." });
        run = await CheckTests.RunAsync(controller, project);
        Assert.Equal("PASS", CheckTests.Result(run, "SC-02"));

        // The next revision's export is not readable: the release stands, the check says so.
        var broken = await ScheduleRevisionAsync(engineer, project, schedule, "Task,When\nB100,soon\n");
        await ReleaseAsync(engineer, approver, controller, project, broken);
        var imports = await UntilAsync(controller, $"{p}/schedule", s => s.GetProperty("imports").GetArrayLength() == 2);
        Assert.Equal("FAILED", imports.GetProperty("imports")[0].GetProperty("status").GetString());
        run = await CheckTests.RunAsync(controller, project);
        Assert.Equal("FAIL", CheckTests.Result(run, "SC-01"));
    }

    [Fact]
    public void An_Excel_export_is_read_from_its_headings_wherever_they_start()
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.AddWorksheet("TASK");
        sheet.Cell(1, 1).Value = "Project P1001 programme, data date 01-Oct-26";
        sheet.Cell(3, 1).Value = "Task ID";
        sheet.Cell(3, 2).Value = "Task Name";
        sheet.Cell(3, 3).Value = "Early Start";
        sheet.Cell(3, 4).Value = "Early Finish";
        sheet.Cell(3, 5).Value = "Discipline";
        sheet.Cell(4, 1).Value = "C-10";
        sheet.Cell(4, 2).Value = "Excavate";
        sheet.Cell(4, 3).Value = new DateTime(2026, 11, 2);
        sheet.Cell(4, 4).Value = "20-Nov-26 A";
        sheet.Cell(4, 5).Value = "Civil; Survey";
        sheet.Cell(5, 1).Value = "C-20";
        sheet.Cell(5, 2).Value = "Milestone: ready for pour";
        sheet.Cell(5, 3).Value = "";
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        stream.Position = 0;

        var (activities, error) = ScheduleReader.Read(stream, "Programme.xlsx", new ScheduleColumns());

        Assert.Null(error);
        Assert.Equal(2, activities!.Count);
        Assert.Equal(("C-10", "Excavate", new LocalDate(2026, 11, 2), new LocalDate(2026, 11, 20)),
            (activities[0].Code, activities[0].Name, activities[0].Start, activities[0].Finish));
        Assert.Equal(["Civil", "Survey"], activities[0].Departments);
        Assert.Null(activities[1].Start);
    }

    [Fact]
    public void A_csv_field_may_hold_line_breaks_and_month_first_dates_are_read_when_the_project_says_so()
    {
        var csv = "Activity ID,Activity Name,Start\r\nA1,\"Pour slab,\r\nbay 1\",03/04/2027\r\nA2,Strike forms,12/31/2027\r\n";
        var dayFirst = ScheduleReader.Read(new MemoryStream(Encoding.UTF8.GetBytes(csv)), "x.csv", new ScheduleColumns());
        Assert.Contains("12/31/2027", dayFirst.Error);
        var (activities, error) = ScheduleReader.Read(new MemoryStream(Encoding.UTF8.GetBytes(csv)), "x.csv", new ScheduleColumns { DateOrder = "MDY" });
        Assert.Null(error);
        Assert.Equal(("A1", "Pour slab,\r\nbay 1", new LocalDate(2027, 3, 4)), (activities![0].Code, activities[0].Name, activities[0].Start));
        Assert.Equal(new LocalDate(2027, 12, 31), activities[1].Start);
    }

    [Theory]
    [InlineData("Name,Start\nA,01-Jan-27\n", "No heading row")]
    [InlineData("Activity ID,Activity Name\nA,Dig\n", "No start date column")]
    [InlineData("Activity ID,Activity Name,Start\nA,Dig,someday\n", "Row 2: 'someday' is not a date.")]
    [InlineData("Activity ID,Activity Name,Start\nA,Dig,01-Jan-27\nA,Dig again,02-Jan-27\n", "Row 3: activity A appears twice.")]
    public void A_schedule_that_cannot_be_read_says_why(string csv, string expected)
    {
        var (activities, error) = ScheduleReader.Read(new MemoryStream(Encoding.UTF8.GetBytes(csv)), "x.csv", new ScheduleColumns());
        Assert.Null(activities);
        Assert.Contains(expected, error);
    }
}
