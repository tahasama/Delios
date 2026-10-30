using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Operators;

/// <summary>A trial's end moved (set at sign-up, changed in the console): the worker's reminder reads its next moment again.</summary>
public sealed record TrialsMoved(Guid TenantId)
{
    public const string RoutingKey = "trials.moved";
}

/// <summary>
/// Trying DELIOS: every new organization starts with a trial of the length the DELIOS team set in its console
/// (<see cref="PlatformKeys.TrialDays"/>, 30 days unless set; 0: no end). Its administrators are reminded 7 days before
/// it ends, the day before, and the day it ends, by notification and email, each pointing to Contract &amp; plan. The
/// moment of the next reminder is written by what sets the end (<see cref="Moved"/>), never looked for.
/// </summary>
public static class Trials
{
    public const int DefaultDays = 30;
    private static readonly Duration[] Before = [Duration.FromDays(7), Duration.FromDays(1), Duration.Zero];

    public static async Task<int> DaysAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var value = await db.Set<PlatformSetting>().AsNoTracking().Where(p => p.Key == PlatformKeys.TrialDays).Select(p => p.Value)
            .SingleOrDefaultAsync(cancellationToken);
        return int.TryParse(value, out var days) && days is >= 0 and <= 365 ? days : DefaultDays;
    }

    /// <summary>A new organization's trial, of the length set now.</summary>
    public static async Task StartAsync(DeliosDbContext db, Guid tenantId, Instant now, CancellationToken cancellationToken)
    {
        // Run by the organization itself: no trial (Hosting).
        if (!Hosting.ByDelios || await db.Set<Subscription>().AnyAsync(s => s.TenantId == tenantId, cancellationToken)) return;
        var days = await DaysAsync(db, cancellationToken);
        var row = new Subscription
        {
            TenantId = tenantId,
            State = SubscriptionStates.Trial,
            TrialEndsAt = days == 0 ? null : now + Duration.FromDays(days),
            UpdatedAt = now,
            UpdatedBy = "DELIOS",
        };
        db.Add(row);
        Moved(db, row);
    }

    /// <summary>A paid plan renews: its administrators are told this long before the period paid ends (as the terms say).</summary>
    public static readonly Duration RenewalNotice = Duration.FromDays(30);

    /// <summary>
    /// The next reminder: of a trial, 7 days before its end, the day before, the day it ends; of a paid plan not cancelled,
    /// once, 30 days before the period paid ends (a later period paid reminds again). Each once
    /// (<see cref="Subscription.TrialToldAt"/> is when they were last told, trial or renewal alike).
    /// </summary>
    public static Instant? NextReminder(Subscription s)
    {
        if (s.State == SubscriptionStates.Active && s.CancelledAt is null && s.PaidUntil is { } paid)
        {
            var at = paid - RenewalNotice;
            return s.TrialToldAt is { } toldRenewal && toldRenewal >= at ? null : at;
        }
        if (s.State != SubscriptionStates.Trial || s.TrialEndsAt is not { } end) return null;
        foreach (var before in Before)
        {
            var at = end - before;
            if (s.TrialToldAt is not { } told || at > told) return at;
        }
        return null;
    }

    /// <summary>Its end set or changed: the next reminder written, and the worker told, with the save.</summary>
    public static void Moved(DeliosDbContext db, Subscription s)
    {
        s.RemindAt = NextReminder(s);
        db.Add(new Messaging.OutboxMessage
        {
            RoutingKey = TrialsMoved.RoutingKey,
            Payload = System.Text.Json.JsonSerializer.Serialize(new TrialsMoved(s.TenantId)),
        });
    }

    /// <summary>What a reminder says, by how long is left.</summary>
    public static (string Title, string Body) Words(Instant end, Instant now)
    {
        var day = end.InUtc().Date.ToString("d MMMM yyyy", null);
        const string after = "Everyone keeps reading and exporting, nothing is deleted, but nobody can add or change anything.";
        const string choose = "To go on working, an administrator chooses a plan in the organization's Settings → Contract & plan.";
        if (end <= now) return ("Your DELIOS trial has ended", $"Your organization now reads only. {after} {choose}");
        var left = (int)Math.Ceiling((end - now).TotalDays);
        return (left <= 1 ? "Your DELIOS trial ends tomorrow" : $"Your DELIOS trial ends in {left} days",
            $"On {day} your organization will read only. {after} {choose}");
    }
}

/// <summary>What the renewal reminder says (owner: told by itself 30 days before, never by hand).</summary>
public static class Renewals
{
    public static (string Title, string Body) Words(Instant paidUntil, Instant now, string? plan)
    {
        var day = paidUntil.InUtc().Date.ToString("d MMMM yyyy", null);
        var left = Math.Max(0, (int)Math.Ceiling((paidUntil - now).TotalDays));
        return ($"Your DELIOS plan renews in {left} days",
            $"The period paid{(plan is null ? "" : $" on your plan {plan}")} ends on {day}. It renews for the same period unless an administrator " +
            "cancels it in the organization's Settings → Contract & plan; the invoice for the next period follows. Cancelled, everyone keeps " +
            "reading and exporting once it ends, and nothing is deleted.");
    }
}

public sealed class TrialBell
{
    private readonly SemaphoreSlim bell = new(0, 1);

    public void Ring()
    {
        try { bell.Release(); }
        catch (SemaphoreFullException) { /* already rung */ }
    }

    public Task<bool> WaitAsync(TimeSpan until, CancellationToken cancellationToken) => bell.WaitAsync(until, cancellationToken);
}

/// <summary>
/// In the worker: asleep until the next trial reminder written (<see cref="Subscription.RemindAt"/>), or until a trial's
/// end moves (<see cref="TrialsMoved"/> rings it). Each reminder goes once, then the next one is written.
/// </summary>
public sealed class TrialReminders(IServiceScopeFactory scopes, TrialBell bell, IClock clock, ILogger<TrialReminders> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                Instant? next;
                await using (var scope = scopes.CreateAsyncScope())
                {
                    var db = scope.ServiceProvider.GetRequiredService<DeliosDbContext>();
                    var now = clock.GetCurrentInstant();
                    var due = await db.Set<Subscription>().Where(s => s.RemindAt != null && s.RemindAt <= now).ToListAsync(stoppingToken);
                    foreach (var row in due)
                    {
                        var told = row.State == SubscriptionStates.Trial && row.TrialEndsAt is { } end ? Trials.Words(end, now)
                            : row.State == SubscriptionStates.Active && row.CancelledAt is null && row.PaidUntil is { } paid ? Renewals.Words(paid, now, row.Plan)
                            : default;
                        row.TrialToldAt = now;
                        row.RemindAt = Trials.NextReminder(row);
                        await db.SaveChangesAsync(stoppingToken);
                        if (told.Title is null) continue;
                        var email = await db.Set<BillingDetails>().AsNoTracking().Where(d => d.TenantId == row.TenantId).Select(d => d.Email)
                            .SingleOrDefaultAsync(stoppingToken);
                        await BillingEndpoints.TellAsync(scopes, row.TenantId, email, told.Title, told.Body, stoppingToken, "Subscription");
                    }
                    next = await db.Set<Subscription>().Where(s => s.RemindAt != null).MinAsync(s => s.RemindAt, stoppingToken);
                }
                var wait = next is { } at ? at - clock.GetCurrentInstant() : Duration.MaxValue;
                await bell.WaitAsync(wait <= Duration.Zero ? TimeSpan.Zero
                    : wait > Duration.FromDays(24) ? TimeSpan.FromDays(24) : wait.ToTimeSpan(), stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // Failed: tried again in an hour, not at once over and over.
                logger.LogWarning(e, "The trial reminders failed; trying again in an hour");
                await bell.WaitAsync(TimeSpan.FromHours(1), stoppingToken);
            }
        }
    }
}
