using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Notifications;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Organizations;

/// <summary>
/// What follows by itself once an organization on DELIOS is proven to be one others recorded (a claim confirmed by its
/// guest, vouched for by whoever recorded it, or a guest taking their account into their own new DELIOS): every
/// organization that listed it is linked with it at once, nobody invited or asked (owner: it is automatic), and every
/// guest account made for its people moves to it. Each guest keeps their email, password and two-step sign-in, signs in
/// at home from then on and switches into the projects they were on, as a collaborator; the account with the host stays,
/// standing for them, with everything it did and every project it is on.
/// </summary>
public static class ClaimLinking
{
    /// <summary>Linked accounts have no password of their own: this never matches a hash (as <c>OrganizationService</c>).</summary>
    private const string NoPassword = "!linked";

    /// <summary>
    /// Links the claimer with every organization holding one of <paramref name="organizationIds"/> and brings their guest
    /// accounts over. <paramref name="by"/> names who proved it, for the record. Returns how many accounts moved.
    /// </summary>
    /// <remarks>
    /// Both entries are read: a merge still inside the caller's transaction has not moved the holders yet for other
    /// connections, so the entry's holders are found under either.
    /// </remarks>
    public static async Task<int> LinkAsync(IServiceScopeFactory scopes, Guid claimerTenantId, Guid[] organizationIds, string by,
        CancellationToken cancellationToken)
    {
        var moved = 0;
        var (holders, claimerName) = await TenantScope.RunAsync(scopes, claimerTenantId, async (_, db) => (
            await db.OrganizationHolders.AsNoTracking().Where(h => organizationIds.Contains(h.OrganizationId) && h.TenantId != claimerTenantId)
                .ToListAsync(cancellationToken),
            await db.Tenants.AsNoTracking().Where(t => t.Id == claimerTenantId).Select(t => t.Name).SingleAsync(cancellationToken)), cancellationToken);
        foreach (var holder in holders.DistinctBy(h => (h.TenantId, h.PartyId)))
            moved += await LinkOneAsync(scopes, claimerTenantId, claimerName, holder.TenantId, holder.PartyId, by, cancellationToken);
        return moved;
    }

    private static async Task<int> LinkOneAsync(IServiceScopeFactory scopes, Guid claimer, string claimerName, Guid host, Guid partyId, string by,
        CancellationToken cancellationToken)
    {
        var now = SystemClock.Instance.GetCurrentInstant();
        // On the host's side: the link, made or completed by itself, and the party now answering for itself.
        var (link, guests, hostName) = await TenantScope.RunAsync(scopes, host, async (services, hostDb) =>
        {
            var party = await hostDb.Parties.SingleOrDefaultAsync(p => p.Id == partyId, cancellationToken);
            if (party is null || party.IsInternal) return ((OrganizationLink?)null, new List<User>(), "");
            var open = await hostDb.OrganizationLinks.Where(l => l.HostTenantId == host && l.HostPartyId == partyId
                && (l.State == LinkStates.Invited || l.State == LinkStates.Linked)).ToListAsync(cancellationToken);
            // Already linked with another organization: that one stands for the party; nothing changes by itself.
            if (open.Any(l => l.State == LinkStates.Linked && l.GuestTenantId != claimer)) return (null, new List<User>(), "");
            var link = open.FirstOrDefault(l => l.GuestTenantId == claimer);
            foreach (var other in open.Where(l => l != link))
            {
                other.State = LinkStates.Ended;
                other.EndedAt = now;
                other.EndedByName = "DELIOS";
                other.EndedBySide = "HOST";
                other.EndReason = $"{party.Name} is {claimerName} on DELIOS: linked with it instead.";
            }
            if (link is null)
            {
                link = new OrganizationLink
                {
                    HostTenantId = host,
                    HostPartyId = party.Id,
                    HostPartyCode = party.Code,
                    HostPartyName = party.Name,
                    GuestTenantId = claimer,
                    InvitedEmail = "(claimed)",
                    InvitedAt = now,
                    InvitedByName = "DELIOS",
                };
                hostDb.OrganizationLinks.Add(link);
            }
            if (link.State != LinkStates.Linked)
            {
                link.State = LinkStates.Linked;
                link.AnsweredAt = now;
                link.AnsweredByName = by;
                link.AnswerNote = "Linked by itself: proven to be the organization recorded here.";
            }
            party.Participation = Participations.InApp;
            party.Active = true;
            var guests = await hostDb.Users.Where(u => u.TenantId == host && u.PartyId == party.Id && u.HomeTenantId == null).ToListAsync(cancellationToken);
            await services.GetRequiredService<AuditLog>().WriteAsync(new Actor(null, by), "ORGANIZATION_LINKED", "Party", party.Id, party.Code,
                $"{party.Name} is {claimerName} on DELIOS (proven by {by}): linked by itself; {guests.Count} guest account(s) move to it.",
                cancellationToken: cancellationToken);
            await hostDb.SaveChangesAsync(cancellationToken);
            var name = await hostDb.Tenants.AsNoTracking().Where(t => t.Id == host).Select(t => t.Name).SingleAsync(cancellationToken);
            return (link, guests, name);
        }, cancellationToken);
        if (link is null) return 0;

        // Each guest account moves to the claimer: its home account there (theirs already, when they made it), the
        // host's account standing for them.
        var moved = 0;
        foreach (var guest in guests)
        {
            var homeId = await TenantScope.RunAsync(scopes, claimer, async (services, homeDb) =>
            {
                var home = await homeDb.Users.SingleOrDefaultAsync(u => u.TenantId == claimer && u.NormalizedEmail == guest.NormalizedEmail && u.HomeTenantId == null, cancellationToken);
                if (home is null)
                {
                    // Their sign-in name moves home: the host's account stops being one you sign in to.
                    await homeDb.SignInNames.Where(n => n.NormalizedEmail == guest.NormalizedEmail && n.TenantId == host).ExecuteDeleteAsync(cancellationToken);
                    if (await homeDb.SignInNames.AnyAsync(n => n.NormalizedEmail == guest.NormalizedEmail, cancellationToken)) return (Guid?)null;
                    home = new User
                    {
                        TenantId = claimer,
                        Email = guest.Email,
                        NormalizedEmail = guest.NormalizedEmail,
                        Name = guest.Name,
                        PasswordHash = guest.PasswordHash,
                        Active = guest.Active,
                        MfaSecretProtected = guest.MfaSecretProtected,
                        MfaEnabledAt = guest.MfaEnabledAt,
                        RecoveryCodeHashes = guest.RecoveryCodeHashes,
                        PartyId = await homeDb.Parties.Where(p => p.TenantId == claimer && p.IsInternal).Select(p => (Guid?)p.Id).FirstOrDefaultAsync(cancellationToken),
                    };
                    homeDb.Users.Add(home);
                }
                if (!await homeDb.AccountLinks.AnyAsync(a => a.LinkId == link.Id && a.HostUserId == guest.Id && a.EndedAt == null, cancellationToken))
                {
                    homeDb.AccountLinks.Add(new AccountLink
                    {
                        LinkId = link.Id,
                        HomeTenantId = claimer,
                        HomeUserId = home.Id,
                        HostTenantId = host,
                        HostUserId = guest.Id,
                        CreatedAt = now,
                    });
                }
                await services.GetRequiredService<AuditLog>().WriteAsync(new Actor(null, by), "GUEST_BROUGHT_OVER", "User", home.Id, home.Email,
                    $"{home.Name} was a guest at {hostName}: now one of ours, still on their projects there.", cancellationToken: cancellationToken);
                services.GetRequiredService<Notifier>().Queue(claimer, home.Id, EmailKinds.Account, home.Email, home.Name,
                    $"Your account at {hostName} now works from {claimerName}'s DELIOS",
                    $"{claimerName} is on DELIOS now, linked with {hostName}. Sign in as usual, with the same email and password: you land in "
                    + $"{claimerName}'s DELIOS, and switch into {hostName}'s projects from there. Nothing you did there is lost.\n\n"
                    + services.GetRequiredService<Notifier>().Url("/"), "User", home.Id);
                await homeDb.SaveChangesAsync(cancellationToken);
                return (Guid?)home.Id;
            }, cancellationToken);
            if (homeId is null) continue;
            await TenantScope.RunAsync(scopes, host, async (services, hostDb) =>
            {
                var stand = await hostDb.Users.SingleAsync(u => u.Id == guest.Id, cancellationToken);
                // The sign-in name went home before the home account was made; a trigger never re-adds it here.
                stand.HomeTenantId = claimer;
                stand.PasswordHash = NoPassword;
                stand.MfaSecretProtected = null;
                stand.MfaEnabledAt = null;
                stand.RecoveryCodeHashes = [];
                await services.GetRequiredService<AuditLog>().WriteAsync(new Actor(null, by), "GUEST_BROUGHT_OVER", "User", stand.Id, stand.Email,
                    $"{stand.Name} now signs in with {claimerName}'s own DELIOS; this account stands for them here.", cancellationToken: cancellationToken);
                await hostDb.SaveChangesAsync(cancellationToken);
                await services.GetRequiredService<SessionStore>().ForgetAllAsync(stand.Id, revoke: true, cancellationToken);
            }, cancellationToken);
            moved++;
        }

        // The host's administrators are told; nothing is asked of them.
        await TenantScope.RunAsync(scopes, host, async (services, hostDb) =>
        {
            var notifier = services.GetRequiredService<Notifier>();
            foreach (var admin in await hostDb.Users.AsNoTracking().Where(u => u.TenantId == host && u.Active && u.IsAdmin && u.HomeTenantId == null)
                         .Select(u => new { u.Email, u.Name }).ToListAsync(cancellationToken))
                notifier.Queue(host, null, EmailKinds.Account, admin.Email, admin.Name, $"{link.HostPartyName} now works from its own DELIOS",
                    $"{link.HostPartyName} is {claimerName} on DELIOS (proven by {by}). It is linked with us by itself"
                    + (moved > 0 ? $", and its {moved} guest account(s) now sign in there and switch into our projects as before." : ".")
                    + $"\n\n{notifier.Url("/organization/organizations")}", "Party", link.HostPartyId);
            await hostDb.SaveChangesAsync(cancellationToken);
        }, cancellationToken);
        return moved;
    }
}
