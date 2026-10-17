using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Notifications;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Organizations;

/// <summary>Body of an invitation: the email of someone we know in the other organization.</summary>
public sealed record LinkRequest(string? Email);
/// <summary>Body of an answer or an end: what the person wrote.</summary>
public sealed record NoteRequest(string? Note);

/// <summary>
/// A link between two organizations as either side reads it. <c>Side</c>: "HOST" when we invited them (they work on
/// our projects), "GUEST" when they invited us (we work on theirs). <c>Organization</c> is the other side's name.
/// </summary>
public sealed record LinkView(Guid Id, string Side, string Organization, Guid OtherTenantId, Guid? PartyId, string PartyCode, string PartyName,
    string State, string InvitedEmail, DateTimeOffset InvitedAt, string InvitedBy, DateTimeOffset? AnsweredAt, string? AnsweredBy,
    string? AnswerNote, DateTimeOffset? EndedAt, string? EndedBy, string? EndedBySide, string? EndReason);

/// <summary>
/// Organizations working together (docs/ORGANIZATIONS.md): links between two organizations that both have DELIOS, the
/// organizations taking part in a project, and the linked accounts that let a collaborator's people work on our
/// projects with their own sign-in. Each organization's data stays in its own organization; only these meeting points
/// reach across, through <see cref="TenantScope"/>.
/// </summary>
public sealed partial class OrganizationService(
    DeliosDbContext db, TenantContext tenant, IServiceScopeFactory scopes, AuditLog audit, IClock clock)
{
    /// <summary>The kind of an organization we work with, in the words of docs/ORGANIZATIONS.md.</summary>
    public const string Collaborator = "COLLABORATOR", Guest = "GUEST", NotOnDelios = "NOT_ON_DELIOS";

    /// <summary>Collaborator (linked to its own organization), guest (accounts we made), or not on DELIOS (by proxy).</summary>
    public static string KindOf(Party party, bool linked) =>
        linked ? Collaborator : party.Participation == Participations.ByProxy ? NotOnDelios : Guest;

    // ── Links between organizations ───────────────────────────────────────────

    /// <summary>
    /// We invite the organization one of our parties stands for, through someone we know there. Refused when that
    /// email has no DELIOS organization: then they work with us as guests, or not on DELIOS.
    /// </summary>
    public async Task<(OrganizationLink? Link, IResult? Problem)> InviteAsync(Actor actor, Guid partyId, LinkRequest request,
        CancellationToken cancellationToken)
    {
        var party = await db.Parties.SingleOrDefaultAsync(p => p.Id == partyId, cancellationToken);
        if (party is null) return (null, Problems.NotFound("PARTY_NOT_FOUND", "No such organization."));
        if (party.IsInternal) return (null, Problems.Invalid("PARTY_INTERNAL", $"{party.Name} is our own organization."));
        if (!party.Active) return (null, Problems.Conflict("PARTY_INACTIVE", $"{party.Name} is switched off: switch it on first."));
        var email = (request.Email ?? "").Trim();
        // An organization added from DELIOS is invited as itself: no email is needed to find it.
        var known = party.OrganizationId is { } oid ? await Registry.IdentityAsync(db, oid, cancellationToken) : null;
        Guid? them;
        if (known?.TenantId is { } itself && email.Length == 0)
        {
            them = itself;
            email = "(added from DELIOS)";
        }
        else
        {
            if (email.Length == 0 || !email.Contains('@')) return (null, Problems.Invalid("EMAIL_REQUIRED", "Give the email of someone you know there."));
            var normalized = email.ToUpperInvariant();
            them = await db.SignInNames.AsNoTracking().Where(n => n.NormalizedEmail == normalized).Select(n => (Guid?)n.TenantId)
                .SingleOrDefaultAsync(cancellationToken);
        }
        if (them is null)
        {
            return (null, Problems.Conflict("NOT_ON_DELIOS",
                $"{email} has no DELIOS organization. {party.Name} can still work with us: as guests (accounts we make for them), or not on DELIOS (we record for them)."));
        }
        if (them == tenant.Required) return (null, Problems.Invalid("SAME_ORGANIZATION", $"{email} is one of us."));
        if (await db.OrganizationLinks.AnyAsync(l => l.HostTenantId == tenant.Required && l.HostPartyId == partyId
                && (l.State == LinkStates.Invited || l.State == LinkStates.Linked), cancellationToken))
            return (null, Problems.Conflict("ALREADY_LINKED", $"{party.Name} is already invited or linked."));
        if (await db.OrganizationLinks.AnyAsync(l => l.HostTenantId == tenant.Required && l.GuestTenantId == them
                && (l.State == LinkStates.Invited || l.State == LinkStates.Linked), cancellationToken))
            return (null, Problems.Conflict("ORGANIZATION_ALREADY_LINKED", "That organization is already invited or linked, as another of our organizations."));

        var link = new OrganizationLink
        {
            HostTenantId = tenant.Required,
            HostPartyId = party.Id,
            HostPartyCode = party.Code,
            HostPartyName = party.Name,
            GuestTenantId = them.Value,
            InvitedEmail = email,
            InvitedAt = clock.GetCurrentInstant(),
            InvitedByName = actor.Name,
        };
        db.OrganizationLinks.Add(link);
        await audit.WriteAsync(actor, "ORGANIZATION_INVITED", "Party", party.Id, party.Code, $"Invited {party.Name} to work with us, through {email}.",
            cancellationToken: cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        var host = await HostNameAsync(link.HostTenantId, cancellationToken);
        // Their administrators are told, and find it on their organization's page.
        await TenantScope.RunAsync(scopes, link.GuestTenantId, async (services, theirs) =>
        {
            var notifier = services.GetRequiredService<Notifier>();
            var admins = await theirs.Users.AsNoTracking().Where(u => u.Active && u.IsAdmin && u.HomeTenantId == null)
                .Select(u => new { u.Email, u.Name }).ToListAsync(cancellationToken);
            foreach (var admin in admins)
            {
                notifier.Queue(link.GuestTenantId, null, EmailKinds.Account, admin.Email, admin.Name, $"{host} invites you to work together on DELIOS",
                    $"{host} invites your organization to work on its projects, with your own accounts.\n\n"
                    + $"Accept or refuse it on your organization's page: {notifier.Url("/organization")}", "OrganizationLink", link.Id);
            }
            await services.GetRequiredService<AuditLog>().WriteAsync(new Actor(null, actor.Name), "ORGANIZATION_INVITATION_RECEIVED",
                "OrganizationLink", link.Id, host, $"{host} invites us to work on its projects (as {party.Name}).", cancellationToken: cancellationToken);
        }, cancellationToken);
        return (link, null);
    }

    /// <summary>Every link of ours, both ways: those we sent (they work on our projects) and those we received.</summary>
    public async Task<IReadOnlyList<LinkView>> LinksAsync(CancellationToken cancellationToken)
    {
        var me = tenant.Required;
        var links = await db.OrganizationLinks.AsNoTracking().Where(l => l.HostTenantId == me || l.GuestTenantId == me)
            .OrderByDescending(l => l.InvitedAt).ToListAsync(cancellationToken);
        var others = links.Select(l => l.HostTenantId == me ? l.GuestTenantId : l.HostTenantId).Distinct().ToList();
        var names = await db.Tenants.AsNoTracking().Where(t => others.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Name, cancellationToken);
        return links.Select(l =>
        {
            var hosting = l.HostTenantId == me;
            var other = hosting ? l.GuestTenantId : l.HostTenantId;
            return new LinkView(l.Id, hosting ? "HOST" : "GUEST", names.GetValueOrDefault(other) ?? "", other, hosting ? l.HostPartyId : null,
                l.HostPartyCode, l.HostPartyName, l.State, hosting ? l.InvitedEmail : "", l.InvitedAt.ToDateTimeOffset(), l.InvitedByName,
                l.AnsweredAt?.ToDateTimeOffset(), l.AnsweredByName, l.AnswerNote, l.EndedAt?.ToDateTimeOffset(), l.EndedByName, l.EndedBySide, l.EndReason);
        }).ToList();
    }

    /// <summary>Their administrator accepts our invitation: the party we know them by now stands for their organization.</summary>
    public async Task<IResult?> AcceptAsync(Actor actor, Guid linkId, NoteRequest request, CancellationToken cancellationToken)
    {
        var link = await db.OrganizationLinks.SingleOrDefaultAsync(l => l.Id == linkId && l.GuestTenantId == tenant.Required, cancellationToken);
        if (link is null) return Problems.NotFound("LINK_NOT_FOUND", "No such invitation.");
        if (link.State != LinkStates.Invited) return Problems.Conflict("LINK_ANSWERED", "This invitation was already answered.");
        link.State = LinkStates.Linked;
        link.AnsweredAt = clock.GetCurrentInstant();
        link.AnsweredByName = actor.Name;
        link.AnswerNote = Blank(request.Note);
        var host = await HostNameAsync(link.HostTenantId, cancellationToken);
        await audit.WriteAsync(actor, "ORGANIZATION_LINKED", "OrganizationLink", link.Id, host,
            $"Accepted to work on {host}'s projects (they know us as {link.HostPartyName}).", cancellationToken: cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        // On their side, the party now has people of its own: it is no longer one we answer for.
        await TenantScope.RunAsync(scopes, link.HostTenantId, async (services, theirs) =>
        {
            var party = await theirs.Parties.SingleAsync(p => p.Id == link.HostPartyId, cancellationToken);
            party.Participation = Participations.InApp;
            await services.GetRequiredService<AuditLog>().WriteAsync(new Actor(null, actor.Name), "ORGANIZATION_LINKED", "Party", party.Id,
                party.Code, $"{party.Name} accepted: their people now work here with their own accounts.{Note(link.AnswerNote)}",
                cancellationToken: cancellationToken);
        }, cancellationToken);
        return null;
    }

    /// <summary>Their administrator refuses our invitation, saying why; we keep working with them as before.</summary>
    public async Task<IResult?> RefuseAsync(Actor actor, Guid linkId, NoteRequest request, CancellationToken cancellationToken)
    {
        var link = await db.OrganizationLinks.SingleOrDefaultAsync(l => l.Id == linkId && l.GuestTenantId == tenant.Required, cancellationToken);
        if (link is null) return Problems.NotFound("LINK_NOT_FOUND", "No such invitation.");
        if (link.State != LinkStates.Invited) return Problems.Conflict("LINK_ANSWERED", "This invitation was already answered.");
        link.State = LinkStates.Refused;
        link.AnsweredAt = clock.GetCurrentInstant();
        link.AnsweredByName = actor.Name;
        link.AnswerNote = Blank(request.Note);
        var host = await HostNameAsync(link.HostTenantId, cancellationToken);
        await audit.WriteAsync(actor, "ORGANIZATION_REFUSED", "OrganizationLink", link.Id, host, $"Refused to work on {host}'s projects.{Note(link.AnswerNote)}",
            cancellationToken: cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await TenantScope.RunAsync(scopes, link.HostTenantId, (services, _) =>
            services.GetRequiredService<AuditLog>().WriteAsync(new Actor(null, actor.Name), "ORGANIZATION_REFUSED", "Party", link.HostPartyId,
                link.HostPartyCode, $"{link.HostPartyName} refused to link.{Note(link.AnswerNote)}", cancellationToken: cancellationToken),
            cancellationToken);
        return null;
    }

    /// <summary>
    /// Either side ends a link (or the host takes back an invitation not yet answered), saying why. Their accounts on
    /// the host's projects stop; everything they did stays, under the party the host knows them by.
    /// </summary>
    public async Task<IResult?> EndAsync(Actor actor, Guid linkId, NoteRequest request, CancellationToken cancellationToken)
    {
        var me = tenant.Required;
        var link = await db.OrganizationLinks.SingleOrDefaultAsync(l => l.Id == linkId && (l.HostTenantId == me || l.GuestTenantId == me),
            cancellationToken);
        if (link is null) return Problems.NotFound("LINK_NOT_FOUND", "No such link.");
        if (link.State is not (LinkStates.Invited or LinkStates.Linked)) return Problems.Conflict("LINK_CLOSED", "This link has already ended.");
        var reason = Blank(request.Note);
        if (reason is null) return Problems.Invalid("REASON_REQUIRED", "Say why it ends: the other organization reads it.");
        var hosting = link.HostTenantId == me;
        if (!hosting && link.State == LinkStates.Invited) return Problems.Conflict("LINK_NOT_ANSWERED", "Answer the invitation instead: accept or refuse it.");
        link.State = LinkStates.Ended;
        link.EndedAt = clock.GetCurrentInstant();
        link.EndedByName = actor.Name;
        link.EndedBySide = hosting ? "HOST" : "GUEST";
        link.EndReason = reason;
        var accounts = await db.AccountLinks.Where(a => a.LinkId == link.Id && a.EndedAt == null).ToListAsync(cancellationToken);
        foreach (var account in accounts) account.EndedAt = link.EndedAt;
        var other = await HostNameAsync(hosting ? link.GuestTenantId : link.HostTenantId, cancellationToken);
        await audit.WriteAsync(actor, "ORGANIZATION_LINK_ENDED", hosting ? "Party" : "OrganizationLink", hosting ? link.HostPartyId : link.Id,
            hosting ? link.HostPartyCode : other, $"Ended the link with {other}: {reason}", cancellationToken: cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        // The host's accounts standing for their people stop, wherever this was ended.
        var hostUsers = accounts.Select(a => a.HostUserId).ToList();
        await TenantScope.RunAsync(scopes, link.HostTenantId, async (services, hostDb) =>
        {
            var users = await hostDb.Users.Where(u => hostUsers.Contains(u.Id)).ToListAsync(cancellationToken);
            foreach (var user in users) user.Active = false;
            await hostDb.SaveChangesAsync(cancellationToken);
            foreach (var user in users) await services.GetRequiredService<SessionStore>().ForgetAllAsync(user.Id, revoke: true, cancellationToken);
            if (!hosting)
            {
                await services.GetRequiredService<AuditLog>().WriteAsync(new Actor(null, actor.Name), "ORGANIZATION_LINK_ENDED", "Party",
                    link.HostPartyId, link.HostPartyCode, $"{link.HostPartyName} ended the link: {reason}", cancellationToken: cancellationToken);
            }
        }, cancellationToken);
        if (hosting)
        {
            await TenantScope.RunAsync(scopes, link.GuestTenantId, (services, _) =>
                services.GetRequiredService<AuditLog>().WriteAsync(new Actor(null, actor.Name), "ORGANIZATION_LINK_ENDED", "OrganizationLink",
                    link.Id, other, $"{other} ended the link: {reason}", cancellationToken: cancellationToken), cancellationToken);
        }
        return null;
    }

    /// <summary>Each of our parties' link, when it has an open one (invited or linked), with the other organization's name.</summary>
    public async Task<IReadOnlyDictionary<Guid, (Guid Id, string State, string Organization)>> PartyLinksAsync(CancellationToken cancellationToken)
    {
        var me = tenant.Required;
        var links = await db.OrganizationLinks.AsNoTracking()
            .Where(l => l.HostTenantId == me && (l.State == LinkStates.Invited || l.State == LinkStates.Linked)).ToListAsync(cancellationToken);
        var ids = links.Select(l => l.GuestTenantId).Distinct().ToList();
        var names = await db.Tenants.AsNoTracking().Where(t => ids.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Name, cancellationToken);
        return links.ToDictionary(l => l.HostPartyId, l => (l.Id, l.State, names.GetValueOrDefault(l.GuestTenantId) ?? ""));
    }

    private async Task<string> HostNameAsync(Guid tenantId, CancellationToken cancellationToken) =>
        await db.Tenants.AsNoTracking().Where(t => t.Id == tenantId).Select(t => t.Name).SingleOrDefaultAsync(cancellationToken) ?? "";

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static string Note(string? note) => note is null ? "" : $" They wrote: {note}";
}
