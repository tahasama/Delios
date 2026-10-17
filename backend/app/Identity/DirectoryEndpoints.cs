using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Identity;

/// <summary>
/// Body of creating a person. <c>PartyId</c> empty means one of our own people. <c>Invite</c>, with no password: they
/// are emailed a link to choose their own, and nobody else ever knows it.
/// </summary>
public sealed record CreateUserRequest(string? Name, string? Email, string? Password, Guid? PartyId = null, bool IsAdmin = false, bool Invite = false);

/// <summary>Body of changing a person. A null field is left as it is; <c>ClearParty</c> makes them one of ours again.</summary>
public sealed record UpdateUserRequest(
    string? Name = null, string? Email = null, Guid? PartyId = null, bool ClearParty = false, bool? Active = null, bool? IsAdmin = null,
    string? Password = null);

/// <summary>Body of creating a project.</summary>
public sealed record CreateProjectRequest(string? Code, string? Name, string? ContractRole = null, string? TimeZone = null, string? Kind = null);

/// <summary>Body of changing a project. A null field is left as it is.</summary>
/// <remarks>A new <c>Code</c> shapes new numbers only; numbers already given keep the old one.</remarks>
public sealed record UpdateProjectRequest(
    string? Code = null, string? Name = null, string? ContractRole = null, string? Status = null, string? TimeZone = null, int[]? WeekendDays = null,
    string? Kind = null, string? Reason = null);

/// <summary>Body of putting a person on a project, or changing their place on it: one function per person per project.</summary>
public sealed record MembershipRequest(Guid UserId, Guid? FunctionId, string? Department = null, bool Active = true, Guid? ConfirmerId = null);

/// <summary>Body of creating a function.</summary>
public sealed record CreateFunctionRequest(string? Code, string? Name);

/// <summary>One row of the matrix as sent by the screens: what a function may do, to which documents (null: any).</summary>
public sealed record RuleRequest(
    string[]? Verbs, string? DeliverableType = null, string? DocType = null, string? Discipline = null, string? Criticality = null,
    string? Confidentiality = null, string? ProjectRole = null, string? Family = null, string? Note = null);

/// <summary>Body of changing a function. <c>Rules</c>, when given, replaces all of its matrix rows.</summary>
/// <remarks><c>Clearance</c>: a confidentiality code; an empty string takes the limit away.</remarks>
public sealed record UpdateFunctionRequest(string? Name = null, bool? Active = null, RuleRequest[]? Rules = null, string? Clearance = null);

/// <summary>Body of creating or changing an organization taking part in projects.</summary>
/// <remarks>
/// <c>IdentityId</c>: an organization already known to DELIOS, added as it is (its code and name; one on DELIOS is invited
/// to link). Otherwise one is created: its code, name and identifier (<c>Country</c>, <c>IdentifierKind</c>,
/// <c>IdentifierNumber</c>), or why it has none (<c>NoIdentifierReason</c>), and its email <c>Domain</c>. Organizations that
/// look like it are named first (LOOKS_LIKE); <c>NotTheSame</c> says which of them it is not.
/// </remarks>
public sealed record PartyRequest(
    string? Code = null, string? Name = null, bool? IsInternal = null, bool? Active = null, string? Participation = null,
    string? CustodianFunction = null, string? ExternalSystem = null, bool? EvidenceRequired = null, string? ContactEmail = null,
    Guid? IdentityId = null, string? Country = null, string? IdentifierKind = null, string? IdentifierNumber = null,
    string? NoIdentifierReason = null, string? Domain = null, Guid[]? NotTheSame = null, string? CarriedBy = null);

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
            .AddEndpointFilter(Keepers.Configurers("Only an administrator changes the organization's projects."));
        admin.MapGet("/projects", ProjectsAsync);
        admin.MapPost("/projects", CreateProjectAsync);
        admin.MapPut("/projects/{projectId:guid}", UpdateProjectAsync);
        admin.MapPost("/projects/{projectId:guid}/join", JoinProjectAsync);

        // The control function keeps these day to day, as well as administrators.
        var keepers = app.MapGroup("/api/admin").WithTags("Administration")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Filter);
        // People, and who is on which project: also whoever holds Manage, which adds people where there is no control function.
        var people = app.MapGroup("/api/admin").WithTags("Administration")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.People);
        people.MapGet("/users", UsersAsync);
        people.MapPost("/users", CreateUserAsync);
        people.MapPut("/users/{userId:guid}", UpdateUserAsync);
        people.MapPut("/projects/{projectId:guid}/members", MemberAsync);
        // Reading the functions and organizations is open to whoever holds Manage too: People & access chooses from them.
        people.MapGet("/functions", FunctionsAsync);
        keepers.MapGet("/users/{userId:guid}/activity", ActivityAsync);
        keepers.MapPost("/functions", CreateFunctionAsync);
        keepers.MapPut("/functions/{functionId:guid}", UpdateFunctionAsync);
        people.MapGet("/parties", PartiesAsync);
        keepers.MapPost("/parties", CreatePartyAsync);
        keepers.MapPut("/parties/{partyId:guid}", UpdatePartyAsync);
    }

    /// <summary>
    /// <c>GET /api/admin/users/{userId}/activity</c>: everything a person did in the app, newest first, read from the
    /// audit trail (signed in, opened, downloaded, reviewed, released, sent…), a page at a time, narrowed to a project or
    /// a kind of act. An administrator or the control function only (Settings, never the directory): it is the record
    /// kept for the integrity of the register, read by those who answer for it.
    /// </summary>
    private static async Task<IResult> ActivityAsync(Guid userId, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken,
        Guid? projectId = null, string? kind = null, string? action = null, string? q = null, DateOnly? from = null, DateOnly? to = null,
        int page = 1, int per = 50)
    {
        var user = await db.Users.AsNoTracking().Where(u => u.Id == userId)
            .Select(u => new { u.Id, u.Name, u.Email, u.Active, Party = u.Party == null ? null : u.Party.Name, Linked = u.HomeTenantId != null })
            .SingleOrDefaultAsync(cancellationToken);
        if (user is null) return Problems.NotFound("USER_NOT_FOUND", "No such person.");
        per = Math.Clamp(per, 10, 200);
        page = Math.Max(1, page);
        // What the organization chose to keep and show (Settings.Tracking): reading only where kept, sign-ins only where shown.
        var keepsReading = await Settings.Tracking.KeepsReadingAsync(db, cancellationToken);
        var showsSignIns = await Settings.Tracking.ShowsSignInsAsync(db, cancellationToken);
        var hidden = (keepsReading ? [] : Settings.Tracking.Reading).Concat(showsSignIns ? [] : Settings.Tracking.SignIns).ToArray();
        var mine = db.AuditEvents.AsNoTracking().Where(e => e.ActorId == userId && !hidden.Contains(e.Action));
        var query = mine;
        if (projectId is { } p) query = query.Where(e => e.ProjectId == p);
        if (from is { } f) { var start = LocalDate.FromDateOnly(f).AtStartOfDayInZone(DateTimeZone.Utc).ToInstant(); query = query.Where(e => e.At >= start); }
        if (to is { } u) { var end = LocalDate.FromDateOnly(u).PlusDays(1).AtStartOfDayInZone(DateTimeZone.Utc).ToInstant(); query = query.Where(e => e.At < end); }
        if (!string.IsNullOrWhiteSpace(q))
        {
            var pattern = $"%{q.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_")}%";
            query = query.Where(e => (e.EntityLabel != null && EF.Functions.ILike(e.EntityLabel, pattern)) || (e.Detail != null && EF.Functions.ILike(e.Detail, pattern)));
        }
        if (!string.IsNullOrWhiteSpace(kind))
        {
            var codes = (await mine.Select(e => e.Action).Distinct().ToListAsync(cancellationToken)).Where(c => AuditKinds.Of(c) == kind).ToArray();
            query = query.Where(e => codes.Contains(e.Action));
        }
        if (!string.IsNullOrWhiteSpace(action)) query = query.Where(e => e.Action == action);
        var total = await query.CountAsync(cancellationToken);
        var rows = await query.OrderByDescending(e => e.Id).Skip((page - 1) * per).Take(per).ToListAsync(cancellationToken);
        var kinds = (await mine.GroupBy(e => e.Action).Select(g => new { Action = g.Key, Count = g.Count() })
            .OrderByDescending(g => g.Count).ToListAsync(cancellationToken)).Select(x => new { x.Action, x.Count, Kind = AuditKinds.Of(x.Action) });
        var first = await mine.OrderBy(e => e.Id).Select(e => (Instant?)e.At).FirstOrDefaultAsync(cancellationToken);
        var lastSignIn = !showsSignIns ? null : await mine.Where(e => e.Action.StartsWith("SIGN_IN") && e.Action != "SIGN_IN_FAILED")
            .OrderByDescending(e => e.Id).Select(e => (Instant?)e.At).FirstOrDefaultAsync(cancellationToken);
        var projects = await db.Projects.AsNoTracking().Select(x => new { x.Id, x.Code }).ToDictionaryAsync(x => x.Id, x => x.Code, cancellationToken);
        var documents = await AuditKinds.DocumentsOfAsync(db, rows, cancellationToken);
        // Reading someone's record is itself recorded: who looked, and when.
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "ACTIVITY_READ", "User", user.Id, user.Name,
            projectId is null ? null : $"on {projects.GetValueOrDefault(projectId.Value)}", projectId, cancellationToken);
        return Results.Ok(new
        {
            user,
            total,
            page,
            per,
            pages = Math.Max(1, (total + per - 1) / per),
            first = first?.ToDateTimeOffset(),
            keepsReading,
            showsSignIns,
            lastSignIn = lastSignIn?.ToDateTimeOffset(),
            kinds,
            rows = rows.Select(e => new
            {
                e.Id, At = e.At.ToDateTimeOffset(), e.Action, Kind = AuditKinds.Of(e.Action), e.EntityType, e.EntityId, e.EntityLabel, e.Detail, e.ProjectId,
                Project = e.ProjectId is { } pid ? projects.GetValueOrDefault(pid) : null,
                DocumentId = e.EntityId is { } eid && documents.TryGetValue(eid, out var did) ? did : (Guid?)null,
            }),
        });
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
            // Works here from its own organization's DELIOS: signs in at home; name and email are theirs.
            Linked = u.HomeTenantId != null,
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
                // A linked account reads in its own organization's words: "ACME / Lead Engineer".
                FunctionName = u.HomeFunction != null ? $"{u.Party?.Code} / {u.HomeFunction}" : m.Function.Name,
                m.Department,
                m.Active,
                PendingSince = m.PendingSince?.ToDateTimeOffset(),
                m.ProposedByName,
                m.ConfirmerName,
                RefusedAt = m.RefusedAt?.ToDateTimeOffset(),
                m.RefusedByName,
                m.RefusedReason,
                ConfirmedAt = m.ConfirmedAt?.ToDateTimeOffset(),
                m.ConfirmedByName,
            }),
        }));
    }

    /// <summary><c>POST /api/admin/users</c>: a new person. Their email signs them in to this organization alone.</summary>
    private static async Task<IResult> CreateUserAsync(
        CreateUserRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IPasswordHasher<User> hasher,
        PasswordPolicy passwords, Microsoft.AspNetCore.DataProtection.IDataProtectionProvider protection, Notifications.Notifier notifier,
        CancellationToken cancellationToken)
    {
        // Invited: a password nobody knows until they choose their own from the link.
        var invite = request.Invite && string.IsNullOrEmpty(request.Password);
        if (invite) request = request with { Password = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)) };
        var name = Blank(request.Name);
        var email = Blank(request.Email)?.ToLowerInvariant();
        if (name is null || email is null) return Problems.Invalid("NAME_AND_EMAIL_REQUIRED", "Name and email are required.");
        if (!email.Contains('@') || email.Length > 254) return Problems.Invalid("EMAIL_INVALID", "Give a valid email address.");
        if (await passwords.RefusalAsync(request.Password, cancellationToken) is { } weak) return weak;
        if (request.IsAdmin && !await Keepers.ConfiguresAsync(http)) return Problems.Forbidden("ADMIN_ONLY", "Only an administrator makes somebody an administrator.");
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
        var actor = await ActorAsync(http, db, cancellationToken);
        await audit.WriteAsync(actor, "USER_CREATED", "User", user.Id, user.Name,
            $"{email}{(request.IsAdmin ? ", administrator" : "")}{(invite ? ", invited by email" : "")}.", cancellationToken: cancellationToken);
        if (!invite) return Results.Created($"/api/admin/users/{user.Id}", new { user.Id });

        var link = PasswordReset.InvitationLink(protection, notifier, user);
        var organization = await db.Tenants.AsNoTracking().Where(t => t.Id == user.TenantId).Select(t => t.Name).SingleAsync(cancellationToken);
        notifier.Queue(user.TenantId, null, Notifications.EmailKinds.Account, user.Email, user.Name, "Your DELIOS account",
            $"{actor.Name} made you an account on DELIOS, at {organization} ({user.Email}).\n\n" +
            $"To choose your password, open this link within {PasswordReset.InvitationLifetime.TotalDays:0} days. It works once.\n\n{link}",
            "User", user.Id);
        await db.SaveChangesAsync(cancellationToken);
        // Email off on this installation: the link is handed back, for whoever made the account to pass on.
        var sent = notifier.Sends(Notifications.EmailKinds.Account);
        return Results.Created($"/api/admin/users/{user.Id}", new { user.Id, Invited = sent, Link = sent ? null : link });
    }

    /// <summary><c>PUT /api/admin/users/{id}</c>: name, email, organization, sign-in, administration rights, a new password.</summary>
    private static async Task<IResult> UpdateUserAsync(
        Guid userId, UpdateUserRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IPasswordHasher<User> hasher,
        SessionStore sessions, Organizations.OrganizationService organizations, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null) return Problems.NotFound("USER_NOT_FOUND", "No such person.");
        // Someone of another organization working here with their own account: their organization keeps their sign-in.
        if (user.HomeTenantId is not null && (request.Password is not null || (request.Email is not null && request.Email != user.Email)
                || request.IsAdmin == true))
            return Problems.Conflict("LINKED_ACCOUNT", $"{user.Name} signs in with their own organization's account: it keeps their email and password.");
        var wasActive = user.Active;
        if (!await Keepers.ConfiguresAsync(http) && (user.IsAdmin || request.IsAdmin is not null))
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
            if (await http.RequestServices.GetRequiredService<PasswordPolicy>().RefusalAsync(request.Password, cancellationToken) is { } weak) return weak;
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
        await db.SaveChangesAsync(cancellationToken);
        // Switched off (or back on) here: the accounts standing for them in our partners' organizations follow.
        if (user.Active != wasActive && user.HomeTenantId is null) await organizations.FollowPersonAsync(user.Id, user.Active, cancellationToken);
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
            p.Kind,
            p.Status,
            p.StatusReason,
            p.StatusChangedByName,
            StatusChangedAt = p.StatusChangedAt?.ToDateTimeOffset(),
            p.PreviousCode,
            p.CodeChangedByName,
            CodeChangedAt = p.CodeChangedAt?.ToDateTimeOffset(),
            p.TimeZone,
            p.WeekendDays,
            p.ContentExtraction,
            CreatedAt = p.CreatedAt.ToDateTimeOffset(),
            Members = counts.FirstOrDefault(c => c.Key == p.Id)?.Count ?? 0,
            Documents = documents.FirstOrDefault(c => c.Key == p.Id)?.Count ?? 0,
        }));
    }

    /// <summary>
    /// A project's type is one of the organization's Project types (<see cref="ValueSets.ProjectKinds"/>), still in use. None
    /// given: the default, GENERIC. A list nobody filled refuses nothing.
    /// </summary>
    private static async Task<IResult?> KindRefusedAsync(DeliosDbContext db, string? kind, CancellationToken cancellationToken)
    {
        if (Blank(kind)?.ToUpperInvariant() is not { } code) return null;
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        if (catalog.Active(ValueSets.ProjectKinds).Count == 0 || catalog.IsActive(ValueSets.ProjectKinds, code)) return null;
        return Problems.Invalid("KIND_UNKNOWN", $"{code} is not one of the project types (Settings, Disciplines, types & sets, Project types).", new { field = "kind" });
    }

    /// <summary><c>POST /api/admin/projects</c>: a new project. Whoever creates it is put on it, with the first function that controls.</summary>
    private static async Task<IResult> CreateProjectAsync(
        CreateProjectRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var code = Blank(request.Code)?.ToUpperInvariant();
        var name = Blank(request.Name);
        if (code is null || name is null) return Problems.Invalid("CODE_AND_NAME_REQUIRED", "A project has a code and a name.");
        if (code.Length > 32) return Problems.Invalid("CODE_TOO_LONG", "A project code has at most 32 characters.");
        var zone = Blank(request.TimeZone) ?? "UTC";
        if (DateTimeZoneProviders.Tzdb.GetZoneOrNull(zone) is null) return Problems.Invalid("TIME_ZONE_UNKNOWN", $"{zone} is not a time zone.");
        if (await KindRefusedAsync(db, request.Kind, cancellationToken) is { } refusedKind) return refusedKind;
        var project = new Project
        {
            TenantId = http.User.TenantId(),
            Code = code,
            Name = name,
            ContractRole = Blank(request.ContractRole)?.ToUpperInvariant() ?? "GENERIC",
            Kind = Blank(request.Kind)?.ToUpperInvariant() ?? "GENERIC",
            TimeZone = zone,
        };
        // A project's code and name are its own across DELIOS, for good: never given to another.
        if (!await Organizations.Registry.ReserveAsync(db, Organizations.ReservedKinds.ProjectCode, code, project.Id, project.TenantId, cancellationToken))
            return Problems.Conflict("PROJECT_CODE_TAKEN", $"{code} is already a project's code on DELIOS, or was: a code is never used twice.", new { field = "code" });
        if (!await Organizations.Registry.ReserveAsync(db, Organizations.ReservedKinds.ProjectName, name, project.Id, project.TenantId, cancellationToken))
            return Problems.Conflict("PROJECT_NAME_TAKEN", $"{name} is already a project's name on DELIOS, or was: choose another.", new { field = "name" });
        db.Projects.Add(project);
        await ProjectCodes.EnsurePublishedAsync(db, project.TenantId, project.Code, project.Name, cancellationToken);
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
            // Changed once in the project's life, for a mistake: the old code stays its own, on what was numbered with it.
            if (project.CodeChangedAt is not null)
                return Problems.Conflict("CODE_CHANGED_ONCE",
                    $"{project.Code}'s code was already changed once (from {project.PreviousCode}, by {project.CodeChangedByName}): it is fixed now.",
                    new { field = "code" });
            if (code.Length > 32) return Problems.Invalid("CODE_TOO_LONG", "A project code has at most 32 characters.");
            if (!await Organizations.Registry.ReserveAsync(db, Organizations.ReservedKinds.ProjectCode, code, project.Id, project.TenantId, cancellationToken))
                return Problems.Conflict("PROJECT_CODE_TAKEN", $"{code} is already a project's code on DELIOS, or was: a code is never used twice.", new { field = "code" });
            changes.Add($"code {project.Code} → {code}; numbers already given keep {project.Code}");
            project.PreviousCode = project.Code;
            project.CodeChangedAt = SystemClock.Instance.GetCurrentInstant();
            project.CodeChangedByName = (await ActorAsync(http, db, cancellationToken)).Name;
            project.Code = code;
            await ProjectCodes.EnsurePublishedAsync(db, project.TenantId, code, Blank(request.Name) ?? project.Name, cancellationToken);
        }
        if (Blank(request.Name) is { } name && name != project.Name)
        {
            // Renamed as often as needed; each name it had stays its own.
            if (!await Organizations.Registry.ReserveAsync(db, Organizations.ReservedKinds.ProjectName, name, project.Id, project.TenantId, cancellationToken))
                return Problems.Conflict("PROJECT_NAME_TAKEN", $"{name} is already a project's name on DELIOS, or was: choose another.", new { field = "name" });
            changes.Add($"name → {name}");
            project.Name = name;
        }
        if (Blank(request.ContractRole)?.ToUpperInvariant() is { } role && role != project.ContractRole) { changes.Add($"contract role → {role}"); project.ContractRole = role; }
        if (Blank(request.Kind)?.ToUpperInvariant() is { } kind && kind != project.Kind)
        {
            if (await KindRefusedAsync(db, kind, cancellationToken) is { } refusedKind) return refusedKind;
            changes.Add($"kind → {kind}");
            project.Kind = kind;
        }
        if (Blank(request.Status)?.ToUpperInvariant() is { } status && status != project.Status)
        {
            if (status is not ("ACTIVE" or "CLOSED" or "ON_HOLD" or "ARCHIVED"))
                return Problems.Invalid("STATUS_INVALID", "A project is ACTIVE, ON_HOLD, CLOSED or ARCHIVED.");
            // Archiving puts every document of it away, reopening brings them back: always with why, kept on the project.
            var reason = Blank(request.Reason);
            if (reason is null) return Problems.Invalid("REASON_REQUIRED", "Say why: it is kept on the project's line.", new { field = "reason" });
            changes.Add($"status → {status}: {reason}");
            project.StatusReason = reason;
            project.StatusChangedByName = (await ActorAsync(http, db, cancellationToken)).Name;
            project.StatusChangedAt = SystemClock.Instance.GetCurrentInstant();
            // A document is archived with its project, never on its own; reopening the project brings them back.
            if (status == "ARCHIVED")
            {
                var archived = await db.Documents.Where(d => d.ProjectId == projectId
                        && (d.State == Documents.DocumentStates.Planned || d.State == Documents.DocumentStates.Active))
                    .ExecuteUpdateAsync(d => d.SetProperty(x => x.State, Documents.DocumentStates.Archived), cancellationToken);
                changes.Add($"{archived} document(s) archived with it");
            }
            else if (project.Status == "ARCHIVED")
            {
                var back = await db.Documents.Where(d => d.ProjectId == projectId && d.State == Documents.DocumentStates.Archived)
                    .ExecuteUpdateAsync(d => d.SetProperty(x => x.State,
                        x => x.LatestRevisionState == null ? Documents.DocumentStates.Planned : Documents.DocumentStates.Active), cancellationToken);
                changes.Add($"{back} document(s) back in use");
            }
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
    /// <summary>
    /// <c>POST /api/admin/projects/{id}/join</c>: an administrator opening one of the organization's projects they are not
    /// on joins it, holding the organization's administrator function (the first function that may configure). Somebody
    /// switched off on the project stays off.
    /// </summary>
    private static async Task<IResult> JoinProjectAsync(
        Guid projectId, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var project = await db.Projects.AsNoTracking().SingleOrDefaultAsync(p => p.Id == projectId && p.Status == "ACTIVE", cancellationToken);
        if (project is null) return Problems.NotFound("PROJECT_NOT_FOUND", "No such project in use.");
        var me = http.User.UserId();
        var membership = await db.Memberships.AsNoTracking().SingleOrDefaultAsync(m => m.ProjectId == projectId && m.UserId == me, cancellationToken);
        if (membership is not null)
        {
            return membership.Active ? Results.NoContent()
                : Problems.Conflict("SWITCHED_OFF_HERE", "You were taken off this project. Put yourself back in People & access, saying why.");
        }
        var function = await db.Functions.AsNoTracking().Where(f => f.Active && f.Rules.Any(r => r.Verbs.Contains(Verbs.Configure)
                && (r.ProjectRole == null || r.ProjectRole == project.ContractRole)))
            .OrderBy(f => f.Name).FirstOrDefaultAsync(cancellationToken);
        if (function is null)
            return Problems.Conflict("NO_ADMIN_FUNCTION", "No function may configure on this project. Publish one, or put yourself on it in People & access.");
        db.Memberships.Add(new Membership { TenantId = project.TenantId, ProjectId = project.Id, UserId = me, FunctionId = function.Id });
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "PROJECT_JOINED", "Project", project.Id, project.Code,
            $"An administrator opened the project and joined it as {function.Name}.", project.Id, cancellationToken);
        return Results.NoContent();
    }

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
        // Who keeps the people here: the control function; where the project lets everyone add, whoever holds Manage
        // too (everyone else adds from the project directory). An administrator always may, and is never held for
        // confirmation: they set the project up.
        var me = http.User.UserId();
        var admin = await Keepers.ConfiguresAsync(http);
        var holds = async (string verb) => await db.Memberships.AnyAsync(m => m.ProjectId == projectId && m.UserId == me && m.Active
            && m.Function!.Active && ((verb == Verbs.Control && m.ActsAsControl) || m.Function.Rules.Any(r => r.Verbs.Contains(verb))), cancellationToken);
        var withControl = await Settings.ProjectAnswers.ControlDoesAsync(db, projectId, "PROJECT_PEOPLE", cancellationToken);
        if (!admin && !(await holds(Verbs.Control) || (!withControl && await holds(Verbs.Manage))))
            return Problems.Forbidden("PEOPLE_NOT_YOURS", $"On {project.Code} the control function keeps who is on the project.");
        // Joining waits for the confirmation of whoever holds Manage, where the project asks for it.
        var confirming = !admin && await Settings.ProjectAnswers.NeedsConfirmationAsync(db, projectId, "PROJECT_PEOPLE", cancellationToken);
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
            if (confirming) changes.Add(await HoldForConfirmationAsync(db, http, membership, request.ConfirmerId, cancellationToken));
        }
        else
        {
            if (function is not null && function.Id != membership.FunctionId) { membership.FunctionId = function.Id; changes.Add($"function → {function.Name}"); }
            var department = Blank(request.Department);
            if (department != membership.Department) { membership.Department = department; changes.Add($"department → {department ?? "none"}"); }
            if (request.Active != membership.Active)
            {
                if (!request.Active && user.Id == http.User.UserId()) return Problems.Conflict("SELF_LOCKOUT", "You cannot remove yourself from a project.");
                if (request.Active && membership.PendingSince is not null)
                    return Problems.Conflict("PENDING", $"{user.Name} waits for {membership.ConfirmerName ?? "an answer"} to join {project.Code}.");
                membership.Active = request.Active;
                changes.Add(request.Active ? $"back on {project.Code}" : $"removed from {project.Code}");
                if (request.Active && confirming) changes.Add(await HoldForConfirmationAsync(db, http, membership, request.ConfirmerId, cancellationToken));
            }
        }
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(await ActorAsync(http, db, cancellationToken), "MEMBERSHIP_CHANGED", "User", user.Id, user.Name,
            string.Join("; ", changes), projectId, cancellationToken);
        // Put on the project (not held for confirmation): they are told, by notification and email.
        if (membership.Active && membership.PendingSince is null && changes.Any(c => c.StartsWith("added to") || c.StartsWith("back on")))
            await JoinRequests.TellJoinedAsync(db, http.RequestServices.GetRequiredService<Notifications.Notifier>(), project, membership, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// Holds a person off the project until they are confirmed: inactive, with who added them and who is asked (when
    /// nobody is named, anyone holding <paramref name="answeredBy"/> on the project: Manage, or the control function).
    /// Those asked are told, on a transmittal.
    /// </summary>
    internal static async Task<string> HoldForConfirmationAsync(DeliosDbContext db, HttpContext http, Membership membership, Guid? confirmerId,
        CancellationToken cancellationToken, string? why = null, string answeredBy = Verbs.Manage)
    {
        var clock = http.RequestServices.GetRequiredService<IClock>();
        var notifier = http.RequestServices.GetRequiredService<Notifications.Notifier>();
        var transmittals = http.RequestServices.GetRequiredService<Transmittals.TransmittalService>();
        var by = (await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), cancellationToken)).Name;
        var confirmer = confirmerId is { } cid ? await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == cid && u.Active, cancellationToken) : null;
        membership.Active = false;
        membership.PendingSince = clock.GetCurrentInstant();
        membership.ProposedById = http.User.UserId();
        membership.ProposedByName = by;
        membership.ConfirmerId = confirmer?.Id;
        membership.ConfirmerName = confirmer?.Name;
        membership.ConfirmedAt = null;
        membership.ConfirmedByName = null;
        membership.RefusedAt = null;
        membership.RefusedByName = null;
        membership.RefusedReason = null;
        var told = confirmer is not null ? [confirmer.Id] : await Actions.NoticeLog.HoldersAsync(db, membership.ProjectId, answeredBy, cancellationToken);
        var person = (await db.Users.AsNoTracking().SingleAsync(u => u.Id == membership.UserId, cancellationToken)).Name;
        // Asked on a transmittal: whoever confirms answers it, in the same thread.
        var project = await db.Projects.AsNoTracking().SingleAsync(p => p.Id == membership.ProjectId, cancellationToken);
        var function = await db.Functions.AsNoTracking().Where(f => f.Id == membership.FunctionId).Select(f => f.Name).SingleOrDefaultAsync(cancellationToken);
        var letter = await Actions.ActionLetters.SendAsync(db, transmittals, clock, project, new Actor(http.User.UserId(), by), Actions.ActionLetters.Request,
            $"{person} to join {project.Code}",
            $"{by} asks for {person} to join {project.Code} as {function}{(membership.Department is { } d ? $", department {d}" : "")}." +
            (string.IsNullOrWhiteSpace(why) ? "" : $"\n\n{why.Trim()}") +
            "\n\nThey join once confirmed. Confirm or refuse it on “People to confirm”.",
            told, [], null, cancellationToken);
        membership.ConfirmTransmittalId = letter?.Id;

        if (letter is null && told.Count > 0)
            await notifier.NotifyAsync(membership.TenantId, membership.ProjectId, told.Distinct(), Notifications.NotificationKinds.General,
                $"{person} to confirm on the project", $"{by} added {person}; they join once confirmed.", "/people/confirm", cancellationToken);
        return $"waiting for {confirmer?.Name ?? (answeredBy == Verbs.Manage ? "whoever holds Manage" : "the control function")} to confirm";
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
            f.Clearance,
            Holders = held.FirstOrDefault(h => h.Key == f.Id)?.Count ?? 0,
            Rules = f.Rules.Select(r => new { r.Id, r.Verbs, r.DeliverableType, r.DocType, r.Discipline, r.Criticality, r.Confidentiality, r.ProjectRole, r.Family, r.Note }),
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
        if (request.Clearance is not null)
        {
            var clearance = Blank(request.Clearance);
            if (clearance is not null && !await db.ValueEntries.AnyAsync(v => v.SetKey == Documents.ValueSets.Confidentiality && v.Code == clearance
                    && v.Status == Documents.ValueStatus.Active, cancellationToken))
                return Problems.Invalid("CLEARANCE_UNKNOWN", $"{clearance} is not a published confidentiality level.");
            if (clearance != function.Clearance)
            {
                changes.Add(clearance is null ? "clearance: no limit" : $"clearance → {clearance}");
                function.Clearance = clearance;
            }
        }
        if (request.Rules is { } rules)
        {
            if (!await Keepers.ConfiguresAsync(http) && rules.Any(r => (r.Verbs ?? []).Contains(Verbs.Configure)))
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
                    Family = Blank(rule.Family) is { } family && family.Length <= 32 ? family : null,
                    Note = Blank(rule.Note) is { } note ? note.Length > 300 ? note[..300] : note : null,
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
    private static async Task<IResult> PartiesAsync(DeliosDbContext db, Organizations.OrganizationService organizations,
        CancellationToken cancellationToken)
    {
        var links = await organizations.PartyLinksAsync(cancellationToken);
        var parties = await db.Parties.AsNoTracking().OrderBy(p => p.Name).ToListAsync(cancellationToken);
        var identityIds = parties.Where(p => p.OrganizationId != null).Select(p => p.OrganizationId!.Value).ToList();
        var identities = await db.OrganizationIdentities.AsNoTracking().Where(o => identityIds.Contains(o.Id)).ToDictionaryAsync(o => o.Id, cancellationToken);
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
            p.CarriedByUserId,
            p.ExternalSystem,
            p.EvidenceRequired,
            p.ContactEmail,
            // What was changed once and is fixed now: its code and name (the same everywhere on DELIOS), how it works with us.
            Changed = p.OrganizationId is { } oid && identities.TryGetValue(oid, out var o) ? new
            {
                Code = o.CodeChangedAt is null ? null : new { Was = o.PreviousCode, By = o.CodeChangedByName, At = o.CodeChangedAt.Value.ToDateTimeOffset() },
                Name = o.NameChangedAt is null ? null : new { Was = o.PreviousName, By = o.NameChangedByName, At = o.NameChangedAt.Value.ToDateTimeOffset() },
                Participation = p.ParticipationChangedAt is null ? null : new { Was = p.PreviousParticipation, By = p.ParticipationChangedByName, At = p.ParticipationChangedAt.Value.ToDateTimeOffset() },
                // Another organization on DELIOS keeps its own code and name: only it changes them.
                Theirs = o.TenantId is { } own && own != p.TenantId,
                Identifier = o.IdentifierShown is null ? null : new { o.Country, Kind = o.IdentifierKind, Number = o.IdentifierNumber },
                IdentifierWas = o.IdentifierChangedAt is null ? null : new { Was = o.PreviousIdentifier, By = o.IdentifierChangedByName, At = o.IdentifierChangedAt.Value.ToDateTimeOffset() },
                o.NoIdentifierReason,
                o.Domain,
                DomainConfirmed = o.DomainConfirmedAt != null,
                OnDelios = o.TenantId != null,
                o.Id,
            } : null,
            People = people.FirstOrDefault(c => c.Key == p.Id)?.Count ?? 0,
            // Collaborator (linked to its own organization), guest, or not on DELIOS (docs/ORGANIZATIONS.md).
            Kind = p.IsInternal ? null : Organizations.OrganizationService.KindOf(p, links.TryGetValue(p.Id, out var l) && l.State == Organizations.LinkStates.Linked),
            Link = links.TryGetValue(p.Id, out var link) ? new { link.Id, link.State, link.Organization } : null,
        }));
    }

    /// <summary>
    /// <c>POST /api/admin/parties</c>: a new organization taking part. An organization has one code and one name across
    /// DELIOS: one already known is added under its own; a code or name of another is refused.
    /// </summary>
    private static async Task<IResult> CreatePartyAsync(
        PartyRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, Organizations.OrganizationService organizations,
        Notifications.Notifier notifier, CancellationToken cancellationToken)
    {
        var tenantId = http.User.TenantId();
        var actor = await ActorAsync(http, db, cancellationToken);
        Party party;
        Organizations.OrganizationIdentity identity;
        if (request.IdentityId is { } known)
        {
            // Add: an organization DELIOS already knows, as it is.
            var chosen = await Organizations.Registry.IdentityAsync(db, known, cancellationToken);
            if (chosen is null) return Problems.NotFound("ORGANIZATION_NOT_FOUND", "No such organization on DELIOS.");
            identity = chosen;
            if (identity.TenantId == tenantId) return Problems.Invalid("SAME_ORGANIZATION", "That is us.");
            if (await db.Parties.AnyAsync(p => p.OrganizationId == identity.Id, cancellationToken))
                return Problems.Conflict("ALREADY_LISTED", $"{identity.Name} is already in your list of organizations.");
            if (await db.Parties.AnyAsync(p => p.Code == identity.Code, cancellationToken))
                return Problems.Conflict("PARTY_CODE_TAKEN", $"{identity.Code} is already the code of another organization in your list.");
            party = new Party { TenantId = tenantId, Code = identity.Code, Name = identity.Name };
            var onDelios = identity.TenantId is not null;
            var problem = Apply(party, request with { Code = null, Name = null, Participation = onDelios ? Participations.InApp : request.Participation },
                [], creating: true);
            if (problem is not null) return problem;
            db.Parties.Add(party);
            await Organizations.Registry.HoldAsync(db, identity, party, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            await audit.WriteAsync(actor, "PARTY_CREATED", "Party", party.Id, party.Name, $"{party.Code}, added as DELIOS knows it.",
                cancellationToken: cancellationToken);
            // On DELIOS: invited to link at once; its administrator accepts, then puts its people on.
            if (onDelios)
            {
                var (_, refused) = await organizations.InviteAsync(actor, party.Id, new Organizations.LinkRequest(null), cancellationToken);
                if (refused is not null) return refused;
            }
            return Results.Created($"/api/admin/parties/{party.Id}", new { party.Id, invited = onDelios });
        }

        // Create: one DELIOS does not know yet, with its identifier (or why it has none).
        var code = Blank(request.Code)?.ToUpperInvariant();
        var name = Blank(request.Name);
        if (code is null || name is null) return Problems.Invalid("CODE_AND_NAME_REQUIRED", "An organization has a code and a name.");
        if (await db.Parties.AnyAsync(p => p.Code == code, cancellationToken))
            return Problems.Conflict("PARTY_CODE_TAKEN", $"{code} is already in your list of organizations.", new { field = "code" });
        var number = Blank(request.IdentifierNumber);
        if (number is null && Blank(request.NoIdentifierReason) is null)
            return Problems.Invalid("IDENTIFIER_REQUIRED",
                "Give its identifier with its country (company registration, else tax number, else professional register), or say why it has none.",
                new { fields = new[] { "country", "identifierNumber" } });
        var identifier = number is null ? null
            : Organizations.Registry.IdentifierValue(Blank(request.Country) ?? "", Blank(request.IdentifierKind) ?? "", number);
        var domain = Organizations.Registry.DomainOf(request.Domain);
        if (domain is not null && Organizations.Registry.PublicMail.Contains(domain)) domain = null;
        // What looks like it is named first: the same identifier, domain or a name that reads the same.
        var lookalikes = (await Organizations.Registry.LookalikesAsync(db, name, identifier, domain, cancellationToken))
            .Where(l => !(request.NotTheSame ?? []).Contains(l.Id)).ToList();
        if (lookalikes.Count > 0)
            return Problems.Conflict("LOOKS_LIKE", lookalikes.Count == 1
                ? $"Is this the same as {lookalikes[0].Name} ({lookalikes[0].Code})? It has {lookalikes[0].Why}."
                : $"Is this one of these {lookalikes.Count} organizations already on DELIOS?", new { lookalikes });
        var ours = request.IsInternal == true ? tenantId : (Guid?)null;
        var (found, refusedName) = await Organizations.Registry.OrganizationForAsync(db, code, name, tenantId, ours, cancellationToken);
        if (refusedName is not null) return refusedName;
        identity = found!;
        var changes = new List<string>();
        var badIdentifier = await Organizations.Registry.SetIdentifierAsync(db, identity, request.Country, request.IdentifierKind, number,
            request.NoIdentifierReason, tenantId, actor.Name, changes, cancellationToken);
        if (badIdentifier is not null) return badIdentifier;
        if (domain is not null && identity.DomainConfirmedAt is null) identity.Domain = domain;
        party = new Party { TenantId = tenantId, Code = identity.Code, Name = identity.Name };
        var invalid = Apply(party, request with { Code = null, Name = null }, [], creating: true);
        if (invalid is not null) return invalid;
        db.Parties.Add(party);
        await Organizations.Registry.HoldAsync(db, identity, party, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        // One not on DELIOS is told at its email for transmittals that it is now one we work with.
        if (party.ContactEmail is { } contact)
        {
            var us = await db.Tenants.AsNoTracking().Where(t => t.Id == tenantId).Select(t => t.Name).SingleAsync(cancellationToken);
            notifier.Queue(tenantId, null, Notifications.EmailKinds.Notification, contact, party.Name, $"{us} works with {party.Name} on DELIOS",
                $"{us} has recorded {party.Name} ({party.Code}) as an organization it works with. Its transmittals for you reach you at this address, "
                + "with their files; reply to them to answer. Nobody needs to sign in.", "Party", party.Id);
            await db.SaveChangesAsync(cancellationToken);
        }
        var said = request.NotTheSame is { Length: > 0 } ? $"; said not to be {request.NotTheSame.Length} look-alike(s)" : "";
        await audit.WriteAsync(actor, "PARTY_CREATED", "Party", party.Id, party.Name, $"{code}{(changes.Count > 0 ? $"; {string.Join("; ", changes)}" : "")}{said}",
            cancellationToken: cancellationToken);
        return Results.Created($"/api/admin/parties/{party.Id}", new { party.Id, invited = false });
    }

    /// <summary>
    /// <c>PUT /api/admin/parties/{id}</c>: how it takes part, who carries its exchange, revoked or not; and, once each,
    /// for a mistake, its code, its name (the same everywhere on DELIOS: carried to every list holding it) and how it
    /// works with us. What was changed once is fixed.
    /// </summary>
    private static async Task<IResult> UpdatePartyAsync(
        Guid partyId, PartyRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IServiceScopeFactory scopes,
        CancellationToken cancellationToken)
    {
        var party = await db.Parties.SingleOrDefaultAsync(p => p.Id == partyId, cancellationToken);
        if (party is null) return Problems.NotFound("PARTY_NOT_FOUND", "No such organization.");
        var changes = new List<string>();
        var actor = await ActorAsync(http, db, cancellationToken);
        Organizations.OrganizationIdentity? identity = null;
        IReadOnlyList<Organizations.OrganizationHolder> elsewhere = [];
        var code = Blank(request.Code)?.ToUpperInvariant();
        var name = Blank(request.Name);
        if ((code is not null && code != party.Code) || (name is not null && name != party.Name))
        {
            if (code is not null && code != party.Code && await db.Parties.AnyAsync(p => p.Code == code && p.Id != partyId, cancellationToken))
                return Problems.Conflict("PARTY_CODE_TAKEN", $"{code} is already in your list of organizations.", new { field = "code" });
            identity = party.OrganizationId is { } oid ? await Organizations.Registry.IdentityAsync(db, oid, cancellationToken) : null;
            if (identity is null) return Problems.Conflict("NOT_REGISTERED", "This organization is not in DELIOS's register yet: try again in a moment.");
            var (others, refused) = await Organizations.Registry.ChangeAsync(db, identity, code, name, party.TenantId, actor.Name, changes, cancellationToken);
            if (refused is not null) return refused;
            elsewhere = others;
            party.Code = identity.Code;
            party.Name = identity.Name;
        }
        if (Blank(request.IdentifierNumber) is not null || Blank(request.NoIdentifierReason) is not null || request.Domain is not null)
        {
            identity ??= party.OrganizationId is { } oid2 ? await Organizations.Registry.IdentityAsync(db, oid2, cancellationToken) : null;
            if (identity is not null)
            {
                var bad = await Organizations.Registry.SetIdentifierAsync(db, identity, request.Country, request.IdentifierKind, request.IdentifierNumber,
                    request.NoIdentifierReason, party.TenantId, actor.Name, changes, cancellationToken);
                if (bad is not null) return bad;
                // The domain someone says for them, until they prove their own on DELIOS.
                var said = Organizations.Registry.DomainOf(request.Domain);
                if (request.Domain is not null && identity.DomainConfirmedAt is null && said != identity.Domain
                    && (said is null || !Organizations.Registry.PublicMail.Contains(said)))
                {
                    identity.Domain = said;
                    changes.Add($"email domain → {said ?? "none"}");
                }
            }
        }
        var problem = Apply(party, request with { Code = null, Name = null }, changes, creating: false, actor.Name);
        if (problem is not null) return problem;
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(actor, "PARTY_UPDATED", "Party", party.Id, party.Name, string.Join("; ", changes), cancellationToken: cancellationToken);
        if (identity is not null && elsewhere.Count > 0) await Organizations.Registry.CarryAsync(scopes, identity, elsewhere, cancellationToken);
        return Results.NoContent();
    }

    private static IResult? Apply(Party party, PartyRequest request, List<string> changes, bool creating, string? actorName = null)
    {
        if (request.IsInternal is { } inside && inside != party.IsInternal) { changes.Add(inside ? "one of ours" : "outside"); party.IsInternal = inside; }
        if (request.Active is { } active && active != party.Active) { changes.Add(active ? "restored" : "revoked"); party.Active = active; }
        if (Blank(request.Participation)?.ToUpperInvariant() is { } participation && participation != party.Participation)
        {
            if (participation is not (Participations.InApp or Participations.ByProxy))
                return Problems.Invalid("PARTICIPATION_INVALID", "An organization answers here (IN_APP) or through one of ours (BY_PROXY).");
            // How it works with us changes once, for a mistake; then it is fixed.
            if (!creating)
            {
                if (party.ParticipationChangedAt is not null)
                    return Problems.Conflict("CHANGED_ONCE",
                        $"How {party.Name} works with us was already changed once (by {party.ParticipationChangedByName}): it is fixed now.",
                        new { field = "participation" });
                party.PreviousParticipation = party.Participation;
                party.ParticipationChangedAt = SystemClock.Instance.GetCurrentInstant();
                party.ParticipationChangedByName = actorName;
            }
            changes.Add($"participation → {participation}");
            party.Participation = participation;
        }
        // Who of ours carries it: a person ("" puts it back to the control function).
        if (request.CarriedBy is not null)
        {
            Guid? person = Guid.TryParse(request.CarriedBy, out var pid) ? pid : null;
            if (person != party.CarriedByUserId)
            {
                party.CarriedByUserId = person;
                party.CustodianFunction = null;
                changes.Add(person is null ? "carried by the control function" : "carried by someone of ours");
            }
        }
        else if (request.CustodianFunction is not null && Blank(request.CustodianFunction) != party.CustodianFunction)
        {
            party.CustodianFunction = Blank(request.CustodianFunction);
            changes.Add($"carried by {party.CustodianFunction ?? "the control function"}");
        }
        if (request.ContactEmail is not null && Blank(request.ContactEmail)?.ToLowerInvariant() != party.ContactEmail)
        {
            var contact = Blank(request.ContactEmail)?.ToLowerInvariant();
            if (contact is not null && (contact.Length > 254 || !System.Net.Mail.MailAddress.TryCreate(contact, out _)))
                return Problems.Invalid("EMAIL_INVALID", "That is not an email address.", new { field = "contactEmail" });
            party.ContactEmail = contact;
            changes.Add($"transmittals by email to {party.ContactEmail ?? "nobody"}");
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

/// <summary>Who keeps the directory day to day: an administrator, or anybody who acts as the control function on a project.</summary>
public static class Keepers
{
    /// <summary>
    /// Whether this person administers the organization: flagged an administrator, or holding the right to configure
    /// through a function on one of its projects. The matrix decides, as it does for everything else.
    /// </summary>
    public static async Task<bool> ConfiguresAsync(HttpContext http)
    {
        if (http.User.IsAdmin()) return true;
        var db = http.RequestServices.GetRequiredService<DeliosDbContext>();
        var me = http.User.UserId();
        return await db.Memberships.AnyAsync(m => m.UserId == me && m.Active && m.Function!.Active
            && m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Configure)), http.RequestAborted);
    }

    /// <summary>An endpoint filter that lets through only those who administer the organization.</summary>
    public static Func<EndpointFilterInvocationContext, EndpointFilterDelegate, ValueTask<object?>> Configurers(string refusal) => async (context, next) =>
        await ConfiguresAsync(context.HttpContext) ? await next(context) : Problems.Forbidden("ADMIN_ONLY", refusal);

    /// <summary>People and memberships: an administrator, the control function, or whoever holds Manage (Manage).</summary>
    public static async ValueTask<object?> People(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (await ConfiguresAsync(http)) return await next(context);
        var db = http.RequestServices.GetRequiredService<DeliosDbContext>();
        var me = http.User.UserId();
        var keeps = await db.Memberships.AnyAsync(m => m.UserId == me && m.Active && m.Function!.Active
            && (m.ActsAsControl || m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control) || r.Verbs.Contains(Verbs.Manage))), http.RequestAborted);
        return keeps
            ? await next(context)
            : Problems.Forbidden("ADMIN_OR_CONTROL", "An administrator, the control function or whoever holds Manage keeps the project's people.");
    }

    public static async ValueTask<object?> Filter(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (await ConfiguresAsync(http)) return await next(context);
        var db = http.RequestServices.GetRequiredService<DeliosDbContext>();
        var me = http.User.UserId();
        var control = await db.Memberships.AnyAsync(m => m.UserId == me && m.Active && m.Function!.Active
            && (m.ActsAsControl || m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control))), http.RequestAborted);
        return control
            ? await next(context)
            : Problems.Forbidden("ADMIN_OR_CONTROL", "An administrator, or the control function, keeps the organization's people and functions.");
    }
}
