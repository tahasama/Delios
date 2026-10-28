using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Organizations;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Operators;

/// <summary>
/// The DELIOS team's console (<c>/api/console</c>, signed in by <see cref="OperatorAuth"/>): every organization with what
/// it has with us, what organizations ask, the plans, the legal texts and every legal matter, support access, notices to
/// every administrator, the team and its log. An organization's documents are never read here: its projects and people
/// are named only while one of its administrators lets DELIOS in (<see cref="SupportGrant"/>), each reading then written
/// in its own audit trail.
/// </summary>
public static class ConsoleEndpoints
{
    public sealed record SubscriptionRequest(string? Plan, string? State, DateOnly? TrialEndsAt, DateOnly? PaidUntil, string? Billing, int? Seats,
        string? ContractRef, DateOnly? ContractSignedOn, string? ProviderRef, string? Notes, string? Why);
    public sealed record ActiveRequest(bool Active, string? Why);
    public sealed record PlanRequest(string? Code, string? Name, decimal? PricePerUser, string? Currency, string? Notes, bool? Active);
    public sealed record PublishRequest(string? Title, string? Body, string? Note);
    public sealed record MatterRequest(string? Status, string? Note);
    public sealed record NoticeRequest(string? Title, string? Body, string? Why);
    public sealed record OrganizationRow(Guid Id, string Slug, string Name, bool Active, Instant CreatedAt, string State, string Why, bool ReadsOnly,
        string? Plan, Instant? TrialEndsAt, Instant? PaidUntil, Instant? CancelledAt, int Users, int People, int Projects, long Storage,
        Instant? LastSeen, bool SupportOpen, bool TermsToAccept);

    public static void MapConsoleEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/console").WithTags("Console").AllowAnonymous().AddEndpointFilter(OperatorAuth.Gate);
        g.MapGet("/overview", OverviewAsync);
        g.MapGet("/organizations", async (DeliosDbContext db, IServiceScopeFactory scopes, IClock clock, CancellationToken c) =>
            Results.Ok(await OrganizationsAsync(db, scopes, clock.GetCurrentInstant(), c)));
        g.MapGet("/organizations/{id:guid}", OrganizationAsync);
        g.MapPut("/organizations/{id:guid}/subscription", SetSubscriptionAsync);
        g.MapPut("/organizations/{id:guid}/active", SetActiveAsync);
        g.MapGet("/requests", RequestsAsync);
        g.MapPost("/merges/{id:guid}/carry-out", CarryOutAsync);
        g.MapGet("/plans", async (DeliosDbContext db, CancellationToken c) => Results.Ok(await PlansAsync(db, c)));
        g.MapPost("/plans", SavePlanAsync);
        g.MapGet("/legal", LegalAsync);
        g.MapGet("/legal/{kind}", LegalKindAsync);
        g.MapPost("/legal/{kind}", PublishAsync);
        g.MapPut("/matters/{key}", SetMatterAsync);
        g.MapGet("/support", SupportAsync);
        g.MapPost("/organizations/{id:guid}/enter", EnterAsync);
        g.MapGet("/platform", async (DeliosDbContext db, CancellationToken c) =>
            Results.Ok(await db.Set<PlatformSetting>().AsNoTracking().ToDictionaryAsync(p => p.Key, p => p.Value, c)));
        g.MapPut("/platform", SetPlatformAsync);
        g.MapGet("/notices", async (DeliosDbContext db, CancellationToken c) => Results.Ok(await db.Set<OperatorEvent>().AsNoTracking()
            .Where(e => e.Action == "PLATFORM_NOTICE").OrderByDescending(e => e.At).Take(100).ToListAsync(c)));
        g.MapPost("/notices", NoticeAsync);
        g.MapGet("/team", async (DeliosDbContext db, CancellationToken c) => Results.Ok(await db.Set<Operator>().AsNoTracking().OrderBy(o => o.Name)
            .Select(o => new { o.Id, o.Name, o.Email, o.Active, o.CreatedAt, o.LastSignInAt, locked = o.LockedUntil }).ToListAsync(c)));
        g.MapGet("/log", async (Guid? tenantId, string? before, DeliosDbContext db, CancellationToken c) =>
        {
            var q = db.Set<OperatorEvent>().AsNoTracking().AsQueryable();
            if (tenantId is { } t) q = q.Where(e => e.TenantId == t);
            if (NodaTime.Text.InstantPattern.ExtendedIso.Parse(before ?? "") is { Success: true } parsed)
            {
                var b = parsed.Value;
                q = q.Where(e => e.At < b);
            }
            return Results.Ok(await q.OrderByDescending(e => e.At).Take(100).ToListAsync(c));
        });
    }

    private static void Log(DeliosDbContext db, HttpContext http, string action, Guid? tenantId, string? detail, IClock clock)
    {
        var who = http.Current();
        db.Add(new OperatorEvent
        {
            OperatorId = who.Id, OperatorName = who.Name, Action = action, TenantId = tenantId,
            Detail = detail is { Length: > 4000 } ? detail[..4000] : detail, At = clock.GetCurrentInstant(),
        });
    }

    /// <summary>Every organization with its standing and its counts: each counted under its own row-level security.</summary>
    public static async Task<List<OrganizationRow>> OrganizationsAsync(DeliosDbContext db, IServiceScopeFactory scopes, Instant now,
        CancellationToken cancellationToken)
    {
        var tenants = await db.Tenants.AsNoTracking().OrderBy(t => t.Name).ToListAsync(cancellationToken);
        var subs = await db.Set<Subscription>().AsNoTracking().ToDictionaryAsync(s => s.TenantId, cancellationToken);
        var open = await db.Set<SupportGrant>().AsNoTracking().Where(s => s.EndedAt == null && s.Until > now).Select(s => s.TenantId)
            .ToListAsync(cancellationToken);
        var latest = await ContractEndpoints.LatestAsync(db, cancellationToken);
        var accepted = await db.Set<LegalAcceptance>().AsNoTracking().GroupBy(a => new { a.TenantId, a.Kind })
            .Select(x => new { x.Key.TenantId, x.Key.Kind, Version = x.Max(a => a.Version) }).ToListAsync(cancellationToken);
        var rows = new List<OrganizationRow>();
        foreach (var t in tenants)
        {
            var counts = await TenantScope.RunAsync(scopes, t.Id, async (_, there) => new
            {
                Users = await Subscriptions.Paid(there, t.Id).CountAsync(cancellationToken),
                People = await there.Users.CountAsync(u => u.TenantId == t.Id && u.Active, cancellationToken),
                Projects = await there.Projects.CountAsync(p => p.TenantId == t.Id, cancellationToken),
                Storage = await there.StoredFiles.Where(f => f.TenantId == t.Id).SumAsync(f => (long?)f.Size, cancellationToken) ?? 0,
                LastSeen = await there.PeopleSeen.Where(p => p.TenantId == t.Id).MaxAsync(p => p.LastAt, cancellationToken),
            }, cancellationToken);
            var sub = subs.GetValueOrDefault(t.Id);
            var standing = Subscriptions.Effective(sub, now);
            var toAccept = ContractEndpoints.ToAccept.Any(k =>
                (accepted.FirstOrDefault(a => a.TenantId == t.Id && a.Kind == k)?.Version ?? -1) < (latest.GetValueOrDefault(k)?.Version ?? 0));
            rows.Add(new(t.Id, t.Slug, t.Name, t.Active, t.CreatedAt, standing.State, standing.Why, standing.ReadsOnly, sub?.Plan, sub?.TrialEndsAt,
                sub?.PaidUntil, sub?.CancelledAt, counts.Users, counts.People, counts.Projects, counts.Storage, counts.LastSeen, open.Contains(t.Id),
                toAccept));
        }
        return rows;
    }

    private static async Task<IResult> OverviewAsync(DeliosDbContext db, IServiceScopeFactory scopes, IClock clock, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var orgs = await OrganizationsAsync(db, scopes, now, cancellationToken);
        var states = await db.Set<LegalMatterState>().AsNoTracking().ToDictionaryAsync(m => m.Key, cancellationToken);
        var mustOpen = LegalMatters.All.Count(m => m.Must && states.GetValueOrDefault(m.Key)?.Status is null or MatterStates.ToDo or MatterStates.Placeholder
            or MatterStates.WithLawyer);
        return Results.Ok(new
        {
            organizations = orgs.Count,
            byState = SubscriptionStates.All.ToDictionary(s => s, s => orgs.Count(o => o.State == s)),
            users = orgs.Sum(o => o.Users),
            people = orgs.Sum(o => o.People),
            projects = orgs.Sum(o => o.Projects),
            storage = orgs.Sum(o => o.Storage),
            productRequests = await db.Set<ProductRequest>().CountAsync(cancellationToken),
            mergesToCarryOut = await db.OrganizationMerges.CountAsync(m => m.State == MergeStates.Agreed, cancellationToken),
            claimsWaiting = await db.OrganizationClaims.CountAsync(c => c.State == ClaimStates.Waiting, cancellationToken),
            supportOpen = orgs.Count(o => o.SupportOpen),
            legalMustOpen = mustOpen,
            legalMust = LegalMatters.All.Count(m => m.Must),
            renewingSoon = (await db.Set<Subscription>().AsNoTracking().Where(s => s.State == SubscriptionStates.Active && s.CancelledAt == null
                && s.PaidUntil != null && s.PaidUntil > now && s.PaidUntil <= now + Duration.FromDays(30)).CountAsync(cancellationToken)),
        });
    }

    private static async Task<IResult> OrganizationAsync(Guid id, HttpContext http, DeliosDbContext db, IServiceScopeFactory scopes, IClock clock,
        CancellationToken cancellationToken)
    {
        var tenant = await db.Tenants.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (tenant is null) return Problems.NotFound("NO_SUCH_ORGANIZATION", "No such organization.");
        var now = clock.GetCurrentInstant();
        var row = (await OrganizationsAsync(db, scopes, now, cancellationToken)).Single(o => o.Id == id);
        var sub = await db.Set<Subscription>().AsNoTracking().SingleOrDefaultAsync(s => s.TenantId == id, cancellationToken);
        var grants = await db.Set<SupportGrant>().AsNoTracking().Where(g => g.TenantId == id).OrderByDescending(g => g.From).ToListAsync(cancellationToken);
        var open = grants.FirstOrDefault(g => g.EndedAt == null && g.Until > now);
        var acceptances = await db.Set<LegalAcceptance>().AsNoTracking().Where(a => a.TenantId == id).OrderByDescending(a => a.At).ToListAsync(cancellationToken);
        var requests = await db.Set<ProductRequest>().AsNoTracking().Where(r => r.TenantId == id).OrderByDescending(r => r.At).ToListAsync(cancellationToken);
        var who = http.Current();
        // Administrators are named always (who to talk to about the contract); projects and people only while DELIOS is let in.
        var inside = await TenantScope.RunAsync(scopes, id, async (services, there) =>
        {
            var admins = await there.Users.AsNoTracking().Where(u => u.TenantId == id && u.IsAdmin && u.Active && u.HomeTenantId == null)
                .OrderBy(u => u.Name).Select(u => new { u.Name, u.Email }).ToListAsync(cancellationToken);
            if (open is null) return new { admins = (object)admins, projects = (object?)null, people = (object?)null };
            var projects = await there.Projects.AsNoTracking().Where(p => p.TenantId == id).OrderBy(p => p.Code)
                .Select(p => new { p.Code, p.Name, p.Status, members = there.Memberships.Count(m => m.ProjectId == p.Id && m.Active) })
                .ToListAsync(cancellationToken);
            var people = await there.Users.AsNoTracking().Where(u => u.TenantId == id).OrderBy(u => u.Name)
                .Select(u => new { u.Name, u.Email, u.IsAdmin, u.Active, guest = u.Party != null && !u.Party.IsInternal, linked = u.HomeTenantId != null })
                .ToListAsync(cancellationToken);
            await services.GetRequiredService<AuditLog>().WriteAsync(new Actor(null, $"DELIOS support: {who.Name}"), "SUPPORT_READ", "SupportGrant", open.Id,
                "Projects and people", $"Read under the access {open.GrantedByName} granted: {open.Why}", cancellationToken: cancellationToken);
            return new { admins = (object)admins, projects = (object?)projects, people = (object?)people };
        }, cancellationToken);
        return Results.Ok(new
        {
            organization = row, subscription = sub, inside.admins, inside.projects, inside.people, support = grants,
            supportOpen = open is not null, acceptances, requests,
            log = await db.Set<OperatorEvent>().AsNoTracking().Where(e => e.TenantId == id).OrderByDescending(e => e.At).Take(50).ToListAsync(cancellationToken),
        });
    }

    private static async Task<IResult> SetSubscriptionAsync(Guid id, SubscriptionRequest request, HttpContext http, DeliosDbContext db, IClock clock,
        CancellationToken cancellationToken)
    {
        var why = request.Why?.Trim() ?? "";
        if (why.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it changes.", new { field = "why" });
        if (!await db.Tenants.AnyAsync(t => t.Id == id, cancellationToken)) return Problems.NotFound("NO_SUCH_ORGANIZATION", "No such organization.");
        var state = request.State?.Trim().ToUpperInvariant() ?? SubscriptionStates.Trial;
        if (!SubscriptionStates.All.Contains(state)) return Problems.Invalid("STATE_UNKNOWN", "No such state.", new { field = "state" });
        var billing = string.IsNullOrWhiteSpace(request.Billing) ? null : request.Billing.Trim().ToUpperInvariant();
        if (billing is not null && !BillingWays.All.Contains(billing)) return Problems.Invalid("BILLING_UNKNOWN", "By card or on invoice.", new { field = "billing" });
        var plan = string.IsNullOrWhiteSpace(request.Plan) ? null : request.Plan.Trim().ToUpperInvariant();
        if (plan is not null && !await db.Set<Plan>().AnyAsync(p => p.Code == plan, cancellationToken))
            return Problems.Invalid("PLAN_UNKNOWN", "No such plan.", new { field = "plan" });
        if (request.Seats is < 0) return Problems.Invalid("SEATS_NEGATIVE", "Users cannot be fewer than none.", new { field = "seats" });
        var row = await db.Set<Subscription>().SingleOrDefaultAsync(s => s.TenantId == id, cancellationToken);
        var before = row is null ? "none" : $"{row.State} {row.Plan} paid until {row.PaidUntil}";
        if (row is null) db.Add(row = new Subscription { TenantId = id });
        row.Plan = plan;
        row.State = state;
        row.TrialEndsAt = EndOf(request.TrialEndsAt);
        row.PaidUntil = EndOf(request.PaidUntil);
        row.Billing = billing;
        row.Seats = request.Seats;
        row.ContractRef = Clip(request.ContractRef, 100);
        row.ContractSignedOn = request.ContractSignedOn is { } signed ? LocalDate.FromDateOnly(signed) : null;
        row.ProviderRef = Clip(request.ProviderRef, 200);
        row.Notes = Clip(request.Notes, 4000);
        row.UpdatedAt = clock.GetCurrentInstant();
        row.UpdatedBy = http.Current().Name;
        Log(db, http, "SUBSCRIPTION_SET", id, $"{before} → {state} {plan} paid until {request.PaidUntil}. Why: {why}", clock);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> SetActiveAsync(Guid id, ActiveRequest request, HttpContext http, DeliosDbContext db, IClock clock,
        CancellationToken cancellationToken)
    {
        var why = request.Why?.Trim() ?? "";
        if (why.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why.", new { field = "why" });
        var tenant = await db.Tenants.SingleOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (tenant is null) return Problems.NotFound("NO_SUCH_ORGANIZATION", "No such organization.");
        tenant.Active = request.Active;
        Log(db, http, request.Active ? "ORGANIZATION_SWITCHED_ON" : "ORGANIZATION_SWITCHED_OFF", id, why, clock);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> RequestsAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var merges = await db.OrganizationMerges.AsNoTracking().OrderByDescending(m => m.RequestedAt).Take(200).ToListAsync(cancellationToken);
        var claims = await db.OrganizationClaims.AsNoTracking().OrderByDescending(c => c.CreatedAt).Take(200).ToListAsync(cancellationToken);
        var ids = merges.SelectMany(m => new[] { m.KeepId, m.MergeId }).Concat(claims.SelectMany(c => new[] { c.EntryId, c.ClaimerIdentityId })).Distinct().ToList();
        var names = await db.OrganizationIdentities.AsNoTracking().Where(o => ids.Contains(o.Id))
            .ToDictionaryAsync(o => o.Id, o => $"{o.Name} ({o.Code})", cancellationToken);
        string Name(Guid g) => names.GetValueOrDefault(g) ?? "an organization no longer listed";
        return Results.Ok(new
        {
            products = await db.Set<ProductRequest>().AsNoTracking().OrderByDescending(r => r.At).Take(200).ToListAsync(cancellationToken),
            merges = merges.Select(m => new { m.Id, keep = Name(m.KeepId), merge = Name(m.MergeId), m.RequestedByName, m.Why, m.RequestedAt, m.State,
                m.RefusedByName, m.RefusedWhy, m.AnsweredAt, m.DoneAt }),
            claims = claims.Select(c => new { c.Id, entry = Name(c.EntryId), claimer = Name(c.ClaimerIdentityId), c.ClaimedByName, c.Method, c.State,
                c.CreatedAt, c.AnsweredAt, c.AnsweredByName, c.RefusedWhy }),
        });
    }

    /// <summary>Carries out a merge every side agreed to, as the backend command <c>merge-organizations</c> does.</summary>
    private static async Task<IResult> CarryOutAsync(Guid id, HttpContext http, DeliosDbContext db, MergeOrganizations merges, IClock clock,
        CancellationToken cancellationToken)
    {
        var said = await merges.RunAsync(id.ToString(), cancellationToken);
        if (said.StartsWith("No such") || said.StartsWith("One of")) return Problems.Conflict("MERGE_NOT_READY", said);
        Log(db, http, "MERGE_CARRIED_OUT", null, said, clock);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { said });
    }

    private static async Task<object> PlansAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var used = await db.Set<Subscription>().AsNoTracking().Where(s => s.Plan != null).GroupBy(s => s.Plan!)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, cancellationToken);
        return (await db.Set<Plan>().AsNoTracking().OrderBy(p => p.Code).ToListAsync(cancellationToken))
            .Select(p => new { p.Code, p.Name, p.PricePerUser, p.Currency, p.Notes, p.Active, organizations = used.GetValueOrDefault(p.Code) });
    }

    /// <summary>A plan is added, or changed by its code (which never changes: the contracts carry it).</summary>
    private static async Task<IResult> SavePlanAsync(PlanRequest request, HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var code = request.Code?.Trim().ToUpperInvariant() ?? "";
        var name = request.Name?.Trim() ?? "";
        if (code.Length is 0 or > 32 || !code.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '_' or '-'))
            return Problems.Invalid("CODE_REQUIRED", "A short code: letters, digits, - or _.", new { field = "code" });
        if (name.Length == 0) return Problems.Invalid("NAME_REQUIRED", "Name the plan.", new { field = "name" });
        if (request.PricePerUser is < 0) return Problems.Invalid("PRICE_NEGATIVE", "A price is not below zero.", new { field = "pricePerUser" });
        var currency = (request.Currency ?? "EUR").Trim().ToUpperInvariant();
        if (currency.Length != 3) return Problems.Invalid("CURRENCY", "A currency's three letters (EUR, USD, GBP).", new { field = "currency" });
        var plan = await db.Set<Plan>().SingleOrDefaultAsync(p => p.Code == code, cancellationToken);
        var isNew = plan is null;
        if (plan is null) db.Add(plan = new Plan { Code = code, Name = name });
        plan.Name = name;
        plan.PricePerUser = request.PricePerUser;
        plan.Currency = currency;
        plan.Notes = Clip(request.Notes, 2000);
        plan.Active = request.Active ?? true;
        Log(db, http, isNew ? "PLAN_CREATED" : "PLAN_CHANGED", null, $"{code}: {name}, {request.PricePerUser} {currency} per user a month", clock);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> LegalAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var latest = await ContractEndpoints.LatestAsync(db, cancellationToken);
        var states = await db.Set<LegalMatterState>().AsNoTracking().ToDictionaryAsync(m => m.Key, cancellationToken);
        var accepted = await db.Set<LegalAcceptance>().AsNoTracking().GroupBy(a => new { a.Kind, a.Version })
            .Select(g => new { g.Key.Kind, g.Key.Version, Organizations = g.Select(a => a.TenantId).Distinct().Count() }).ToListAsync(cancellationToken);
        var organizations = await db.Tenants.CountAsync(cancellationToken);
        return Results.Ok(new
        {
            texts = LegalKinds.All.Select(k =>
            {
                var text = ContractEndpoints.TextOf(k, latest.GetValueOrDefault(k.Code));
                return new
                {
                    text.Kind, text.Slug, text.Title, text.Lead, text.Version, text.PublishedAt, text.Placeholder, k.Accepted,
                    lawyerParts = text.Body.Split("[[LAWYER").Length - 1,
                    acceptedBy = accepted.Where(a => a.Kind == k.Code && a.Version == text.Version).Sum(a => a.Organizations),
                };
            }),
            organizations,
            groups = new[] { LegalMatters.BeforeFirst, LegalMatters.Running, LegalMatters.Growing },
            matters = LegalMatters.All.Select(m =>
            {
                var s = states.GetValueOrDefault(m.Key);
                var text = m.Text is { } kind ? ContractEndpoints.TextOf(LegalKinds.Of(kind)!, latest.GetValueOrDefault(kind)) : null;
                return new
                {
                    m.Key, m.Group, m.Must, m.Title, m.What, text = m.Text, textSlug = m.Text is null ? null : LegalKinds.Of(m.Text)!.Slug,
                    textVersion = text?.Version, textPlaceholder = text?.Placeholder,
                    status = s?.Status ?? (text is { Version: 0 } || text?.Placeholder == true ? MatterStates.Placeholder : MatterStates.ToDo),
                    set = s is not null, note = s?.Note, s?.UpdatedAt, s?.UpdatedBy,
                };
            }),
        });
    }

    private static async Task<IResult> LegalKindAsync(string kind, DeliosDbContext db, CancellationToken cancellationToken)
    {
        if (LegalKinds.Of(kind) is not { } k) return Problems.NotFound("NO_SUCH_TEXT", "There is no such text.");
        var versions = await db.Set<LegalDocument>().AsNoTracking().Where(d => d.Kind == k.Code).OrderByDescending(d => d.Version).ToListAsync(cancellationToken);
        return Results.Ok(new
        {
            current = ContractEndpoints.TextOf(k, versions.FirstOrDefault()),
            versions = versions.Select(v => new { v.Version, v.Title, v.Note, v.PublishedAt, v.PublishedBy,
                acceptedBy = db.Set<LegalAcceptance>().Where(a => a.Kind == k.Code && a.Version == v.Version).Select(a => a.TenantId).Distinct().Count() }),
            k.Accepted,
        });
    }

    /// <summary>
    /// A new version, never an old one changed. A text organizations accept is announced to every administrator, who
    /// accepts it from their organization's Settings → Contract &amp; plan.
    /// </summary>
    private static async Task<IResult> PublishAsync(string kind, PublishRequest request, HttpContext http, DeliosDbContext db, IServiceScopeFactory scopes,
        IClock clock, CancellationToken cancellationToken)
    {
        if (LegalKinds.Of(kind) is not { } k) return Problems.NotFound("NO_SUCH_TEXT", "There is no such text.");
        var title = request.Title?.Trim() ?? "";
        var body = request.Body?.Trim() ?? "";
        if (title.Length is 0 or > 200) return Problems.Invalid("TITLE_REQUIRED", "A title, up to 200 characters.", new { field = "title" });
        if (body.Length == 0) return Problems.Invalid("BODY_REQUIRED", "The text itself.", new { field = "body" });
        if (body.Length > 200_000) return Problems.Invalid("TOO_LONG", "Keep it under 200,000 characters.", new { field = "body" });
        var last = await db.Set<LegalDocument>().Where(d => d.Kind == k.Code).MaxAsync(d => (int?)d.Version, cancellationToken) ?? 0;
        var now = clock.GetCurrentInstant();
        var note = Clip(request.Note, 2000);
        db.Add(new LegalDocument { Kind = k.Code, Version = last + 1, Title = title, Body = body, Note = note, PublishedAt = now, PublishedBy = http.Current().Name });
        Log(db, http, "LEGAL_PUBLISHED", null, $"{k.Title}, version {last + 1}{(note is null ? "" : $": {note}")}", clock);
        await db.SaveChangesAsync(cancellationToken);
        if (k.Accepted) await TellAdministratorsAsync(db, scopes, $"New {k.Title.ToLowerInvariant()} to accept",
            $"Version {last + 1} of DELIOS's {k.Title.ToLowerInvariant()} was published{(note is null ? "." : $": {note}")} One of you accepts it in the organization's Settings → Contract & plan.",
            "/organization/settings/contract", cancellationToken);
        return Results.Ok(new { version = last + 1 });
    }

    private static async Task<IResult> SetMatterAsync(string key, MatterRequest request, HttpContext http, DeliosDbContext db, IClock clock,
        CancellationToken cancellationToken)
    {
        var matter = LegalMatters.All.FirstOrDefault(m => m.Key == key);
        if (matter is null) return Problems.NotFound("NO_SUCH_MATTER", "No such legal matter.");
        var status = request.Status?.Trim().ToUpperInvariant() ?? "";
        if (!MatterStates.All.Contains(status)) return Problems.Invalid("STATUS_UNKNOWN", "No such state.", new { field = "status" });
        if (status == MatterStates.NotNeeded && matter.Must)
            return Problems.Invalid("MUST_STAYS", "This one is a must: it cannot be marked not needed.", new { field = "status" });
        var row = await db.Set<LegalMatterState>().SingleOrDefaultAsync(m => m.Key == key, cancellationToken);
        var before = row?.Status ?? "unset";
        if (row is null) db.Add(row = new LegalMatterState { Key = key });
        row.Status = status;
        row.Note = Clip(request.Note, 4000);
        row.UpdatedAt = clock.GetCurrentInstant();
        row.UpdatedBy = http.Current().Name;
        Log(db, http, "LEGAL_MATTER_SET", null, $"{matter.Title}: {before} → {status}", clock);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> SupportAsync(DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var grants = await db.Set<SupportGrant>().AsNoTracking().OrderByDescending(g => g.From).Take(300).ToListAsync(cancellationToken);
        var ids = grants.Select(g => g.TenantId).Distinct().ToList();
        var names = await db.Tenants.AsNoTracking().Where(t => ids.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Name, cancellationToken);
        return Results.Ok(grants.Select(g => new
        {
            g.Id, g.TenantId, organization = names.GetValueOrDefault(g.TenantId), g.GrantedByName, g.Why, g.From, g.Until, g.EndedAt, g.EndedByName,
            open = g.EndedAt == null && g.Until > now,
        }));
    }

    public sealed record PlatformRequest(string? SupportEmail, string? SupportHours, string? SupportPhone);

    /// <summary>How organizations reach DELIOS support: shown on their Contract &amp; plan, on Help and wherever something went wrong.</summary>
    private static async Task<IResult> SetPlatformAsync(PlatformRequest request, HttpContext http, DeliosDbContext db, IClock clock,
        CancellationToken cancellationToken)
    {
        var email = request.SupportEmail?.Trim() ?? "";
        if (email.Length > 0 && (!email.Contains('@') || email.Length > 254))
            return Problems.Invalid("EMAIL_INVALID", "An email address.", new { field = "supportEmail" });
        var values = new Dictionary<string, string?>
        {
            [PlatformKeys.SupportEmail] = email, [PlatformKeys.SupportHours] = request.SupportHours?.Trim(), [PlatformKeys.SupportPhone] = request.SupportPhone?.Trim(),
        };
        var now = clock.GetCurrentInstant();
        foreach (var (key, value) in values)
        {
            var row = await db.Set<PlatformSetting>().SingleOrDefaultAsync(p => p.Key == key, cancellationToken);
            if (string.IsNullOrWhiteSpace(value)) { if (row is not null) db.Remove(row); continue; }
            if (row is null) db.Add(row = new PlatformSetting { Key = key, Value = "" });
            row.Value = value.Length > 1000 ? value[..1000] : value;
            row.UpdatedAt = now;
            row.UpdatedBy = http.Current().Name;
        }
        Log(db, http, "SUPPORT_CONTACT_SET", null, $"{email} · {request.SupportHours} · {request.SupportPhone}", clock);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// The operator enters the organization as one of its administrators while it lets DELIOS in (owner: "we would be just
    /// like an admin and that's it, and we inform them, and their trail will show them what happened"): an account of its
    /// own, "DELIOS support: …", made or switched on, its session ending with the access at the latest. Its
    /// administrators are told now; every act is in their audit trail under that name.
    /// </summary>
    private static async Task<IResult> EnterAsync(Guid id, HttpContext http, DeliosDbContext db, IServiceScopeFactory scopes, IClock clock,
        CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var grant = await db.Set<SupportGrant>().AsNoTracking()
            .Where(g => g.TenantId == id && g.EndedAt == null && g.Until > now).OrderByDescending(g => g.Until).FirstOrDefaultAsync(cancellationToken);
        if (grant is null) return Problems.Forbidden("NOT_LET_IN", "This organization does not let DELIOS in now: one of its administrators grants it from Contract & plan.");
        var who = http.Current();
        var (token, expires) = await TenantScope.RunAsync(scopes, id, async (services, there) =>
        {
            var email = $"support-{who.Id:N}@delios.invalid";
            var normalized = email.ToUpperInvariant();
            var user = await there.Users.SingleOrDefaultAsync(u => u.TenantId == id && u.NormalizedEmail == normalized, cancellationToken);
            if (user is null)
            {
                user = new User { TenantId = id, Email = email, NormalizedEmail = normalized, Name = "", PasswordHash = "", IsSupport = true };
                there.Users.Add(user);
            }
            user.Name = $"DELIOS support: {who.Name}";
            user.IsAdmin = true;
            user.IsSupport = true;
            user.Active = true;
            await there.SaveChangesAsync(cancellationToken);
            var admins = await there.Users.AsNoTracking().Where(u => u.TenantId == id && u.IsAdmin && u.Active && !u.IsSupport && u.HomeTenantId == null)
                .Select(u => u.Id).ToListAsync(cancellationToken);
            await services.GetRequiredService<Notifications.Notifier>().NotifyAsync(id, null, admins, "PLATFORM", $"DELIOS support is in: {who.Name}",
                $"{who.Name} of DELIOS entered as an administrator, under the access {grant.GrantedByName} granted until {grant.Until:yyyy-MM-dd HH:mm} UTC: {grant.Why}. "
                + "Everything done is in the audit trail under \"DELIOS support\". End it whenever you want in Settings → Contract & plan.",
                "/organization/settings/contract", cancellationToken);
            await services.GetRequiredService<AuditLog>().WriteAsync(new Actor(user.Id, user.Name), "SUPPORT_ENTERED", "SupportGrant", grant.Id,
                $"Until {grant.Until:yyyy-MM-dd HH:mm} UTC", grant.Why, cancellationToken: cancellationToken);
            var (t, e) = await services.GetRequiredService<SessionStore>().CreateAsync(user, cancellationToken);
            return (t, e < grant.Until ? e : grant.Until);
        }, cancellationToken);
        Log(db, http, "SUPPORT_ENTERED", id, $"Under {grant.GrantedByName}'s access: {grant.Why}", clock);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { token, expires });
    }

    private static async Task<IResult> NoticeAsync(NoticeRequest request, HttpContext http, DeliosDbContext db, IServiceScopeFactory scopes, IClock clock,
        CancellationToken cancellationToken)
    {
        var title = request.Title?.Trim() ?? "";
        var body = request.Body?.Trim() ?? "";
        if (title.Length is 0 or > 200) return Problems.Invalid("TITLE_REQUIRED", "What it is about, up to 200 characters.", new { field = "title" });
        if (body.Length is 0 or > 2000) return Problems.Invalid("BODY_REQUIRED", "What it says, up to 2,000 characters.", new { field = "body" });
        var told = await TellAdministratorsAsync(db, scopes, title, body, null, cancellationToken);
        Log(db, http, "PLATFORM_NOTICE", null, $"{title}\n\n{body}\n\nTold {told} administrator(s).", clock);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { told });
    }

    /// <summary>Every active organization's administrators are told, by notification and email, each under their own organization.</summary>
    private static async Task<int> TellAdministratorsAsync(DeliosDbContext db, IServiceScopeFactory scopes, string title, string body, string? link,
        CancellationToken cancellationToken)
    {
        var tenants = await db.Tenants.AsNoTracking().Where(t => t.Active).Select(t => t.Id).ToListAsync(cancellationToken);
        var told = 0;
        foreach (var id in tenants)
            told += await TenantScope.RunAsync(scopes, id, async (services, there) =>
            {
                var admins = await there.Users.AsNoTracking().Where(u => u.TenantId == id && u.IsAdmin && u.Active && u.HomeTenantId == null)
                    .Select(u => u.Id).ToListAsync(cancellationToken);
                await services.GetRequiredService<Notifications.Notifier>().NotifyAsync(id, null, admins, "PLATFORM", title, body, link, cancellationToken);
                return admins.Count;
            }, cancellationToken);
        return told;
    }

    /// <summary>A day typed on a form: until its last moment, UTC.</summary>
    private static Instant? EndOf(DateOnly? day) =>
        day is { } d ? Instant.FromDateTimeOffset(new DateTimeOffset(d.ToDateTime(new TimeOnly(23, 59, 59)), TimeSpan.Zero)) : null;

    private static string? Clip(string? text, int max) =>
        string.IsNullOrWhiteSpace(text) ? null : text.Trim() is var t && t.Length > max ? t[..max] : text.Trim();
}
