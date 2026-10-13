using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Identity;

/// <summary>Someone on the project whose function grants a verb, as the screens list them.</summary>
public sealed record HolderView(Guid Id, string Name, string FunctionName, string? Department, bool Internal, string FunctionCode);

/// <summary>
/// Who on a project holds a verb, optionally for one class of document: the replacement for "every user whose role is
/// X". Read from the matrix, as every decision is.
/// </summary>
public static class HolderEndpoints
{
    public static void MapHolderEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("People")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("/holders", HoldersAsync);
    }

    /// <summary>GET <c>/holders?verb=CONTROL</c>, with the document's facts to ask about one class.</summary>
    private static async Task<IResult> HoldersAsync(
        HttpContext http, DeliosDbContext db, CancellationToken cancellationToken, string verb, string? deliverableType = null,
        string? docType = null, string? discipline = null, string? criticality = null, string? confidentiality = null)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal) return Results.Ok(Array.Empty<HolderView>());
        var members = await db.Memberships.AsNoTracking()
            .Where(m => m.ProjectId == access.Project.Id && m.Active && m.Function!.Active && db.Users.Any(u => u.Id == m.UserId && u.Active))
            .Include(m => m.Function!).ThenInclude(f => f.Rules)
            .Join(db.Users, m => m.UserId, u => u.Id, (m, u) => new { m, u.Name, Internal = u.Party == null || u.Party.IsInternal })
            .ToListAsync(cancellationToken);
        var asked = deliverableType ?? docType ?? discipline ?? criticality ?? confidentiality;
        var facts = new DocumentFacts(deliverableType, docType, discipline, criticality, confidentiality);
        return Results.Ok(members
            .Where(x =>
            {
                var their = ProjectAccess.OfFunction(access.Project, x.m.Function!, x.m.UserId, x.Name);
                return asked is null ? their.Holds(verb) : their.Allows(verb, facts);
            })
            .OrderBy(x => x.Name)
            .Select(x => new HolderView(x.m.UserId, x.Name, x.m.Function!.Name, x.m.Department, x.Internal, x.m.Function!.Code)));
    }
}
