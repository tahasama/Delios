using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Organizations;

/// <summary>
/// The organization's training space (docs/APP-DECISIONS.md §84): one project, marked <see cref="Spaces.Training"/>, its
/// code <c>SB-&lt;the organization's code&gt;</c>, where documents, reviews, releases and transmittals are tried with
/// made-up organizations, one for each role. It reads the organization's settings live, as any project that changed
/// nothing. Its administrators open it, and start it again: the old one is put away (archived, out of every list) and a
/// fresh one opens, nothing deleted, so the guards on every real project's files and trail stay whole.
/// </summary>
public static class Training
{
    /// <summary>Maps <c>GET</c> / <c>POST /api/admin/training</c> and <c>POST /api/admin/training/again</c>, administrators only.</summary>
    public static void MapTrainingEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/admin/training").WithTags("Administration")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("Only an administrator opens the training space, or starts it again."));
        admin.MapGet("", NowAsync);
        admin.MapPost("", OpenAsync);
        admin.MapPost("/again", AgainAsync);
    }

    /// <summary>Why the space is started again, kept on the old one's line.</summary>
    public sealed record AgainRequest(string? Reason = null);

    /// <summary>The training space open now, if any, and its made-up organizations.</summary>
    public sealed record TrainingView(Guid Id, string Code, string Name, Instant OpenedAt, int People, int Documents,
        IReadOnlyList<TrainingParty> Organizations);

    /// <summary>A made-up organization of the space and the role it plays there.</summary>
    public sealed record TrainingParty(Guid Id, string Code, string Name, string Role);

    /// <summary>The app's own roles (CONTRACT_ROLES, docs/ORGANIZATIONS.md), each with a short name for its made-up organization.</summary>
    private static readonly Dictionary<string, string> AppRoles = new()
    {
        ["EPC"] = "EPC contractor",
        ["EPCM"] = "EPCM contractor",
        ["PMC"] = "Project management consultant",
        ["DESIGN"] = "Design office",
        ["OWNER"] = "Owner",
        ["CM"] = "Construction manager",
        ["CONTRACTOR"] = "Main contractor",
        ["SUBCONTRACTOR"] = "Subcontractor",
        ["SUPPLIER"] = "Supplier",
        ["INSPECTOR"] = "Inspector",
    };

    /// <summary>The training space open now (none: null), whether a real project or this one is in hand.</summary>
    public static Task<Project?> CurrentAsync(DeliosDbContext db, CancellationToken cancellationToken) =>
        db.Projects.Where(p => p.Space == Spaces.Training && p.Status != "ARCHIVED").OrderByDescending(p => p.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>Whether a project is a training space (open or put away): left out of what spans the organization's projects.</summary>
    public static IQueryable<Guid> TrainingIds(DeliosDbContext db) => db.Projects.Where(p => p.Space == Spaces.Training).Select(p => p.Id);

    private static async Task<IResult> NowAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var project = await CurrentAsync(db, cancellationToken);
        return project is null ? Results.Ok(new { training = (TrainingView?)null }) : Results.Ok(new { training = await ViewAsync(db, project, cancellationToken) });
    }

    private static async Task<IResult> OpenAsync(HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        if (await CurrentAsync(db, cancellationToken) is { } open)
            return Problems.Conflict("TRAINING_OPEN", $"The training space is open already ({open.Code}): start it again to begin afresh.");
        var actor = await ActorAsync(http, db, cancellationToken);
        var project = await NewAsync(http, db, audit, actor, cancellationToken);
        if (project is null) return Problems.Conflict("TRAINING_CODE_TAKEN", "No training code was free for this organization. Write to support.");
        return Results.Ok(await ViewAsync(db, project, cancellationToken));
    }

    private static async Task<IResult> AgainAsync(AgainRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, db, cancellationToken);
        // Put away, never deleted: archived with its documents, out of every list, a fresh space in its place.
        if (await CurrentAsync(db, cancellationToken) is { } old)
        {
            var why = string.IsNullOrWhiteSpace(request.Reason) ? "The training space was started again." : request.Reason.Trim();
            old.Status = "ARCHIVED";
            old.StatusReason = why;
            old.StatusChangedByName = actor.Name;
            old.StatusChangedAt = SystemClock.Instance.GetCurrentInstant();
            await db.Documents.Where(d => d.ProjectId == old.Id && (d.State == DocumentStates.Planned || d.State == DocumentStates.Active))
                .ExecuteUpdateAsync(d => d.SetProperty(x => x.State, DocumentStates.Archived), cancellationToken);
            await db.Parties.IgnoreQueryFilters().Where(p => p.TrainingProjectId == old.Id)
                .ExecuteUpdateAsync(p => p.SetProperty(x => x.Active, false), cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            await audit.WriteAsync(actor, "PROJECT_UPDATED", "Project", old.Id, old.Code,
                $"put away, the training space started again: {why}", old.Id, cancellationToken);
        }
        var project = await NewAsync(http, db, audit, actor, cancellationToken);
        if (project is null) return Problems.Conflict("TRAINING_CODE_TAKEN", "No training code was free for this organization. Write to support.");
        return Results.Ok(await ViewAsync(db, project, cancellationToken));
    }

    /// <summary>
    /// Opens a fresh training space: <c>SB-&lt;our code&gt;</c> (then -2, -3… as codes are never given twice), the
    /// administrator on it with the control function, and one made-up organization for each role of the organization's
    /// list, taking part in it with that role. Its settings are the organization's, read live.
    /// </summary>
    private static async Task<Project?> NewAsync(HttpContext http, DeliosDbContext db, AuditLog audit, Actor actor, CancellationToken cancellationToken)
    {
        var tenantId = http.User.TenantId();
        var ours = await db.Parties.IgnoreQueryFilters().Where(p => p.IsInternal).OrderBy(p => p.Code)
            .Select(p => new { p.Code, p.Name }).FirstOrDefaultAsync(cancellationToken);
        var stem = $"SB-{(ours?.Code ?? "ORG").ToUpperInvariant()}";
        stem = stem.Length > 26 ? stem[..26] : stem;
        var named = $"{ours?.Name ?? "Our organization"} training";
        named = named.Length > 190 ? named[..190] : named;
        var place = await Settings.ProjectPlace.OrganizationAsync(db, cancellationToken);

        for (var turn = 1; turn <= 50; turn++)
        {
            var code = turn == 1 ? stem : $"{stem}-{turn}";
            var name = turn == 1 ? named : $"{named} {turn}";
            if (await db.Projects.AnyAsync(p => p.Code == code, cancellationToken)) continue;
            var project = new Project
            {
                TenantId = tenantId,
                Code = code,
                Name = name,
                Space = Spaces.Training,
                TimeZone = place.TimeZone,
                WeekendDays = place.WeekendDays,
                Country = place.Country,
                OpenedById = actor.Id,
            };
            // Its code and name are held on DELIOS as any project's, so no real project ever takes them.
            if (!await Registry.ReserveAsync(db, ReservedKinds.ProjectCode, code, project.Id, tenantId, cancellationToken)) continue;
            if (!await Registry.ReserveAsync(db, ReservedKinds.ProjectName, name, project.Id, tenantId, cancellationToken)) continue;
            db.Projects.Add(project);
            await ProjectCodes.EnsurePublishedAsync(db, tenantId, code, name, cancellationToken);
            var control = await db.Functions.Where(f => f.Active && f.Rules.Any(r => r.Verbs.Contains(Verbs.Control)))
                .OrderBy(f => f.Code).Select(f => (Guid?)f.Id).FirstOrDefaultAsync(cancellationToken);
            if (control is { } functionId && actor.Id is { } me)
                db.Memberships.Add(new Membership { TenantId = tenantId, ProjectId = project.Id, UserId = me, FunctionId = functionId });

            // One made-up organization for each role it may play: seen in this space only, never holding a code or name on
            // DELIOS, its people given accounts here (each to stand for it while practising).
            var published = await db.ValueEntries.IgnoreQueryFilters()
                .Where(v => v.SetKey == "CONTRACT_ROLES" && v.ProjectId == null && v.Status == ValueStatus.Active && v.Code != "GENERIC")
                .OrderBy(v => v.Code).Select(v => new { v.Code, Name = v.Label }).ToListAsync(cancellationToken);
            // An organization that never wrote its own list of roles works with the app's own, as its screens do.
            var roles = published.Count > 0 ? published : AppRoles.Select(r => new { Code = r.Key, Name = r.Value }).ToList();
            foreach (var role in roles)
            {
                var partyCode = $"{code}-{role.Code}";
                var party = new Party
                {
                    TenantId = tenantId,
                    Code = partyCode.Length > 32 ? partyCode[..32] : partyCode,
                    Name = $"{role.Name} (training)",
                    Participation = Participations.InApp,
                    TrainingProjectId = project.Id,
                };
                db.Parties.Add(party);
                db.ProjectParties.Add(new ProjectParty
                {
                    TenantId = tenantId,
                    ProjectId = project.Id,
                    PartyId = party.Id,
                    Role = role.Code,
                    AddedAt = SystemClock.Instance.GetCurrentInstant(),
                    AddedByName = actor.Name,
                });
            }
            await db.SaveChangesAsync(cancellationToken);
            await audit.WriteAsync(actor, "PROJECT_CREATED", "Project", project.Id, project.Code,
                $"{project.Name}: the organization's training space, with {roles.Count} made-up organization(s), one for each role", project.Id,
                cancellationToken);
            return project;
        }
        return null;
    }

    private static async Task<TrainingView> ViewAsync(DeliosDbContext db, Project project, CancellationToken cancellationToken)
    {
        var parties = await db.ProjectParties.Where(pp => pp.ProjectId == project.Id)
            .Join(db.Parties.IgnoreQueryFilters().Where(p => p.TrainingProjectId == project.Id), pp => pp.PartyId, p => p.Id,
                (pp, p) => new { p.Id, p.Code, p.Name, pp.Role })
            .OrderBy(p => p.Code).ToListAsync(cancellationToken);
        var people = await db.Memberships.CountAsync(m => m.ProjectId == project.Id && m.Active, cancellationToken);
        var documents = await db.Documents.CountAsync(d => d.ProjectId == project.Id, cancellationToken);
        return new TrainingView(project.Id, project.Code, project.Name, project.CreatedAt, people, documents,
            parties.Select(p => new TrainingParty(p.Id, p.Code, p.Name, p.Role ?? "")).ToList());
    }

    private static async Task<Actor> ActorAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var id = http.User.UserId();
        var name = await db.Users.Where(u => u.Id == id).Select(u => u.Name).SingleAsync(cancellationToken);
        return new Actor(id, name);
    }
}
