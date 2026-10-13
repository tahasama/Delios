using System.Text.Json;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Notifications;

/// <summary>
/// One browser (on a computer or a phone) where a person turned pop-up notifications on: where to push to, and the
/// keys the browser gave to read what is pushed. A browser that no longer answers is dropped.
/// </summary>
public sealed class PushSubscription
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public required string Endpoint { get; set; }
    public required string P256dh { get; set; }
    public required string Auth { get; set; }
    /// <summary>Which browser, as it said itself, so a person can tell their devices apart.</summary>
    public string? Device { get; set; }
    public Instant CreatedAt { get; set; }
    public Instant? LastPushedAt { get; set; }
}

/// <summary>
/// The installation's own keys for signing what it pushes (VAPID): made once, the first time they are needed, and
/// kept, so browsers that subscribed keep receiving. Not an organization's: the installation's.
/// </summary>
public sealed class PlatformSecret
{
    public required string Key { get; set; }
    public required string Value { get; set; }
}

internal sealed class PushSubscriptionConfiguration : IEntityTypeConfiguration<PushSubscription>
{
    public void Configure(EntityTypeBuilder<PushSubscription> b)
    {
        b.ToTable("push_subscriptions");
        b.HasKey(x => x.Id);
        b.HasIndex(x => x.Endpoint).IsUnique();
        b.HasIndex(x => new { x.TenantId, x.UserId });
        b.Property(x => x.Endpoint).HasMaxLength(2000);
        b.Property(x => x.P256dh).HasMaxLength(200);
        b.Property(x => x.Auth).HasMaxLength(100);
        b.Property(x => x.Device).HasMaxLength(200);
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class PlatformSecretConfiguration : IEntityTypeConfiguration<PlatformSecret>
{
    public void Configure(EntityTypeBuilder<PlatformSecret> b)
    {
        b.ToTable("platform_secrets");
        b.HasKey(x => x.Key);
        b.Property(x => x.Key).HasMaxLength(100);
    }
}

/// <summary>
/// What pops up, in the groups a person turns on or off: reviews (their steps, answers, hand-overs), documents sent
/// to them or released, and everything else (the schedule, requests, confirmations).
/// </summary>
public static class PushGroups
{
    public const string Reviews = "REVIEWS";
    public const string Documents = "DOCUMENTS";
    public const string Other = "OTHER";
    public static readonly string[] All = [Reviews, Documents, Other];

    public static string Of(string kind) => kind switch
    {
        NotificationKinds.ReviewStep or NotificationKinds.ReviewDecided or NotificationKinds.ReviewReturned or NotificationKinds.Delegation => Reviews,
        NotificationKinds.TransmittalReceived or NotificationKinds.IncomingArrived or NotificationKinds.IssueRequested or NotificationKinds.Released => Documents,
        _ => Other,
    };
}

/// <summary>A notification to push to the person's browsers. Queued with the notification, sent by the worker.</summary>
public sealed record PushRequested(Guid TenantId, Guid NotificationId)
{
    public const string RoutingKey = "push.send";
}

/// <summary>The installation's push keys, made the first time they are needed.</summary>
public static class PushKeys
{
    private const string PublicKey = "VAPID_PUBLIC";
    private const string PrivateKey = "VAPID_PRIVATE";

    public static async Task<(string Public, string Private)> GetAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var stored = await db.Set<PlatformSecret>().AsNoTracking().Where(s => s.Key == PublicKey || s.Key == PrivateKey)
            .ToDictionaryAsync(s => s.Key, s => s.Value, cancellationToken);
        if (stored.TryGetValue(PublicKey, out var pub) && stored.TryGetValue(PrivateKey, out var priv)) return (pub, priv);
        var keys = WebPush.VapidHelper.GenerateVapidKeys();
        db.Set<PlatformSecret>().AddRange(
            new PlatformSecret { Key = PublicKey, Value = keys.PublicKey },
            new PlatformSecret { Key = PrivateKey, Value = keys.PrivateKey });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return (keys.PublicKey, keys.PrivateKey);
        }
        catch (DbUpdateException)
        {
            // Another request made them at the same moment: theirs are the ones kept.
            db.ChangeTracker.Clear();
            var again = await db.Set<PlatformSecret>().AsNoTracking().Where(s => s.Key == PublicKey || s.Key == PrivateKey)
                .ToDictionaryAsync(s => s.Key, s => s.Value, cancellationToken);
            return (again[PublicKey], again[PrivateKey]);
        }
    }
}

/// <summary>
/// Pushes one notification to every browser its person turned pop-ups on in, unless they turned that group off.
/// A browser that answers it is gone (404, 410) is dropped; other refusals throw, so the message is retried.
/// </summary>
public sealed class PushSender(DeliosDbContext db, TenantContext tenant, IClock clock, EmailOptionsAccessor email, ILogger<PushSender> logger)
{
    public async Task ProcessAsync(PushRequested message, CancellationToken cancellationToken)
    {
        tenant.Set(message.TenantId);
        var notification = await db.Set<Notification>().AsNoTracking().SingleOrDefaultAsync(n => n.Id == message.NotificationId, cancellationToken);
        if (notification is null) return;
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == notification.UserId && u.Active, cancellationToken);
        if (user is null || user.PushOff.Contains(PushGroups.Of(notification.Kind))) return;
        var subscriptions = await db.Set<PushSubscription>().Where(s => s.UserId == user.Id).ToListAsync(cancellationToken);
        if (subscriptions.Count == 0) return;
        var (publicKey, privateKey) = await PushKeys.GetAsync(db, cancellationToken);
        var vapid = new WebPush.VapidDetails(email.Subject, publicKey, privateKey);
        var payload = JsonSerializer.Serialize(new
        {
            title = notification.Title,
            body = notification.Body ?? "",
            link = notification.Link ?? "/",
            tag = notification.Id.ToString(),
        });
        using var client = new WebPush.WebPushClient();
        var now = clock.GetCurrentInstant();
        foreach (var subscription in subscriptions)
        {
            try
            {
                await client.SendNotificationAsync(new WebPush.PushSubscription(subscription.Endpoint, subscription.P256dh, subscription.Auth),
                    payload, vapid, cancellationToken);
                subscription.LastPushedAt = now;
            }
            catch (WebPush.WebPushException ex) when (ex.StatusCode is System.Net.HttpStatusCode.Gone or System.Net.HttpStatusCode.NotFound)
            {
                // The browser no longer has this subscription: nothing to keep sending to.
                db.Remove(subscription);
                logger.LogInformation("Push subscription {Id} is gone; dropped", subscription.Id);
            }
        }
        await db.SaveChangesAsync(cancellationToken);
    }
}

/// <summary>Who the pushes say they come from: the address of whoever runs the installation, as browsers ask.</summary>
public sealed class EmailOptionsAccessor(Microsoft.Extensions.Options.IOptions<EmailOptions> options)
{
    public string Subject => options.Value.From is { Length: > 0 } from ? $"mailto:{from}" : "mailto:admin@delios.local";
}

/// <summary>Turning pop-up notifications on and off, per browser, and which groups pop up, per person.</summary>
public static class PushEndpoints
{
    public sealed record SubscribeRequest(string? Endpoint, string? P256dh, string? Auth, string? Device);
    public sealed record UnsubscribeRequest(string? Endpoint);
    public sealed record GroupsRequest(string[]? Off);

    public static void MapPushEndpoints(this IEndpointRouteBuilder app)
    {
        var push = app.MapGroup("/api/push").WithTags("Notifications").RequireAuthorization().AddEndpointFilter<TransactionFilter>();
        push.MapGet("", StateAsync);
        push.MapPost("/subscriptions", SubscribeAsync);
        push.MapPost("/subscriptions/remove", UnsubscribeAsync);
        push.MapPut("/groups", GroupsAsync);
    }

    /// <summary>The key a browser subscribes with, how many browsers this person has on, and the groups turned off.</summary>
    private static async Task<IResult> StateAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var me = http.User.UserId();
        var (publicKey, _) = await PushKeys.GetAsync(db, cancellationToken);
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == me, cancellationToken);
        var devices = await db.Set<PushSubscription>().AsNoTracking().Where(s => s.UserId == me)
            .OrderBy(s => s.CreatedAt).Select(s => new { s.Endpoint, s.Device, CreatedAt = s.CreatedAt.ToDateTimeOffset() }).ToListAsync(cancellationToken);
        return Results.Ok(new { publicKey, devices, off = user.PushOff });
    }

    private static async Task<IResult> SubscribeAsync(SubscribeRequest request, HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Endpoint) || string.IsNullOrWhiteSpace(request.P256dh) || string.IsNullOrWhiteSpace(request.Auth)
            || !Uri.TryCreate(request.Endpoint, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            return Problems.Invalid("SUBSCRIPTION_INVALID", "The browser did not give what is needed to push to it.");
        var me = http.User.UserId();
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == me, cancellationToken);
        // The same browser subscribing again (or after another person signed in on it) is one row, now this person's.
        var existing = await db.Set<PushSubscription>().SingleOrDefaultAsync(s => s.Endpoint == request.Endpoint, cancellationToken);
        if (existing is not null && existing.TenantId != user.TenantId) db.Remove(existing);
        else if (existing is not null)
        {
            existing.UserId = me;
            existing.P256dh = request.P256dh!;
            existing.Auth = request.Auth!;
            existing.Device = request.Device?.Trim() is { Length: > 0 } d ? d[..Math.Min(d.Length, 200)] : existing.Device;
            await db.SaveChangesAsync(cancellationToken);
            return Results.NoContent();
        }
        db.Add(new PushSubscription
        {
            TenantId = user.TenantId,
            UserId = me,
            Endpoint = request.Endpoint!,
            P256dh = request.P256dh!,
            Auth = request.Auth!,
            Device = request.Device?.Trim() is { Length: > 0 } device ? device[..Math.Min(device.Length, 200)] : null,
            CreatedAt = clock.GetCurrentInstant(),
        });
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> UnsubscribeAsync(UnsubscribeRequest request, HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var me = http.User.UserId();
        var mine = await db.Set<PushSubscription>().Where(s => s.UserId == me && s.Endpoint == request.Endpoint).ToListAsync(cancellationToken);
        db.RemoveRange(mine);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> GroupsAsync(GroupsRequest request, HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var me = http.User.UserId();
        var user = await db.Users.SingleAsync(u => u.Id == me, cancellationToken);
        user.PushOff = (request.Off ?? []).Where(PushGroups.All.Contains).Distinct().ToArray();
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }
}
