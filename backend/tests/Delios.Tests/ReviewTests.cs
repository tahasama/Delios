using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NodaTime;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace Delios.Tests;

/// <summary>A document with a revision whose PDF has passed scanning, ready to be reviewed.</summary>
public sealed record Prepared(Guid Project, Guid Document, Guid Revision);

public static class Flow
{
    public static byte[] Pdf(int pages = 1)
    {
        using var document = new PdfDocument();
        for (var i = 0; i < pages; i++) document.AddPage();
        using var output = new MemoryStream();
        document.Save(output);
        return output.ToArray();
    }

    public static async Task<Guid> UploadAsync(HttpClient client, Guid project, Guid document, string name, byte[] bytes, string contentType)
    {
        using var response = await client.PostAsJsonAsync($"/api/projects/{project}/documents/{document}/uploads", new
        {
            fileName = name,
            size = bytes.Length,
            contentType,
            sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)),
        });
        var ticket = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(response.IsSuccessStatusCode, ticket.ToString());
        await PutAsync(ticket, bytes);
        return ticket.GetProperty("fileId").GetGuid();
    }

    /// <summary>Sends the bytes as a browser would: to the signed link, with every header the ticket names.</summary>
    public static async Task PutAsync(JsonElement ticket, byte[] bytes)
    {
        using var raw = new HttpClient();
        using var request = new HttpRequestMessage(HttpMethod.Put, ticket.GetProperty("url").GetString()) { Content = new ByteArrayContent(bytes) };
        foreach (var header in ticket.GetProperty("headers").EnumerateObject())
        {
            if (header.Name.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))
                request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(header.Value.GetString()!);
            else
                request.Headers.Add(header.Name, header.Value.GetString());
        }
        using var response = await raw.SendAsync(request);
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
    }

    /// <summary>Registers a drawing (or reuses one) and starts a revision with a PDF, then waits for its scan.</summary>
    public static async Task<Prepared> RevisionAsync(HttpClient client, Guid? document = null, byte[]? pdf = null,
        string name = "GA.pdf", string contentType = "application/pdf")
    {
        var project = await Api.ProjectIdAsync(client);
        var doc = document ?? (await Api.RegisterAsync(client, project, Api.Drawing())).GetProperty("id").GetGuid();
        var file = await UploadAsync(client, project, doc, name, pdf ?? Pdf(), contentType);
        using var started = await client.PostAsJsonAsync($"/api/projects/{project}/documents/{doc}/revisions", new { fileIds = new[] { file } });
        var revision = await started.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(started.StatusCode == HttpStatusCode.Created, revision.ToString());
        var id = revision.GetProperty("id").GetGuid();
        await UntilAsync(client, project, doc, d => Revision(d, id).GetProperty("filesState").GetString() != "PROCESSING");
        return new Prepared(project, doc, id);
    }

    public static JsonElement Revision(JsonElement document, Guid id) =>
        document.GetProperty("revisions").EnumerateArray().Single(r => r.GetProperty("id").GetGuid() == id);

    public static async Task<JsonElement> UntilAsync(HttpClient client, Guid project, Guid document, Func<JsonElement, bool> done)
    {
        for (var i = 0; i < 150; i++)
        {
            var current = await client.GetFromJsonAsync<JsonElement>($"/api/projects/{project}/documents/{document}");
            if (done(current)) return current;
            await Task.Delay(200);
        }
        throw new TimeoutException("The worker did not finish.");
    }

    public static async Task<(HttpStatusCode Status, JsonElement Body)> PostAsync(HttpClient client, string path, object body)
    {
        using var response = await client.PostAsJsonAsync(path, body);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, text.Length == 0 ? default : JsonDocument.Parse(text).RootElement);
    }

    public static string? Code(JsonElement problem) => problem.TryGetProperty("code", out var c) ? c.GetString() : null;
}

public sealed class ReviewTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static string R(Prepared p, Guid review, string act = "") => $"/api/projects/{p.Project}/reviews/{review}{act}";

    private static async Task<JsonElement> StartAsync(HttpClient client, Prepared p)
    {
        var (status, body) = await Flow.PostAsync(client, $"/api/projects/{p.Project}/revisions/{p.Revision}/reviews", new { });
        Assert.True(status == HttpStatusCode.Created, body.ToString());
        return body;
    }

    [Fact]
    public async Task A_revision_goes_through_its_route_is_released_stamped_and_later_superseded()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var p = await Flow.RevisionAsync(engineer, pdf: Flow.Pdf(pages: 2));

        var review = await StartAsync(engineer, p);
        var id = review.GetProperty("id").GetGuid();
        Assert.Equal("P1001-RV-0001", review.GetProperty("number").GetString());
        Assert.Equal(1, review.GetProperty("currentStep").GetInt32());
        Assert.Equal("Eli Engineer", review.GetProperty("steps")[0].GetProperty("participants")[0].GetProperty("name").GetString());
        Assert.NotEqual(JsonValueKind.Null, review.GetProperty("steps")[0].GetProperty("dueDate").ValueKind);

        // The approver is not on the open step.
        var (refused, problem) = await Flow.PostAsync(approver, R(p, id, "/answer"), new { verdict = "C1", status = "IFC" });
        Assert.Equal((HttpStatusCode.Forbidden, "NOT_ON_OPEN_STEP"), (refused, Flow.Code(problem)));

        // The adviser comments; their answer is read off what they wrote.
        await Flow.PostAsync(engineer, R(p, id, "/comments"), new { text = "Check the north arrow.", @class = "NON_BLOCKING" });
        var (advisedStatus, advised) = await Flow.PostAsync(engineer, R(p, id, "/answer"), new { });
        Assert.True(advisedStatus == HttpStatusCode.OK, advised.ToString());
        Assert.Equal("COMMENTS", advised.GetProperty("steps")[0].GetProperty("answer").GetString());
        Assert.Equal(2, advised.GetProperty("currentStep").GetInt32());

        // A verdict that proceeds names its status.
        var (missing, missingBody) = await Flow.PostAsync(approver, R(p, id, "/answer"), new { verdict = "C1" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "STATUS_REQUIRED"), (missing, Flow.Code(missingBody)));
        var (_, decided) = await Flow.PostAsync(approver, R(p, id, "/answer"), new { verdict = "C2", status = "IFC" });
        Assert.Equal(("DECIDED", "C2", "IFC"), (decided.GetProperty("state").GetString(),
            decided.GetProperty("verdict").GetString(), decided.GetProperty("grantedStatus").GetString()));

        // Document Control releases; the people who reviewed may not.
        var (notControl, notControlBody) = await Flow.PostAsync(approver, R(p, id, "/release"), new { });
        Assert.Equal((HttpStatusCode.Forbidden, "CONTROL_ONLY"), (notControl, Flow.Code(notControlBody)));
        var (released, _) = await Flow.PostAsync(controller, R(p, id, "/release"), new { });
        Assert.Equal(HttpStatusCode.OK, released);

        var document = await Flow.UntilAsync(engineer, p.Project, p.Document, d =>
            Flow.Revision(d, p.Revision).GetProperty("files").EnumerateArray().Any(f => f.GetProperty("kind").GetString() == "STAMPED"));
        Assert.Equal("ACTIVE", document.GetProperty("state").GetString());
        var revA = Flow.Revision(document, p.Revision);
        Assert.Equal(("RELEASED", "IFC"), (revA.GetProperty("state").GetString(), revA.GetProperty("statusCode").GetString()));

        var stamped = revA.GetProperty("files").EnumerateArray().Single(f => f.GetProperty("kind").GetString() == "STAMPED");
        var link = await engineer.GetFromJsonAsync<JsonElement>($"/api/projects/{p.Project}/files/{stamped.GetProperty("id").GetGuid()}/download");
        using var raw = new HttpClient();
        using (var pdf = PdfReader.Open(new MemoryStream(await raw.GetByteArrayAsync(new Uri(link.GetProperty("url").GetString()!))), PdfDocumentOpenMode.Import))
        {
            Assert.Equal(2, pdf.PageCount);
        }

        // Revision B, released, supersedes A, and A's stamped copy is marked.
        var b = await Flow.RevisionAsync(engineer, p.Document);
        var reviewB = (await StartAsync(engineer, b)).GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, R(b, reviewB, "/answer"), new { });
        await Flow.PostAsync(approver, R(b, reviewB, "/answer"), new { verdict = "C1", status = "AFC" });
        await Flow.PostAsync(controller, R(b, reviewB, "/release"), new { });

        document = await Flow.UntilAsync(engineer, p.Project, p.Document, d =>
            Flow.Revision(d, p.Revision).GetProperty("files").EnumerateArray().Any(f => f.GetProperty("kind").GetString() == "SUPERSEDED"));
        Assert.Equal("SUPERSEDED", Flow.Revision(document, p.Revision).GetProperty("state").GetString());
        Assert.Equal(("RELEASED", "AFC"), (Flow.Revision(document, b.Revision).GetProperty("state").GetString(),
            Flow.Revision(document, b.Revision).GetProperty("statusCode").GetString()));
        Assert.Equal("B", Flow.Revision(document, b.Revision).GetProperty("value").GetString());
    }

    [Fact]
    public async Task A_blocking_comment_holds_the_release_until_its_author_closes_it()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var id = (await StartAsync(engineer, p)).GetProperty("id").GetGuid();

        var (_, comment) = await Flow.PostAsync(engineer, R(p, id, "/comments"), new { text = "Pump base is undersized.", @class = "BLOCKING" });
        var (_, advised) = await Flow.PostAsync(engineer, R(p, id, "/answer"), new { });
        Assert.Equal("COMMENTS_BLOCKING", advised.GetProperty("steps")[0].GetProperty("answer").GetString());
        await Flow.PostAsync(approver, R(p, id, "/answer"), new { verdict = "C1", status = "IFC" });

        var (held, heldBody) = await Flow.PostAsync(controller, R(p, id, "/release"), new { });
        Assert.Equal((HttpStatusCode.Conflict, "BLOCKING_COMMENTS_OPEN"), (held, Flow.Code(heldBody)));

        var (closed, _) = await Flow.PostAsync(engineer, R(p, id, $"/comments/{comment.GetProperty("id").GetGuid()}/close"),
            new { resolution = "Base enlarged on sheet 2; checked." });
        Assert.Equal(HttpStatusCode.NoContent, closed);
        var (released, _) = await Flow.PostAsync(controller, R(p, id, "/release"), new { });
        Assert.Equal(HttpStatusCode.OK, released);
    }

    [Fact]
    public async Task A_reservation_naming_a_later_step_closes_when_that_step_approves()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var id = (await StartAsync(engineer, p)).GetProperty("id").GetGuid();

        await Flow.PostAsync(engineer, R(p, id, "/comments"),
            new { text = "Acceptable subject to the approver confirming loads.", @class = "BLOCKING", closesWithStep = 2 });
        await Flow.PostAsync(engineer, R(p, id, "/answer"), new { });
        var (_, decided) = await Flow.PostAsync(approver, R(p, id, "/answer"), new { verdict = "C1", status = "IFC" });

        var comment = decided.GetProperty("comments")[0];
        Assert.Equal("CLOSED", comment.GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.OK, (await Flow.PostAsync(controller, R(p, id, "/release"), new { })).Status);
    }

    [Fact]
    public async Task A_verdict_asking_for_changes_cannot_be_released_and_goes_back_to_the_author()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var id = (await StartAsync(engineer, p)).GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, R(p, id, "/answer"), new { });
        await Flow.PostAsync(approver, R(p, id, "/answer"), new { verdict = "C3", note = "Rework the foundations." });

        var work = await controller.GetFromJsonAsync<JsonElement>($"/api/projects/{p.Project}/work");
        Assert.Equal("SEND_BACK", work.GetProperty("gate")[0].GetProperty("kind").GetString());
        var (refused, body) = await Flow.PostAsync(controller, R(p, id, "/release"), new { });
        Assert.Equal((HttpStatusCode.Conflict, "VERDICT_DOES_NOT_PROCEED"), (refused, Flow.Code(body)));

        var (_, returned) = await Flow.PostAsync(controller, R(p, id, "/return"), new { note = "C3 from the approver." });
        Assert.Equal("RETURNED", returned.GetProperty("state").GetString());
        var document = await engineer.GetFromJsonAsync<JsonElement>($"/api/projects/{p.Project}/documents/{p.Document}");
        Assert.Equal("RETURNED", Flow.Revision(document, p.Revision).GetProperty("state").GetString());

        // Replaced, never corrected: the next revision starts.
        var b = await Flow.RevisionAsync(engineer, p.Document);
        Assert.NotEqual(p.Revision, b.Revision);
    }

    [Fact]
    public async Task The_open_step_may_send_the_route_back_but_only_backwards_and_with_a_reason()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var id = (await StartAsync(engineer, p)).GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, R(p, id, "/answer"), new { });

        var (noReason, noReasonBody) = await Flow.PostAsync(approver, R(p, id, "/rewind"), new { toStep = 1, note = "Wrong file." });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "RETURN_REASON_REQUIRED"), (noReason, Flow.Code(noReasonBody)));
        var (forward, forwardBody) = await Flow.PostAsync(approver, R(p, id, "/rewind"), new { toStep = 2, reason = "WRONG_FILE" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "REWIND_FORWARD"), (forward, Flow.Code(forwardBody)));

        var (_, rewound) = await Flow.PostAsync(approver, R(p, id, "/rewind"), new { toStep = 1, reason = "WRONG_FILE", note = "Sheet 2 missing." });
        Assert.Equal(1, rewound.GetProperty("currentStep").GetInt32());
        Assert.Equal("OPEN", rewound.GetProperty("steps")[0].GetProperty("state").GetString());
        Assert.Equal("WAITING", rewound.GetProperty("steps")[1].GetProperty("state").GetString());
    }

    [Fact]
    public async Task Document_Control_cannot_send_a_route_forward_to_a_step_it_has_not_reached()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var id = (await StartAsync(engineer, p)).GetProperty("id").GetGuid();

        // Step 1 is open; step 2 has not been reached. Opening it would leave two steps open.
        var (ahead, aheadBody) = await Flow.PostAsync(controller, R(p, id, "/return"), new { note = "Skip ahead.", toStep = 2, reason = "WRONG_FILE" });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "STEP_NOT_REACHED"), (ahead, Flow.Code(aheadBody)));
        // The review carries on as it was.
        var (answered, answer) = await Flow.PostAsync(engineer, R(p, id, "/answer"), new { });
        Assert.True(answered == HttpStatusCode.OK, answer.ToString());
        Assert.Equal(2, answer.GetProperty("currentStep").GetInt32());
    }

    [Fact]
    public async Task A_pdf_that_cannot_be_stamped_is_recorded_once_and_the_release_stands()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        // Starts like a PDF, so it is classed as one, but has no structure inside.
        var p = await Flow.RevisionAsync(engineer, pdf: "%PDF-1.7\nnot really a pdf\n%%EOF\n"u8.ToArray());
        var id = (await StartAsync(engineer, p)).GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, R(p, id, "/answer"), new { });
        await Flow.PostAsync(approver, R(p, id, "/answer"), new { verdict = "C1", status = "IFC" });
        Assert.Equal(HttpStatusCode.OK, (await Flow.PostAsync(controller, R(p, id, "/release"), new { })).Status);

        await using var scope = app.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
        scope.ServiceProvider.GetRequiredService<TenantContext>().Set(await db.Tenants.Select(t => t.Id).SingleAsync());
        var recorded = 0;
        for (var i = 0; i < 100 && recorded == 0; i++)
        {
            await Task.Delay(200);
            await using var tx = await db.Database.BeginTransactionAsync();
            recorded = await db.AuditEvents.CountAsync(e => e.Action == "STAMP_NOT_POSSIBLE");
        }
        Assert.Equal(1, recorded);
        var document = await engineer.GetFromJsonAsync<JsonElement>($"/api/projects/{p.Project}/documents/{p.Document}");
        Assert.Equal("RELEASED", Flow.Revision(document, p.Revision).GetProperty("state").GetString());
    }

    [Fact]
    public async Task Nothing_is_reviewed_that_nobody_can_read()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var p = await Flow.RevisionAsync(engineer, pdf: "AC1032 native drawing"u8.ToArray(), name: "GA.dwg", contentType: "image/vnd.dwg");

        var (status, body) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/revisions/{p.Revision}/reviews", new { });

        Assert.Equal((HttpStatusCode.Conflict, "NO_RENDITION"), (status, Flow.Code(body)));
    }

    [Fact]
    public async Task Without_anyone_in_document_control_the_deciding_step_releases_by_itself()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        await using (var scope = app.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
            scope.ServiceProvider.GetRequiredService<TenantContext>().Set(await db.Tenants.Select(t => t.Id).SingleAsync());
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.Memberships.Where(m => m.Function!.Code == "DC").ExecuteUpdateAsync(m => m.SetProperty(x => x.Active, false));
            await tx.CommitAsync();
        }
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var id = (await StartAsync(engineer, p)).GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, R(p, id, "/answer"), new { });

        var (_, decided) = await Flow.PostAsync(approver, R(p, id, "/answer"), new { verdict = "C1", status = "IFC" });

        Assert.Equal("RELEASED", decided.GetProperty("state").GetString());
    }

    [Fact]
    public async Task Each_person_sees_what_waits_for_them()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var id = (await StartAsync(engineer, p)).GetProperty("id").GetGuid();

        var mine = await engineer.GetFromJsonAsync<JsonElement>($"/api/projects/{p.Project}/work");
        Assert.Equal("ANSWER_STEP", mine.GetProperty("steps")[0].GetProperty("kind").GetString());
        Assert.Equal(0, (await approver.GetFromJsonAsync<JsonElement>($"/api/projects/{p.Project}/work")).GetProperty("steps").GetArrayLength());

        await Flow.PostAsync(engineer, R(p, id, "/answer"), new { });
        await Flow.PostAsync(approver, R(p, id, "/answer"), new { verdict = "C1", status = "IFC" });
        var gate = await controller.GetFromJsonAsync<JsonElement>($"/api/projects/{p.Project}/work");
        Assert.Equal("READY_TO_RELEASE", gate.GetProperty("gate")[0].GetProperty("kind").GetString());
    }
}

public sealed class StampingRuleTests
{
    [Fact]
    public void Due_dates_skip_the_projects_weekend()
    {
        var thursday = new LocalDate(2026, 10, 8);
        Assert.Equal(new LocalDate(2026, 10, 9), WorkingCalendar.AddWorkingDays(thursday, 1, [6, 7]));
        Assert.Equal(new LocalDate(2026, 10, 13), WorkingCalendar.AddWorkingDays(thursday, 3, [6, 7]));
        // A Friday–Saturday weekend, as in the Gulf: the next working day is Sunday.
        Assert.Equal(new LocalDate(2026, 10, 11), WorkingCalendar.AddWorkingDays(thursday, 1, [5, 6]));
    }

    [Fact]
    public void Stamping_and_watermarking_keep_every_page()
    {
        var pdf = Flow.Pdf(pages: 3);
        var stamped = Stamping.Stamp(pdf, "P1001-10-CI-DWG-00001", "Rev A   IFC", "Released 07 Oct 2026");
        var marked = Stamping.Watermark(stamped, "Superseded by rev B on 09 Oct 2026");

        Assert.NotEqual(pdf, stamped);
        using var result = PdfReader.Open(new MemoryStream(marked), PdfDocumentOpenMode.Import);
        Assert.Equal(3, result.PageCount);
    }
}
