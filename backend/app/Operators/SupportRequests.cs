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

/// <summary>The main kinds of request, so support sees at once what it is about (codes provisional: the owner confirms them).</summary>
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

    public static void MapSupportEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/support").WithTags("Support").AddEndpointFilter<TransactionFilter>();
        g.MapGet("/requests", MineAsync);
        g.MapPost("/requests", AskAsync);
    }

    private static async Task<IResult> MineAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var tenantId = http.User.TenantId();
        var me = http.User.UserId();
        var mine = await db.Set<SupportRequest>().AsNoTracking().Where(r => r.TenantId == tenantId && r.ByUserId == me)
            .OrderByDescending(r => r.At).Take(50)
            .Select(r => new { r.Id, r.Kind, r.Subject, r.Message, r.ProjectName, r.At, r.Answer, r.AnsweredBy, r.AnsweredAt })
            .ToListAsync(cancellationToken);
        return Results.Ok(new { kinds = SupportKinds.All, mine });
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
            TenantId = tenantId, OrganizationName = tenant.Name, ProjectId = project?.Id, ProjectName = project is null ? null : $"{project.Code} {project.Name}",
            Kind = kind.Code, Subject = subject, Message = message, ByUserId = by.Id, ByName = by.Name, ByEmail = by.Email, At = clock.GetCurrentInstant(),
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
        await db.Set<SupportRequest>().AsNoTracking().OrderByDescending(r => r.At).Take(300).ToListAsync(cancellationToken);

    public static async Task<IResult> AnswerAsync(Guid id, AnswerRequest request, string operatorName, DeliosDbContext db, IServiceScopeFactory scopes,
        IClock clock, CancellationToken cancellationToken)
    {
        var answer = request.Answer?.Trim() ?? "";
        if (answer.Length == 0) return Problems.Invalid("ANSWER_REQUIRED", "Write the answer.", new { field = "answer" });
        if (answer.Length > 4000) return Problems.Invalid("TOO_LONG", "Keep it under 4,000 characters.", new { field = "answer" });
        var ask = await db.Set<SupportRequest>().SingleOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (ask is null) return Problems.NotFound("NO_SUCH_REQUEST", "No such request.");
        ask.Answer = answer;
        ask.AnsweredBy = operatorName;
        ask.AnsweredAt = clock.GetCurrentInstant();
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
