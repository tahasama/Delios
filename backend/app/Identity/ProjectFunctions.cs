using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Notifications;
using Delios.Host.Platform;
using Delios.Host.Settings;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using System.Text.Json;

namespace Delios.Host.Identity;

/// <summary>
/// What each function may do, on a project (owner: "we should be able to change functions on a project level"). The
/// functions themselves (their names, codes, clearance, in use) are the organization's; where the organization leaves
/// Functions &amp; permissions free, a project changes what each may do there, its first change copying every function's
/// rights onto it (<see cref="Project.OwnFunctions"/>, rules marked with its id), which the organization's later changes
/// never touch. Put back to the organization's only from the organization's card, with why, its copy kept.
/// </summary>
public static class ProjectFunctions
{
    /// <summary>Registers the project's routes and the organization's view of the copies.</summary>
    public static void MapProjectFunctionEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}/functions").WithTags("Settings")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("", ViewAsync);
        project.MapPut("/{functionId:guid}/rules", RulesAsync);

        var org = app.MapGroup("/api/admin/functions/projects").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("A project's own rights are put back by an administrator, from the organization's Settings."));
        org.MapGet("", CopiesAsync);
        org.MapPost("/{projectId:guid}/reset", ResetAsync);
    }

    /// <summary>
    /// <c>GET /api/projects/{id}/functions</c>: every function with what it may do on this project, how many hold it here,
    /// whether the project has its own copy, whether it may (the switch), and whether this person may change it.
    /// </summary>
    private static async Task<IResult> ViewAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal) return Problems.Forbidden("INTERNAL_ONLY", "What each function may do is ours to read.");
        var projectId = access.Project.Id;
        var own = access.Project.OwnFunctions;
        var functions = await db.Functions.AsNoTracking().OrderBy(f => f.Name).ToListAsync(cancellationToken);
        var rules = await db.PermissionRules.IgnoreQueryFilters().AsNoTracking()
            .Where(r => r.TenantId == access.Project.TenantId && r.ProjectId == (own ? projectId : null)).ToListAsync(cancellationToken);
        var held = await db.Memberships.AsNoTracking().Where(m => m.ProjectId == projectId && m.Active).GroupBy(m => m.FunctionId)
            .Select(g => new { g.Key, Count = g.Count() }).ToListAsync(cancellationToken);
        return Results.Ok(new
        {
            Own = own,
            Free = await Liberty.IsFreeAsync(db, Liberty.Functions, cancellationToken),
            MayChange = await ProjectLists.MayChangeAsync(db, access, cancellationToken),
            Functions = functions.Select(f => new
            {
                f.Id, f.Code, f.Name, f.Active, f.Clearance,
                Holders = held.FirstOrDefault(h => h.Key == f.Id)?.Count ?? 0,
                Rules = rules.Where(r => r.FunctionId == f.Id)
                    .Select(r => new { r.Id, r.Verbs, r.DeliverableType, r.DocType, r.Discipline, r.Criticality, r.Confidentiality, r.ProjectRole, r.Family, r.Note }),
            }),
        });
    }

    /// <summary>
    /// <c>PUT /api/projects/{id}/functions/{functionId}/rules</c>: what one function may do on this project, its rows
    /// replaced as a whole. Only where Functions &amp; permissions is free, by whoever changes the project's settings; the
    /// project's copy is made first. Configure stays the organization's: a project never grants it.
    /// </summary>
    private static async Task<IResult> RulesAsync(Guid functionId, UpdateFunctionRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!await Liberty.IsFreeAsync(db, Liberty.Functions, cancellationToken))
            return Problems.Forbidden("FUNCTIONS_FIXED", "What each function may do is the organization's, the same on every project: an administrator changes it on the organization's page.");
        if (!await ProjectLists.MayChangeAsync(db, access, cancellationToken))
            return Problems.Forbidden("CONTROL_ONLY", "Whoever acts as the control function on this project changes what each function may do here (on a project with none, whoever opened it).");
        var rules = request.Rules ?? [];
        if (rules.Any(r => (r.Verbs ?? []).Contains(Verbs.Configure)))
            return Problems.Forbidden("CONFIGURE_ORGANIZATIONS", "Configure is the organization's: it is given on the organization's page, never on a project.");
        foreach (var rule in rules)
        {
            var unknown = (rule.Verbs ?? []).Where(v => !Verbs.All.Contains(v)).ToList();
            if (unknown.Count > 0) return Problems.Invalid("VERB_UNKNOWN", $"{string.Join(", ", unknown)} is not a right.", new { verbs = unknown });
        }
        var function = await db.Functions.AsNoTracking().SingleOrDefaultAsync(f => f.Id == functionId, cancellationToken);
        if (function is null) return Problems.NotFound("FUNCTION_NOT_FOUND", "No such function.");
        // The administrators' function (one that configures) is the organization's to change (owner): a project could
        // otherwise take Configure away from it, or give its holders more. Read from the rights in force, before any copy.
        var project = await db.Projects.SingleAsync(p => p.Id == access.Project.Id, cancellationToken);
        var inForce = project.OwnFunctions ? project.Id : (Guid?)null;
        if (await db.PermissionRules.IgnoreQueryFilters().AnyAsync(r => r.TenantId == project.TenantId && r.ProjectId == inForce
                && r.FunctionId == functionId && r.Verbs.Contains(Verbs.Configure), cancellationToken))
            return Problems.Forbidden("CONFIGURE_ORGANIZATIONS", $"{function.Name} configures the organization: what it may do is changed in the organization's Settings, never on a project.");
        await EnsureOwnAsync(db, project, cancellationToken);
        var mine = await db.PermissionRules.IgnoreQueryFilters().Where(r => r.ProjectId == project.Id && r.FunctionId == functionId).ToListAsync(cancellationToken);
        db.PermissionRules.RemoveRange(mine);
        foreach (var rule in rules.Where(r => (r.Verbs ?? []).Length > 0))
            db.PermissionRules.Add(new PermissionRule
            {
                TenantId = project.TenantId,
                ProjectId = project.Id,
                FunctionId = functionId,
                Verbs = rule.Verbs!.Distinct().ToArray(),
                DeliverableType = Blank(rule.DeliverableType),
                DocType = Blank(rule.DocType),
                Discipline = Blank(rule.Discipline),
                Criticality = Blank(rule.Criticality),
                Confidentiality = Blank(rule.Confidentiality),
                ProjectRole = Blank(rule.ProjectRole),
                Family = Blank(rule.Family) is { } family && family.Length <= 32 ? family : null,
                Note = Blank(rule.Note) is { } note ? note.Length > 300 ? note[..300] : note : null,
            });
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "FUNCTION_UPDATED", "Function", function.Id, function.Name,
            $"on {project.Code}: {rules.Length} row(s)", project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>The project's own copy of every function's rights, made on its first change: the organization's as they stand.</summary>
    private static async Task EnsureOwnAsync(DeliosDbContext db, Project project, CancellationToken cancellationToken)
    {
        if (project.OwnFunctions) return;
        var organization = await db.PermissionRules.IgnoreQueryFilters().AsNoTracking()
            .Where(r => r.TenantId == project.TenantId && r.ProjectId == null).ToListAsync(cancellationToken);
        foreach (var r in organization)
            db.PermissionRules.Add(new PermissionRule
            {
                TenantId = project.TenantId, ProjectId = project.Id, FunctionId = r.FunctionId, Verbs = r.Verbs,
                DeliverableType = r.DeliverableType, DocType = r.DocType, Discipline = r.Discipline, Criticality = r.Criticality,
                Confidentiality = r.Confidentiality, ProjectRole = r.ProjectRole, Family = r.Family, Note = r.Note,
            });
        project.OwnFunctions = true;
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary><c>GET /api/admin/functions/projects</c>: the projects with their own rights, since their first change.</summary>
    private static async Task<IResult> CopiesAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var projects = await db.Projects.AsNoTracking().Where(p => p.OwnFunctions).OrderBy(p => p.Code)
            .Select(p => new { p.Id, p.Code, p.Name }).ToListAsync(cancellationToken);
        var ids = projects.Select(p => p.Id).ToList();
        var since = await db.AuditEvents.AsNoTracking()
            .Where(e => e.Action == "FUNCTION_UPDATED" && e.ProjectId != null && ids.Contains(e.ProjectId.Value))
            .GroupBy(e => e.ProjectId).Select(g => new { g.Key, At = g.Min(e => e.At) }).ToListAsync(cancellationToken);
        var by = await db.AuditEvents.AsNoTracking()
            .Where(e => e.Action == "FUNCTION_UPDATED" && e.ProjectId != null && ids.Contains(e.ProjectId.Value))
            .OrderBy(e => e.At).Select(e => new { e.ProjectId, e.ActorName }).ToListAsync(cancellationToken);
        return Results.Ok(projects.Select(p => new
        {
            p.Id, p.Code, p.Name,
            Since = since.FirstOrDefault(s => s.Key == p.Id)?.At.ToDateTimeOffset(),
            By = by.FirstOrDefault(b => b.ProjectId == p.Id)?.ActorName ?? "",
        }));
    }

    /// <summary>The project's own rights as a kept copy holds them.</summary>
    public sealed record FunctionsCopy(List<KeptRule> Rules);
    public sealed record KeptRule(Guid FunctionId, string[] Verbs, string? DeliverableType, string? DocType, string? Discipline, string? Criticality,
        string? Confidentiality, string? ProjectRole, string? Family, string? Note);

    /// <summary>
    /// <c>POST /api/admin/functions/projects/{id}/reset</c> (owner: from the organization's Settings, for a mess only): the
    /// project reads the organization's rights again; its own are kept, to be put back if wanted. With why, logged, its
    /// control function told.
    /// </summary>
    private static async Task<IResult> ResetAsync(Guid projectId, NumberingLevels.ResetRequest request, HttpContext http, DeliosDbContext db,
        AuditLog audit, Notifier notifier, IClock clock, CancellationToken cancellationToken)
    {
        var reason = Blank(request.Reason);
        if (reason is null) return Problems.Invalid("REASON_REQUIRED", "Say why the project goes back to the organization's functions.");
        var project = await db.Projects.SingleOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return Problems.NotFound("PROJECT_NOT_FOUND", "No such project.");
        if (!project.OwnFunctions) return Problems.Invalid("NOT_OWN", $"{project.Code} already reads the organization's functions.");
        var me = await db.Users.AsNoTracking().Where(u => u.Id == http.User.UserId()).Select(u => u.Name).SingleAsync(cancellationToken);
        var rows = await db.PermissionRules.IgnoreQueryFilters().Where(r => r.ProjectId == projectId).ToListAsync(cancellationToken);
        KeptCopies.Keep(db, clock, project.TenantId, project.Id, "FUNCTIONS", "functions & permissions",
            new FunctionsCopy(rows.Select(r => new KeptRule(r.FunctionId, r.Verbs, r.DeliverableType, r.DocType, r.Discipline, r.Criticality,
                r.Confidentiality, r.ProjectRole, r.Family, r.Note)).ToList()), me, reason);
        db.PermissionRules.RemoveRange(rows);
        project.OwnFunctions = false;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(http.User.UserId(), me), "SETTING_RESET", "Project", project.Id, $"{project.Code}: functions & permissions", reason,
            project.Id, cancellationToken);
        await notifier.NotifyAsync(project.TenantId, project.Id, await Actions.NoticeLog.HoldersAsync(db, project.Id, Verbs.Control, cancellationToken),
            NotificationKinds.General, $"{project.Code} reads the organization's functions again",
            $"{me} put what each function may do on {project.Code} back to the organization's: {reason}. Its own is kept.",
            "/settings/functions", cancellationToken);
        return Results.NoContent();
    }

    /// <summary>Puts kept rights back on the project, as they were.</summary>
    public static async Task<IResult?> PutBackAsync(DeliosDbContext db, Project project, string payload, CancellationToken cancellationToken)
    {
        if (project.OwnFunctions) return KeptCopies.OwnAgain(project.Code, "functions & permissions");
        var copy = JsonSerializer.Deserialize<FunctionsCopy>(payload, KeptCopies.Json)!;
        var live = await db.Functions.AsNoTracking().Select(f => f.Id).ToListAsync(cancellationToken);
        foreach (var r in copy.Rules.Where(r => live.Contains(r.FunctionId)))
            db.PermissionRules.Add(new PermissionRule
            {
                TenantId = project.TenantId, ProjectId = project.Id, FunctionId = r.FunctionId, Verbs = r.Verbs, DeliverableType = r.DeliverableType,
                DocType = r.DocType, Discipline = r.Discipline, Criticality = r.Criticality, Confidentiality = r.Confidentiality,
                ProjectRole = r.ProjectRole, Family = r.Family, Note = r.Note,
            });
        project.OwnFunctions = true;
        await db.SaveChangesAsync(cancellationToken);
        return null;
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
