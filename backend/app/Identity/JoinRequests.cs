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
/// email and organization), with the function and department they would hold, an optional message, who is asked to
/// confirm (empty: whoever holds Manage), and the file the request came on (an email from outside, uploaded as proof).
/// </summary>
public sealed record JoinRequest(
    Guid? UserId, string? Name, string? Email, Guid? PartyId, Guid FunctionId, string? Department, string? Why,
    Guid? ConfirmerId = null, Guid? ProofFileId = null);

/// <summary>
/// Joining a project (owner's decision). Two switches of the project: who adds people (only the control function, the
/// default, or everyone of ours on the project: <c>PROJECT_PEOPLE</c>), and whether whoever holds Manage confirms each
/// addition (necessary by default: <c>CONFIRM:PROJECT_PEOPLE</c>). Anyone of ours asks for someone new; it travels as
/// an information transmittal (Request) to whoever answers it. Confirmed, they are put on by itself and told; a new
/// account's invitation goes then, never before. Whoever may add, where no confirmation is asked, puts them on at once;
/// an ask by someone who may not goes to the control function. An administrator setting a project up is never held.
/// No function or job title is named here: the control function is whoever holds CONTROL on the project.
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
    /// may confirm (holders of Manage first). Whether this person's ask is put on at once or asked first, and whether
    /// they may add someone with an account.
    /// </summary>
    private static async Task<IResult> OptionsAsync(HttpContext http, DeliosDbContext db, Organizations.OrganizationService organizations,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal) return Problems.Forbidden("OURS_ONLY", "People join this project at the request of the organization it belongs to.");
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
        var mayAdd = admin || await MayAddAsync(db, access, cancellationToken);
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
            MayAdd = mayAdd,
            Everyone = !await Settings.ProjectAnswers.ControlDoesAsync(db, projectId, "PROJECT_PEOPLE", cancellationToken),
            MayKeepProof = access.Holds(Verbs.Control),
        });
    }

    private static async Task<IResult> AskAsync(JoinRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        IPasswordHasher<User> hasher, IDataProtectionProvider protection, Notifications.Notifier notifier,
        Transmittals.IncomingService incoming, Organizations.OrganizationService organizations, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var project = access.Project;
        if (!access.IsInternal) return Problems.Forbidden("OURS_ONLY", "People join this project at the request of the organization it belongs to.");
        var why = string.IsNullOrWhiteSpace(request.Why) ? null : request.Why.Trim();
        var function = await db.Functions.AsNoTracking().SingleOrDefaultAsync(f => f.Id == request.FunctionId && f.Active, cancellationToken);
        if (function is null) return Problems.Invalid("FUNCTION_REQUIRED", "Choose the function they would hold.", new { field = "functionId" });
        var department = string.IsNullOrWhiteSpace(request.Department) ? null : request.Department.Trim().ToUpperInvariant();
        if (department is not null && !(await Catalog.LoadAsync(db, cancellationToken)).IsActive(ValueSets.Disciplines, department))
            return Problems.Invalid("VALUE_NOT_PUBLISHED", $"{department} is not a published discipline.", new { field = "department" });

        // Who may add directly, and whether this project asks whoever holds Manage first.
        var admin = await Keepers.ConfiguresAsync(http);
        var mayAdd = admin || await MayAddAsync(db, access, cancellationToken);
        var confirms = await Settings.ProjectAnswers.NeedsConfirmationAsync(db, project.Id, "PROJECT_PEOPLE", cancellationToken);
        var held = !admin && (!mayAdd || confirms);
        // Asked of: whoever is named, else whoever holds Manage (a confirmation), else the control function (only it adds).
        var answeredBy = confirms ? Verbs.Manage : Verbs.Control;
        if (held && request.ConfirmerId is null && (await Actions.NoticeLog.HoldersAsync(db, project.Id, answeredBy, cancellationToken)).Count == 0)
            return Problems.Conflict("NOBODY_ANSWERS", answeredBy == Verbs.Manage
                ? $"Nobody holds Manage on {project.Code}, so nobody can confirm. Give a function the Manage permission, or name who confirms."
                : $"Nobody acts as the control function on {project.Code}, so nobody can add them. Name who answers.");
        if (request.ProofFileId is not null && !access.Holds(Verbs.Control))
            return Problems.Forbidden("CONTROL_ONLY", "The control function keeps what came from outside the system.");
        if (request.UserId is not null && !mayAdd)
            return Problems.Forbidden("PEOPLE_NOT_YOURS", $"On {project.Code} the control function adds people with an account; ask for someone new instead.");

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
            var home = await db.SignInNames.AsNoTracking().Where(n => n.NormalizedEmail == normalized).Select(n => (Guid?)n.TenantId)
                .SingleOrDefaultAsync(cancellationToken);
            if (home is { } theirs && theirs != project.TenantId)
            {
                // Someone of an organization on DELIOS: their whole organization comes onto the project with them.
                if (!mayAdd) return Problems.Forbidden("THEIR_OWN_DELIOS",
                    $"{email} works from their own organization's DELIOS: the control function adds their organization to {project.Code}.", new { field = "email" });
                var (organization, linked, refused) = await organizations.BringOrganizationAsync(new Actor(access.UserId, access.UserName), theirs, project.Id,
                    function.Id, email, cancellationToken);
                if (refused is not null) return refused;
                return Results.Ok(new
                {
                    Held = false, Brought = organization,
                    Said = linked
                        ? $"{organization} works with us already: it now takes part in {project.Code}; their administrator puts {name} on"
                        : $"{organization} is on DELIOS: it now takes part in {project.Code} and is invited to work with us; once their administrator accepts, they put {name} on",
                });
            }
            if (home is not null)
                return Problems.Conflict("EMAIL_TAKEN", $"{email} already has an account: they are added with “Add someone”.", new { field = "email" });
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
            return Problems.Conflict("PENDING", $"{user.Name} already waits for {membership.ConfirmerName ?? "an answer"} to join {project.Code}.");
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
            said = await DirectoryEndpoints.HoldForConfirmationAsync(db, http, membership, request.ConfirmerId, cancellationToken, why, answeredBy);
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
            why is null ? $"{said}." : $"{said}. Message: {why}", project.Id, cancellationToken);
        if (!held) await TellJoinedAsync(db, notifier, project, membership, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { user.Id, Held = held, Said = said, Invited = !held && newAccount && link is null, Link = link });
    }

    /// <summary>
    /// Whether this person puts people on the project themselves: whoever acts as the control function, or, where the
    /// project lets everyone add, anyone of ours on it.
    /// </summary>
    public static async Task<bool> MayAddAsync(DeliosDbContext db, ProjectAccess access, CancellationToken cancellationToken) =>
        access.Holds(Verbs.Control)
        || (access.IsInternal && !await Settings.ProjectAnswers.ControlDoesAsync(db, access.Project.Id, "PROJECT_PEOPLE", cancellationToken));

    /// <summary>
    /// Whether this person answers a request to join that names nobody: whoever holds Manage, or, where the project asks
    /// no confirmation (the request came from someone who may not add), the control function.
    /// </summary>
    public static async Task<bool> AnswersAsync(DeliosDbContext db, ProjectAccess access, CancellationToken cancellationToken) =>
        access.Holds(Verbs.Manage)
        || (access.Holds(Verbs.Control) && !await Settings.ProjectAnswers.NeedsConfirmationAsync(db, access.Project.Id, "PROJECT_PEOPLE", cancellationToken));

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
