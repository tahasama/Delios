using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Delios.Host.Notifications;
using Microsoft.Extensions.DependencyInjection;

namespace Delios.Tests;

/// <summary>Catches outgoing mail instead of sending it.</summary>
public sealed class RecordingTransport : IMailTransport
{
    public ConcurrentQueue<System.Net.Mail.MailMessage> Sent { get; } = new();

    public Task SendAsync(System.Net.Mail.MailMessage message, EmailOptions options, CancellationToken cancellationToken)
    {
        Sent.Enqueue(message);
        return Task.CompletedTask;
    }
}

public sealed class NotificationTests(Infrastructure infrastructure) : IClassFixture<Infrastructure>
{
    private static async Task<Guid> StartReviewAsync(HttpClient engineer, Prepared p)
    {
        var (status, review) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/revisions/{p.Revision}/reviews", new { });
        Assert.True(status == HttpStatusCode.Created, review.ToString());
        return review.GetProperty("id").GetGuid();
    }

    [Fact]
    public async Task A_step_waiting_on_someone_tells_them_and_with_email_off_the_email_is_kept_but_not_sent()
    {
        await using var app = await TestApp.StartAsync(infrastructure);
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var admin = await app.SignedInAsync("admin@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var review = await StartReviewAsync(engineer, p);

        var mine = await engineer.GetFromJsonAsync<JsonElement>("/api/me/notifications");
        var told = mine.GetProperty("rows").EnumerateArray().First(n => n.GetProperty("kind").GetString() == NotificationKinds.ReviewStep);
        Assert.Equal($"/reviews/{review}", told.GetProperty("link").GetString());
        Assert.True(mine.GetProperty("unread").GetInt32() >= 1);

        // Read, they stop counting.
        using (var read = await engineer.PostAsJsonAsync("/api/me/notifications/read", new { all = true }))
            Assert.Equal(HttpStatusCode.NoContent, read.StatusCode);
        Assert.Equal(0, (await engineer.GetFromJsonAsync<JsonElement>("/api/me/notifications")).GetProperty("unread").GetInt32());

        // Email is off by default: the message is in the outbox, marked so, and nothing is sent.
        var outbox = await admin.GetFromJsonAsync<JsonElement>("/api/admin/emails?kind=REVIEW");
        Assert.False(outbox.GetProperty("switches").GetProperty("enabled").GetBoolean());
        var email = outbox.GetProperty("rows").EnumerateArray().First(e => e.GetProperty("toAddress").GetString() == "engineer@demo.local");
        Assert.Equal(EmailStates.Off, email.GetProperty("state").GetString());
        Assert.Contains($"/reviews/{review}", email.GetProperty("body").GetString());

        // Only those who keep the organization read the outbox.
        using var refused = await engineer.GetAsync("/api/admin/emails");
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
    }

    [Fact]
    public async Task With_email_on_the_worker_sends_it_and_records_that_it_went()
    {
        var transport = new RecordingTransport();
        await using var app = await TestApp.StartAsync(infrastructure,
            settings =>
            {
                settings["Email:Enabled"] = "true";
                settings["Email:Notifications"] = "false";
                settings["Email:BaseUrl"] = "https://edms.example.test";
            },
            services => services.AddSingleton<IMailTransport>(transport));
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var admin = await app.SignedInAsync("admin@demo.local");
        var p = await Flow.RevisionAsync(engineer);
        var review = await StartReviewAsync(engineer, p);

        System.Net.Mail.MailMessage? sent = null;
        for (var i = 0; i < 100 && sent is null; i++)
        {
            sent = transport.Sent.FirstOrDefault(m => m.To.Any(t => t.Address == "engineer@demo.local"));
            if (sent is null) await Task.Delay(200);
        }
        Assert.NotNull(sent);
        Assert.Contains($"https://edms.example.test/reviews/{review}", sent!.Body);

        JsonElement email = default;
        for (var i = 0; i < 50; i++)
        {
            var outbox = await admin.GetFromJsonAsync<JsonElement>("/api/admin/emails?kind=REVIEW");
            email = outbox.GetProperty("rows").EnumerateArray().First(e => e.GetProperty("toAddress").GetString() == "engineer@demo.local");
            if (email.GetProperty("state").GetString() == EmailStates.Sent) break;
            await Task.Delay(200);
        }
        Assert.Equal(EmailStates.Sent, email.GetProperty("state").GetString());
        Assert.NotEqual(JsonValueKind.Null, email.GetProperty("sentAt").ValueKind);
    }
}
