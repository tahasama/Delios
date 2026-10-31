using System.Security.Cryptography;
using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Notifications;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Organizations;

/// <summary>Body of giving our organization its identifier, or saying why it has none.</summary>
public sealed record IdentifierRequest(string? Country, string? IdentifierKind, string? IdentifierNumber, string? NoIdentifierReason);
/// <summary>Body of proving our email domain: an address of ours there, where the link goes.</summary>
public sealed record DomainRequest(string? Email);
/// <summary>Body of the domain link: its token.</summary>
public sealed record DomainTokenRequest(string? Token);
/// <summary>Body of asking for two organizations to be merged: the one kept, the one folded into it, and why.</summary>
public sealed record MergeRequest(Guid KeepId, Guid MergeId, string? Why);

/// <summary>
/// The register's meeting points with the screens: finding an organization already on DELIOS (to add it as it is); our
/// own organization as DELIOS knows it (identifier, email domain proven by a link to an address there); claiming the
/// entries others made for us before we came onto DELIOS; and merges of duplicates, asked and agreed by each side, then
/// carried out by the app's owner.
/// </summary>
public static class RegistryEndpoints
{
    private static readonly TimeSpan DomainLinkLifetime = TimeSpan.FromDays(2);

    public static void MapRegistryEndpoints(this IEndpointRouteBuilder app)
    {
        var keepers = app.MapGroup("/api/admin/organizations").WithTags("Organizations")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter(Keepers.Filter);
        keepers.MapGet("/on-delios", OnDeliosAsync);
        keepers.MapPost("/merges", AskMergeAsync);

        var admins = app.MapGroup("/api/organization").WithTags("Organizations")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter(Keepers.Configurers("An administrator answers for the organization."));
        admins.MapGet("/identity", OursAsync);
        admins.MapPut("/identity", SetOursAsync);
        admins.MapPost("/domain", SendDomainLinkAsync);
        admins.MapGet("/claims", ClaimsAsync);
        admins.MapPost("/claims/{identityId:guid}", ClaimAsync);
        admins.MapPost("/claims/incoming/{claimId:guid}/vouch", VouchAsync);
        admins.MapPost("/claims/incoming/{claimId:guid}/refuse", RefuseClaimAsync);
        admins.MapGet("/merges", MergesAsync);
        admins.MapPost("/merges/{mergeId:guid}/agree", AgreeAsync);
        admins.MapPost("/merges/{mergeId:guid}/refuse", RefuseAsync);

        app.MapPost("/api/auth/confirm-domain", ConfirmDomainAsync).WithTags("Auth").AllowAnonymous().RequireRateLimiting("sign-in");
        app.MapPost("/api/auth/confirm-claim", ConfirmClaimAsync).WithTags("Auth").AllowAnonymous().RequireRateLimiting("sign-in");
    }

    private static ITimeLimitedDataProtector Links(IDataProtectionProvider protection) =>
        protection.CreateProtector("delios.domain.confirm").ToTimeLimitedDataProtector();

    private static async Task<Actor> ActorAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var id = http.User.UserId();
        return new Actor(id, await db.Users.Where(u => u.Id == id).Select(u => u.Name).SingleAsync(cancellationToken));
    }

    /// <summary>Our own organization as DELIOS knows it: the one that is us.</summary>
    private static Task<OrganizationIdentity?> OwnAsync(DeliosDbContext db, Guid tenantId, CancellationToken cancellationToken) =>
        db.OrganizationIdentities.SingleOrDefaultAsync(o => o.TenantId == tenantId && o.MergedIntoId == null, cancellationToken);

    /// <summary>
    /// <c>GET /api/admin/organizations/on-delios?q=</c>: organizations DELIOS knows whose code or name holds the words (two
    /// letters at least, twelve at most), those with their own DELIOS and those others listed: to add one as it is.
    /// </summary>
    private static async Task<IResult> OnDeliosAsync(string? q, HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var words = q?.Trim();
        if (string.IsNullOrEmpty(words) || words.Length < 2) return Results.Ok(Array.Empty<object>());
        var me = http.User.TenantId();
        var key = Registry.Key(words);
        var listed = await db.Parties.AsNoTracking().Where(p => p.OrganizationId != null)
            .Select(p => new { Organization = p.OrganizationId!.Value, p.Id }).ToListAsync(cancellationToken);
        var found = await db.OrganizationIdentities.AsNoTracking()
            .Where(o => o.TenantId != me && o.MergedIntoId == null
                && (o.Code.Contains(key) || EF.Functions.ILike(o.Name, $"%{words}%")))
            .OrderBy(o => o.Name).Take(12).ToListAsync(cancellationToken);
        // One already in our list carries our line for it, to put it on a project.
        return Results.Ok(found.Select(o => new
        {
            o.Id,
            o.Code,
            o.Name,
            o.Country,
            Listed = listed.Any(l => l.Organization == o.Id),
            PartyId = listed.FirstOrDefault(l => l.Organization == o.Id)?.Id,
            OnDelios = o.TenantId != null,
        }));
    }

    /// <summary><c>GET /api/organization/identity</c>: ours, as DELIOS knows it.</summary>
    private static async Task<IResult> OursAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var o = await OwnAsync(db, http.User.TenantId(), cancellationToken);
        if (o is null) return Problems.NotFound("NOT_REGISTERED", "Our organization is not in DELIOS's register yet: try again in a moment.");
        return Results.Ok(new
        {
            o.Id,
            o.Code,
            o.Name,
            o.Country,
            Kind = o.IdentifierKind,
            Number = o.IdentifierNumber,
            o.NoIdentifierReason,
            IdentifierWas = o.IdentifierChangedAt is null ? null : new { Was = o.PreviousIdentifier, By = o.IdentifierChangedByName, At = o.IdentifierChangedAt.Value.ToDateTimeOffset() },
            o.Domain,
            DomainConfirmedAt = o.DomainConfirmedAt?.ToDateTimeOffset(),
        });
    }

    /// <summary><c>PUT /api/organization/identity</c>: our identifier (changed once at most), or why we have none.</summary>
    private static async Task<IResult> SetOursAsync(IdentifierRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        CancellationToken cancellationToken)
    {
        var tenantId = http.User.TenantId();
        var o = await OwnAsync(db, tenantId, cancellationToken);
        if (o is null) return Problems.NotFound("NOT_REGISTERED", "Our organization is not in DELIOS's register yet: try again in a moment.");
        var actor = await ActorAsync(http, db, cancellationToken);
        var changes = new List<string>();
        var problem = await Registry.SetIdentifierAsync(db, o, request.Country, request.IdentifierKind, request.IdentifierNumber,
            request.NoIdentifierReason, tenantId, actor.Name, changes, cancellationToken);
        if (problem is not null) return problem;
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(actor, "ORGANIZATION_IDENTIFIED", "Organization", o.Id, o.Name, string.Join("; ", changes), cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// <c>POST /api/organization/domain</c>: sends a link to an address of ours at the domain we say is ours; opening it
    /// proves it. A mail provider anyone uses is refused, and so is a domain another organization on DELIOS proved.
    /// </summary>
    private static async Task<IResult> SendDomainLinkAsync(DomainRequest request, HttpContext http, DeliosDbContext db, Notifier notifier,
        IDataProtectionProvider protection, AuditLog audit, CancellationToken cancellationToken)
    {
        var tenantId = http.User.TenantId();
        var email = request.Email?.Trim().ToLowerInvariant();
        var domain = Registry.DomainOf(email);
        if (email is null || !email.Contains('@') || domain is null)
            return Problems.Invalid("EMAIL_INVALID", "Give an address of ours at our domain, e.g. documents@our-company.com.", new { field = "email" });
        if (Registry.PublicMail.Contains(domain))
            return Problems.Invalid("PUBLIC_MAIL", $"{domain} is a mail provider anyone uses: it cannot prove who we are.", new { field = "email" });
        var o = await OwnAsync(db, tenantId, cancellationToken);
        if (o is null) return Problems.NotFound("NOT_REGISTERED", "Our organization is not in DELIOS's register yet: try again in a moment.");
        if (await db.OrganizationIdentities.AnyAsync(x => x.Id != o.Id && x.Domain == domain && x.DomainConfirmedAt != null, cancellationToken))
            return Problems.Conflict("DOMAIN_TAKEN", $"{domain} was proven by another organization on DELIOS. If it is us twice, ask for a merge.", new { field = "email" });
        var token = Links(protection).Protect($"{tenantId:N}|{domain}|{email}", DomainLinkLifetime);
        var link = notifier.Url($"/confirm-domain?token={Uri.EscapeDataString(token)}");
        notifier.Queue(tenantId, null, EmailKinds.Account, email, email, $"Confirm that {domain} is {o.Name}'s",
            $"{o.Name} says {domain} is its email domain on DELIOS. If it is, open this link within two days:\n\n{link}\n\n"
            + "If you do not know what this is, ignore this email: nothing changes without it.", "Organization", o.Id);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "DOMAIN_LINK_SENT", "Organization", o.Id, o.Name,
            $"Link to prove {domain}, sent to {email}.", cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    /// <summary><c>POST /api/auth/confirm-domain</c>: the link opened: the domain is ours, proven.</summary>
    private static async Task<IResult> ConfirmDomainAsync(DomainTokenRequest request, DeliosDbContext db, TenantContext tenant, AuditLog audit,
        IDataProtectionProvider protection, CancellationToken cancellationToken)
    {
        var invalid = Problems.Problem(StatusCodes.Status400BadRequest, "DOMAIN_LINK_INVALID", "This link has expired. Ask for a new one on the organization's page.", null);
        string[] parts;
        try { parts = Links(protection).Unprotect(request.Token ?? "").Split('|'); }
        catch (CryptographicException) { return invalid; }
        if (parts.Length != 3 || !Guid.TryParse(parts[0], out var tenantId)) return invalid;
        tenant.Set(tenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var o = await OwnAsync(db, tenantId, cancellationToken);
        if (o is null) return invalid;
        if (await db.OrganizationIdentities.AnyAsync(x => x.Id != o.Id && x.Domain == parts[1] && x.DomainConfirmedAt != null, cancellationToken))
            return Problems.Conflict("DOMAIN_TAKEN", $"{parts[1]} was proven by another organization on DELIOS meanwhile.");
        o.Domain = parts[1];
        o.DomainConfirmedAt = SystemClock.Instance.GetCurrentInstant();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(null, parts[2]), "DOMAIN_CONFIRMED", "Organization", o.Id, o.Name,
            $"{parts[1]} proven ours, by {parts[2]}.", cancellationToken: cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.Ok(new { domain = parts[1], organization = o.Name });
    }

    private static ITimeLimitedDataProtector ClaimLinks(IDataProtectionProvider protection) =>
        protection.CreateProtector("delios.organization.claim").ToTimeLimitedDataProtector();

    /// <summary>
    /// <c>GET /api/organization/claims</c>: the entries others made that look like us (same identifier, domain, or a
    /// name that reads the same) and are not on DELIOS themselves, each with where our claim on it stands; and the claims
    /// on entries we made, waiting for us to vouch.
    /// </summary>
    private static async Task<IResult> ClaimsAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var me = http.User.TenantId();
        var o = await OwnAsync(db, me, cancellationToken);
        if (o is null) return Results.Ok(new { candidates = Array.Empty<object>(), incoming = Array.Empty<object>() });
        var identifier = o.IdentifierNumber is null ? null : Registry.IdentifierValue(o.Country ?? "", o.IdentifierKind ?? "", o.IdentifierNumber);
        var alike = (await Registry.LookalikesAsync(db, o.Name, identifier, o.DomainConfirmedAt is null ? null : o.Domain, cancellationToken))
            .Where(l => !l.OnDelios && l.Id != o.Id).ToList();
        var ids = alike.Select(l => l.Id).ToList();
        var mine = await db.OrganizationClaims.AsNoTracking().Where(c => c.ClaimerTenantId == me && ids.Contains(c.EntryId))
            .OrderByDescending(c => c.CreatedAt).ToListAsync(cancellationToken);
        var incoming = await db.OrganizationClaims.AsNoTracking()
            .Where(c => c.MakerTenantId == me && c.Method == ClaimMethods.Vouch && c.State == ClaimStates.Waiting).ToListAsync(cancellationToken);
        var names = await db.OrganizationIdentities.AsNoTracking()
            .Where(x => incoming.Select(c => c.EntryId).Contains(x.Id) || incoming.Select(c => c.ClaimerIdentityId).Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, x => new { x.Code, x.Name, Identifier = x.IdentifierShown, x.Domain }, cancellationToken);
        return Results.Ok(new
        {
            candidates = alike.Select(l =>
            {
                var claim = mine.FirstOrDefault(c => c.EntryId == l.Id);
                return new { l.Id, l.Code, l.Name, l.Why, Claim = claim is null ? null : new { claim.Id, claim.State, claim.Method, claim.SentTo, claim.RefusedWhy } };
            }),
            incoming = incoming.Select(c => new
            {
                c.Id,
                c.ClaimedByName,
                CreatedAt = c.CreatedAt.ToDateTimeOffset(),
                Entry = names.GetValueOrDefault(c.EntryId),
                Claimer = names.GetValueOrDefault(c.ClaimerIdentityId),
            }),
        });
    }

    /// <summary>
    /// <c>POST /api/organization/claims/{id}</c>: that entry is us. Nothing passes yet: the guest account that stood for
    /// it is sent a link to confirm; with no guest, the organization that made it is asked to vouch.
    /// </summary>
    private static async Task<IResult> ClaimAsync(Guid identityId, HttpContext http, DeliosDbContext db, IServiceScopeFactory scopes, AuditLog audit,
        Notifier notifier, IDataProtectionProvider protection, CancellationToken cancellationToken)
    {
        var me = http.User.TenantId();
        var o = await OwnAsync(db, me, cancellationToken);
        var entry = await db.OrganizationIdentities.SingleOrDefaultAsync(x => x.Id == identityId && x.MergedIntoId == null, cancellationToken);
        if (o is null || entry is null || entry.TenantId is not null) return Problems.NotFound("NOT_FOUND", "No such entry to claim.");
        if (await db.OrganizationClaims.AnyAsync(c => c.EntryId == entry.Id && c.ClaimerTenantId == me && c.State == ClaimStates.Waiting, cancellationToken))
            return Problems.Conflict("ALREADY_ASKED", "Our claim on it is already waiting.");
        var actor = await ActorAsync(http, db, cancellationToken);
        var maker = entry.CreatedByTenantId;
        // The guest that stood for it, in the data of the organization that made it.
        var guest = maker is { } m ? await TenantScope.RunAsync(scopes, m, async (_, there) =>
        {
            var partyIds = await there.Parties.AsNoTracking().Where(p => p.OrganizationId == entry.Id).Select(p => p.Id).ToListAsync(cancellationToken);
            return await there.Users.AsNoTracking().Where(u => u.PartyId != null && partyIds.Contains(u.PartyId.Value) && u.Active && u.HomeTenantId == null)
                .OrderBy(u => u.Name).Select(u => new { u.Email, u.Name }).FirstOrDefaultAsync(cancellationToken);
        }, cancellationToken) : null;
        var claim = new OrganizationClaim
        {
            EntryId = entry.Id,
            ClaimerTenantId = me,
            ClaimerIdentityId = o.Id,
            ClaimedByName = actor.Name,
            MakerTenantId = maker,
            Method = guest is null ? ClaimMethods.Vouch : ClaimMethods.GuestEmail,
            SentTo = guest?.Email,
            CreatedAt = SystemClock.Instance.GetCurrentInstant(),
        };
        db.OrganizationClaims.Add(claim);
        if (guest is not null)
        {
            var token = ClaimLinks(protection).Protect(claim.Id.ToString("N"), TimeSpan.FromDays(7));
            notifier.Queue(me, null, EmailKinds.Account, guest.Email, guest.Name, $"Is {o.Name} the organization you stood for as {entry.Name}?",
                $"{o.Name} says it is {entry.Name} ({entry.Code}), the organization you stood for on DELIOS. If it is, open this link within seven days:\n\n"
                + $"{notifier.Url($"/confirm-claim?token={Uri.EscapeDataString(token)}")}\n\nIf it is not, ignore this email: nothing passes without it.",
                "Organization", entry.Id);
        }
        await db.SaveChangesAsync(cancellationToken);
        if (guest is null && maker is { } makerTenant)
            await TellAdminsAsync(scopes, makerTenant, $"{o.Name} says it is {entry.Name}",
                $"{o.Name} ({o.Code}) on DELIOS says it is {entry.Name} ({entry.Code}), which you recorded. Vouch for it, or refuse with why, on your organization's page.",
                cancellationToken);
        await audit.WriteAsync(actor, "ORGANIZATION_CLAIMED", "Organization", entry.Id, entry.Name,
            guest is null ? $"Claimed {entry.Name}: the organization that recorded it is asked to vouch." : $"Claimed {entry.Name}: a link went to its guest, {guest.Email}.",
            cancellationToken: cancellationToken);
        return Results.Ok(new { claim.Id, claim.Method, claim.SentTo });
    }

    /// <summary>A claim confirmed: the entry becomes the claimer, under its own code and name, in every list holding it.</summary>
    private static async Task CompleteClaimAsync(DeliosDbContext db, IServiceScopeFactory scopes, OrganizationClaim claim, string by, CancellationToken cancellationToken)
    {
        var keep = await db.OrganizationIdentities.SingleAsync(x => x.Id == claim.ClaimerIdentityId, cancellationToken);
        var entry = await db.OrganizationIdentities.SingleAsync(x => x.Id == claim.EntryId, cancellationToken);
        claim.State = ClaimStates.Confirmed;
        claim.AnsweredAt = SystemClock.Instance.GetCurrentInstant();
        claim.AnsweredByName = by;
        if (entry.MergedIntoId is null) await Registry.MergeAsync(db, scopes, keep, entry, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        // Proven: every organization that recorded it is linked with it by itself, and its guest accounts move to it.
        await ClaimLinking.LinkAsync(scopes, claim.ClaimerTenantId, [keep.Id, entry.Id], by, cancellationToken);
    }

    /// <summary><c>POST /api/auth/confirm-claim</c>: the guest who stood for the entry opened the link: it is them.</summary>
    private static async Task<IResult> ConfirmClaimAsync(DomainTokenRequest request, DeliosDbContext db, IServiceScopeFactory scopes,
        IDataProtectionProvider protection, CancellationToken cancellationToken)
    {
        var invalid = Problems.Problem(StatusCodes.Status400BadRequest, "CLAIM_LINK_INVALID", "This link has expired, or was answered already.", null);
        Guid claimId;
        try { claimId = Guid.ParseExact(ClaimLinks(protection).Unprotect(request.Token ?? ""), "N"); }
        catch (Exception e) when (e is CryptographicException or FormatException) { return invalid; }
        var claim = await db.OrganizationClaims.SingleOrDefaultAsync(c => c.Id == claimId && c.State == ClaimStates.Waiting, cancellationToken);
        if (claim is null) return invalid;
        await CompleteClaimAsync(db, scopes, claim, claim.SentTo ?? "its guest", cancellationToken);
        var name = await db.OrganizationIdentities.Where(x => x.Id == claim.ClaimerIdentityId).Select(x => x.Name).SingleAsync(cancellationToken);
        return Results.Ok(new { organization = name });
    }

    /// <summary><c>POST /api/organization/claims/incoming/{id}/vouch</c>: we made the entry, and vouch that the claimer is it.</summary>
    private static async Task<IResult> VouchAsync(Guid claimId, HttpContext http, DeliosDbContext db, IServiceScopeFactory scopes, AuditLog audit,
        CancellationToken cancellationToken)
    {
        var me = http.User.TenantId();
        var claim = await db.OrganizationClaims.SingleOrDefaultAsync(c => c.Id == claimId && c.MakerTenantId == me && c.State == ClaimStates.Waiting, cancellationToken);
        if (claim is null) return Problems.NotFound("NOT_FOUND", "No such claim waiting on us.");
        var actor = await ActorAsync(http, db, cancellationToken);
        await CompleteClaimAsync(db, scopes, claim, actor.Name, cancellationToken);
        await audit.WriteAsync(actor, "CLAIM_VOUCHED", "Organization", claim.EntryId, claim.ClaimedByName, "Vouched: the claimer is the organization we recorded.",
            cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    /// <summary><c>POST /api/organization/claims/incoming/{id}/refuse</c>: it is not them, with why; nothing passes.</summary>
    private static async Task<IResult> RefuseClaimAsync(Guid claimId, NoteRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        IServiceScopeFactory scopes, CancellationToken cancellationToken)
    {
        var me = http.User.TenantId();
        var why = request.Note?.Trim();
        if (string.IsNullOrEmpty(why)) return Problems.Invalid("WHY_REQUIRED", "Say why it is not them.", new { field = "note" });
        var claim = await db.OrganizationClaims.SingleOrDefaultAsync(c => c.Id == claimId && c.MakerTenantId == me && c.State == ClaimStates.Waiting, cancellationToken);
        if (claim is null) return Problems.NotFound("NOT_FOUND", "No such claim waiting on us.");
        var actor = await ActorAsync(http, db, cancellationToken);
        claim.State = ClaimStates.Refused;
        claim.RefusedWhy = why;
        claim.AnsweredAt = SystemClock.Instance.GetCurrentInstant();
        claim.AnsweredByName = actor.Name;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(actor, "CLAIM_REFUSED", "Organization", claim.EntryId, claim.ClaimedByName, $"Refused: {why}", cancellationToken: cancellationToken);
        await TellAdminsAsync(scopes, claim.ClaimerTenantId, "Your claim was refused", $"{actor.Name} refused your claim: {why}", cancellationToken);
        return Results.NoContent();
    }

    /// <summary>The organizations that answer for a merge: the side of each of the two.</summary>
    private static Guid[] SidesOf(OrganizationIdentity keep, OrganizationIdentity merge) =>
        new[] { keep.Side, merge.Side }.Where(s => s is not null).Select(s => s!.Value).Distinct().ToArray();

    /// <summary>
    /// <c>POST /api/admin/organizations/merges</c>: two organizations are one. Asked with why by an organization holding
    /// either; agreed at once by the asker when it answers for one; the other side is told. Carried out by the app's owner.
    /// </summary>
    private static async Task<IResult> AskMergeAsync(MergeRequest request, HttpContext http, DeliosDbContext db, IServiceScopeFactory scopes,
        AuditLog audit, CancellationToken cancellationToken)
    {
        var me = http.User.TenantId();
        var why = request.Why?.Trim();
        if (string.IsNullOrEmpty(why)) return Problems.Invalid("WHY_REQUIRED", "Say why they are one organization.", new { field = "why" });
        if (request.KeepId == request.MergeId) return Problems.Invalid("SAME", "Choose two different organizations.");
        var keep = await Registry.IdentityAsync(db, request.KeepId, cancellationToken);
        var merge = await Registry.IdentityAsync(db, request.MergeId, cancellationToken);
        if (keep is null || merge is null || keep.Id == merge.Id) return Problems.NotFound("NOT_FOUND", "No such organizations, or they are one already.");
        if (keep.TenantId is not null && merge.TenantId is not null)
            return Problems.Conflict("BOTH_ON_DELIOS", $"{keep.Name} and {merge.Name} are both on DELIOS: the app's owner looks at it with both.");
        var holds = await db.Parties.AnyAsync(p => p.OrganizationId == keep.Id || p.OrganizationId == merge.Id, cancellationToken);
        var sides = SidesOf(keep, merge);
        if (!holds && !sides.Contains(me)) return Problems.Forbidden("NOT_YOURS", "Only an organization that works with them asks for this.");
        if (await db.OrganizationMerges.AnyAsync(m => (m.State == MergeStates.Asked || m.State == MergeStates.Agreed)
                && ((m.KeepId == keep.Id && m.MergeId == merge.Id) || (m.KeepId == merge.Id && m.MergeId == keep.Id)), cancellationToken))
            return Problems.Conflict("ALREADY_ASKED", "This merge is already asked.");
        var actor = await ActorAsync(http, db, cancellationToken);
        var asked = new OrganizationMerge
        {
            KeepId = keep.Id,
            MergeId = merge.Id,
            RequestedByTenantId = me,
            RequestedByName = actor.Name,
            Why = why,
            RequestedAt = SystemClock.Instance.GetCurrentInstant(),
            AgreedTenantIds = sides.Contains(me) ? [me] : [],
        };
        if (sides.All(asked.AgreedTenantIds.Contains)) asked.State = MergeStates.Agreed;
        db.OrganizationMerges.Add(asked);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(actor, "MERGE_ASKED", "Organization", merge.Id, merge.Name,
            $"{merge.Name} ({merge.Code}) is {keep.Name} ({keep.Code}): {why}", cancellationToken: cancellationToken);
        foreach (var side in sides.Where(s => !asked.AgreedTenantIds.Contains(s)))
            await TellAdminsAsync(scopes, side, $"Is {merge.Name} the same as {keep.Name}?",
                $"{actor.Name} asks for {merge.Name} ({merge.Code}) and {keep.Name} ({keep.Code}) to be one organization on DELIOS: {why}\n\n"
                + "Agree or refuse it on your organization's page.", cancellationToken);
        return Results.Ok(new { asked.Id, asked.State });
    }

    /// <summary><c>GET /api/organization/merges</c>: the merges asked by us or waiting on us, with where each stands.</summary>
    private static async Task<IResult> MergesAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var me = http.User.TenantId();
        var all = await db.OrganizationMerges.AsNoTracking().OrderByDescending(m => m.RequestedAt).Take(200).ToListAsync(cancellationToken);
        var ids = all.SelectMany(m => new[] { m.KeepId, m.MergeId }).Distinct().ToList();
        var orgs = await db.OrganizationIdentities.AsNoTracking().Where(o => ids.Contains(o.Id)).ToDictionaryAsync(o => o.Id, cancellationToken);
        var rows = all.Where(m => orgs.ContainsKey(m.KeepId) && orgs.ContainsKey(m.MergeId))
            .Select(m => (m, sides: SidesOf(orgs[m.KeepId], orgs[m.MergeId])))
            .Where(x => x.m.RequestedByTenantId == me || x.sides.Contains(me))
            .Select(x => new
            {
                x.m.Id,
                x.m.State,
                x.m.Why,
                x.m.RequestedByName,
                RequestedAt = x.m.RequestedAt.ToDateTimeOffset(),
                Ours = x.m.RequestedByTenantId == me,
                Keep = new { orgs[x.m.KeepId].Code, orgs[x.m.KeepId].Name },
                Merge = new { orgs[x.m.MergeId].Code, orgs[x.m.MergeId].Name },
                WaitsOnUs = x.m.State == MergeStates.Asked && x.sides.Contains(me) && !x.m.AgreedTenantIds.Contains(me),
                x.m.RefusedByName,
                x.m.RefusedWhy,
                DoneAt = x.m.DoneAt?.ToDateTimeOffset(),
            });
        return Results.Ok(rows);
    }

    /// <summary><c>POST /api/organization/merges/{id}/agree</c>: we agree; once every side has, it waits for the app's owner.</summary>
    private static async Task<IResult> AgreeAsync(Guid mergeId, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var me = http.User.TenantId();
        var m = await db.OrganizationMerges.SingleOrDefaultAsync(x => x.Id == mergeId, cancellationToken);
        if (m is null || m.State != MergeStates.Asked) return Problems.NotFound("NOT_FOUND", "No such merge waiting.");
        var keep = await db.OrganizationIdentities.FindAsync([m.KeepId], cancellationToken);
        var merge = await db.OrganizationIdentities.FindAsync([m.MergeId], cancellationToken);
        var sides = SidesOf(keep!, merge!);
        if (!sides.Contains(me)) return Problems.Forbidden("NOT_YOURS", "This merge does not wait on us.");
        m.AgreedTenantIds = [.. m.AgreedTenantIds.Append(me).Distinct()];
        if (sides.All(m.AgreedTenantIds.Contains)) { m.State = MergeStates.Agreed; m.AnsweredAt = SystemClock.Instance.GetCurrentInstant(); }
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "MERGE_AGREED", "Organization", merge!.Id, merge.Name,
            $"Agreed: {merge.Name} is {keep!.Name}.", cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    /// <summary><c>POST /api/organization/merges/{id}/refuse</c>: we refuse, with why: they stay two.</summary>
    private static async Task<IResult> RefuseAsync(Guid mergeId, NoteRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        IServiceScopeFactory scopes, CancellationToken cancellationToken)
    {
        var me = http.User.TenantId();
        var why = request.Note?.Trim();
        if (string.IsNullOrEmpty(why)) return Problems.Invalid("WHY_REQUIRED", "Say why they are not one organization.", new { field = "note" });
        var m = await db.OrganizationMerges.SingleOrDefaultAsync(x => x.Id == mergeId, cancellationToken);
        if (m is null || m.State != MergeStates.Asked) return Problems.NotFound("NOT_FOUND", "No such merge waiting.");
        var keep = await db.OrganizationIdentities.FindAsync([m.KeepId], cancellationToken);
        var merge = await db.OrganizationIdentities.FindAsync([m.MergeId], cancellationToken);
        if (!SidesOf(keep!, merge!).Contains(me)) return Problems.Forbidden("NOT_YOURS", "This merge does not wait on us.");
        var actor = await ActorAsync(http, db, cancellationToken);
        m.State = MergeStates.Refused;
        m.RefusedByName = actor.Name;
        m.RefusedWhy = why;
        m.AnsweredAt = SystemClock.Instance.GetCurrentInstant();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(actor, "MERGE_REFUSED", "Organization", merge!.Id, merge.Name, $"Refused: {merge.Name} is not {keep!.Name}: {why}",
            cancellationToken: cancellationToken);
        if (m.RequestedByTenantId != me)
            await TellAdminsAsync(scopes, m.RequestedByTenantId, $"{merge.Name} and {keep.Name} stay two",
                $"{actor.Name} refused to merge {merge.Name} into {keep.Name}: {why}", cancellationToken);
        return Results.NoContent();
    }

    /// <summary>Tells another organization's administrators, in their own data.</summary>
    private static Task TellAdminsAsync(IServiceScopeFactory scopes, Guid tenantId, string subject, string body, CancellationToken cancellationToken) =>
        TenantScope.RunAsync(scopes, tenantId, async (services, theirs) =>
        {
            var notifier = services.GetRequiredService<Notifier>();
            foreach (var admin in await theirs.Users.AsNoTracking().Where(u => u.Active && u.IsAdmin && u.HomeTenantId == null)
                         .Select(u => new { u.Email, u.Name }).ToListAsync(cancellationToken))
                notifier.Queue(tenantId, null, EmailKinds.Account, admin.Email, admin.Name, subject, $"{body}\n\n{notifier.Url("/organization")}", "Organization", null);
            await theirs.SaveChangesAsync(cancellationToken);
        }, cancellationToken);
}

/// <summary>
/// <c>merge-organizations</c>: the app's owner carries out merges every side agreed to. Without an id, lists those
/// waiting; with one, merges it. Nothing is deleted: the merged organization's code and name stay reserved and point
/// to the one kept.
/// </summary>
public sealed class MergeOrganizations(DeliosDbContext db, IServiceScopeFactory scopes)
{
    public async Task<string> RunAsync(string? id, CancellationToken cancellationToken = default)
    {
        var waiting = await db.OrganizationMerges.Where(m => m.State == MergeStates.Agreed).OrderBy(m => m.RequestedAt).ToListAsync(cancellationToken);
        var ids = waiting.SelectMany(m => new[] { m.KeepId, m.MergeId }).ToList();
        var orgs = await db.OrganizationIdentities.Where(o => ids.Contains(o.Id)).ToDictionaryAsync(o => o.Id, cancellationToken);
        if (id is null)
            return waiting.Count == 0 ? "No merge waits: none agreed by every side."
                : string.Join('\n', waiting.Select(m => $"{m.Id}  {orgs[m.MergeId].Name} ({orgs[m.MergeId].Code}) → {orgs[m.KeepId].Name} ({orgs[m.KeepId].Code}): {m.Why}"));
        var merge = waiting.FirstOrDefault(m => m.Id.ToString() == id || m.Id.ToString("N") == id);
        if (merge is null) return "No such merge agreed by every side.";
        var keep = orgs[merge.KeepId];
        var folded = orgs[merge.MergeId];
        if (keep.MergedIntoId is not null || folded.MergedIntoId is not null) return "One of the two was merged meanwhile: ask again.";
        await Registry.MergeAsync(db, scopes, keep, folded, cancellationToken);
        merge.State = MergeStates.Done;
        merge.DoneAt = SystemClock.Instance.GetCurrentInstant();
        await db.SaveChangesAsync(cancellationToken);
        // The one kept is on DELIOS: whoever recorded the other is linked with it by itself, its guests moving to it.
        var moved = keep.TenantId is { } home ? await ClaimLinking.LinkAsync(scopes, home, [keep.Id, folded.Id], "the merge", cancellationToken) : 0;
        return $"Merged: {folded.Name} ({folded.Code}) is {keep.Name} ({keep.Code}) now." + (moved > 0 ? $" {moved} guest account(s) moved to it." : "");
    }
}
