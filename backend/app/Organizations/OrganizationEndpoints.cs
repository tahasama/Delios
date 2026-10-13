using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Delios.Host.Organizations;

/// <summary>Body of switching organization: the one to switch into.</summary>
public sealed record SwitchRequest(Guid TenantId);

/// <summary>
/// HTTP endpoints for organizations working together (docs/ORGANIZATIONS.md). Ours as host: invite the organization
/// one of our parties stands for, end the link, say which organizations take part in a project. Ours as guest: answer
/// an invitation, end a link, see the projects we take part in and put our people on them. And one sign-in across
/// organizations: where the signed-in person can switch to, and the switch itself.
/// </summary>
public static class OrganizationEndpoints
{
    public static void MapOrganizationEndpoints(this IEndpointRouteBuilder app)
    {
        // Document Control and administrators look after the organizations we work with.
        var keepers = app.MapGroup("/api/admin").WithTags("Organizations")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter(Keepers.Filter);
        keepers.MapPost("/parties/{partyId:guid}/link", async (Guid partyId, LinkRequest request, HttpContext http, OrganizationService orgs,
            DeliosDbContext db, CancellationToken c) =>
        {
            var (link, problem) = await orgs.InviteAsync(await ActorAsync(http, db, c), partyId, request, c);
            return problem ?? Results.Ok(new { link!.Id, link.State });
        });

        // The organization's own page: its administrators answer for it.
        var admins = app.MapGroup("/api/organization").WithTags("Organizations")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter(Keepers.Configurers("An administrator answers for the organization."));
        admins.MapGet("/links", async (OrganizationService orgs, CancellationToken c) => Results.Ok(await orgs.LinksAsync(c)));
        admins.MapPost("/links/{linkId:guid}/accept", async (Guid linkId, NoteRequest request, HttpContext http, OrganizationService orgs,
            DeliosDbContext db, CancellationToken c) => await orgs.AcceptAsync(await ActorAsync(http, db, c), linkId, request, c) ?? Results.NoContent());
        admins.MapPost("/links/{linkId:guid}/refuse", async (Guid linkId, NoteRequest request, HttpContext http, OrganizationService orgs,
            DeliosDbContext db, CancellationToken c) => await orgs.RefuseAsync(await ActorAsync(http, db, c), linkId, request, c) ?? Results.NoContent());
        admins.MapGet("/joined", async (OrganizationService orgs, CancellationToken c) => Results.Ok(await orgs.JoinedAsync(c)));
        admins.MapPut("/joined/{linkId:guid}/projects/{projectId:guid}/people", async (Guid linkId, Guid projectId, JoinPersonRequest request,
            HttpContext http, OrganizationService orgs, DeliosDbContext db, CancellationToken c) =>
            await orgs.JoinPersonAsync(await ActorAsync(http, db, c), linkId, projectId, request, c) ?? Results.NoContent());

        admins.MapGet("/joined/{linkId:guid}/guests", async (Guid linkId, OrganizationService orgs, CancellationToken c) =>
            Results.Ok(await orgs.GuestsAsync(linkId, c)));
        admins.MapPost("/joined/{linkId:guid}/guests/{hostUserId:guid}/bring", async (Guid linkId, Guid hostUserId, HttpContext http,
            OrganizationService orgs, DeliosDbContext db, CancellationToken c) =>
            await orgs.BringOverAsync(await ActorAsync(http, db, c), linkId, hostUserId, c) ?? Results.NoContent());

        // Ending a link: either side; ours as host is Document Control's too.
        app.MapPost("/api/organization/links/{linkId:guid}/end", async (Guid linkId, NoteRequest request, HttpContext http,
            OrganizationService orgs, DeliosDbContext db, CancellationToken c) =>
            await orgs.EndAsync(await ActorAsync(http, db, c), linkId, request, c) ?? Results.NoContent())
            .WithTags("Organizations").AddEndpointFilter<TransactionFilter>().AddEndpointFilter(Keepers.Filter);

        // The organizations taking part in one of our projects.
        var project = app.MapGroup("/api/projects/{projectId:guid}/organizations").WithTags("Organizations")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("", async (Guid projectId, OrganizationService orgs, CancellationToken c) =>
            Results.Ok(await orgs.ProjectPartiesAsync(projectId, c)));
        project.MapPut("/{partyId:guid}", async (Guid projectId, Guid partyId, ProjectPartyRequest request, HttpContext http,
            OrganizationService orgs, DeliosDbContext db, CancellationToken c) =>
        {
            var access = ProjectAccessFilter.Of(http);
            if (!access.IsInternal || !(access.Holds(Verbs.Control) || await Keepers.ConfiguresAsync(http)))
                return Problems.Forbidden("CONTROL_ONLY", "Document Control says which organizations take part in the project.");
            return await orgs.SetProjectPartyAsync(await ActorAsync(http, db, c), projectId, partyId, request, c) ?? Results.NoContent();
        });

        // One sign-in, several organizations.
        var me = app.MapGroup("/api").WithTags("Organizations").AddEndpointFilter<TransactionFilter>();
        me.MapGet("/me/elsewhere", async (HttpContext http, OrganizationService orgs, CancellationToken c) =>
            Results.Ok(await orgs.ElsewhereAsync(http.User.UserId(), c)));
        me.MapPost("/auth/switch", SwitchAsync);
    }

    /// <summary>
    /// <c>POST /api/auth/switch</c>: the signed-in person moves into another organization, onto the account standing for
    /// them there (or back to their own at home). The session is replaced; the sign-in's start carries over. An
    /// organization that asks for two-step sign-in is entered only by someone who has it turned on at home.
    /// </summary>
    private static async Task<IResult> SwitchAsync(SwitchRequest request, HttpContext http, OrganizationService orgs, DeliosDbContext db,
        IServiceScopeFactory scopes, SessionStore sessions, IOptions<SessionCookieOptions> cookie, CancellationToken cancellationToken)
    {
        var userId = http.User.UserId();
        var target = await orgs.SwitchTargetAsync(userId, request.TenantId, cancellationToken);
        if (target is null) return Problems.NotFound("NOT_THERE", "You are not on any project of that organization.");
        var token = http.Request.Cookies[SessionAuthenticationHandler.CookieName] ?? "";
        var startedAt = await sessions.StartedAtAsync(token, cancellationToken);
        var me = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new { u.HomeTenantId, u.MfaEnabledAt })
            .SingleAsync(cancellationToken);
        var into = await db.Tenants.AsNoTracking().SingleOrDefaultAsync(t => t.Id == target.Value.TenantId && t.Active, cancellationToken);
        if (into is null) return Problems.NotFound("NOT_THERE", "That organization is not open.");
        // Going out from home: the other organization's sign-in rule holds.
        if (me.HomeTenantId is null && into.MfaRequired && me.MfaEnabledAt is null)
            return Problems.Forbidden("MFA_REQUIRED_THERE", $"{into.Name} asks for two-step sign-in. Turn it on under Your sign-in, then come back.");

        var issued = await TenantScope.RunAsync(scopes, target.Value.TenantId, async (services, there) =>
        {
            var user = await there.Users.Include(u => u.Party).SingleOrDefaultAsync(u => u.Id == target.Value.UserId, cancellationToken);
            if (user is null || !user.Active || user.Party is { Active: false }) return ((string, NodaTime.Instant)?)null;
            var created = await services.GetRequiredService<SessionStore>().CreateAsync(user, cancellationToken, startedAt);
            await services.GetRequiredService<AuditLog>().WriteAsync(new Actor(user.Id, user.Name), "SWITCHED_IN", "User", user.Id, user.Email,
                user.HomeTenantId is null ? "Came back home from another organization." : "Came in from their own organization.",
                cancellationToken: cancellationToken);
            return created;
        }, cancellationToken);
        if (issued is null) return Problems.Forbidden("NOT_THERE", "Your account there is switched off.");
        await sessions.RevokeAsync(token, cancellationToken);
        SessionAuthenticationHandler.WriteCookie(http.Response, issued.Value.Item1, issued.Value.Item2, cookie.Value);
        return Results.NoContent();
    }

    private static async Task<Actor> ActorAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var id = http.User.UserId();
        var name = await db.Users.Where(u => u.Id == id).Select(u => u.Name).SingleAsync(cancellationToken);
        return new Actor(id, name);
    }
}
