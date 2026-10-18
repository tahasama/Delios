using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Checks;

/// <summary>
/// <c>GET /api/projects/{projectId}/management-plan</c>: what the project's document management plan is written from and only the
/// keepers read elsewhere: the numbering, how revisions are named, the review routes with who answers each step, and
/// each function with what it may do and who holds it here. Everyone of ours on the project reads it; another
/// organization's people do not (the plan is ours). The lists, the project's answers and the directory are read where
/// they already are.
/// </summary>
public static class PlanEndpoints
{
    public static void MapPlanEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGroup("/api/projects/{projectId:guid}/management-plan").WithTags("Assurance")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>()
            .MapGet("", PlanAsync);
    }

    private static async Task<IResult> PlanAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal) return Problems.Forbidden("OURS_ONLY", "The plan is the project's own organization's.");
        var project = access.Project;

        var numbering = await NumberingLevels.ScopeAsync(db, project.Id, cancellationToken);
        var schemes = await db.NumberingSchemes.AsNoTracking().Where(s => s.ProjectId == numbering && s.Active).OrderBy(s => s.Name).ToListAsync(cancellationToken);
        var routing = await db.SchemeRoutings.AsNoTracking().Where(r => r.ProjectId == numbering && r.Active).OrderBy(r => r.DeliverableType).ToListAsync(cancellationToken);
        var naming = await RevisionSchemeEndpoints.ScopeAsync(db, project.Id, cancellationToken);
        var revisions = await db.RevisionSchemes.AsNoTracking().Where(s => s.ProjectId == naming).OrderByDescending(s => s.IsDefault).ThenBy(s => s.Name).ToListAsync(cancellationToken);
        var revisionRouting = await db.RevisionSchemeRoutings.AsNoTracking().Where(r => r.ProjectId == naming).ToListAsync(cancellationToken);
        var routeScope = await CatalogAdminEndpoints.RouteScopeAsync(db, project.Id, cancellationToken);
        var routes = await db.ReviewRoutes.AsNoTracking().Where(r => r.ProjectId == routeScope && r.Active).OrderByDescending(r => r.IsDefault).ThenBy(r => r.Name)
            .ToListAsync(cancellationToken);

        // Who is on the project, by function: the people named on steps and the holders of each function read by name.
        var members = await db.Memberships.AsNoTracking().Where(m => m.ProjectId == project.Id && m.Active && m.PendingSince == null)
            .Join(db.Users.AsNoTracking().Where(u => u.Active), m => m.UserId, u => u.Id,
                (m, u) => new { m.UserId, u.Name, m.FunctionId, m.Department, m.ActsAsControl })
            .ToListAsync(cancellationToken);
        var names = members.ToDictionary(m => m.UserId, m => m.Name);
        var functions = await db.Functions.AsNoTracking().Include(f => f.Rules).Where(f => f.Active).OrderBy(f => f.Name).ToListAsync(cancellationToken);

        return Results.Ok(new
        {
            Numbering = schemes.Select(s => new
            {
                s.Name, s.Delimiter, s.Fields,
                DeliverableTypes = routing.Where(r => r.SchemeId == s.Id).Select(r => r.DeliverableType).ToList(),
            }),
            Revisions = revisions.Select(s => new
            {
                s.Name, s.IsDefault, s.ForwardOnly, s.Series,
                DeliverableTypes = revisionRouting.Where(r => r.SchemeId == s.Id).Select(r => r.DeliverableType).ToList(),
            }),
            Routes = routes.Select(r => new
            {
                r.Name, r.Description, r.IsDefault, VerdictSet = ReviewSets.Verdicts, r.Verdicts, r.Patterns,
                Steps = r.Steps.Select(s => new
                {
                    s.Title, s.FunctionCode, s.PartyCode, s.Reason, s.Mode, s.Days, s.GrantsStatuses,
                    People = s.UserIds.Where(names.ContainsKey).Select(id => names[id]).ToList(),
                    Holders = s.FunctionCode is null ? [] : members
                        .Where(m => functions.FirstOrDefault(f => f.Code == s.FunctionCode)?.Id == m.FunctionId).Select(m => m.Name).ToList(),
                }),
            }),
            // Each function used here, what its rows let it do, and who holds it on the project (ours and theirs).
            Functions = functions
                .Select(f => new
                {
                    f.Code, f.Name, f.Clearance,
                    Rows = f.Rules.Where(r => r.ProjectRole is null || r.ProjectRole == project.ContractRole)
                        .Select(r => new { r.Verbs, r.DeliverableType, r.DocType, r.Discipline, r.Criticality, r.Confidentiality, r.Note }).ToList(),
                    Holders = members.Where(m => m.FunctionId == f.Id).Select(m => new { m.Name, m.Department }).ToList(),
                })
                .Where(f => f.Holders.Count > 0 || f.Rows.Count > 0),
            Control = members.Where(m => m.ActsAsControl || functions.Any(f => f.Id == m.FunctionId
                    && f.Rules.Any(r => r.Verbs.Contains(Verbs.Control) && (r.ProjectRole is null || r.ProjectRole == project.ContractRole))))
                .Select(m => m.Name).Distinct().ToList(),
            Departments = members.Where(m => m.Department != null).Select(m => m.Department!).Distinct().OrderBy(d => d).ToList(),
        });
    }
}
