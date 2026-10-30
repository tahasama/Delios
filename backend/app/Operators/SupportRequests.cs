using Delios.Host.Identity;
using Delios.Host.Notifications;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Operators;

/// <summary>
/// A request to DELIOS support (owner: "just have them write a message with object, we already know which org and which
/// project, and have a drawer with main type of requests"): anyone signed in writes its kind, a subject and a message;
/// who, which organization and which project are known. Answered in the console; the person is told. Kept above every
/// organization (no row-level security, as the console's tables): an organization reads only its own, filtered here.
/// </summary>
public sealed class SupportRequest
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public required string OrganizationName { get; set; }
    public Guid? ProjectId { get; set; }
    public string? ProjectName { get; set; }
    /// <summary>One of <see cref="SupportKinds"/>.</summary>
    public required string Kind { get; set; }
    public required string Subject { get; set; }
    public required string Message { get; set; }
    public Guid ByUserId { get; set; }
    public required string ByName { get; set; }
    public required string ByEmail { get; set; }
    public Instant At { get; set; }
    public string? Answer { get; set; }
    public string? AnsweredBy { get; set; }
    public Instant? AnsweredAt { get; set; }
}

/// <summary>
/// A message of a request's conversation after its first (owner: support back and forth): the person writing back, or
/// DELIOS support answering. Kept with the request, above every organization as it is.
/// </summary>
public sealed class SupportMessage
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid RequestId { get; set; }
    public Guid TenantId { get; set; }
    /// <summary>Written by DELIOS support (else by the person who asked).</summary>
    public bool FromDelios { get; set; }
    public required string ByName { get; set; }
    public required string Text { get; set; }
    public Instant At { get; set; }
}

internal sealed class SupportMessageConfiguration : IEntityTypeConfiguration<SupportMessage>
{
    public void Configure(EntityTypeBuilder<SupportMessage> b)
    {
        b.ToTable("support_messages");
        b.Property(x => x.ByName).HasMaxLength(200);
        b.Property(x => x.Text).HasMaxLength(4000);
        b.HasIndex(x => new { x.RequestId, x.At });
    }
}

internal sealed class SupportRequestConfiguration : IEntityTypeConfiguration<SupportRequest>
{
    public void Configure(EntityTypeBuilder<SupportRequest> b)
    {
        b.ToTable("support_requests");
        b.Property(x => x.OrganizationName).HasMaxLength(200);
        b.Property(x => x.ProjectName).HasMaxLength(200);
        b.Property(x => x.Kind).HasMaxLength(32);
        b.Property(x => x.Subject).HasMaxLength(200);
        b.Property(x => x.Message).HasMaxLength(4000);
        b.Property(x => x.ByName).HasMaxLength(200);
        b.Property(x => x.ByEmail).HasMaxLength(254);
        b.Property(x => x.Answer).HasMaxLength(4000);
        b.Property(x => x.AnsweredBy).HasMaxLength(200);
        b.HasIndex(x => new { x.TenantId, x.ByUserId, x.At });
        b.HasIndex(x => x.At);
    }
}

/// <summary>The main kinds of request, so support sees at once what it is about (codes confirmed by the owner).</summary>
public static class SupportKinds
{
    public sealed record Kind(string Code, string Label);
    public static readonly Kind[] All =
    [
        new("SIGN_IN", "Signing in or my account"),
        new("OPEN_FILE", "A document or file does not open"),
        new("UPLOAD", "A file is refused"),
        new("ACCESS", "Someone cannot see or do something"),
        new("ERROR", "An error, or something does not work"),
        new("SETUP", "Setting up a project or its settings"),
        new("BILLING", "Plan, invoice or payment"),
        new("OTHER", "Something else"),
    ];
}

public static class SupportEndpoints
{
    public sealed record AskRequest(string? Kind, string? Subject, string? Message, Guid? ProjectId);
    public sealed record AnswerRequest(string? Answer);
    public sealed record ReplyRequest(string? Text);

    public static void MapSupportEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/support").WithTags("Support").AddEndpointFilter<TransactionFilter>();
        g.MapGet("/requests", MineAsync);
        g.MapPost("/requests", AskAsync);
        g.MapPost("/requests/{id:guid}/messages", ReplyAsync);
    }

    /// <summary>A request with its conversation: every message after the first, oldest first, and whether DELIOS owes the next word.</summary>
    private static async Task<List<object>> WithMessagesAsync(DeliosDbContext db, List<SupportRequest> asks, CancellationToken cancellationToken)
    {
        var ids = asks.Select(a => a.Id).ToList();
        var messages = (await db.Set<SupportMessage>().AsNoTracking().Where(m => ids.Contains(m.RequestId)).OrderBy(m => m.At).ToListAsync(cancellationToken))
            .GroupBy(m => m.RequestId).ToDictionary(g => g.Key, g => g.ToList());
        return asks.Select(a =>
        {
            var thread = messages.GetValueOrDefault(a.Id) ?? [];
            // An answer kept before the conversation existed reads as DELIOS's first message.
            if (thread.Count == 0 && a.Answer is not null)
                thread = [new SupportMessage { RequestId = a.Id, TenantId = a.TenantId, FromDelios = true, ByName = a.AnsweredBy ?? "DELIOS support", Text = a.Answer, At = a.AnsweredAt ?? a.At }];
            var waiting = thread.Count == 0 || !thread[^1].FromDelios;
            return (object)new
            {
                a.Id,
                a.TenantId,
                a.OrganizationName,
                a.ProjectId,
                a.ProjectName,
                a.Kind,
                a.Subject,
                a.Message,
                a.ByUserId,
                a.ByName,
                a.ByEmail,
                a.At,
                a.Answer,
                a.AnsweredBy,
                a.AnsweredAt,
                Waiting = waiting,
                Messages = thread.Select(m => new { m.Id, m.FromDelios, m.ByName, m.Text, m.At }),
            };
        }).ToList();
    }

    /// <summary>The person who asked writes back (owner: a conversation, not one answer): support is emailed, as for a new request.</summary>
    private static async Task<IResult> ReplyAsync(Guid id, ReplyRequest request, HttpContext http, DeliosDbContext db, Notifier notifier,
        IOptions<EmailOptions> email, IClock clock, CancellationToken cancellationToken)
    {
        var text = request.Text?.Trim() ?? "";
        if (text.Length == 0) return Problems.Invalid("MESSAGE_REQUIRED", "Write your message.", new { field = "text" });
        if (text.Length > 4000) return Problems.Invalid("TOO_LONG", "Keep it under 4,000 characters.", new { field = "text" });
        var tenantId = http.User.TenantId();
        var me = http.User.UserId();
        var ask = await db.Set<SupportRequest>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.ByUserId == me, cancellationToken);
        if (ask is null) return Problems.NotFound("NO_SUCH_REQUEST", "No such request of yours.");
        var by = await db.Users.AsNoTracking().Where(u => u.Id == me).Select(u => u.Name).SingleAsync(cancellationToken);
        var message = new SupportMessage { RequestId = ask.Id, TenantId = tenantId, FromDelios = false, ByName = by, Text = text, At = clock.GetCurrentInstant() };
        db.Add(message);
        var support = await db.Set<PlatformSetting>().AsNoTracking().Where(p => p.Key == PlatformKeys.SupportEmail).Select(p => p.Value).SingleOrDefaultAsync(cancellationToken);
        var to = !string.IsNullOrWhiteSpace(support) ? support : email.Value.DeliosAddress;
        if (to is { Length: > 0 } && to.Contains('@'))
            notifier.Queue(tenantId, null, EmailKinds.Account, to, "DELIOS support", $"[Reply] {ask.Subject}",
                $"{ask.ByName} <{ask.ByEmail}>, {ask.OrganizationName}, wrote back.\n\n{text}\n\nAnswer it in the console: Support.",
                "SupportRequest", ask.Id, replyTo: ask.ByEmail);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { message.Id });
    }

    private static async Task<IResult> MineAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var tenantId = http.User.TenantId();
        var me = http.User.UserId();
        var asks = await db.Set<SupportRequest>().AsNoTracking().Where(r => r.TenantId == tenantId && r.ByUserId == me)
            .OrderByDescending(r => r.At).Take(50).ToListAsync(cancellationToken);
        return Results.Ok(new { kinds = SupportKinds.All, mine = await WithMessagesAsync(db, asks, cancellationToken) });
    }

    private static async Task<IResult> AskAsync(AskRequest request, HttpContext http, DeliosDbContext db, Notifier notifier,
        IOptions<EmailOptions> email, IClock clock, CancellationToken cancellationToken)
    {
        var kind = SupportKinds.All.FirstOrDefault(k => k.Code == request.Kind?.Trim().ToUpperInvariant());
        if (kind is null) return Problems.Invalid("KIND_REQUIRED", "Say what it is about.", new { field = "kind" });
        var subject = request.Subject?.Trim() ?? "";
        if (subject.Length == 0) return Problems.Invalid("SUBJECT_REQUIRED", "Give it a subject.", new { field = "subject" });
        var message = request.Message?.Trim() ?? "";
        if (message.Length == 0) return Problems.Invalid("MESSAGE_REQUIRED", "Say what happened.", new { field = "message" });
        if (subject.Length > 200 || message.Length > 4000) return Problems.Invalid("TOO_LONG", "Keep the subject under 200 characters and the message under 4,000.");
        var tenantId = http.User.TenantId();
        var tenant = await db.Tenants.AsNoTracking().SingleAsync(t => t.Id == tenantId, cancellationToken);
        var by = await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), cancellationToken);
        var project = request.ProjectId is { } pid ? await db.Projects.AsNoTracking().Where(p => p.Id == pid).Select(p => new { p.Id, p.Code, p.Name })
            .SingleOrDefaultAsync(cancellationToken) : null;
        var ask = new SupportRequest
        {
            TenantId = tenantId,
            OrganizationName = tenant.Name,
            ProjectId = project?.Id,
            ProjectName = project is null ? null : $"{project.Code} {project.Name}",
            Kind = kind.Code,
            Subject = subject,
            Message = message,
            ByUserId = by.Id,
            ByName = by.Name,
            ByEmail = by.Email,
            At = clock.GetCurrentInstant(),
        };
        db.Add(ask);
        var support = await db.Set<PlatformSetting>().AsNoTracking().Where(p => p.Key == PlatformKeys.SupportEmail).Select(p => p.Value).SingleOrDefaultAsync(cancellationToken);
        var to = !string.IsNullOrWhiteSpace(support) ? support : email.Value.DeliosAddress;
        if (to is { Length: > 0 } && to.Contains('@'))
            notifier.Queue(tenantId, null, EmailKinds.Account, to, "DELIOS support", $"[{kind.Label}] {subject}",
                $"{by.Name} <{by.Email}>, {tenant.Name}{(project is null ? "" : $", project {project.Code} {project.Name}")}.\n\n{message}\n\nAnswer it in the console: Support.",
                "SupportRequest", ask.Id, replyTo: by.Email);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { ask.Id });
    }

    /// <summary>In the console: every request, newest first, and the answer, which tells the person.</summary>
    public static async Task<object> AllAsync(DeliosDbContext db, CancellationToken cancellationToken) =>
        await WithMessagesAsync(db, await db.Set<SupportRequest>().AsNoTracking().OrderByDescending(r => r.At).Take(300).ToListAsync(cancellationToken), cancellationToken);

    public static async Task<IResult> AnswerAsync(Guid id, AnswerRequest request, string operatorName, DeliosDbContext db, IServiceScopeFactory scopes,
        IClock clock, CancellationToken cancellationToken)
    {
        var answer = request.Answer?.Trim() ?? "";
        if (answer.Length == 0) return Problems.Invalid("ANSWER_REQUIRED", "Write the answer.", new { field = "answer" });
        if (answer.Length > 4000) return Problems.Invalid("TOO_LONG", "Keep it under 4,000 characters.", new { field = "answer" });
        var ask = await db.Set<SupportRequest>().SingleOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (ask is null) return Problems.NotFound("NO_SUCH_REQUEST", "No such request.");
        var now = clock.GetCurrentInstant();
        // An answer kept before the conversation existed is written into it first, so nothing said is lost.
        if (ask.Answer is not null && !await db.Set<SupportMessage>().AnyAsync(m => m.RequestId == ask.Id, cancellationToken))
            db.Add(new SupportMessage { RequestId = ask.Id, TenantId = ask.TenantId, FromDelios = true, ByName = ask.AnsweredBy ?? "DELIOS support", Text = ask.Answer, At = ask.AnsweredAt ?? ask.At });
        db.Add(new SupportMessage { RequestId = ask.Id, TenantId = ask.TenantId, FromDelios = true, ByName = operatorName, Text = answer, At = now });
        // The latest answer, as read before the conversation existed.
        ask.Answer = answer;
        ask.AnsweredBy = operatorName;
        ask.AnsweredAt = now;
        await db.SaveChangesAsync(cancellationToken);
        await TenantScope.RunAsync(scopes, ask.TenantId, async (services, _) =>
        {
            var notifier = services.GetRequiredService<Notifier>();
            await notifier.NotifyAsync(ask.TenantId, null, [ask.ByUserId], "PLATFORM", $"DELIOS support answered: {ask.Subject}", answer,
                "/guide?support=1", cancellationToken);
        }, cancellationToken);
        return Results.NoContent();
    }
}
