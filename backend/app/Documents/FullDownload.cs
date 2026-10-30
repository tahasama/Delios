using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>
/// The full download (owner: "the ultimate package that an org may download, having all their files"): one zip of every
/// document's newest released revision (its PDF as released, stamped where it was, and its source file), with what the
/// person chose beside it (the register as Excel, each review's verdicts and comments, the transmittals, the audit
/// trail), filed as they chose (the package tree, levels in their order, or flat). An administrator takes the whole
/// organization or one project; a project's control function takes that project. What the person may read is fixed when
/// they ask, with their own rights on each project (clearance always applies): the worker packs exactly that list.
/// Made once, in the background (<see cref="FullDownloadBuilder"/>), kept sealed like every file, and opened only by
/// whoever asked. A newer one from the same person takes the place of the older (its zip goes: it is only a copy).
/// </summary>
public sealed class FullDownload
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    /// <summary>The project taken; null: the whole organization (every project the person is on).</summary>
    public Guid? ProjectId { get; set; }
    /// <summary>What it covers, as said to the person: "P1001 · Harbour extension", or "The whole organization".</summary>
    public required string Scope { get; set; }
    public Guid RequestedById { get; set; }
    public required string RequestedByName { get; set; }
    public Instant RequestedAt { get; set; }
    /// <summary>How the folders are made: <see cref="FullDownloadLayouts"/>.</summary>
    public string Layout { get; set; } = FullDownloadLayouts.Tree;
    /// <summary>With <see cref="FullDownloadLayouts.Levels"/>, the levels in their order: <see cref="FullDownloadLevels"/>.</summary>
    public string[] Levels { get; set; } = [];
    public bool WithRegister { get; set; }
    public bool WithReviews { get; set; }
    public bool WithTransmittals { get; set; }
    public bool WithAudit { get; set; }
    /// <summary>The projects it covers, and those the person is not on (named in the download's note, left out).</summary>
    public Guid[] ProjectIds { get; set; } = [];
    public string[] LeftOut { get; set; } = [];
    /// <summary>The documents and transmittals the person may read, fixed when they asked.</summary>
    public Guid[] DocumentIds { get; set; } = [];
    public Guid[] TransmittalIds { get; set; } = [];
    public string Status { get; set; } = FullDownloadStatuses.Queued;
    public Instant? StartedAt { get; set; }
    public Instant? FinishedAt { get; set; }
    public string? ObjectKey { get; set; }
    public long? Size { get; set; }
    public int? FileCount { get; set; }
    public string? Error { get; set; }
}

public static class FullDownloadStatuses
{
    public const string Queued = "QUEUED";
    public const string Running = "RUNNING";
    public const string Done = "DONE";
    public const string Failed = "FAILED";
    /// <summary>A newer one from the same person took its place: its zip is gone, its record stays.</summary>
    public const string Replaced = "REPLACED";
}

/// <summary>How the folders of a full download are made, chosen each time.</summary>
public static class FullDownloadLayouts
{
    /// <summary>The packages and the packages inside them; documents in no package in a folder of their own.</summary>
    public const string Tree = "TREE";
    /// <summary>The levels chosen, in their order (project, deliverable type, discipline, document type, phase, originator).</summary>
    public const string Levels = "LEVELS";
    /// <summary>Every document side by side (under its project when several are taken).</summary>
    public const string Flat = "FLAT";
    public static readonly string[] All = [Tree, Levels, Flat];
}

public static class FullDownloadLevels
{
    public const string Project = "PROJECT";
    public const string DeliverableType = "DELIVERABLE";
    public const string Discipline = "DISCIPLINE";
    public const string DocType = "DOCTYPE";
    public const string Phase = "PHASE";
    public const string Originator = "ORIGINATOR";
    public static readonly string[] All = [Project, DeliverableType, Discipline, DocType, Phase, Originator];
}

/// <summary>Put on the queue when a full download is asked; the worker makes it (<see cref="FullDownloadBuilder"/>).</summary>
public sealed record FullDownloadRequested(Guid TenantId, Guid DownloadId)
{
    public const string RoutingKey = "export.full";
}

internal sealed class FullDownloadConfiguration : IEntityTypeConfiguration<FullDownload>
{
    public void Configure(EntityTypeBuilder<FullDownload> b)
    {
        b.ToTable("full_downloads");
        b.Property(x => x.Scope).HasMaxLength(300);
        b.Property(x => x.RequestedByName).HasMaxLength(200);
        b.Property(x => x.Layout).HasMaxLength(16);
        b.Property(x => x.Status).HasMaxLength(16);
        b.Property(x => x.ObjectKey).HasMaxLength(300);
        b.Property(x => x.Error).HasMaxLength(2000);
        b.HasIndex(x => new { x.TenantId, x.RequestedById, x.RequestedAt });
    }
}

public static class FullDownloadEndpoints
{
    public sealed record AskRequest(Guid? ProjectId, string? Layout, string[]? Levels, bool Register, bool Reviews, bool Transmittals, bool Audit);

    public static void MapFullDownloadEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/full-downloads").WithTags("Full download").AddEndpointFilter<TransactionFilter>();
        g.MapGet("", MineAsync);
        g.MapPost("", AskAsync);
        g.MapGet("/{id:guid}/file", FileAsync).RequireRateLimiting("heavy");
    }

    /// <summary>The person's own full downloads, newest first, with where each stands.</summary>
    private static async Task<IResult> MineAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var me = http.User.UserId();
        var mine = await db.Set<FullDownload>().AsNoTracking().Where(d => d.RequestedById == me)
            .OrderByDescending(d => d.RequestedAt).Take(10)
            .Select(d => new
            {
                d.Id, d.ProjectId, d.Scope, d.RequestedAt, d.Layout, d.Levels, d.WithRegister, d.WithReviews, d.WithTransmittals, d.WithAudit,
                Documents = d.DocumentIds.Length, d.LeftOut, d.Status, d.FinishedAt, d.Size, d.FileCount, d.Error,
            })
            .ToListAsync(cancellationToken);
        return Results.Ok(mine);
    }

    private static async Task<IResult> AskAsync(AskRequest request, HttpContext http, DeliosDbContext db, ProjectAccessLoader loader,
        Transmittals.TransmittalService transmittals, AuditLog audit, IClock clock, CancellationToken cancellationToken)
    {
        var layout = request.Layout?.Trim().ToUpperInvariant() ?? FullDownloadLayouts.Tree;
        if (!FullDownloadLayouts.All.Contains(layout)) return Problems.Invalid("LAYOUT_UNKNOWN", "Choose how the folders are made: the package tree, levels, or flat.", new { field = "layout" });
        var levels = (request.Levels ?? []).Select(l => l.Trim().ToUpperInvariant()).Distinct().ToArray();
        if (levels.Any(l => !FullDownloadLevels.All.Contains(l))) return Problems.Invalid("LEVEL_UNKNOWN", "One of the levels is not one the download knows.", new { field = "levels" });
        if (layout == FullDownloadLayouts.Levels && levels.Length == 0)
            return Problems.Invalid("LEVELS_REQUIRED", "Choose at least one level for the folders, in the order wanted.", new { field = "levels" });

        var me = http.User.UserId();
        var admin = await Keepers.ConfiguresAsync(http);
        if (!await Keepers.IsOursAsync(http))
            return Problems.Forbidden("OURS_ONLY", "Only the organization's own people take its full download.");
        if (await db.Set<FullDownload>().AnyAsync(d => d.RequestedById == me
                && (d.Status == FullDownloadStatuses.Queued || d.Status == FullDownloadStatuses.Running), cancellationToken))
            return Problems.Conflict("DOWNLOAD_BUSY", "Your last full download is still being made: it is ready in a moment, and you are told.");

        // The projects taken: one, or (an administrator) every project of the organization that is not archived away.
        List<Identity.Project> projects;
        if (request.ProjectId is { } one)
        {
            var project = await db.Projects.AsNoTracking().SingleOrDefaultAsync(p => p.Id == one, cancellationToken);
            if (project is null) return Problems.NotFound("PROJECT_NOT_FOUND", "No such project.");
            projects = [project];
        }
        else
        {
            if (!admin) return Problems.Forbidden("ADMIN_ONLY", "An administrator takes the whole organization's download; the control function takes its project's.");
            projects = await db.Projects.AsNoTracking().OrderBy(p => p.Code).ToListAsync(cancellationToken);
        }

        // What the person may read on each project, with their own rights: clearance always applies.
        var documentIds = new List<Guid>();
        var transmittalIds = new List<Guid>();
        var covered = new List<Guid>();
        var leftOut = new List<string>();
        foreach (var project in projects)
        {
            var access = await loader.LoadAsync(project.Id, http.User, cancellationToken);
            if (access is null || !access.IsInternal)
            {
                leftOut.Add($"{project.Code} · {project.Name}: not open to you (you are not on it, or it is suspended)");
                continue;
            }
            if (request.ProjectId is not null && !admin && !access.Holds(Verbs.Control))
                return Problems.Forbidden("CONTROL_ONLY", "The control function, or an administrator, takes a project's full download.");
            covered.Add(project.Id);
            documentIds.AddRange(await DocumentQueries.Visible(db, access)
                .Where(d => db.Revisions.Any(r => r.DocumentId == d.Id && r.State == RevisionStates.Released))
                .Select(d => d.Id).ToListAsync(cancellationToken));
            if (request.Transmittals)
                transmittalIds.AddRange(await transmittals.Visible(access).Select(t => t.Id).ToListAsync(cancellationToken));
        }
        if (covered.Count == 0) return Problems.Forbidden("NOT_ON_PROJECT", "You are on none of these projects: a project's documents are read by those on it.");

        var name = http.User.Identity?.Name ?? "Unknown";
        var scope = request.ProjectId is null ? "The whole organization" : $"{projects[0].Code} · {projects[0].Name}";
        var download = new FullDownload
        {
            TenantId = http.User.TenantId(),
            ProjectId = request.ProjectId,
            Scope = scope.Length > 300 ? scope[..300] : scope,
            RequestedById = me,
            RequestedByName = name,
            RequestedAt = clock.GetCurrentInstant(),
            Layout = layout,
            Levels = layout == FullDownloadLayouts.Levels ? levels : [],
            WithRegister = request.Register,
            WithReviews = request.Reviews,
            WithTransmittals = request.Transmittals,
            // The audit trail is the administrators' and the control function's to read: both are the only ones asking.
            WithAudit = request.Audit,
            ProjectIds = [.. covered],
            LeftOut = [.. leftOut],
            DocumentIds = [.. documentIds.Distinct()],
            TransmittalIds = [.. transmittalIds.Distinct()],
        };
        db.Add(download);
        db.Enqueue(FullDownloadRequested.RoutingKey, new FullDownloadRequested(download.TenantId, download.Id));
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "FULL_DOWNLOAD_ASKED", "FullDownload", download.Id, scope,
            detail: $"{download.DocumentIds.Length} documents, {(layout == FullDownloadLayouts.Levels ? string.Join(" / ", levels) : layout)}",
            projectId: request.ProjectId, cancellationToken: cancellationToken);
        return Results.Ok(new { download.Id, download.Status, Documents = download.DocumentIds.Length, download.LeftOut });
    }

    /// <summary>The zip itself, opened from its seal, for whoever asked for it only.</summary>
    private static async Task<IResult> FileAsync(Guid id, HttpContext http, DeliosDbContext db, FileStorage storage, AuditLog audit, CancellationToken cancellationToken)
    {
        var me = http.User.UserId();
        var download = await db.Set<FullDownload>().AsNoTracking().SingleOrDefaultAsync(d => d.Id == id && d.RequestedById == me, cancellationToken);
        if (download is null) return Problems.NotFound("DOWNLOAD_NOT_FOUND", "No such download of yours.");
        if (download is not { Status: FullDownloadStatuses.Done, ObjectKey: { } key })
            return Problems.Conflict("DOWNLOAD_NOT_READY", download.Status == FullDownloadStatuses.Replaced
                ? "A newer full download of yours took its place: take that one."
                : "It is not ready yet: you are told when it is.");
        await audit.WriteAsync(http.User.Actor(), "DOWNLOAD", "FullDownload", download.Id, download.Scope, projectId: download.ProjectId, cancellationToken: cancellationToken);
        var stream = await storage.OpenReadAsync(key, cancellationToken);
        return Results.Stream(stream, "application/zip", FullDownloadBuilder.ZipName(download));
    }
}
