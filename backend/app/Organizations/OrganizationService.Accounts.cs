using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Organizations;

/// <summary>Body of putting one of our people on a project of another organization's (or taking them off).</summary>
public sealed record JoinPersonRequest(Guid UserId, bool Active = true);

/// <summary>Another organization the signed-in person can switch into, with the projects they are on there.</summary>
public sealed record ElsewhereView(Guid TenantId, string Organization, bool Home, IReadOnlyList<ElsewhereProject> Projects);
public sealed record ElsewhereProject(Guid Id, string Code, string Name);

/** A guest account another organization made for one of our people, before our two organizations were linked. */
public sealed record GuestAccount(Guid Id, string Name, string Email, bool Active);

public sealed partial class OrganizationService
{
    /// <summary>Linked accounts have no password of their own: this never matches a hash.</summary>
    private const string NoPassword = "!linked";

    // ── Our people on another organization's project ──────────────────────────

    /// <summary>
    /// Our administrator puts one of our people on a project of another organization's that we take part in (or takes
    /// them off). The other organization gets an account standing for them, linked to theirs here, holding the function
    /// it chose for us. They keep signing in here only.
    /// </summary>
    public async Task<IResult?> JoinPersonAsync(Actor actor, Guid linkId, Guid projectId, JoinPersonRequest request,
        CancellationToken cancellationToken)
    {
        var me = tenant.Required;
        var link = await db.OrganizationLinks.AsNoTracking().SingleOrDefaultAsync(l => l.Id == linkId && l.GuestTenantId == me, cancellationToken);
        if (link is null || link.State != LinkStates.Linked) return Problems.NotFound("LINK_NOT_FOUND", "No such organization we work with.");
        var person = await db.Users.AsNoTracking().Include(u => u.Party).SingleOrDefaultAsync(u => u.Id == request.UserId, cancellationToken);
        if (person is null || person.HomeTenantId is not null || person.Party is { IsInternal: false })
            return Problems.Invalid("NOT_OURS", "Choose one of our own people.");
        if (request.Active && !person.Active) return Problems.Conflict("PERSON_INACTIVE", $"{person.Name} is switched off.");
        var account = await db.AccountLinks.SingleOrDefaultAsync(a => a.LinkId == link.Id && a.HomeUserId == person.Id && a.EndedAt == null,
            cancellationToken);
        var host = await HostNameAsync(link.HostTenantId, cancellationToken);
        // Their function at home, as we name it: shown on our project as "<us> / <function>".
        var homeFunction = await db.Memberships.AsNoTracking().Where(m => m.UserId == person.Id && m.Active)
            .OrderByDescending(m => m.Id).Select(m => m.Function!.Name).FirstOrDefaultAsync(cancellationToken);

        var (problem, hostUserId, project) = await TenantScope.RunAsync(scopes, link.HostTenantId, async (services, hostDb) =>
        {
            var part = await hostDb.ProjectParties.AsNoTracking().Include(p => p.Project)
                .SingleOrDefaultAsync(p => p.ProjectId == projectId && p.PartyId == link.HostPartyId && p.Active, cancellationToken);
            if (part?.Project is null) return (Problems.NotFound("PROJECT_NOT_FOUND", $"We do not take part in that project of {host}'s."), Guid.Empty, "");
            if (request.Active && part.StartFunctionId is null)
                return (Problems.Conflict("NO_START_FUNCTION", $"{host} has not given our people their function on {part.Project.Code} yet."), Guid.Empty, "");
            User? stand = account is null ? null : await hostDb.Users.SingleOrDefaultAsync(u => u.Id == account.HostUserId, cancellationToken);
            if (stand is null)
            {
                if (!request.Active) return ((IResult?)null, Guid.Empty, part.Project.Code);
                var normalized = person.NormalizedEmail;
                if (await hostDb.Users.AnyAsync(u => u.NormalizedEmail == normalized, cancellationToken))
                    return (Problems.Conflict("GUEST_ACCOUNT_EXISTS",
                        $"{host} already has a guest account for {person.Email}. Ask them to link it to {person.Name}'s own account."), Guid.Empty, "");
                stand = new User
                {
                    TenantId = link.HostTenantId,
                    Email = person.Email,
                    NormalizedEmail = normalized,
                    Name = person.Name,
                    PasswordHash = NoPassword,
                    PartyId = link.HostPartyId,
                    HomeTenantId = me,
                };
                hostDb.Users.Add(stand);
            }
            stand.Name = person.Name;
            stand.HomeFunction = homeFunction;
            if (request.Active) stand.Active = true;
            var membership = await hostDb.Memberships.SingleOrDefaultAsync(m => m.ProjectId == projectId && m.UserId == stand.Id, cancellationToken);
            if (membership is null && request.Active)
            {
                hostDb.Memberships.Add(new Membership
                {
                    TenantId = link.HostTenantId,
                    ProjectId = projectId,
                    UserId = stand.Id,
                    FunctionId = part.StartFunctionId!.Value,
                    Active = true,
                });
            }
            else if (membership is not null) membership.Active = request.Active;
            await services.GetRequiredService<AuditLog>().WriteAsync(new Actor(null, $"{actor.Name} ({link.HostPartyName})"),
                request.Active ? "LINKED_PERSON_ADDED" : "LINKED_PERSON_REMOVED", "Project", projectId, part.Project.Code,
                request.Active ? $"{link.HostPartyName} put {person.Name} on the project." : $"{link.HostPartyName} took {person.Name} off the project.",
                projectId, cancellationToken);
            await hostDb.SaveChangesAsync(cancellationToken);
            await services.GetRequiredService<SessionStore>().ForgetAllAsync(stand.Id, revoke: false, cancellationToken);
            return ((IResult?)null, stand.Id, part.Project.Code);
        }, cancellationToken);
        if (problem is not null) return problem;
        if (account is null && hostUserId != Guid.Empty)
        {
            db.AccountLinks.Add(new AccountLink
            {
                LinkId = link.Id,
                HomeTenantId = me,
                HomeUserId = person.Id,
                HostTenantId = link.HostTenantId,
                HostUserId = hostUserId,
                CreatedAt = clock.GetCurrentInstant(),
            });
        }
        await audit.WriteAsync(actor, request.Active ? "PERSON_JOINED_PROJECT" : "PERSON_LEFT_PROJECT", "User", person.Id, person.Email,
            request.Active ? $"Put on {host}'s project {project}." : $"Taken off {host}'s project {project}.", cancellationToken: cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return null;
    }

    /// <summary>
    /// One of our people switched off (or put back): every account standing for them in other organizations follows,
    /// so someone who left us loses our partners' projects too.
    /// </summary>
    public async Task FollowPersonAsync(Guid userId, bool active, CancellationToken cancellationToken)
    {
        var accounts = await db.AccountLinks.AsNoTracking().Where(a => a.HomeTenantId == tenant.Required && a.HomeUserId == userId && a.EndedAt == null)
            .ToListAsync(cancellationToken);
        foreach (var account in accounts)
        {
            await TenantScope.RunAsync(scopes, account.HostTenantId, async (services, hostDb) =>
            {
                var stand = await hostDb.Users.SingleOrDefaultAsync(u => u.Id == account.HostUserId, cancellationToken);
                if (stand is null) return;
                stand.Active = active;
                await hostDb.SaveChangesAsync(cancellationToken);
                await services.GetRequiredService<SessionStore>().ForgetAllAsync(stand.Id, revoke: !active, cancellationToken);
            }, cancellationToken);
        }
    }

    // ── One sign-in, several organizations ────────────────────────────────────

    /// <summary>
    /// The other organizations the signed-in person can switch into: from home, each organization whose projects they
    /// were put on; from such a project, home. With the projects they are on there.
    /// </summary>
    public async Task<IReadOnlyList<ElsewhereView>> ElsewhereAsync(Guid userId, CancellationToken cancellationToken)
    {
        var me = tenant.Required;
        var open = await (from a in db.AccountLinks
                          join l in db.OrganizationLinks on a.LinkId equals l.Id
                          where a.EndedAt == null && l.State == LinkStates.Linked
                              && ((a.HomeTenantId == me && a.HomeUserId == userId) || (a.HostTenantId == me && a.HostUserId == userId))
                          select a).AsNoTracking().ToListAsync(cancellationToken);
        var result = new List<ElsewhereView>();
        foreach (var account in open)
        {
            var home = account.HostTenantId == me;
            var (otherTenant, otherUser) = home ? (account.HomeTenantId, account.HomeUserId) : (account.HostTenantId, account.HostUserId);
            var view = await TenantScope.RunAsync(scopes, otherTenant, async (_, other) =>
            {
                var organization = await other.Tenants.AsNoTracking().Where(t => t.Id == otherTenant).Select(t => t.Name).SingleAsync(cancellationToken);
                var projects = await other.Memberships.AsNoTracking()
                    .Where(m => m.UserId == otherUser && m.Active && m.Project!.Status == "ACTIVE" && m.Function!.Active)
                    .OrderBy(m => m.Project!.Code).Select(m => new ElsewhereProject(m.ProjectId, m.Project!.Code, m.Project.Name))
                    .ToListAsync(cancellationToken);
                return new ElsewhereView(otherTenant, organization, home, projects);
            }, cancellationToken);
            if (home || view.Projects.Count > 0) result.Add(view);
        }
        return result;
    }

    /// <summary>
    /// The account the signed-in person switches to in another organization: their account standing for them there,
    /// or, from there, their own at home. Null when they have none open there.
    /// </summary>
    public async Task<(Guid TenantId, Guid UserId)?> SwitchTargetAsync(Guid userId, Guid targetTenantId, CancellationToken cancellationToken)
    {
        var me = tenant.Required;
        var account = await (from a in db.AccountLinks
                             join l in db.OrganizationLinks on a.LinkId equals l.Id
                             where a.EndedAt == null && l.State == LinkStates.Linked
                                 && ((a.HomeTenantId == me && a.HomeUserId == userId && a.HostTenantId == targetTenantId)
                                     || (a.HostTenantId == me && a.HostUserId == userId && a.HomeTenantId == targetTenantId))
                             select a).AsNoTracking().FirstOrDefaultAsync(cancellationToken);
        if (account is null) return null;
        return account.HostTenantId == targetTenantId ? (account.HostTenantId, account.HostUserId) : (account.HomeTenantId, account.HomeUserId);
    }
    // ── Guests whose company joins DELIOS later ───────────────────────────────

    /// <summary>
    /// The guest accounts another organization made for our people before we linked: accounts inside theirs, standing
    /// for the party they know us by, not yet brought over to us.
    /// </summary>
    public async Task<IReadOnlyList<GuestAccount>> GuestsAsync(Guid linkId, CancellationToken cancellationToken)
    {
        var link = await db.OrganizationLinks.AsNoTracking()
            .SingleOrDefaultAsync(l => l.Id == linkId && l.GuestTenantId == tenant.Required && l.State == LinkStates.Linked, cancellationToken);
        if (link is null) return [];
        return await TenantScope.RunAsync(scopes, link.HostTenantId, async (_, hostDb) =>
            await hostDb.Users.AsNoTracking().Where(u => u.PartyId == link.HostPartyId && u.HomeTenantId == null)
                .OrderBy(u => u.Name).Select(u => new GuestAccount(u.Id, u.Name, u.Email, u.Active)).ToListAsync(cancellationToken),
            cancellationToken);
    }

    /// <summary>
    /// Brings a guest account over: the person gets their own account here, with the same email, password and
    /// two-step sign-in, and signs in here from now on; the account in the other organization becomes the one standing
    /// for them, with everything it did and every project it is on. Their sessions there end.
    /// </summary>
    public async Task<IResult?> BringOverAsync(Actor actor, Guid linkId, Guid hostUserId, CancellationToken cancellationToken)
    {
        var me = tenant.Required;
        var link = await db.OrganizationLinks.AsNoTracking()
            .SingleOrDefaultAsync(l => l.Id == linkId && l.GuestTenantId == me && l.State == LinkStates.Linked, cancellationToken);
        if (link is null) return Problems.NotFound("LINK_NOT_FOUND", "No such organization we work with.");
        var guest = await TenantScope.RunAsync(scopes, link.HostTenantId, async (_, hostDb) =>
            await hostDb.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == hostUserId && u.PartyId == link.HostPartyId && u.HomeTenantId == null,
                cancellationToken), cancellationToken);
        if (guest is null) return Problems.NotFound("GUEST_NOT_FOUND", "No such guest account of ours there.");
        if (await db.Users.AnyAsync(u => u.NormalizedEmail == guest.NormalizedEmail, cancellationToken))
            return Problems.Conflict("EMAIL_TAKEN", $"{guest.Email} already has an account here.");

        // Their sign-in name moves here: the account there stops being one you sign in to.
        await db.SignInNames.Where(n => n.NormalizedEmail == guest.NormalizedEmail && n.TenantId == link.HostTenantId).ExecuteDeleteAsync(cancellationToken);
        var home = new User
        {
            TenantId = me,
            Email = guest.Email,
            NormalizedEmail = guest.NormalizedEmail,
            Name = guest.Name,
            PasswordHash = guest.PasswordHash,
            Active = guest.Active,
            MfaSecretProtected = guest.MfaSecretProtected,
            MfaEnabledAt = guest.MfaEnabledAt,
            RecoveryCodeHashes = guest.RecoveryCodeHashes,
        };
        db.Users.Add(home);
        db.AccountLinks.Add(new AccountLink
        {
            LinkId = link.Id,
            HomeTenantId = me,
            HomeUserId = home.Id,
            HostTenantId = link.HostTenantId,
            HostUserId = guest.Id,
            CreatedAt = clock.GetCurrentInstant(),
        });
        await audit.WriteAsync(actor, "GUEST_BROUGHT_OVER", "User", home.Id, home.Email,
            $"{home.Name} was a guest at {await HostNameAsync(link.HostTenantId, cancellationToken)}: now one of ours, still on their projects.",
            cancellationToken: cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await TenantScope.RunAsync(scopes, link.HostTenantId, async (services, hostDb) =>
        {
            var stand = await hostDb.Users.SingleAsync(u => u.Id == guest.Id, cancellationToken);
            stand.HomeTenantId = me;
            stand.PasswordHash = NoPassword;
            stand.MfaSecretProtected = null;
            stand.MfaEnabledAt = null;
            stand.RecoveryCodeHashes = [];
            await services.GetRequiredService<AuditLog>().WriteAsync(new Actor(null, $"{actor.Name} ({link.HostPartyName})"), "GUEST_BROUGHT_OVER",
                "User", stand.Id, stand.Email, $"{stand.Name} now signs in with {link.HostPartyName}'s own DELIOS; this account stands for them here.",
                cancellationToken: cancellationToken);
            await hostDb.SaveChangesAsync(cancellationToken);
            await services.GetRequiredService<SessionStore>().ForgetAllAsync(stand.Id, revoke: true, cancellationToken);
        }, cancellationToken);
        return null;
    }
}
