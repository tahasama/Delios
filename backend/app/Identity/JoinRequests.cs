using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Identity;

/// <summary>
/// Body of asking for someone to join a project: someone who has an account (<c>UserId</c>), or someone new (name,
/// email and organization), with the function and department they would hold, why, who is asked to confirm (empty:
/// every manager), and the file the request came on (an email from outside, uploaded as proof).
/// </summary>
public sealed record JoinRequest(
    Guid? UserId, string? Name, string? Email, Guid? PartyId, Guid FunctionId, string? Department, string? Why,
    Guid? ConfirmerId = null, Guid? ProofFileId = null);

/// <summary>
/// Joining a project (owner's decision): a request management confirms. Anyone of ours on the project asks, for
/// someone with an account or someone new; it travels as an information transmittal (Request) to whoever confirms,
/// with why and, for something that came outside the system, its proof. Confirmed, they are put on by itself and
/// told; a new account's invitation goes then, never before. Document Control (or management, where the project has
/// no Document Control) adds directly where the project does not ask for confirmation; an administrator setting a
/// project up is never held.
/// </summary>
public static class JoinRequests
{
    public static void MapJoinRequestEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("People")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapPost("/people/requests", AskAsync);
        project.MapGet("/people/join-options", OptionsAsync);
    }

    /// <summary>
    /// <c>GET /people/join-options</c>: what anyone of ours needs to ask for someone to join: the functions, our
    /// organizations and the guest ones, the people with an account who are not on the project (nor waiting), and who
    /// may confirm (managers first). Whether this person's ask is put on at once or asked of management.
    /// </summary>
    private static async Task<IResult> OptionsAsync(HttpContext http, DeliosDbContext db, Organizations.OrganizationService organizations,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal) return Problems.Forbidden("OURS_ONLY", "Ask Document Control.");
        var projectId = access.Project.Id;
        var functions = await db.Functions.AsNoTracking().Where(f => f.Active).OrderBy(f => f.Name).Select(f => new { f.Id, f.Name }).ToListAsync(cancellationToken);
        var links = await organizations.PartyLinksAsync(cancellationToken);
        var parties = (await db.Parties.AsNoTracking().Where(p => p.Active).OrderBy(p => p.Name).ToListAsync(cancellationToken))
            .Select(p => new { p.Id, p.Name, p.IsInternal, p.Participation, Linked = links.TryGetValue(p.Id, out var l) && l.State == Organizations.LinkStates.Linked })
            .ToList();
        var seated = await db.Memberships.AsNoTracking().Where(m => m.ProjectId == projectId && (m.Active || m.PendingSince != null))
            .Select(m => m.UserId).ToListAsync(cancellationToken);
        var people = await db.Users.AsNoTracking().Where(u => u.Active && !seated.Contains(u.Id)).OrderBy(u => u.Name)
            .Select(u => new { u.Id, u.Name, Organization = u.Party == null ? null : u.Party.Name }).ToListAsync(cancellationToken);
        var managers = await Actions.NoticeLog.HoldersAsync(db, projectId, Verbs.Manage, cancellationToken);
        var onProject = await db.Memberships.AsNoTracking().Where(m => m.ProjectId == projectId && m.Active)
            .Join(db.Users.AsNoTracking().Where(u => u.Active), m => m.UserId, u => u.Id, (m, u) => new { u.Id, u.Name, Function = m.Function!.Name })
            .OrderBy(x => x.Name).ToListAsync(cancellationToken);
        var admin = await Keepers.ConfiguresAsync(http);
        var withControl = await Settings.ProjectAnswers.ControlDoesAsync(db, projectId, "PROJECT_PEOPLE", cancellationToken);
        var mayAdd = admin || (withControl ? access.Holds(Verbs.Control) : access.Holds(Verbs.Manage) || access.Holds(Verbs.Control));
        var asks = !admin && (!mayAdd || await Settings.ProjectAnswers.NeedsConfirmationAsync(db, projectId, "PROJECT_PEOPLE", cancellationToken));
        return Results.Ok(new
        {
            Functions = functions,
            Ours = parties.Where(p => p.IsInternal).Select(p => new { p.Id, p.Name }),
            Guests = parties.Where(p => !p.IsInternal && !p.Linked && p.Participation != "BY_PROXY").Select(p => new { p.Id, p.Name }),
            People = people,
            Confirmers = onProject.Select(p => new { p.Id, p.Name, p.Function, Manager = managers.Contains(p.Id) })
                .OrderByDescending(p => p.Manager).ThenBy(p => p.Name),
            Asks = asks,
            MayKeepProof = access.Holds(Verbs.Control),
        });
    }

    private static async Task<IResult> AskAsync(JoinRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        IPasswordHasher<User> hasher, IDataProtectionProvider protection, Notifications.Notifier notifier,
        Transmittals.IncomingService incoming, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var project = access.Project;
        if (!access.IsInternal) return Problems.Forbidden("OURS_ONLY", "Ask Document Control: people join a project at the organization's request.");
        var why = request.Why?.Trim();
        if (string.IsNullOrEmpty(why)) return Problems.Invalid("WHY_REQUIRED", "Say why they should join: whoever confirms reads it.", new { field = "why" });
        var function = await db.Functions.AsNoTracking().SingleOrDefaultAsync(f => f.Id == request.FunctionId && f.Active, cancellationToken);
        if (function is null) return Problems.Invalid("FUNCTION_REQUIRED", "Choose the function they would hold.", new { field = "functionId" });
        var department = string.IsNullOrWhiteSpace(request.Department) ? null : request.Department.Trim().ToUpperInvariant();
        if (department is not null && !(await Catalog.LoadAsync(db, cancellationToken)).IsActive(ValueSets.Disciplines, department))
            return Problems.Invalid("VALUE_NOT_PUBLISHED", $"{department} is not a published discipline.", new { field = "department" });

        // Who may add directly, and whether this project still asks management first.
        var admin = await Keepers.ConfiguresAsync(http);
        var withControl = await Settings.ProjectAnswers.ControlDoesAsync(db, project.Id, "PROJECT_PEOPLE", cancellationToken);
        var mayAdd = admin || (withControl ? access.Holds(Verbs.Control) : access.Holds(Verbs.Manage) || access.Holds(Verbs.Control));
        var held = !admin && (!mayAdd || await Settings.ProjectAnswers.NeedsConfirmationAsync(db, project.Id, "PROJECT_PEOPLE", cancellationToken));
        if (held && request.ConfirmerId is null && (await Actions.NoticeLog.HoldersAsync(db, project.Id, Verbs.Manage, cancellationToken)).Count == 0)
            return Problems.Conflict("NO_MANAGER", $"Nobody holds Manage on {project.Code}, so nobody can confirm. Give a manager's function the Manage permission, or name who confirms.");
        if (request.ProofFileId is not null && !access.Holds(Verbs.Control))
            return Problems.Forbidden("CONTROL_ONLY", "Document Control keeps what came from outside the system.");

        // Someone with an account, or someone new (their account is made now; the invitation waits for the yes).
        User? user;
        var newAccount = request.UserId is null;
        if (request.UserId is { } userId)
        {
            user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
            if (user is null || !user.Active) return Problems.NotFound("USER_NOT_FOUND", "No such person, or their account is switched off.");
        }
        else
        {
            var name = request.Name?.Trim();
            var email = request.Email?.Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(email)) return Problems.Invalid("NAME_AND_EMAIL_REQUIRED", "Give their name and email.");
            if (!email.Contains('@') || email.Length > 254) return Problems.Invalid("EMAIL_INVALID", "Give a valid email address.", new { field = "email" });
            var normalized = email.ToUpperInvariant();
            if (await db.SignInNames.AnyAsync(n => n.NormalizedEmail == normalized, cancellationToken))
                return Problems.Conflict("EMAIL_TAKEN", $"{email} already has an account: choose them under “Someone with an account”.", new { field = "email" });
            var party = request.PartyId is { } pid ? await db.Parties.AsNoTracking().SingleOrDefaultAsync(p => p.Id == pid && p.Active, cancellationToken) : null;
            if (request.PartyId is not null && party is null) return Problems.Invalid("PARTY_UNKNOWN", "Choose one of the organizations.", new { field = "partyId" });
            if (party is { IsInternal: false } && party.Participation == "BY_PROXY")
                return Problems.Invalid("NOBODY_SIGNS_IN", $"{party.Name} is not on DELIOS: nobody of theirs signs in; one of ours records for them.", new { field = "partyId" });
            user = new User { TenantId = project.TenantId, Email = email, NormalizedEmail = normalized, Name = name, PasswordHash = "", PartyId = party?.Id };
            user.PasswordHash = hasher.HashPassword(user, Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)));
            db.Users.Add(user);
            await db.SaveChangesAsync(cancellationToken);
            await audit.WriteAsync(new Actor(access.UserId, access.UserName), "USER_CREATED", "User", user.Id, user.Name,
                $"{email}, asked for on {project.Code}{(held ? "; invited once confirmed" : "")}.", project.Id, cancellationToken);
        }

        var membership = await db.Memberships.SingleOrDefaultAsync(m => m.ProjectId == project.Id && m.UserId == user.Id, cancellationToken);
        if (membership is { Active: true }) return Problems.Conflict("ALREADY_ON", $"{user.Name} is already on {project.Code}.");
        if (membership is { PendingSince: not null })
            return Problems.Conflict("PENDING", $"{user.Name} already waits for {membership.ConfirmerName ?? "management"} to confirm them on {project.Code}.");
        if (membership is null)
        {
            membership = new Membership { TenantId = project.TenantId, ProjectId = project.Id, UserId = user.Id, FunctionId = function.Id };
            db.Memberships.Add(membership);
        }
        membership.FunctionId = function.Id;
        membership.Department = department;
        membership.Active = true;

        string said;
        string? link = null;
        if (held)
        {
            membership.InviteOnJoin = newAccount;
            said = await DirectoryEndpoints.HoldForConfirmationAsync(db, http, membership, request.ConfirmerId, cancellationToken, why);
            // What the request came on (an email from outside, say) stays with it, as proof.
            if (request.ProofFileId is { } proof && membership.ConfirmTransmittalId is { } letterId
                && db.Transmittals.Local.FirstOrDefault(t => t.Id == letterId) is { } letter
                && await incoming.KeepProofAsync(access, letter, proof, cancellationToken) is { } refused)
                return refused;
        }
        else
        {
            said = $"put on {project.Code} as {function.Name}";
            if (newAccount) link = await InviteAsync(db, notifier, protection, user, access.UserName, cancellationToken);
        }
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "MEMBERSHIP_CHANGED", "User", user.Id, user.Name,
            $"{said}. Why: {why}", project.Id, cancellationToken);
        if (!held) await TellJoinedAsync(db, notifier, project, membership, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { user.Id, Held = held, Said = said, Invited = !held && newAccount && link is null, Link = link });
    }

    /// <summary>
    /// Sends a new account its invitation: the link to choose its own password (7 days, once). Email off on this
    /// installation: the link is handed back, for whoever asked to pass on. Does not save.
    /// </summary>
    public static async Task<string?> InviteAsync(DeliosDbContext db, Notifications.Notifier notifier, IDataProtectionProvider protection, User user,
        string byName, CancellationToken cancellationToken)
    {
        var link = PasswordReset.InvitationLink(protection, notifier, user);
        var organization = await db.Tenants.AsNoTracking().Where(t => t.Id == user.TenantId).Select(t => t.Name).SingleAsync(cancellationToken);
        notifier.Queue(user.TenantId, null, Notifications.EmailKinds.Account, user.Email, user.Name, "Your DELIOS account",
            $"{byName} made you an account on DELIOS, at {organization} ({user.Email}).\n\n" +
            $"To choose your password, open this link within {PasswordReset.InvitationLifetime.TotalDays:0} days. It works once.\n\n{link}",
            "User", user.Id);
        return notifier.Sends(Notifications.EmailKinds.Account) ? null : link;
    }

    /// <summary>Tells someone put on a project that they are on it, as what: a notification, and its email.</summary>
    public static async Task TellJoinedAsync(DeliosDbContext db, Notifications.Notifier notifier, Project project, Membership membership,
        CancellationToken cancellationToken)
    {
        var function = await db.Functions.AsNoTracking().Where(f => f.Id == membership.FunctionId).Select(f => f.Name).SingleOrDefaultAsync(cancellationToken);
        await notifier.NotifyAsync(project.TenantId, project.Id, [membership.UserId], Notifications.NotificationKinds.General,
            $"You are on {project.Code}", $"You are on {project.Code} ({project.Name}) as {function}{(membership.Department is { } d ? $", for {d}" : "")}.",
            "/", cancellationToken);
    }
}
