using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Operators;

/// <summary>
/// What an organization has with us, as it applies today: read when looked at, never kept fresh by a clock. A trial past
/// its end, or a payment more than <see cref="GraceDays"/> days late, reads only: everyone reads and exports, nobody adds or
/// changes, nothing is deleted.
/// </summary>
public static class Subscriptions
{
    public const int GraceDays = 14;
    public sealed record Standing(string State, string Why, bool ReadsOnly);

    public static Standing Effective(Subscription? s, Instant now)
    {
        // Run by the organization itself: no plan, payment or trial; it simply works.
        if (!Hosting.ByDelios) return new(SubscriptionStates.Active, "Run by the organization itself.", false);
        // No contract recorded yet: it works as it always did, trying DELIOS with no end set.
        if (s is null) return new(SubscriptionStates.Trial, "Trying DELIOS, no end set.", false);
        switch (s.State)
        {
            case SubscriptionStates.Ended:
                return new(SubscriptionStates.Ended, "The contract ended: the data is handed back, then deleted after the agreed time.", true);
            case SubscriptionStates.ReadOnly:
                return new(SubscriptionStates.ReadOnly, "Set to read only by DELIOS.", true);
            case SubscriptionStates.Trial when s.TrialEndsAt is { } end && end <= now:
                return new(SubscriptionStates.ReadOnly, "The trial ended: choose a plan to go on working.", true);
            case SubscriptionStates.Trial:
                return new(SubscriptionStates.Trial, s.TrialEndsAt is { } ends
                    ? $"Trying DELIOS for free until {ends.InUtc().Date.ToString("d MMMM yyyy", null)}." : "Trying DELIOS, no end set.", false);
        }
        if (s.PaidUntil is { } paid)
        {
            if (s.CancelledAt is not null && paid <= now)
                return new(SubscriptionStates.ReadOnly, "Cancelled: it ended with the period paid.", true);
            if (paid + Duration.FromDays(GraceDays) <= now)
                return new(SubscriptionStates.ReadOnly, "Not paid: everyone reads and exports; nobody adds or changes until it is paid.", true);
            if (paid <= now)
                return new(SubscriptionStates.Active, $"The payment is late: it reads only {GraceDays} days after the end of the period paid.", false);
        }
        return new(SubscriptionStates.Active, s.CancelledAt is null ? "Paid." : "Cancelled: it ends with the period paid.", false);
    }

    /// <summary>The people an organization pays for: its own, working in it. Guests and accounts standing for other organizations are free.</summary>
    public static IQueryable<User> Paid(DeliosDbContext db, Guid tenantId) =>
        db.Users.Where(u => u.TenantId == tenantId && u.Active && !u.IsSupport && u.HomeTenantId == null && (u.Party == null || u.Party.IsInternal));

    /// <summary>
    /// A signed-in person of an organization that reads only: anything but reading is refused, except signing in and out,
    /// their own notifications, and what puts the contract right.
    /// </summary>
    public static async Task ReadOnlyGateAsync(HttpContext http, Func<Task> next)
    {
        if (HttpMethods.IsGet(http.Request.Method) || HttpMethods.IsHead(http.Request.Method) || http.User.Identity?.IsAuthenticated != true
            || Allowed.Any(p => http.Request.Path.StartsWithSegments(p)))
        {
            await next();
            return;
        }
        var db = http.RequestServices.GetRequiredService<DeliosDbContext>();
        var tenantId = http.User.TenantId();
        var row = await db.Set<Subscription>().AsNoTracking().SingleOrDefaultAsync(s => s.TenantId == tenantId, http.RequestAborted);
        var standing = Effective(row, http.RequestServices.GetRequiredService<IClock>().GetCurrentInstant());
        if (!standing.ReadsOnly)
        {
            await next();
            return;
        }
        await Problems.Forbidden("READ_ONLY",
            $"Your organization reads only: {standing.Why} Everyone keeps reading and exporting; nothing is deleted. An administrator puts it right in the organization's Settings → Contract & plan.")
            .ExecuteAsync(http);
    }

    private static readonly string[] Allowed =
        ["/api/auth", "/api/organization/contract", "/api/organization/support", "/api/notifications", "/api/push", "/api/legal", "/api/console", "/api/screens", "/api/support"];
}

/// <summary>
/// The legal texts, read by anyone (<c>/api/legal</c>: the sign-in and sign-up pages link them), and what an organization
/// has with us, read and answered by its administrators (<c>/api/organization/contract</c>, <c>/api/organization/support</c>).
/// </summary>
public static class ContractEndpoints
{
    public sealed record LegalListed(string Kind, string Slug, string Title, string Lead, bool Accepted, int Version, Instant? PublishedAt);
    public sealed record LegalText(string Kind, string Slug, string Title, string Lead, int Version, Instant? PublishedAt, string Body, string? Note,
        bool Placeholder);
    public sealed record AcceptRequest(string? Kind);
    public sealed record WhyRequest(string? Why);
    public sealed record GrantRequest(int? Days, string? Why);
    public sealed record PlanAskRequest(string? Plan, int? Users, string? Note);

    /// <summary>The newest version of each kind; version 0 is the text DELIOS starts from, not published yet.</summary>
    public static async Task<Dictionary<string, LegalDocument>> LatestAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var all = await db.Set<LegalDocument>().AsNoTracking().ToListAsync(cancellationToken);
        return all.GroupBy(d => d.Kind).ToDictionary(g => g.Key, g => g.OrderByDescending(d => d.Version).First());
    }

    public static LegalText TextOf(LegalKinds.Kind kind, LegalDocument? latest) => latest is null
        ? new(kind.Code, kind.Slug, kind.Title, kind.Lead, 0, null, LegalKinds.Starting(kind.Code), null, true)
        : new(kind.Code, kind.Slug, latest.Title, kind.Lead, latest.Version, latest.PublishedAt, latest.Body, latest.Note, latest.Body.Contains("[[LAWYER"));

    /// <summary>Records that a person accepted the current terms and data processing agreement for their organization (signing up, a new version).</summary>
    public static async Task AcceptAsync(DeliosDbContext db, Guid tenantId, Guid userId, string name, string email, string? address,
        IEnumerable<string> kinds, Instant now, CancellationToken cancellationToken)
    {
        var latest = await LatestAsync(db, cancellationToken);
        foreach (var kind in kinds)
            db.Add(new LegalAcceptance
            {
                TenantId = tenantId,
                UserId = userId,
                UserName = name,
                UserEmail = email,
                Kind = kind,
                Version = latest.TryGetValue(kind, out var d) ? d.Version : 0,
                At = now,
                Address = address,
            });
        await db.SaveChangesAsync(cancellationToken);
    }

    public static string[] ToAccept => [.. LegalKinds.All.Where(k => k.Accepted).Select(k => k.Code)];

    public static void MapContractEndpoints(this IEndpointRouteBuilder app)
    {
        var legal = app.MapGroup("/api/legal").WithTags("Legal").AllowAnonymous();
        legal.MapGet("", async (DeliosDbContext db, CancellationToken c) =>
        {
            var latest = await LatestAsync(db, c);
            return Results.Ok(LegalKinds.All.Select(k =>
            {
                var d = latest.GetValueOrDefault(k.Code);
                return new LegalListed(k.Code, k.Slug, d?.Title ?? k.Title, k.Lead, k.Accepted, d?.Version ?? 0, d?.PublishedAt);
            }));
        });
        // How to reach DELIOS support, for anyone (the sign-in page's trouble, Help, an error page).
        legal.MapGet("/support-contact", async (DeliosDbContext db, CancellationToken c) =>
        {
            var all = await db.Set<PlatformSetting>().AsNoTracking().ToDictionaryAsync(p => p.Key, p => p.Value, c);
            return Results.Ok(new
            {
                email = all.GetValueOrDefault(PlatformKeys.SupportEmail),
                hours = all.GetValueOrDefault(PlatformKeys.SupportHours),
                phone = all.GetValueOrDefault(PlatformKeys.SupportPhone),
            });
        });
        legal.MapGet("/{slug}", async (string slug, DeliosDbContext db, CancellationToken c) =>
        {
            if (LegalKinds.Of(slug) is not { } kind) return Problems.NotFound("NO_SUCH_TEXT", "There is no such text.");
            var latest = await LatestAsync(db, c);
            return Results.Ok(TextOf(kind, latest.GetValueOrDefault(kind.Code)));
        });

        // Whether the organization reads only, for everyone signed in: every page says so at its top.
        app.MapGet("/api/standing", async (HttpContext http, DeliosDbContext db, IClock clock, CancellationToken c) =>
        {
            var tenantId = http.User.TenantId();
            var row = await db.Set<Subscription>().AsNoTracking().SingleOrDefaultAsync(s => s.TenantId == tenantId, c);
            var standing = Subscriptions.Effective(row, clock.GetCurrentInstant());
            return Results.Ok(new { standing.State, standing.Why, standing.ReadsOnly });
        }).WithTags("Organizations");

        var admins = app.MapGroup("/api/organization").WithTags("Organizations")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter(Keepers.Configurers("An administrator answers for the organization's contract."));
        admins.MapGet("/contract", ContractAsync);
        admins.MapPost("/contract/accept", AcceptOneAsync);
        admins.MapPost("/contract/cancel", CancelAsync);
        admins.MapPost("/contract/resume", ResumeAsync);
        admins.MapPost("/contract/plan", AskPlanAsync);
        admins.MapPost("/support", GrantAsync);
        admins.MapPost("/support/{id:guid}/end", EndGrantAsync);
    }

    private static async Task<IResult> ContractAsync(HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var tenantId = http.User.TenantId();
        var now = clock.GetCurrentInstant();
        var row = await db.Set<Subscription>().AsNoTracking().SingleOrDefaultAsync(s => s.TenantId == tenantId, cancellationToken);
        var plan = row?.Plan is { } code ? await db.Set<Plan>().AsNoTracking().SingleOrDefaultAsync(p => p.Code == code, cancellationToken) : null;
        var latest = await LatestAsync(db, cancellationToken);
        var accepted = await db.Set<LegalAcceptance>().AsNoTracking().Where(a => a.TenantId == tenantId).OrderByDescending(a => a.At)
            .ToListAsync(cancellationToken);
        var texts = LegalKinds.All.Where(k => k.Accepted).Select(k =>
        {
            var version = latest.GetValueOrDefault(k.Code)?.Version ?? 0;
            var mine = accepted.Where(a => a.Kind == k.Code).Select(a => (int?)a.Version).Max();
            return new { kind = k.Code, slug = k.Slug, title = k.Title, version, acceptedVersion = mine, toAccept = mine is null || mine < version };
        }).ToList();
        var grants = await db.Set<SupportGrant>().AsNoTracking().Where(g => g.TenantId == tenantId).OrderByDescending(g => g.From)
            .Select(g => new { g.Id, g.GrantedByName, g.Why, g.From, g.Until, g.EndedAt, g.EndedByName, active = g.EndedAt == null && g.Until > now })
            .ToListAsync(cancellationToken);
        var standing = Subscriptions.Effective(row, now);
        return Results.Ok(new
        {
            state = standing.State,
            why = standing.Why,
            readsOnly = standing.ReadsOnly,
            plan = plan is null ? null : new { plan.Code, plan.Name, plan.PricePerUser, plan.Currency },
            trialEndsAt = row?.TrialEndsAt,
            paidUntil = row?.PaidUntil,
            billing = row?.Billing,
            seats = row?.Seats,
            contractRef = row?.ContractRef,
            contractSignedOn = row?.ContractSignedOn,
            cancelledAt = row?.CancelledAt,
            cancelledBy = row?.CancelledBy,
            renewsOn = row is { State: SubscriptionStates.Active, CancelledAt: null } ? row.PaidUntil : null,
            users = await Subscriptions.Paid(db, tenantId).CountAsync(cancellationToken),
            texts,
            acceptances = accepted.Select(a => new { a.Kind, a.Version, a.UserName, a.UserEmail, a.At }),
            support = grants,
            provider = (string?)null,
            plans = await db.Set<Plan>().AsNoTracking().Where(p => p.Active).OrderBy(p => p.PricePerUser)
                .Select(p => new { p.Code, p.Name, p.PricePerUser, p.Currency, p.Notes }).ToListAsync(cancellationToken),
            asked = row?.PlanAsked is null ? null : new { plan = row.PlanAsked, users = row.PlanAskedUsers, note = row.PlanAskedNote, at = row.PlanAskedAt, by = row.PlanAskedBy },
        });
    }

    /// <summary>
    /// An administrator chooses a plan and how many users: it waits for DELIOS, told by email, which sets it up and sends
    /// the first invoice. Allowed while the organization reads only: it is how it is put right.
    /// </summary>
    private static async Task<IResult> AskPlanAsync(PlanAskRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, Notifications.Notifier notifier,
        Microsoft.Extensions.Options.IOptions<Notifications.EmailOptions> email, IClock clock, CancellationToken cancellationToken)
    {
        if (!Hosting.ByDelios) return Hosting.NotHosted();
        var code = request.Plan?.Trim().ToUpperInvariant() ?? "";
        var plan = await db.Set<Plan>().AsNoTracking().SingleOrDefaultAsync(p => p.Code == code && p.Active, cancellationToken);
        if (plan is null) return Problems.Invalid("PLAN_UNKNOWN", "Choose one of the plans offered.", new { field = "plan" });
        if (request.Users is not (>= 1 and <= 100000)) return Problems.Invalid("USERS_REQUIRED", "Say how many people will work in it.", new { field = "users" });
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        if (note is { Length: > 2000 }) return Problems.Invalid("TOO_LONG", "Keep it under 2,000 characters.", new { field = "note" });
        var tenantId = http.User.TenantId();
        var now = clock.GetCurrentInstant();
        var me = await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), cancellationToken);
        var tenant = await db.Tenants.AsNoTracking().SingleAsync(t => t.Id == tenantId, cancellationToken);
        var row = await db.Set<Subscription>().SingleOrDefaultAsync(s => s.TenantId == tenantId, cancellationToken);
        if (row is null) db.Add(row = new Subscription { TenantId = tenantId, UpdatedAt = now, UpdatedBy = me.Name });
        (row.PlanAsked, row.PlanAskedUsers, row.PlanAskedNote, row.PlanAskedAt, row.PlanAskedBy) = (plan.Code, request.Users, note, now, me.Name);
        if (email.Value.DeliosAddress is { Length: > 0 } to && to.Contains('@'))
            notifier.Queue(tenantId, null, Notifications.EmailKinds.Account, to, "DELIOS", $"{tenant.Name} chose a plan: {plan.Name}",
                $"{tenant.Name} chose {plan.Name} for {request.Users} users.\n\nAsked by {me.Name} <{me.Email}>.\n\n{note ?? "No message."}\n\nSet it up in the console: Organizations → {tenant.Name}.",
                "Subscription", null, replyTo: me.Email);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "PLAN_ASKED", "Subscription", tenantId, $"{plan.Name}, {request.Users} users", note, cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> AcceptOneAsync(AcceptRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        if (LegalKinds.Of(request.Kind) is not { Accepted: true } kind) return Problems.Invalid("NOT_TO_ACCEPT", "That text is not one to accept.");
        var me = await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), cancellationToken);
        await AcceptAsync(db, me.TenantId, me.Id, me.Name, me.Email, http.Connection.RemoteIpAddress?.ToString(), [kind.Code], clock.GetCurrentInstant(),
            cancellationToken);
        var version = (await LatestAsync(db, cancellationToken)).GetValueOrDefault(kind.Code)?.Version ?? 0;
        await audit.WriteAsync(http.User.Actor(), "LEGAL_ACCEPTED", "Legal", null, $"{kind.Title}, version {version}", cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> CancelAsync(WhyRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        if (!Hosting.ByDelios) return Hosting.NotHosted();
        var tenantId = http.User.TenantId();
        var row = await db.Set<Subscription>().SingleOrDefaultAsync(s => s.TenantId == tenantId, cancellationToken);
        if (row is not { State: SubscriptionStates.Active }) return Problems.Conflict("NOTHING_TO_CANCEL", "There is no paid plan to cancel.");
        if (row.CancelledAt is not null) return Problems.Conflict("ALREADY_CANCELLED", "It is cancelled already.");
        var now = clock.GetCurrentInstant();
        row.CancelledAt = now;
        row.CancelledBy = http.User.Identity?.Name;
        // Cancelled: nothing renews, so no renewal reminder.
        Trials.Moved(db, row);
        row.UpdatedAt = now;
        row.UpdatedBy = http.User.Identity?.Name;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "SUBSCRIPTION_CANCELLED", "Subscription", tenantId, null, request.Why?.Trim(), cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> ResumeAsync(HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken cancellationToken)
    {
        if (!Hosting.ByDelios) return Hosting.NotHosted();
        var tenantId = http.User.TenantId();
        var row = await db.Set<Subscription>().SingleOrDefaultAsync(s => s.TenantId == tenantId, cancellationToken);
        if (row?.CancelledAt is null) return Problems.Conflict("NOT_CANCELLED", "It is not cancelled.");
        row.CancelledAt = null;
        row.CancelledBy = null;
        Trials.Moved(db, row);
        row.UpdatedAt = clock.GetCurrentInstant();
        row.UpdatedBy = http.User.Identity?.Name;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "SUBSCRIPTION_RESUMED", "Subscription", tenantId, cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    /// <summary>Lets the DELIOS team in to help, for 1 to 30 days, with why; every page they open is in the audit trail.</summary>
    private static async Task<IResult> GrantAsync(GrantRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        var why = request.Why?.Trim() ?? "";
        if (why.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why DELIOS is let in.", new { field = "why" });
        if (request.Days is not (>= 1 and <= 30)) return Problems.Invalid("DAYS_OUT_OF_RANGE", "From 1 to 30 days.", new { field = "days" });
        var tenantId = http.User.TenantId();
        var now = clock.GetCurrentInstant();
        if (await db.Set<SupportGrant>().AnyAsync(g => g.TenantId == tenantId && g.EndedAt == null && g.Until > now, cancellationToken))
            return Problems.Conflict("ALREADY_GRANTED", "DELIOS is already let in: end that first.");
        var grant = new SupportGrant
        {
            TenantId = tenantId,
            GrantedById = http.User.UserId(),
            GrantedByName = http.User.Identity?.Name ?? "",
            Why = why[..Math.Min(why.Length, 2000)],
            From = now,
            Until = now + Duration.FromDays(request.Days.Value),
        };
        db.Add(grant);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "SUPPORT_GRANTED", "SupportGrant", grant.Id, $"{request.Days} days", why, cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> EndGrantAsync(Guid id, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock, SessionStore sessions,
        CancellationToken cancellationToken)
    {
        var tenantId = http.User.TenantId();
        var grant = await db.Set<SupportGrant>().SingleOrDefaultAsync(g => g.Id == id && g.TenantId == tenantId, cancellationToken);
        if (grant is null) return Problems.NotFound("NO_SUCH_GRANT", "No such access.");
        if (grant.EndedAt is not null) return Results.NoContent();
        grant.EndedAt = clock.GetCurrentInstant();
        grant.EndedByName = http.User.Identity?.Name;
        // DELIOS support's accounts here stop at once, their sessions with them.
        var support = await db.Users.Where(u => u.TenantId == tenantId && u.IsSupport && u.Active).ToListAsync(cancellationToken);
        foreach (var one in support) one.Active = false;
        await db.SaveChangesAsync(cancellationToken);
        foreach (var one in support) await sessions.ForgetAllAsync(one.Id, revoke: true, cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "SUPPORT_ENDED", "SupportGrant", grant.Id, cancellationToken: cancellationToken);
        return Results.NoContent();
    }
}
