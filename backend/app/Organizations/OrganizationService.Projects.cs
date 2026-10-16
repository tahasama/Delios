using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Organizations;

/// <summary>Body of an organization's part in one of our projects: its role, and the function a collaborator's people start with.</summary>
/// <remarks>
/// <c>ContractNumber</c>: the contract between the project's organization and this one (null leaves it as it is). Unique
/// across DELIOS; once given, it is changed once at most.
/// </remarks>
public sealed record ProjectPartyRequest(string? Role, Guid? StartFunctionId, bool Active = true, string? ContractNumber = null);

/// <summary>An organization taking part in our project, as our project reads it.</summary>
public sealed record ProjectPartyView(Guid PartyId, string Code, string Name, string Kind, string? LinkedOrganization, string? Role,
    Guid? StartFunctionId, string? StartFunction, bool Active, int People, string? ContractNumber = null,
    string? PreviousContractNumber = null, string? ContractChangedByName = null, DateTimeOffset? ContractChangedAt = null);

/// <summary>Someone of ours on a project of another organization's: their own account, and the function they hold there.</summary>
public sealed record JoinedPerson(Guid UserId, string Name, string Function, bool Active);

/// <summary>
/// A project of another organization's that we take part in: whose it is, the role we play, the function our people
/// start with, and our people on it.
/// </summary>
public sealed record JoinedProject(Guid LinkId, Guid HostTenantId, string HostOrganization, Guid ProjectId, string Code, string Name,
    string Status, string? Role, string? StartFunction, IReadOnlyList<JoinedPerson> OurPeople);

public sealed partial class OrganizationService
{
    // ── Organizations taking part in our projects ─────────────────────────────

    /// <summary>The organizations taking part in one of our projects, each with its kind, role and people on it.</summary>
    public async Task<IReadOnlyList<ProjectPartyView>> ProjectPartiesAsync(Guid projectId, CancellationToken cancellationToken)
    {
        var rows = await db.ProjectParties.AsNoTracking().Where(p => p.ProjectId == projectId).ToListAsync(cancellationToken);
        var partyIds = rows.Select(r => r.PartyId).ToList();
        var parties = await db.Parties.AsNoTracking().Where(p => partyIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, cancellationToken);
        var functionIds = rows.Where(r => r.StartFunctionId != null).Select(r => r.StartFunctionId!.Value).ToList();
        var functions = await db.Functions.AsNoTracking().Where(f => functionIds.Contains(f.Id)).ToDictionaryAsync(f => f.Id, f => f.Name, cancellationToken);
        var people = await (from m in db.Memberships
                            join u in db.Users on m.UserId equals u.Id
                            where m.ProjectId == projectId && m.Active && u.Active && u.PartyId != null
                            group m by u.PartyId into g
                            select new { g.Key, Count = g.Count() }).AsNoTracking().ToListAsync(cancellationToken);
        var links = await PartyLinksAsync(cancellationToken);
        return rows.Where(r => parties.ContainsKey(r.PartyId)).Select(r =>
        {
            var party = parties[r.PartyId];
            var linked = links.TryGetValue(r.PartyId, out var link) && link.State == LinkStates.Linked;
            return new ProjectPartyView(r.PartyId, party.Code, party.Name, KindOf(party, linked), linked ? link.Organization : null, r.Role,
                r.StartFunctionId, r.StartFunctionId is { } f ? functions.GetValueOrDefault(f) : null, r.Active,
                people.FirstOrDefault(p => p.Key == r.PartyId)?.Count ?? 0, r.ContractNumber, r.PreviousContractNumber, r.ContractChangedByName,
                r.ContractChangedAt?.ToDateTimeOffset());
        }).OrderBy(v => v.Name).ToList();
    }

    /// <summary>Says an organization takes part in our project (or no longer does), its role, and the function a collaborator's people start with.</summary>
    public async Task<IResult?> SetProjectPartyAsync(Actor actor, Guid projectId, Guid partyId, ProjectPartyRequest request,
        CancellationToken cancellationToken)
    {
        var project = await db.Projects.AsNoTracking().SingleOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        var party = await db.Parties.AsNoTracking().SingleOrDefaultAsync(p => p.Id == partyId, cancellationToken);
        if (project is null || party is null) return Problems.NotFound("NOT_FOUND", "No such project or organization.");
        if (party.IsInternal) return Problems.Invalid("PARTY_INTERNAL", $"{party.Name} is our own organization: its role is the project's.");
        var role = Blank(request.Role)?.ToUpperInvariant();
        if (role is not null && !BuiltInRoles.Contains(role)
            && !await db.ValueEntries.AnyAsync(v => v.SetKey == "CONTRACT_ROLES" && v.Code == role && v.Status == Documents.ValueStatus.Active, cancellationToken))
            return Problems.Invalid("VALUE_NOT_PUBLISHED", $"{role} is not a published role.", new { field = "role", value = role });
        if (request.StartFunctionId is { } fid && !await db.Functions.AnyAsync(f => f.Id == fid && f.Active, cancellationToken))
            return Problems.Invalid("FUNCTION_UNKNOWN", "Choose one of our functions.");
        var row = await db.ProjectParties.SingleOrDefaultAsync(p => p.ProjectId == projectId && p.PartyId == partyId, cancellationToken);
        if (row is null)
        {
            row = new ProjectParty { TenantId = tenant.Required, ProjectId = projectId, PartyId = partyId, AddedAt = clock.GetCurrentInstant(), AddedByName = actor.Name };
            db.ProjectParties.Add(row);
        }
        // The contract between us and them: its number is its own across DELIOS, and changed once at most.
        if (Blank(request.ContractNumber) is { } contract && contract != row.ContractNumber)
        {
            if (row.ContractNumber is not null && row.ContractChangedAt is not null)
                return Problems.Conflict("CHANGED_ONCE",
                    $"The contract number was already changed once (from {row.PreviousContractNumber}, by {row.ContractChangedByName}): it is fixed now.",
                    new { field = "contractNumber" });
            if (!await Registry.ReserveAsync(db, ReservedKinds.Contract, contract, row.Id, tenant.Required, cancellationToken))
                return Problems.Conflict("CONTRACT_TAKEN", $"{contract} is already a contract's number on DELIOS, or was: a number is never used twice.",
                    new { field = "contractNumber" });
            if (row.ContractNumber is not null)
            {
                row.PreviousContractNumber = row.ContractNumber;
                row.ContractChangedAt = clock.GetCurrentInstant();
                row.ContractChangedByName = actor.Name;
            }
            await audit.WriteAsync(actor, "PROJECT_PARTY_SET", "Project", projectId, project.Code,
                row.ContractNumber is null ? $"{party.Name}: contract {contract}." : $"{party.Name}: contract {row.ContractNumber} → {contract}.",
                projectId, cancellationToken);
            row.ContractNumber = contract;
        }
        row.Role = role;
        row.StartFunctionId = request.StartFunctionId;
        row.Active = request.Active;
        await audit.WriteAsync(actor, request.Active ? "PROJECT_PARTY_SET" : "PROJECT_PARTY_REMOVED", "Project", projectId, project.Code,
            request.Active ? $"{party.Name} takes part{(role is null ? "" : $" as {role}")}." : $"{party.Name} no longer takes part.",
            projectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return null;
    }

    /// <summary>The roles the app knows before an organization publishes its own list (frontend lib/settings/profiles/roles.ts).</summary>
    private static readonly HashSet<string> BuiltInRoles = ["GENERIC", "EPC", "EPCM", "PMC", "DESIGN", "OWNER", "CM", "CONTRACTOR", "SUBCONTRACTOR", "SUPPLIER", "INSPECTOR"];

    // ── Projects of other organizations' that we take part in ─────────────────

    /// <summary>
    /// Every project of another organization's that we take part in, through each link we accepted: the role we play,
    /// the function our people start with, and our people on it.
    /// </summary>
    public async Task<IReadOnlyList<JoinedProject>> JoinedAsync(CancellationToken cancellationToken)
    {
        var me = tenant.Required;
        var links = await db.OrganizationLinks.AsNoTracking().Where(l => l.GuestTenantId == me && l.State == LinkStates.Linked)
            .ToListAsync(cancellationToken);
        var hostIds = links.Select(l => l.HostTenantId).Distinct().ToList();
        var hostNames = await db.Tenants.AsNoTracking().Where(t => hostIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Name, cancellationToken);
        var accounts = await db.AccountLinks.AsNoTracking().Where(a => a.HomeTenantId == me && a.EndedAt == null).ToListAsync(cancellationToken);
        var ourNames = await db.Users.AsNoTracking().Where(u => u.HomeTenantId == null).ToDictionaryAsync(u => u.Id, u => u.Name, cancellationToken);
        var result = new List<JoinedProject>();
        foreach (var link in links)
        {
            var mine = accounts.Where(a => a.LinkId == link.Id).ToDictionary(a => a.HostUserId, a => a.HomeUserId);
            var hostUsers = mine.Keys.ToList();
            var projects = await TenantScope.RunAsync(scopes, link.HostTenantId, async (_, hostDb) =>
            {
                var rows = await hostDb.ProjectParties.AsNoTracking()
                    .Where(p => p.PartyId == link.HostPartyId && p.Active && p.Project!.Status != "ARCHIVED")
                    .Select(p => new { p.ProjectId, p.Project!.Code, p.Project.Name, p.Project.Status, p.Role, Start = p.StartFunction!.Name })
                    .ToListAsync(cancellationToken);
                var ids = rows.Select(r => r.ProjectId).ToList();
                var members = await (from m in hostDb.Memberships
                                     join u in hostDb.Users on m.UserId equals u.Id
                                     where ids.Contains(m.ProjectId) && hostUsers.Contains(m.UserId)
                                     select new { m.ProjectId, m.UserId, Function = m.Function!.Name, m.Active, UserActive = u.Active })
                    .AsNoTracking().ToListAsync(cancellationToken);
                return rows.Select(r => new JoinedProject(link.Id, link.HostTenantId, hostNames.GetValueOrDefault(link.HostTenantId) ?? "",
                    r.ProjectId, r.Code, r.Name, r.Status, r.Role, r.Start,
                    members.Where(m => m.ProjectId == r.ProjectId).Select(m => new JoinedPerson(mine[m.UserId],
                        ourNames.GetValueOrDefault(mine[m.UserId]) ?? "", m.Function, m.Active && m.UserActive)).OrderBy(p => p.Name).ToList()))
                    .ToList();
            }, cancellationToken);
            result.AddRange(projects);
        }
        return result.OrderBy(p => p.HostOrganization).ThenBy(p => p.Code).ToList();
    }
}
