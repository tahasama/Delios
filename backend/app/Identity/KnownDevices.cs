using System.Security.Cryptography;
using Delios.Host.Notifications;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Identity;

/// <summary>A browser a person has signed in from: the screens keep a random id in a long-lived cookie, stored here hashed.</summary>
public sealed class KnownDevice
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public required byte[] DeviceHash { get; set; }
    /// <summary>The browser and system, in words a person recognizes ("Chrome on Windows").</summary>
    public required string Label { get; set; }
    public Instant FirstSeenAt { get; set; }
    public Instant LastSeenAt { get; set; }
}

internal sealed class KnownDeviceConfiguration : IEntityTypeConfiguration<KnownDevice>
{
    public void Configure(EntityTypeBuilder<KnownDevice> b)
    {
        b.HasIndex(x => new { x.UserId, x.DeviceHash }).IsUnique();
        b.Property(x => x.Label).HasMaxLength(100);
    }
}

/// <summary>
/// A sign-in from a browser the person has never signed in from is emailed to them: when, which browser, from where,
/// and what to do if it was not them. The very first browser of an account is only remembered.
/// </summary>
public static class KnownDevices
{
    /// <summary>The header the screens pass the browser's id in, with its <c>User-Agent</c>.</summary>
    public const string Header = "X-Delios-Device";

    /// <summary>Remembers the browser of a sign-in and emails the person when it is a new one. Does not save: the caller does.</summary>
    public static async Task NoteAsync(HttpContext http, User user, CancellationToken cancellationToken)
    {
        var id = http.Request.Headers[Header].ToString();
        if (string.IsNullOrWhiteSpace(id) || id.Length > 200) return;
        var services = http.RequestServices;
        var db = services.GetRequiredService<DeliosDbContext>();
        var now = services.GetRequiredService<IClock>().GetCurrentInstant();
        var hash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(id));
        var label = Label(http.Request.Headers.UserAgent.ToString());
        var mine = await db.Set<KnownDevice>().Where(d => d.UserId == user.Id).ToListAsync(cancellationToken);
        if (mine.FirstOrDefault(d => d.DeviceHash.SequenceEqual(hash)) is { } known)
        {
            known.LastSeenAt = now;
            await db.SaveChangesAsync(cancellationToken);
            return;
        }
        db.Add(new KnownDevice { TenantId = user.TenantId, UserId = user.Id, DeviceHash = hash, Label = label, FirstSeenAt = now, LastSeenAt = now });
        await db.SaveChangesAsync(cancellationToken);
        if (mine.Count == 0) return;
        var notifier = services.GetRequiredService<Notifier>();
        var from = http.Connection.RemoteIpAddress?.ToString();
        notifier.Queue(user.TenantId, null, EmailKinds.Account, user.Email, user.Name, "New sign-in to your DELIOS account",
            $"Your DELIOS account ({user.Email}) was signed in to from a browser it had not been used from before.\n\n"
            + $"When: {now.InUtc():yyyy-MM-dd HH:mm} UTC\nBrowser: {label}{(from is null ? "" : $"\nFrom: {from}")}\n\n"
            + "If this was you, there is nothing to do.\n"
            + $"If it was not, change your password now: {notifier.Url("/forgot-password")}\n"
            + "and turn on two-step sign-in under Your sign-in.",
            "User", user.Id);
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>Which browser on which system, read from the user agent.</summary>
    public static string Label(string agent)
    {
        var browser = agent.Contains("Edg/") ? "Edge" : agent.Contains("Chrome/") ? "Chrome" : agent.Contains("Firefox/") ? "Firefox"
            : agent.Contains("Safari/") ? "Safari" : "A browser";
        var system = agent.Contains("Windows") ? "Windows" : agent.Contains("Android") ? "Android"
            : agent.Contains("iPhone") || agent.Contains("iPad") ? "iPhone or iPad" : agent.Contains("Mac OS") ? "Mac"
            : agent.Contains("Linux") ? "Linux" : null;
        return system is null ? browser : $"{browser} on {system}";
    }
}
