using Microsoft.Extensions.Caching.Memory;
using System.Security.Claims;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Identity;

/// <summary>The facts of a document the permission matrix selects on.</summary>
public sealed record DocumentFacts(
    string? DeliverableType, string? DocType, string? Discipline, string? Criticality, string? Confidentiality);

/// <summary>
/// What one person may do on one project: their function there, and the rules of
/// the matrix that apply to this project's contract role.
/// </summary>
public sealed class ProjectAccess
{
    public required Project Project { get; init; }
    public required Guid UserId { get; init; }
    public required string UserName { get; init; }
    public required Function Function { get; init; }
    public required IReadOnlyList<PermissionRule> Rules { get; init; }
    /// <summary>Our own staff, as opposed to someone representing another party.</summary>
    public required bool IsInternal { get; init; }
    /// <summary>Code of the party this person represents. Null: our own organization.</summary>
    public string? PartyCode { get; init; }
    /// <summary>Confidentiality levels above this person's clearance: read only where they are named on the document.</summary>
    public IReadOnlyList<string> AboveClearance { get; init; } = [];

    /// <summary>Every verb this person holds anywhere on the project, without duplicates.</summary>
    public IReadOnlySet<string> Verbs => Rules.SelectMany(r => r.Verbs).ToHashSet();

    /// <summary>Held anywhere in the matrix, whatever the document.</summary>
    public bool Holds(string verb) => Rules.Any(r => r.Verbs.Contains(verb));

    /// <summary>Held by a rule whose selectors all match this document.</summary>
    public bool Allows(string verb, DocumentFacts document) => Rules.Any(r =>
        r.Verbs.Contains(verb)
        && Matches(r.DeliverableType, document.DeliverableType)
        && Matches(r.DocType, document.DocType)
        && Matches(r.Discipline, document.Discipline)
        && Matches(r.Criticality, document.Criticality)
        && Matches(r.Confidentiality, document.Confidentiality));

    /// <summary>What a function may do on a project, whoever holds it: for asking about someone other than the caller.</summary>
    public static ProjectAccess OfFunction(Project project, Function function, Guid userId = default, string userName = "",
        bool actsAsControl = false) => new()
    {
        Project = project,
        UserId = userId,
        UserName = userName,
        Function = function,
        IsInternal = true,
        Rules = WithControl(function.Rules.Where(r => r.ProjectRole is null || r.ProjectRole == project.ContractRole).ToList(), actsAsControl),
    };

    /// <summary>
    /// Someone named on the project to act as the control function holds CONTROL on every document of it, whatever
    /// their function carries.
    /// </summary>
    public static IReadOnlyList<PermissionRule> WithControl(List<PermissionRule> rules, bool actsAsControl)
    {
        if (actsAsControl) rules.Add(new PermissionRule { Verbs = [Delios.Host.Identity.Verbs.Control], Note = "Acts as the control function on this project" });
        return rules;
    }

    /// <summary>A rule selector matches when it is null (any value) or exactly equal to the document's value.</summary>
    private static bool Matches(string? selector, string? value) =>
        selector is null || string.Equals(selector, value, StringComparison.Ordinal);
}

/// <summary>
/// Loads a <c>ProjectAccess</c> from the database for the signed-in user. Used by <c>ProjectAccessFilter</c> on project endpoints.
/// </summary>
public sealed class ProjectAccessLoader(DeliosDbContext db, AccessVersions versions)
{
    /// <summary>
    /// How long a kept copy may be used at most, whatever: a safety net only, should the number that leaves it unused
    /// fail to be raised (<see cref="AccessVersions"/>). Access is never kept longer than this.
    /// </summary>
    public static readonly TimeSpan KeptAtMost = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Null when the person holds no active function on an active project, which
    /// callers answer with 404: a project you are not on does not exist for you.
    /// </summary>
    public async Task<ProjectAccess?> LoadAsync(Guid projectId, ClaimsPrincipal principal, CancellationToken cancellationToken)
    {
        // Kept until how the organization works changes (owner: "static once done"): the number says whether it did.
        var version = await versions.CurrentAsync(principal.TenantId());
        var key = version is null ? null : $"access:{principal.TenantId():N}:{version}:{projectId:N}:{principal.UserId():N}:{principal.Identity?.Name}";
        if (key is not null && versions.Kept.TryGetValue(key, out ProjectAccess? kept) && kept is not null)
        {
            db.UseListsOf(kept.Project.Id, kept.Project.OwnListKeys, kept.Project.OwnFunctions);
            return kept;
        }
        var loaded = await ReadAsync(projectId, principal, cancellationToken);
        if (key is not null && loaded is not null)
            versions.Kept.Set(key, loaded, new Microsoft.Extensions.Caching.Memory.MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = KeptAtMost,
                Size = 1,
            });
        return loaded;
    }

    private async Task<ProjectAccess?> ReadAsync(Guid projectId, ClaimsPrincipal principal, CancellationToken cancellationToken)
    {
        var userId = principal.UserId();
        var membership = await db.Memberships.AsNoTracking()
            .Include(m => m.Project)
            .Include(m => m.Function!).ThenInclude(f => f.Rules)
            .Where(m => m.ProjectId == projectId && m.UserId == userId && m.Active
                && m.Function!.Active && m.Project!.Status == "ACTIVE")
            .SingleOrDefaultAsync(cancellationToken);
        if (membership is null) return null;

        var party = await db.Users.AsNoTracking().Where(u => u.Id == userId)
            .Select(u => u.Party == null ? null : new { u.Party.Code, u.Party.IsInternal })
            .SingleAsync(cancellationToken);
        var project = membership.Project!;
        // Its lists from here on: its own copy once it has one, else the organization's.
        db.UseListsOf(project.Id, project.OwnListKeys, project.OwnFunctions);
        // What the function may do here, read now the project is set: its own copy where it keeps one.
        var rules = await db.PermissionRules.AsNoTracking().Where(r => r.FunctionId == membership.FunctionId).ToListAsync(cancellationToken);
        var above = membership.Function!.Clearance is null ? []
            : Clearance.Above(await Clearance.RanksAsync(db, cancellationToken), membership.Function.Clearance);
        return new ProjectAccess
        {
            Project = project,
            UserId = userId,
            UserName = principal.Identity?.Name ?? "",
            Function = membership.Function!,
            Rules = ProjectAccess.WithControl(rules
                .Where(r => r.ProjectRole is null || r.ProjectRole == project.ContractRole)
                .ToList(), membership.ActsAsControl),
            IsInternal = party is null || party.IsInternal,
            PartyCode = party?.Code,
            AboveClearance = above,
        };
    }
}
