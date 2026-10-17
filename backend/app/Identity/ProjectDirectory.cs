using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Identity;

/// <summary>Body of naming who acts as the control function on a project: everyone named, the rest no longer.</summary>
public sealed record ControlPeopleRequest(Guid[]? UserIds);

/// <summary>
/// The project directory (owner's decision): everyone on the project reads who takes part, the organizations and their
/// people. And the project's configuration names who acts as the control function, whatever their function: no function
/// or job title is fixed in the code; the control function is whoever holds CONTROL on the project.
/// </summary>
public static class ProjectDirectory
{
    public static void MapProjectDirectoryEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("People")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("/people/directory", DirectoryAsync);
        project.MapPut("/people/control", ControlPeopleAsync);
    }

    /// <summary>
    /// <c>GET /people/directory</c>: the organizations taking part (ours first), with their role, how they work with us and
    /// who answers for each; the people on the project, with their function, department and organization; and who acts
    /// as the control function. Emails are read by our own people only.
    /// </summary>
    private static async Task<IResult> DirectoryAsync(HttpContext http, DeliosDbContext db, Organizations.OrganizationService organizations,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var projectId = access.Project.Id;
        var ours = access.IsInternal;
        var people = await (from m in db.Memberships.AsNoTracking()
                            join u in db.Users.AsNoTracking() on m.UserId equals u.Id
                            join f in db.Functions.AsNoTracking() on m.FunctionId equals f.Id
                            join p in db.Parties.AsNoTracking() on u.PartyId equals p.Id into ps
                            from p in ps.DefaultIfEmpty()
                            where m.ProjectId == projectId && m.Active && u.Active
                            orderby u.Name
                            select new
                            {
                                u.Id, u.Name, u.Email, u.PartyId,
                                // A linked account reads in its own organization's words: "ACME / Lead Engineer".
                                Function = u.HomeFunction != null ? p.Code + " / " + u.HomeFunction : f.Name, m.Department, m.ActsAsControl,
                                ControlByFunction = f.Rules.Any(r => r.Verbs.Contains(Verbs.Control)),
                                Manages = f.Rules.Any(r => r.Verbs.Contains(Verbs.Manage)),
                            }).ToListAsync(cancellationToken);
        var taking = await db.ProjectParties.AsNoTracking().Where(pp => pp.ProjectId == projectId && pp.Active)
            .ToDictionaryAsync(pp => pp.PartyId, pp => pp.Role, cancellationToken);
        var parties = await db.Parties.AsNoTracking()
            .Where(p => p.Active && (p.IsInternal || taking.Keys.Contains(p.Id))).ToListAsync(cancellationToken);
        var links = await organizations.PartyLinksAsync(cancellationToken);
        var answers = await db.Set<Settings.Setting>().AsNoTracking()
            .Where(s => (s.ProjectId == projectId || s.ProjectId == null) && s.Key.StartsWith("PARTY:"))
            .Select(s => new { s.Key, s.Value, s.ProjectId }).ToListAsync(cancellationToken);
        var names = people.ToDictionary(p => p.Id, p => p.Name);
        string? Contact(Guid partyId)
        {
            var said = answers.Where(a => a.Key == $"PARTY:{partyId}").OrderByDescending(a => a.ProjectId != null).FirstOrDefault();
            if (said is null) return null;
            try
            {
                using var json = JsonDocument.Parse(said.Value);
                return json.RootElement.TryGetProperty("contactId", out var id) && id.ValueKind == JsonValueKind.String
                    && Guid.TryParse(id.GetString(), out var g) && names.TryGetValue(g, out var name) ? name : null;
            }
            catch (JsonException) { return null; }
        }
        var internalIds = parties.Where(p => p.IsInternal).Select(p => p.Id).ToHashSet();
        return Results.Ok(new
        {
            Organizations = parties
                .OrderByDescending(p => p.IsInternal).ThenBy(p => p.Name)
                .Select(p => new
                {
                    p.Id, p.Code, p.Name,
                    Role = taking.GetValueOrDefault(p.Id),
                    Kind = p.IsInternal ? "OURS"
                        : links.TryGetValue(p.Id, out var l) && l.State == Organizations.LinkStates.Linked ? "COLLABORATOR"
                        : p.Participation == Participations.ByProxy ? "OFFLINE" : "GUEST",
                    Contact = Contact(p.Id),
                    ContactEmail = ours ? p.ContactEmail : null,
                    People = people.Count(x => x.PartyId == p.Id || (p.IsInternal && x.PartyId == null && p.Id == internalIds.First())),
                }),
            People = people.Select(p => new
            {
                p.Id, p.Name, Email = ours ? p.Email : null, p.PartyId,
                Organization = p.PartyId is { } pid ? parties.FirstOrDefault(x => x.Id == pid)?.Name : parties.FirstOrDefault(x => x.IsInternal)?.Name,
                p.Function, p.Department,
                Control = p.ActsAsControl || p.ControlByFunction, p.ActsAsControl, p.Manages,
            }),
            MayNameControl = await MayNameControlAsync(http, access),
        });
    }

    /// <summary>
    /// <c>PUT /people/control</c>: who acts as the control function on the project, whatever their function. An
    /// administrator, or whoever already acts as it. Someone of ours on the project only. Nobody may be named: the
    /// project then has no control function, and the people doing the work carry its acts out themselves. Those named
    /// or no longer named are told; it is logged.
    /// </summary>
    private static async Task<IResult> ControlPeopleAsync(ControlPeopleRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        Notifications.Notifier notifier, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var project = access.Project;
        if (!await MayNameControlAsync(http, access))
            return Problems.Forbidden("CONTROL_ONLY", "An administrator, or whoever acts as the control function, names who acts as it.");
        var wanted = (request.UserIds ?? []).Distinct().ToHashSet();
        var memberships = await db.Memberships.Include(m => m.Function!).ThenInclude(f => f.Rules)
            .Where(m => m.ProjectId == project.Id && m.Active).ToListAsync(cancellationToken);
        var users = await db.Users.AsNoTracking().Where(u => memberships.Select(m => m.UserId).Contains(u.Id))
            .Select(u => new { u.Id, u.Name, u.Active, Internal = u.Party == null || u.Party.IsInternal }).ToDictionaryAsync(u => u.Id, cancellationToken);
        foreach (var id in wanted)
        {
            if (!memberships.Any(m => m.UserId == id) || !users.TryGetValue(id, out var one) || !one.Active)
                return Problems.Invalid("NOT_ON_PROJECT", $"Only someone on {project.Code} acts as its control function.");
            if (!one.Internal)
                return Problems.Invalid("OURS_ONLY", $"{one.Name} is of another organization: the control function is ours.");
        }
        var named = new List<Guid>();
        var unnamed = new List<Guid>();
        foreach (var m in memberships)
        {
            var on = wanted.Contains(m.UserId);
            if (on == m.ActsAsControl) continue;
            m.ActsAsControl = on;
            (on ? named : unnamed).Add(m.UserId);
        }
        if (named.Count + unnamed.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        var said = string.Join("; ", new[]
        {
            named.Count > 0 ? $"acts as the control function: {string.Join(", ", named.Select(id => users[id].Name))}" : null,
            unnamed.Count > 0 ? $"no longer: {string.Join(", ", unnamed.Select(id => users[id].Name))}" : null,
        }.Where(x => x is not null));
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "CONTROL_PEOPLE", "Project", project.Id, project.Code, said, project.Id, cancellationToken);
        var told = named.Where(id => id != access.UserId).ToList();
        if (told.Count > 0)
            await notifier.NotifyAsync(project.TenantId, project.Id, told, Notifications.NotificationKinds.General,
                $"You act as the control function on {project.Code}", $"{access.UserName} named you to act as the control function on {project.Code}, whatever your function.",
                "/directory", cancellationToken);
        var off = unnamed.Where(id => id != access.UserId).ToList();
        if (off.Count > 0)
            await notifier.NotifyAsync(project.TenantId, project.Id, off, Notifications.NotificationKinds.General,
                $"You no longer act as the control function on {project.Code}", $"{access.UserName} took you off acting as the control function on {project.Code}.",
                "/directory", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<bool> MayNameControlAsync(HttpContext http, ProjectAccess access) =>
        access.IsInternal && (access.Holds(Verbs.Control) || await Keepers.ConfiguresAsync(http));
}
