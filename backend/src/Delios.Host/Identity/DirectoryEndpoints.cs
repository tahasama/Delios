using Delios.Host.Audit;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Identity;

/// <summary>Body of creating a person. <c>PartyId</c> empty means one of our own people.</summary>
public sealed record CreateUserRequest(string? Name, string? Email, string? Password, Guid? PartyId = null, bool IsAdmin = false);

/// <summary>Body of changing a person. A null field is left as it is; <c>ClearParty</c> makes them one of ours again.</summary>
public sealed record UpdateUserRequest(
    string? Name = null, string? Email = null, Guid? PartyId = null, bool ClearParty = false, bool? Active = null, bool? IsAdmin = null,
    string? Password = null);

/// <summary>Body of creating a project.</summary>
public sealed record CreateProjectRequest(string? Code, string? Name, string? ContractRole = null, string? TimeZone = null);

/// <summary>Body of changing a project. A null field is left as it is.</summary>
/// <remarks>A new <c>Code</c> shapes new numbers only; numbers already given keep the old one.</remarks>
public sealed record UpdateProjectRequest(
    string? Code = null, string? Name = null, string? ContractRole = null, string? Status = null, string? TimeZone = null, int[]? WeekendDays = null);

/// <summary>Body of putting a person on a project, or changing their place on it: one function per person per project.</summary>
public sealed record MembershipRequest(Guid UserId, Guid? FunctionId, string? Department = null, bool Active = true);

/// <summary>Body of creating a function.</summary>
public sealed record CreateFunctionRequest(string? Code, string? Name);

/// <summary>One row of the matrix as sent by the screens: what a function may do, to which documents (null: any).</summary>
public sealed record RuleRequest(
    string[]? Verbs, string? DeliverableType = null, string? DocType = null, string? Discipline = null, string? Criticality = null,
    string? Confidentiality = null, string? ProjectRole = null);

/// <summary>Body of changing a function. <c>Rules</c>, when given, replaces all of its matrix rows.</summary>
public sealed record UpdateFunctionRequest(string? Name = null, bool? Active = null, RuleRequest[]? Rules = null);

/// <summary>Body of creating or changing an organization taking part in projects.</summary>
public sealed record PartyRequest(
    string? Code = null, string? Name = null, bool? IsInternal = null, bool? Active = null, string? Participation = null,
    string? CustodianFunction = null, string? ExternalSystem = null, bool? EvidenceRequired = null);

/// <summary>
/// The organization's directory, kept by its administrators: people, projects and who is on them with which
/// function, functions and their matrix rows, and the organizations taking part. Nothing is deleted: people,
/// projects, functions and organizations are switched off, so the record keeps meaning what it meant. Every change
/// is audited.
/// </summary>
public static class DirectoryEndpoints
{
    public static void MapDirectoryEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/admin").WithTags("Administration")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(async (context, next) => context.HttpContext.User.IsAdmin()
                ? await next(context)
                : Problems.Forbidden("ADMIN_ONLY", "Only an administrator changes the organization's projects."));
        admin.MapGet("/projects", ProjectsAsync);
        admin.MapPost("/projects", CreateProjectAsync);
        admin.MapPut("/projects/{projectId:guid}", UpdateProjectAsync);

        // Document Control keeps these day to day, as well as administrators.
        var keepers = app.MapGroup("/api/admin").WithTags("Administration")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Filter);
        keepers.MapGet("/users", UsersAsync);
        keepers.MapPost("/users", CreateUserAsync);
        keepers.MapPut("/users/{userId:guid}", UpdateUserAsync);
        keepers.MapPut("/projects/{projectId:guid}/members", MemberAsync);
        keepers.MapGet("/functions", FunctionsAsync);
        keepers.MapPost("/functions", CreateFunctionAsync);
        keepers.MapPut("/functions/{functionId:guid}", UpdateFunctionAsync);
        keepers.MapGet("/parties", PartiesAsync);
        keepers.MapPost("/parties", CreatePartyAsync);
        keepers.MapPut("/parties/{partyId:guid}", UpdatePartyAsync);
    }

    private static async Task<Actor> ActorAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var id = http.User.UserId();
        var name = await db.Users.Where(u => u.Id == id).Select(u => u.Name).SingleAsync(cancellationToken);
        return new Actor(id, name);
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    // ── People ──────────────────────────────────────────────────────────────

    /// <summary><c>GET /api/admin/users</c>: everyone in the organization, with their organization and their places on projects.</summary>
    private static async Task<IResult> UsersAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var users = await db.Users.AsNoTracking().Include(u => u.Party).OrderBy(u => u.Name).ToListAsync(cancellationToken);
        var memberships = await db.Memberships.AsNoTracking().Include(m => m.Function).Include(m => m.Project).ToListAsync(cancellationToken);
        return Results.Ok(users.Select(u => new
        {
            u.Id,
            u.Name,
            u.Email,
            u.Active,
            u.IsAdmin,
            u.PartyId,
            PartyCode = u.Party?.Code,
            PartyName = u.Party?.Name,
            Internal = u.Party is null || u.Party.IsInternal,
            Mfa = u.MfaEnabledAt != null,
            LockedUntil = u.LockedUntil?.ToDateTimeOffset(),
            CreatedAt = u.CreatedAt.ToDateTimeOffset(),
            Memberships = memberships.Where(m => m.UserId == u.Id).Select(m => new
            {
                m.Id,
                m.ProjectId,
                ProjectCode = m.Project!.Code,
                ProjectName = m.Project.Name,
                m.FunctionId,
                FunctionCode = m.Function!.Code,
                FunctionName = m.Function.Name,
                m.Department,
                m.Active,
            }),
        }));
    }

    /// <summary><c>POST /api/admin/users</c>: a new person. Their email signs them in to this organization alone.</summary>
    private static async Task<IResult> CreateUserAsync(
        CreateUserRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IPasswordHasher<User> hasher,
        CancellationToken cancellationToken)
    {
        var name = Blank(request.Name);
        var email = Blank(request.Email)?.ToLowerInvariant();
        if (name is null || email is null) return Problems.Invalid("NAME_AND_EMAIL_REQUIRED", "Name and email are required.");
        if (!email.Contains('@') || email.Length > 254) return Problems.Invalid("EMAIL_INVALID", "Give a valid email address.");
        if ((request.Password ?? "").Length < 8) return Problems.Invalid("PASSWORD_TOO_SHORT", "A password has at least 8 characters.");
        if (request.IsAdmin && !http.User.IsAdmin()) return Problems.Forbidden("ADMIN_ONLY", "Only an administrator makes somebody an administrator.");
        var normalized = email.ToUpperInvariant();
        if (await db.SignInNames.AnyAsync(n => n.NormalizedEmail == normalized, cancellationToken))
            return Problems.Conflict("EMAIL_TAKEN", $"{email} already signs somebody in.");
        if (request.PartyId is { } partyId && !await db.Parties.AnyAsync(p => p.Id == partyId, cancellationToken))
            return Problems.Invalid("PARTY_UNKNOWN", "Choose one of the organization's parties.");
        var user = new User
        {
            TenantId = http.User.TenantId(),
            Email = email,
            NormalizedEmail = normalized,
            Name = name,
            PasswordHash = "",
            PartyId = request.PartyId,
            IsAdmin = request.IsAdmin,
        };
        user.PasswordHash = hasher.HashPassword(user, request.Password!);
        db.Users.Add(user);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "USER_CREATED", "User", user.Id, user.Name,
            $"{email}{(request.IsAdmin ? ", administrator" : "")}.", cancellationToken: cancellationToken);
        return Results.Created($"/api/admin/users/{user.Id}", new { user.Id });
    }

    /// <summary><c>PUT /api/admin/users/{id}</c>: name, email, organization, sign-in, administration rights, a new password.</summary>
    private static async Task<IResult> UpdateUserAsync(
        Guid userId, UpdateUserRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IPasswordHasher<User> hasher,
        SessionStore sessions, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null) return Problems.NotFound("USER_NOT_FOUND", "No such person.");
        if (!http.User.IsAdmin() && (user.IsAdmin || request.IsAdmin is not null))
            return Problems.Forbidden("ADMIN_ONLY", "Only an administrator changes an administrator, or makes one.");
        var self = userId == http.User.UserId();
        if (self && (request.Active == false || request.IsAdmin == false))
            return Problems.Conflict("SELF_LOCKOUT", "You cannot remove your own access.");
        var changes = new List<string>();
        if (Blank(request.Name) is { } name && name != user.Name) { changes.Add($"name → {name}"); user.Name = name; }
        if (Blank(request.Email)?.ToLowerInvariant() is { } email && email != user.Email.ToLowerInvariant())
        {
            if (!email.Contains('@')) return Problems.Invalid("EMAIL_INVALID", "Give a valid email address.");
            var normalized = email.ToUpperInvariant();
            if (await db.SignInNames.AnyAsync(n => n.NormalizedEmail == normalized, cancellationToken))
                return Problems.Conflict("EMAIL_TAKEN", $"{email} already signs somebody in.");
            changes.Add($"email → {email}");
            user.Email = email;
            user.NormalizedEmail = normalized;
        }
        if (request.ClearParty && user.PartyId is not null) { changes.Add("one of ours"); user.PartyId = null; }
        else if (request.PartyId is { } partyId && partyId != user.PartyId)
        {
            if (!await db.Parties.AnyAsync(p => p.Id == partyId, cancellationToken))
                return Problems.Invalid("PARTY_UNKNOWN", "Choose one of the organization's parties.");
            changes.Add("organization changed");
            user.PartyId = partyId;
        }
        if (request.Active is { } active && active != user.Active)
        {
            changes.Add(active ? "may sign in" : "switched off");
            user.Active = active;
        }
        if (request.IsAdmin is { } isAdmin && isAdmin != user.IsAdmin) { changes.Add(isAdmin ? "administrator" : "not an administrator"); user.IsAdmin = isAdmin; }
        if (!string.IsNullOrEmpty(request.Password))
        {
            if (request.Password.Length < 8) return Problems.Invalid("PASSWORD_TOO_SHORT", "A password has at least 8 characters.");
            user.PasswordHash = hasher.HashPassword(user, request.Password);
            user.FailedSignIns = 0;
            user.LockedUntil = null;
            changes.Add("new password");
        }
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        // Switched off, they are out at once; with other rights, their next request carries them.
        await sessions.ForgetAllAsync(user.Id, revoke: !user.Active, cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "USER_UPDATED", "User", user.Id, user.Name,
            string.Join("; ", changes), cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    // ── Projects and who is on them ─────────────────────────────────────────

    /// <summary><c>GET /api/admin/projects</c>: every project, with how many people are on it.</summary>
    private static async Task<IResult> ProjectsAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var projects = await db.Projects.AsNoTracking().OrderBy(p => p.Code).ToListAsync(cancellationToken);
        var counts = await db.Memberships.AsNoTracking().Where(m => m.Active).GroupBy(m => m.ProjectId)
            .Select(g => new { g.Key, Count = g.Count() }).ToListAsync(cancellationToken);
        var documents = await db.Documents.AsNoTracking().GroupBy(d => d.ProjectId)
            .Select(g => new { g.Key, Count = g.Count() }).ToListAsync(cancellationToken);
        return Results.Ok(projects.Select(p => new
        {
            p.Id,
            p.Code,
            p.Name,
            p.ContractRole,
            p.Status,
            p.TimeZone,
            p.WeekendDays,
            p.ContentExtraction,
            CreatedAt = p.CreatedAt.ToDateTimeOffset(),
            Members = counts.FirstOrDefault(c => c.Key == p.Id)?.Count ?? 0,
            Documents = documents.FirstOrDefault(c => c.Key == p.Id)?.Count ?? 0,
        }));
    }

    /// <summary><c>POST /api/admin/projects</c>: a new project. Whoever creates it is put on it, with the first function that controls.</summary>
    private static async Task<IResult> CreateProjectAsync(
        CreateProjectRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var code = Blank(request.Code)?.ToUpperInvariant();
        var name = Blank(request.Name);
        if (code is null || name is null) return Problems.Invalid("CODE_AND_NAME_REQUIRED", "A project has a code and a name.");
        if (code.Length > 32) return Problems.Invalid("CODE_TOO_LONG", "A project code has at most 32 characters.");
        if (await db.Projects.AnyAsync(p => p.Code == code, cancellationToken))
            return Problems.Conflict("PROJECT_CODE_TAKEN", $"{code} is already a project.");
        var zone = Blank(request.TimeZone) ?? "UTC";
        if (DateTimeZoneProviders.Tzdb.GetZoneOrNull(zone) is null) return Problems.Invalid("TIME_ZONE_UNKNOWN", $"{zone} is not a time zone.");
        var project = new Project
        {
            TenantId = http.User.TenantId(),
            Code = code,
            Name = name,
            ContractRole = Blank(request.ContractRole)?.ToUpperInvariant() ?? "GENERIC",
            TimeZone = zone,
        };
        db.Projects.Add(project);
        var control = await db.Functions.Where(f => f.Active && f.Rules.Any(r => r.Verbs.Contains(Verbs.Control)))
            .OrderBy(f => f.Code).Select(f => (Guid?)f.Id).FirstOrDefaultAsync(cancellationToken);
        if (control is { } functionId)
        {
            db.Memberships.Add(new Membership { TenantId = project.TenantId, ProjectId = project.Id, UserId = http.User.UserId(), FunctionId = functionId });
        }
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "PROJECT_CREATED", "Project", project.Id, project.Code,
            project.Name, project.Id, cancellationToken);
        return Results.Created($"/api/admin/projects/{project.Id}", new { project.Id });
    }

    /// <summary><c>PUT /api/admin/projects/{id}</c>: name, contract role, status, time zone, weekend days.</summary>
    private static async Task<IResult> UpdateProjectAsync(
        Guid projectId, UpdateProjectRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var project = await db.Projects.SingleOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return Problems.NotFound("PROJECT_NOT_FOUND", "No such project.");
        var changes = new List<string>();
        if (Blank(request.Code)?.ToUpperInvariant() is { } code && code != project.Code)
        {
            if (code.Length > 32) return Problems.Invalid("CODE_TOO_LONG", "A project code has at most 32 characters.");
            if (await db.Projects.AnyAsync(p => p.Code == code && p.Id != projectId, cancellationToken))
                return Problems.Conflict("PROJECT_CODE_TAKEN", $"{code} is already a project.");
            changes.Add($"code {project.Code} → {code}; numbers already given keep {project.Code}");
            project.Code = code;
        }
        if (Blank(request.Name) is { } name && name != project.Name) { changes.Add($"name → {name}"); project.Name = name; }
        if (Blank(request.ContractRole)?.ToUpperInvariant() is { } role && role != project.ContractRole) { changes.Add($"contract role → {role}"); project.ContractRole = role; }
        if (Blank(request.Status)?.ToUpperInvariant() is { } status && status != project.Status)
        {
            if (status is not ("ACTIVE" or "CLOSED" or "ON_HOLD" or "ARCHIVED"))
                return Problems.Invalid("STATUS_INVALID", "A project is ACTIVE, ON_HOLD, CLOSED or ARCHIVED.");
            changes.Add($"status → {status}");
            project.Status = status;
        }
        if (Blank(request.TimeZone) is { } zone && zone != project.TimeZone)
        {
            if (DateTimeZoneProviders.Tzdb.GetZoneOrNull(zone) is null) return Problems.Invalid("TIME_ZONE_UNKNOWN", $"{zone} is not a time zone.");
            changes.Add($"time zone → {zone}");
            project.TimeZone = zone;
        }
        if (request.WeekendDays is { } days && !days.SequenceEqual(project.WeekendDays))
        {
            if (days.Any(d => d is < 1 or > 7)) return Problems.Invalid("WEEKEND_INVALID", "Weekend days are numbered 1 (Monday) to 7 (Sunday).");
            changes.Add($"weekend → {string.Join(",", days)}");
            project.WeekendDays = days.Distinct().Order().ToArray();
        }
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "PROJECT_UPDATED", "Project", project.Id, project.Code,
            string.Join("; ", changes), project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// <c>PUT /api/admin/projects/{id}/members</c>: puts a person on the project with a function, changes their function
    /// or department, or ends their place on it (<c>Active</c> false).
    /// </summary>
    private static async Task<IResult> MemberAsync(
        Guid projectId, MembershipRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var project = await db.Projects.AsNoTracking().SingleOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return Problems.NotFound("PROJECT_NOT_FOUND", "No such project.");
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == request.UserId, cancellationToken);
        if (user is null) return Problems.NotFound("USER_NOT_FOUND", "No such person.");
        var function = request.FunctionId is { } fid ? await db.Functions.AsNoTracking().SingleOrDefaultAsync(f => f.Id == fid && f.Active, cancellationToken) : null;
        if (request.FunctionId is not null && function is null) return Problems.Invalid("FUNCTION_UNKNOWN", "Choose one of the organization's functions.");
        var membership = await db.Memberships.SingleOrDefaultAsync(m => m.ProjectId == projectId && m.UserId == request.UserId, cancellationToken);
        var changes = new List<string>();
        if (membership is null)
        {
            if (!request.Active) return Results.NoContent();
            if (function is null) return Problems.Invalid("FUNCTION_REQUIRED", $"Choose the function {user.Name} holds on {project.Code}.");
            membership = new Membership
            {
                TenantId = project.TenantId,
                ProjectId = projectId,
                UserId = user.Id,
                FunctionId = function.Id,
                Department = Blank(request.Department),
            };
            db.Memberships.Add(membership);
            changes.Add($"added to {project.Code} as {function.Name}");
        }
        else
        {
            if (function is not null && function.Id != membership.FunctionId) { membership.FunctionId = function.Id; changes.Add($"function → {function.Name}"); }
            var department = Blank(request.Department);
            if (department != membership.Department) { membership.Department = department; changes.Add($"department → {department ?? "none"}"); }
            if (request.Active != membership.Active)
            {
                if (!request.Active && user.Id == http.User.UserId()) return Problems.Conflict("SELF_LOCKOUT", "You cannot remove yourself from a project.");
                membership.Active = request.Active;
                changes.Add(request.Active ? $"back on {project.Code}" : $"removed from {project.Code}");
            }
        }
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "MEMBERSHIP_CHANGED", "User", user.Id, user.Name,
            string.Join("; ", changes), projectId, cancellationToken);
        return Results.NoContent();
    }

    // ── Functions and the matrix ────────────────────────────────────────────

    /// <summary><c>GET /api/admin/functions</c>: every function with its matrix rows and how many places on projects hold it.</summary>
    private static async Task<IResult> FunctionsAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var functions = await db.Functions.AsNoTracking().Include(f => f.Rules).OrderBy(f => f.Name).ToListAsync(cancellationToken);
        var held = await db.Memberships.AsNoTracking().Where(m => m.Active).GroupBy(m => m.FunctionId)
            .Select(g => new { g.Key, Count = g.Count() }).ToListAsync(cancellationToken);
        return Results.Ok(functions.Select(f => new
        {
            f.Id,
            f.Code,
            f.Name,
            f.Active,
            Holders = held.FirstOrDefault(h => h.Key == f.Id)?.Count ?? 0,
            Rules = f.Rules.Select(r => new { r.Id, r.Verbs, r.DeliverableType, r.DocType, r.Discipline, r.Criticality, r.Confidentiality, r.ProjectRole }),
        }));
    }

    /// <summary><c>POST /api/admin/functions</c>: a new function, with no rights until its matrix rows are set.</summary>
    private static async Task<IResult> CreateFunctionAsync(
        CreateFunctionRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var name = Blank(request.Name);
        if (name is null) return Problems.Invalid("NAME_REQUIRED", "A function has a name.");
        var code = Blank(request.Code)?.ToUpperInvariant() ?? new string(name.ToUpperInvariant().Select(c => char.IsLetterOrDigit(c) ? c : '_').ToArray());
        if (await db.Functions.AnyAsync(f => f.Code == code, cancellationToken))
            return Problems.Conflict("FUNCTION_CODE_TAKEN", $"{code} is already a function.");
        var function = new Function { TenantId = http.User.TenantId(), Code = code, Name = name };
        db.Functions.Add(function);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "FUNCTION_CREATED", "Function", function.Id, function.Name,
            code, cancellationToken: cancellationToken);
        return Results.Created($"/api/admin/functions/{function.Id}", new { function.Id, function.Code });
    }

    /// <summary><c>PUT /api/admin/functions/{id}</c>: name, in use or not, and its matrix rows (replaced as a whole).</summary>
    private static async Task<IResult> UpdateFunctionAsync(
        Guid functionId, UpdateFunctionRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var function = await db.Functions.Include(f => f.Rules).SingleOrDefaultAsync(f => f.Id == functionId, cancellationToken);
        if (function is null) return Problems.NotFound("FUNCTION_NOT_FOUND", "No such function.");
        var changes = new List<string>();
        if (Blank(request.Name) is { } name && name != function.Name) { changes.Add($"name → {name}"); function.Name = name; }
        if (request.Active is { } active && active != function.Active) { changes.Add(active ? "in use" : "out of use"); function.Active = active; }
        if (request.Rules is { } rules)
        {
            if (!http.User.IsAdmin() && rules.Any(r => (r.Verbs ?? []).Contains(Verbs.Configure)))
                return Problems.Forbidden("ADMIN_ONLY", "Only an administrator gives a function the right to configure.");
            foreach (var rule in rules)
            {
                var unknown = (rule.Verbs ?? []).Where(v => !Verbs.All.Contains(v)).ToList();
                if (unknown.Count > 0) return Problems.Invalid("VERB_UNKNOWN", $"{string.Join(", ", unknown)} is not a right.", new { verbs = unknown });
            }
            db.PermissionRules.RemoveRange(function.Rules);
            foreach (var rule in rules.Where(r => (r.Verbs ?? []).Length > 0))
            {
                db.PermissionRules.Add(new PermissionRule
                {
                    TenantId = function.TenantId,
                    FunctionId = function.Id,
                    Verbs = rule.Verbs!.Distinct().ToArray(),
                    DeliverableType = Blank(rule.DeliverableType),
                    DocType = Blank(rule.DocType),
                    Discipline = Blank(rule.Discipline),
                    Criticality = Blank(rule.Criticality),
                    Confidentiality = Blank(rule.Confidentiality),
                    ProjectRole = Blank(rule.ProjectRole),
                });
            }
            changes.Add($"matrix: {rules.Length} row(s)");
        }
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "FUNCTION_UPDATED", "Function", function.Id, function.Name,
            string.Join("; ", changes), cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    // ── Organizations taking part ───────────────────────────────────────────

    /// <summary><c>GET /api/admin/parties</c>: every organization, with how many of its people hold accounts.</summary>
    private static async Task<IResult> PartiesAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var parties = await db.Parties.AsNoTracking().OrderBy(p => p.Name).ToListAsync(cancellationToken);
        var people = await db.Users.AsNoTracking().Where(u => u.PartyId != null && u.Active).GroupBy(u => u.PartyId)
            .Select(g => new { g.Key, Count = g.Count() }).ToListAsync(cancellationToken);
        return Results.Ok(parties.Select(p => new
        {
            p.Id,
            p.Code,
            p.Name,
            p.IsInternal,
            p.Active,
            p.Participation,
            p.CustodianFunction,
            p.ExternalSystem,
            p.EvidenceRequired,
            People = people.FirstOrDefault(c => c.Key == p.Id)?.Count ?? 0,
        }));
    }

    /// <summary><c>POST /api/admin/parties</c>: a new organization taking part.</summary>
    private static async Task<IResult> CreatePartyAsync(
        PartyRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var code = Blank(request.Code)?.ToUpperInvariant();
        var name = Blank(request.Name);
        if (code is null || name is null) return Problems.Invalid("CODE_AND_NAME_REQUIRED", "An organization has a code and a name.");
        if (await db.Parties.AnyAsync(p => p.Code == code, cancellationToken))
            return Problems.Conflict("PARTY_CODE_TAKEN", $"{code} is already an organization.");
        var party = new Party { TenantId = http.User.TenantId(), Code = code, Name = name };
        var problem = Apply(party, request with { Code = null, Name = null }, []);
        if (problem is not null) return problem;
        db.Parties.Add(party);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "PARTY_CREATED", "Party", party.Id, party.Name, code,
            cancellationToken: cancellationToken);
        return Results.Created($"/api/admin/parties/{party.Id}", new { party.Id });
    }

    /// <summary><c>PUT /api/admin/parties/{id}</c>: name, how it takes part, who carries its exchange, revoked or not. The code never changes.</summary>
    private static async Task<IResult> UpdatePartyAsync(
        Guid partyId, PartyRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var party = await db.Parties.SingleOrDefaultAsync(p => p.Id == partyId, cancellationToken);
        if (party is null) return Problems.NotFound("PARTY_NOT_FOUND", "No such organization.");
        var changes = new List<string>();
        var problem = Apply(party, request with { Code = null }, changes);
        if (problem is not null) return problem;
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "PARTY_UPDATED", "Party", party.Id, party.Name,
            string.Join("; ", changes), cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    private static IResult? Apply(Party party, PartyRequest request, List<string> changes)
    {
        if (Blank(request.Name) is { } name && name != party.Name) { changes.Add($"name → {name}"); party.Name = name; }
        if (request.IsInternal is { } inside && inside != party.IsInternal) { changes.Add(inside ? "one of ours" : "outside"); party.IsInternal = inside; }
        if (request.Active is { } active && active != party.Active) { changes.Add(active ? "restored" : "revoked"); party.Active = active; }
        if (Blank(request.Participation)?.ToUpperInvariant() is { } participation && participation != party.Participation)
        {
            if (participation is not (Participations.InApp or Participations.ByProxy))
                return Problems.Invalid("PARTICIPATION_INVALID", "An organization answers here (IN_APP) or through one of ours (BY_PROXY).");
            changes.Add($"participation → {participation}");
            party.Participation = participation;
        }
        if (request.CustodianFunction is not null && Blank(request.CustodianFunction) != party.CustodianFunction)
        {
            party.CustodianFunction = Blank(request.CustodianFunction);
            changes.Add($"carried by {party.CustodianFunction ?? "Document Control"}");
        }
        if (request.ExternalSystem is not null && Blank(request.ExternalSystem) != party.ExternalSystem)
        {
            party.ExternalSystem = Blank(request.ExternalSystem);
            changes.Add($"their system → {party.ExternalSystem ?? "none"}");
        }
        if (request.EvidenceRequired is { } evidence && evidence != party.EvidenceRequired)
        {
            party.EvidenceRequired = evidence;
            changes.Add(evidence ? "proof required" : "proof optional");
        }
        return null;
    }
}

/// <summary>Who keeps the directory day to day: an administrator, or anybody who holds Document Control on a project.</summary>
internal static class Keepers
{
    public static async ValueTask<object?> Filter(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (http.User.IsAdmin()) return await next(context);
        var db = http.RequestServices.GetRequiredService<DeliosDbContext>();
        var me = http.User.UserId();
        var control = await db.Memberships.AnyAsync(m => m.UserId == me && m.Active && m.Function!.Active
            && m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control)), http.RequestAborted);
        return control
            ? await next(context)
            : Problems.Forbidden("ADMIN_OR_CONTROL", "An administrator, or Document Control, keeps the organization's people and functions.");
    }
}
