using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Reviews;

/// <summary>
/// Placing a decided review's stamp by hand (owner: the usual corner may be filled; "the stamp is automatic to prevent
/// falsification"): the app finds a clear spot by itself (<see cref="StampPlacement"/>); before the release or the
/// send-back, the control function may move it elsewhere on the page, and make it larger or smaller. Only the place is chosen, never what the stamp
/// says; each move is recorded; once the stamp is made, it is fixed.
/// </summary>
public static class StampPlaceEndpoints
{
    public sealed record PlaceRequest(double? X, double? Y, double? Scale);

    public static void MapStampPlaceEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}/reviews/{reviewId:guid}/stamp-place").WithTags("Reviews")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("", GetAsync);
        project.MapPut("", PutAsync);
    }

    /// <summary>The review, its revision, and whether its stamp may still be placed (decided, not yet made); null: not found.</summary>
    private static async Task<(Review Review, Revision Revision, bool Open)?> ReadAsync(DeliosDbContext db, ProjectAccess access, Guid reviewId,
        CancellationToken cancellationToken)
    {
        var review = await db.Reviews.AsNoTracking().SingleOrDefaultAsync(r => r.Id == reviewId && r.ProjectId == access.Project.Id, cancellationToken);
        if (review is null) return null;
        var revision = await db.Revisions.Include(r => r.Files).SingleAsync(r => r.Id == review.RevisionId, cancellationToken);
        var latest = await db.Reviews.AsNoTracking().Where(r => r.RevisionId == revision.Id).OrderByDescending(r => r.StartedAt)
            .Select(r => r.Id).FirstAsync(cancellationToken);
        var made = revision.Files.Any(f => f.Submission == revision.Submission && (f.Kind == FileKinds.Stamped || f.Kind == FileKinds.Returned));
        var open = review.Verdict is not null && latest == review.Id && !made
            && revision.State is not (RevisionStates.Released or RevisionStates.Returned or RevisionStates.Superseded or RevisionStates.Void);
        return (review, revision, open);
    }

    /// <summary>The control function only: whoever releases or sends it back.</summary>
    private static bool Keeper(ProjectAccess access) => access.IsInternal && access.Holds(Verbs.Control);

    /// <summary>Where the stamp will go: the first page, the stamp's size, the app's spot (or no room), and where it was put by hand.</summary>
    private static async Task<IResult> GetAsync(Guid reviewId, HttpContext http, DeliosDbContext db, Stamping stamping, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!Keeper(access)) return Problems.Forbidden("CONTROL_ONLY", "The control function places the stamp.");
        if (await ReadAsync(db, access, reviewId, cancellationToken) is not { } read) return Problems.NotFound("NOT_FOUND", "No such review.");
        if (!read.Open) return Results.Ok(new { open = false });
        var plan = await stamping.PlanAsync(read.Review, read.Revision, cancellationToken);
        if (plan is null) return Results.Ok(new { open = false });
        return Results.Ok(new
        {
            open = true,
            plan.FileId,
            Page = new { W = plan.PageW, H = plan.PageH },
            Stamp = new { W = plan.StampW, H = plan.StampH },
            Found = new { plan.Found.X, plan.Found.Y, Scale = plan.FoundScale },
            plan.ProjectScale,
            plan.Returned,
            Placed = read.Revision.StampX is { } x && read.Revision.StampY is { } y
                ? new { X = x, Y = y, Scale = read.Revision.StampScale ?? plan.ProjectScale, By = read.Revision.StampPlacedByName, At = read.Revision.StampPlacedAt } : null,
        });
    }

    /// <summary>Puts the stamp at a spot (its top left as a share of the page), or back to the app's (no X and Y).</summary>
    private static async Task<IResult> PutAsync(Guid reviewId, PlaceRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!Keeper(access)) return Problems.Forbidden("CONTROL_ONLY", "The control function places the stamp.");
        if (await ReadAsync(db, access, reviewId, cancellationToken) is not { } read) return Problems.NotFound("NOT_FOUND", "No such review.");
        if (!read.Open)
            return Problems.Conflict("STAMP_FIXED", "The stamp is already made, or the review is not decided: its place no longer changes.");
        var revision = read.Revision;
        string Words(double? x, double? y, double? size) => x is { } a && y is { } b
            ? $"{a * 100:0}% across, {b * 100:0}% down the page{(size is { } z ? $", {z * 100:0}% of its size" : "")}" : "the app's place and size";
        var was = Words(revision.StampX, revision.StampY, revision.StampScale);
        if (request.X is { } nx && request.Y is { } ny)
        {
            if (nx is < 0 or > 1 || ny is < 0 or > 1) return Problems.Invalid("OFF_THE_PAGE", "The stamp has to sit on the page.");
            if (request.Scale is < 0.5 or > 2) return Problems.Invalid("STAMP_SIZE", "The stamp may be from half to twice its size.");
            revision.StampX = Math.Round(nx, 4);
            revision.StampY = Math.Round(ny, 4);
            revision.StampScale = request.Scale is { } size ? Math.Round(size, 3) : null;
            revision.StampPlacedByName = (await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), cancellationToken)).Name;
            revision.StampPlacedAt = clock.GetCurrentInstant();
        }
        else
        {
            revision.StampX = revision.StampY = revision.StampScale = null;
            revision.StampPlacedByName = null;
            revision.StampPlacedAt = null;
        }
        await db.SaveChangesAsync(cancellationToken);
        var document = await db.Documents.AsNoTracking().Where(d => d.Id == revision.DocumentId).Select(d => d.Number).SingleAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "STAMP_PLACED", "Revision", revision.Id, $"{document} rev {revision.Value}",
            $"Where the stamp goes: {was} → {Words(revision.StampX, revision.StampY, revision.StampScale)}.", access.Project.Id, cancellationToken);
        return Results.NoContent();
    }
}
