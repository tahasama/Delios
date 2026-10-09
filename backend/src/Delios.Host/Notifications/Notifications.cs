using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Notifications;

/// <summary>Something a person is told about: a step waiting on them, a transmittal to them, a decision on their work.</summary>
public sealed class Notification
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    /// <summary>The project it happened on; empty for something about the organization.</summary>
    public Guid? ProjectId { get; set; }
    public Guid UserId { get; set; }
    /// <summary>What kind of thing it is, from <see cref="NotificationKinds"/>, so a screen can group or filter.</summary>
    public required string Kind { get; set; }
    public required string Title { get; set; }
    public string? Body { get; set; }
    /// <summary>Where on the screens it is about, as a path: /documents/{id}.</summary>
    public string? Link { get; set; }
    public Instant CreatedAt { get; set; }
    public Instant? ReadAt { get; set; }
}

/// <summary>The kinds of notification the backend raises.</summary>
public static class NotificationKinds
{
    public const string ReviewStep = "REVIEW_STEP";
    public const string ReviewDecided = "REVIEW_DECIDED";
    public const string ReviewReturned = "REVIEW_RETURNED";
    public const string Released = "RELEASED";
    public const string TransmittalReceived = "TRANSMITTAL_RECEIVED";
    public const string IncomingArrived = "INCOMING_ARRIVED";
    public const string IssueRequested = "ISSUE_REQUESTED";
    public const string Delegation = "DELEGATION";
    public const string General = "GENERAL";
}

/// <summary>
/// An email as the system means to send it. Every email is written here first, in the same transaction as the act
/// that caused it, and the worker sends it afterwards; with email switched off it is kept, marked so, and never sent.
/// The outbox is the record of what went out, and of what would have.
/// </summary>
public sealed class EmailMessage
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid? ProjectId { get; set; }
    /// <summary>TRANSMITTAL, REVIEW or NOTIFICATION: which switch governs it.</summary>
    public required string Kind { get; set; }
    public required string ToAddress { get; set; }
    public string? ToName { get; set; }
    public required string Subject { get; set; }
    public required string Body { get; set; }
    /// <summary>What it is about, for the record: Transmittal, Review, Notification.</summary>
    public string? RelatedType { get; set; }
    public Guid? RelatedId { get; set; }
    /// <summary>One of <see cref="EmailStates"/>.</summary>
    public string State { get; set; } = EmailStates.Queued;
    public Instant CreatedAt { get; set; }
    public Instant? SentAt { get; set; }
    public string? Error { get; set; }
    public int Attempts { get; set; }
}

/// <summary>Where an email stands.</summary>
public static class EmailStates
{
    /// <summary>Waiting for the worker to send it.</summary>
    public const string Queued = "QUEUED";
    public const string Sent = "SENT";
    /// <summary>The mail server refused it, every attempt.</summary>
    public const string Failed = "FAILED";
    /// <summary>Email (or this kind of email) was switched off when it was written: kept, never sent.</summary>
    public const string Off = "OFF";
}

/// <summary>Which switch an email answers to.</summary>
public static class EmailKinds
{
    public const string Transmittal = "TRANSMITTAL";
    public const string Review = "REVIEW";
    public const string Notification = "NOTIFICATION";
}

/// <summary>
/// Email settings (section <c>Email</c>). Off by default: nothing leaves the system until an administrator of the
/// installation switches it on and names a mail server. Each kind has its own switch under the main one.
/// </summary>
public sealed class EmailOptions
{
    public const string Section = "Email";
    public bool Enabled { get; set; }
    public bool Transmittals { get; set; } = true;
    public bool Reviews { get; set; } = true;
    public bool Notifications { get; set; } = true;
    /// <summary>The sender address every email carries.</summary>
    public string From { get; set; } = "delios@localhost";
    public string FromName { get; set; } = "DELIOS";
    /// <summary>The address of the screens, to put whole links in an email: https://edms.example.com.</summary>
    public string BaseUrl { get; set; } = "http://localhost:3000";
    public SmtpOptions Smtp { get; set; } = new();

    /// <summary>Whether an email of this kind is sent now.</summary>
    public bool Sends(string kind) => Enabled && kind switch
    {
        EmailKinds.Transmittal => Transmittals,
        EmailKinds.Review => Reviews,
        _ => Notifications,
    };
}

/// <summary>The mail server email goes through.</summary>
public sealed class SmtpOptions
{
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public bool UseTls { get; set; } = true;
    public string? User { get; set; }
    public string? Password { get; set; }
}

/// <summary>The message the worker receives for each email to send.</summary>
public sealed record EmailRequested(Guid TenantId, Guid EmailId)
{
    public const string RoutingKey = "email.send";
}

/// <summary>
/// Tells people: writes their notifications and the emails that go with them, in the caller's unit of work. Nothing
/// is sent here; the worker sends what is queued once the act has committed.
/// </summary>
public sealed class Notifier(DeliosDbContext db, IClock clock, IOptions<EmailOptions> options)
{
    private EmailOptions Email => options.Value;

    /// <summary>
    /// Notifies each person once (repeats and empty ids are ignored), and emails those with an address when
    /// notification email is on. <paramref name="link"/> is a path on the screens.
    /// </summary>
    public async Task NotifyAsync(
        Guid tenantId, Guid? projectId, IEnumerable<Guid> userIds, string kind, string title, string? body, string? link,
        CancellationToken cancellationToken, string emailKind = EmailKinds.Notification)
    {
        var ids = userIds.Where(id => id != Guid.Empty).Distinct().ToList();
        if (ids.Count == 0) return;
        var now = clock.GetCurrentInstant();
        var people = await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id) && u.Active)
            .Select(u => new { u.Id, u.Email, u.Name }).ToListAsync(cancellationToken);
        foreach (var person in people)
        {
            var notification = new Notification
            {
                TenantId = tenantId,
                ProjectId = projectId,
                UserId = person.Id,
                Kind = kind,
                Title = Clip(title, 300),
                Body = body is null ? null : Clip(body, 2000),
                Link = link,
                CreatedAt = now,
            };
            db.Add(notification);
            Queue(tenantId, projectId, emailKind, person.Email, person.Name, title,
                $"{body}{(link is null ? "" : $"\n\n{Url(link)}")}", "Notification", notification.Id);
        }
    }

    /// <summary>Everyone holding Document Control on the project: who is told when something waits on the register.</summary>
    public Task<List<Guid>> ControlHoldersAsync(Guid projectId, CancellationToken cancellationToken) =>
        db.Memberships.AsNoTracking()
            .Where(m => m.ProjectId == projectId && m.Active && m.Function!.Active && m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control)))
            .Select(m => m.UserId).Distinct().ToListAsync(cancellationToken);

    /// <summary>Queues one email (or records it as not sent, when that kind of email is off).</summary>
    public EmailMessage Queue(
        Guid tenantId, Guid? projectId, string kind, string toAddress, string? toName, string subject, string body,
        string? relatedType, Guid? relatedId)
    {
        var sends = Email.Sends(kind);
        var message = new EmailMessage
        {
            TenantId = tenantId,
            ProjectId = projectId,
            Kind = kind,
            ToAddress = toAddress,
            ToName = toName,
            Subject = Clip(subject, 300),
            Body = Clip(body, 20000),
            RelatedType = relatedType,
            RelatedId = relatedId,
            CreatedAt = clock.GetCurrentInstant(),
            State = sends ? EmailStates.Queued : EmailStates.Off,
        };
        db.Add(message);
        if (sends) db.Enqueue(EmailRequested.RoutingKey, new EmailRequested(tenantId, message.Id));
        return message;
    }

    /// <summary>A whole link to a path on the screens.</summary>
    public string Url(string path) => $"{Email.BaseUrl.TrimEnd('/')}{path}";

    private static string Clip(string text, int length) => text.Length <= length ? text : text[..(length - 1)] + "…";
}

/// <summary>How an email leaves: the mail server in production; a recorder in tests.</summary>
public interface IMailTransport
{
    Task SendAsync(System.Net.Mail.MailMessage message, EmailOptions options, CancellationToken cancellationToken);
}

/// <summary>Sends through the SMTP server named in the settings.</summary>
public sealed class SmtpTransport : IMailTransport
{
    public async Task SendAsync(System.Net.Mail.MailMessage message, EmailOptions options, CancellationToken cancellationToken)
    {
        using var client = new System.Net.Mail.SmtpClient(options.Smtp.Host, options.Smtp.Port) { EnableSsl = options.Smtp.UseTls };
        if (!string.IsNullOrEmpty(options.Smtp.User))
            client.Credentials = new System.Net.NetworkCredential(options.Smtp.User, options.Smtp.Password);
        await client.SendMailAsync(message, cancellationToken);
    }
}

/// <summary>Sends one queued email through the mail server. Called by the worker for each <see cref="EmailRequested"/>.</summary>
public sealed class EmailSender(
    DeliosDbContext db, TenantContext tenant, IClock clock, IOptions<EmailOptions> options, IMailTransport transport, ILogger<EmailSender> logger)
{
    /// <summary>
    /// Sends the email, once: an email already sent, or switched off since, is left as it is. A refusal from the mail
    /// server throws, so the message is retried and in the end parked; the email records the error each time.
    /// </summary>
    public async Task ProcessAsync(EmailRequested message, CancellationToken cancellationToken)
    {
        tenant.Set(message.TenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var email = await db.Set<EmailMessage>().SingleOrDefaultAsync(e => e.Id == message.EmailId, cancellationToken);
        if (email is null || email.State is not (EmailStates.Queued or EmailStates.Failed)) return;
        var settings = options.Value;
        if (!settings.Sends(email.Kind))
        {
            email.State = EmailStates.Off;
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return;
        }
        email.Attempts++;
        try
        {
            using var mail = new System.Net.Mail.MailMessage(
                new System.Net.Mail.MailAddress(settings.From, settings.FromName),
                new System.Net.Mail.MailAddress(email.ToAddress, email.ToName ?? email.ToAddress))
            {
                Subject = email.Subject,
                Body = email.Body,
            };
            await transport.SendAsync(mail, settings, cancellationToken);
            email.State = EmailStates.Sent;
            email.SentAt = clock.GetCurrentInstant();
            email.Error = null;
        }
        catch (Exception ex) when (ex is System.Net.Mail.SmtpException or System.Net.Sockets.SocketException or InvalidOperationException)
        {
            email.State = EmailStates.Failed;
            email.Error = ex.Message.Length > 1000 ? ex.Message[..1000] : ex.Message;
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            logger.LogWarning(ex, "Email {EmailId} to {To} was not sent", email.Id, email.ToAddress);
            throw;
        }
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}

/// <summary>EF Core mapping for notifications and the email outbox.</summary>
internal sealed class NotificationConfiguration : IEntityTypeConfiguration<Notification>, IEntityTypeConfiguration<EmailMessage>
{
    public void Configure(EntityTypeBuilder<Notification> b)
    {
        b.ToTable("notifications");
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.UserId, x.ReadAt, x.CreatedAt });
        b.Property(x => x.Kind).HasMaxLength(40);
        b.Property(x => x.Title).HasMaxLength(300);
        b.Property(x => x.Body).HasMaxLength(2000);
        b.Property(x => x.Link).HasMaxLength(500);
    }

    public void Configure(EntityTypeBuilder<EmailMessage> b)
    {
        b.ToTable("email_messages");
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.State, x.CreatedAt });
        b.HasIndex(x => new { x.RelatedType, x.RelatedId });
        b.Property(x => x.Kind).HasMaxLength(20);
        b.Property(x => x.ToAddress).HasMaxLength(254);
        b.Property(x => x.ToName).HasMaxLength(200);
        b.Property(x => x.Subject).HasMaxLength(300);
        b.Property(x => x.Body).HasMaxLength(20000);
        b.Property(x => x.RelatedType).HasMaxLength(40);
        b.Property(x => x.State).HasMaxLength(10);
        b.Property(x => x.Error).HasMaxLength(1000);
    }
}

/// <summary>
/// A person's notifications (<c>/api/me/notifications</c>), and the email outbox for those who keep the
/// organization (<c>/api/admin/emails</c>).
/// </summary>
public static class NotificationEndpoints
{
    public static void MapNotificationEndpoints(this IEndpointRouteBuilder app)
    {
        var me = app.MapGroup("/api/me/notifications").WithTags("Notifications").AddEndpointFilter<TransactionFilter>();
        me.MapGet("", ListAsync);
        me.MapPost("/read", ReadAsync);

        var admin = app.MapGroup("/api/admin/emails").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("Only an administrator reads the email outbox."));
        admin.MapGet("", OutboxAsync);
    }

    /// <summary>Body of marking notifications read: these, or all of them.</summary>
    public sealed record ReadRequest(Guid[]? Ids, bool All = false);

    /// <summary><c>GET /api/me/notifications</c>: newest first, a page at a time, with how many are unread.</summary>
    private static async Task<IResult> ListAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken,
        bool unread = false, int page = 1, int per = 50, Guid? projectId = null)
    {
        var me = http.User.UserId();
        per = Math.Clamp(per, 1, 200);
        page = Math.Max(1, page);
        var mine = db.Set<Notification>().AsNoTracking().Where(n => n.UserId == me);
        if (projectId is { } p) mine = mine.Where(n => n.ProjectId == p || n.ProjectId == null);
        var unreadCount = await mine.CountAsync(n => n.ReadAt == null, cancellationToken);
        var query = unread ? mine.Where(n => n.ReadAt == null) : mine;
        var total = await query.CountAsync(cancellationToken);
        var rows = await query.OrderByDescending(n => n.CreatedAt).Skip((page - 1) * per).Take(per).ToListAsync(cancellationToken);
        return Results.Ok(new
        {
            unread = unreadCount,
            total,
            page,
            per,
            rows = rows.Select(n => new { n.Id, n.ProjectId, n.Kind, n.Title, n.Body, n.Link, CreatedAt = n.CreatedAt.ToDateTimeOffset(), ReadAt = n.ReadAt?.ToDateTimeOffset() }),
        });
    }

    /// <summary><c>POST /api/me/notifications/read</c>: marks the named notifications read, or all of them.</summary>
    private static async Task<IResult> ReadAsync(ReadRequest request, HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var me = http.User.UserId();
        var now = clock.GetCurrentInstant();
        var ids = request.Ids ?? [];
        await db.Set<Notification>().Where(n => n.UserId == me && n.ReadAt == null && (request.All || ids.Contains(n.Id)))
            .ExecuteUpdateAsync(n => n.SetProperty(x => x.ReadAt, now), cancellationToken);
        return Results.NoContent();
    }

    /// <summary><c>GET /api/admin/emails</c>: the outbox, newest first, with what each email was about and whether it went.</summary>
    private static async Task<IResult> OutboxAsync(DeliosDbContext db, IOptions<EmailOptions> options, CancellationToken cancellationToken,
        string? state = null, string? kind = null, int page = 1, int per = 50)
    {
        per = Math.Clamp(per, 1, 200);
        page = Math.Max(1, page);
        var query = db.Set<EmailMessage>().AsNoTracking();
        if (!string.IsNullOrWhiteSpace(state)) query = query.Where(e => e.State == state);
        if (!string.IsNullOrWhiteSpace(kind)) query = query.Where(e => e.Kind == kind);
        var total = await query.CountAsync(cancellationToken);
        var rows = await query.OrderByDescending(e => e.CreatedAt).Skip((page - 1) * per).Take(per).ToListAsync(cancellationToken);
        var settings = options.Value;
        return Results.Ok(new
        {
            switches = new { settings.Enabled, settings.Transmittals, settings.Reviews, settings.Notifications },
            total,
            page,
            per,
            rows = rows.Select(e => new
            {
                e.Id,
                e.Kind,
                e.ToAddress,
                e.ToName,
                e.Subject,
                e.Body,
                e.RelatedType,
                e.RelatedId,
                e.State,
                e.Error,
                e.Attempts,
                CreatedAt = e.CreatedAt.ToDateTimeOffset(),
                SentAt = e.SentAt?.ToDateTimeOffset(),
            }),
        });
    }
}
