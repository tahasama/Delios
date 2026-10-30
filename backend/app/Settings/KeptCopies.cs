using System.Text.Json;
using System.Text.Json.Serialization;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Notifications;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Settings;

/// <summary>
/// A project's own copy of a card, kept when the organization put the project back to its own (owner: "if they decide
/// to reset, we keep a copy of the project's config in case we want to revert"). What it held is kept whole, with who
/// put it back, when and why; from the organization's card it may be put back again, with why, the project's control
/// function told. Kept for good: nothing is removed.
/// </summary>
public sealed class KeptCopy
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    /// <summary>The project it is a copy of; none for the organization's own (its defaults for new projects).</summary>
    public Guid? ProjectId { get; set; }
    /// <summary>What it is a copy of: NUMBERING, REVISIONS, ROUTES, LIST:&lt;key&gt;, FORM:&lt;key&gt;; DEFAULTS, the organization's.</summary>
    public required string Kind { get; set; }
    /// <summary>The card's words for it ("numbering", "Disciplines"), as it read when kept.</summary>
    public required string Title { get; set; }
    /// <summary>What the project held, as it held it.</summary>
    public required string Payload { get; set; }
    public Instant KeptAt { get; set; }
    public required string KeptByName { get; set; }
    /// <summary>Why the project was put back to the organization's.</summary>
    public required string Reason { get; set; }
    /// <summary>Put back on the project: when, by whom, why.</summary>
    public Instant? PutBackAt { get; set; }
    public string? PutBackByName { get; set; }
    public string? PutBackReason { get; set; }
}

/// <summary>Tells EF Core how to store <see cref="KeptCopy"/>.</summary>
internal sealed class KeptCopyConfiguration : IEntityTypeConfiguration<KeptCopy>
{
    public void Configure(EntityTypeBuilder<KeptCopy> b)
    {
        b.ToTable("kept_copies");
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Kind });
        b.Property(x => x.Kind).HasMaxLength(100);
        b.Property(x => x.Title).HasMaxLength(200);
        b.Property(x => x.Payload).HasColumnType("jsonb");
        b.Property(x => x.KeptByName).HasMaxLength(200);
        b.Property(x => x.Reason).HasMaxLength(2000);
        b.Property(x => x.PutBackByName).HasMaxLength(200);
        b.Property(x => x.PutBackReason).HasMaxLength(2000);
    }
}

/// <summary>A setting row as a copy keeps it.</summary>
public sealed record KeptSetting(string Key, string Value);

/// <summary>Body of putting a kept copy back on its project: why, always.</summary>
public sealed record PutBackRequest(string? Reason);

/// <summary>A kept copy as the organization's card reads it.</summary>
public sealed record KeptCopyView(Guid Id, Guid? ProjectId, string? ProjectCode, string? ProjectName, string Kind, string Title,
    DateTimeOffset KeptAt, string KeptByName, string Reason, DateTimeOffset? PutBackAt, string? PutBackByName, string? PutBackReason);

/// <summary>Keeping a project's copy when it is put back to the organization's, and putting it back again.</summary>
public static class KeptCopies
{
    /// <summary>How a copy is written: whole rows, navigation left out.</summary>
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        ReferenceHandler = ReferenceHandler.IgnoreCycles,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>Keeps what the project held before it is put back to the organization's.</summary>
    public static void Keep(DeliosDbContext db, IClock clock, Guid tenantId, Guid? projectId, string kind, string title, object payload,
        string by, string reason) =>
        db.Add(new KeptCopy
        {
            TenantId = tenantId,
            ProjectId = projectId,
            Kind = kind,
            Title = title,
            Payload = JsonSerializer.Serialize(payload, Json),
            KeptAt = clock.GetCurrentInstant(),
            KeptByName = by,
            Reason = reason,
        });

    /// <summary>The settings rows of a project matching a test, as a copy keeps them.</summary>
    public static async Task<List<KeptSetting>> SettingsAsync(DeliosDbContext db, Guid projectId, Func<IQueryable<Setting>, IQueryable<Setting>> which,
        CancellationToken cancellationToken) =>
        await which(db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == projectId)).Select(s => new KeptSetting(s.Key, s.Value))
            .ToListAsync(cancellationToken);

    /// <summary>Writes kept settings rows back onto the project.</summary>
    public static void Restore(DeliosDbContext db, IClock clock, Guid tenantId, Guid projectId, IEnumerable<KeptSetting> rows, string by)
    {
        foreach (var row in rows)
            db.Add(new Setting { TenantId = tenantId, ProjectId = projectId, Key = row.Key, Value = row.Value, UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = by });
    }

    /// <summary>Registers <c>GET /api/admin/kept-copies</c> and <c>POST /api/admin/kept-copies/{id}/put-back</c> (administrators).</summary>
    public static void MapKeptCopyEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/admin/kept-copies").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("A project's kept copy is put back by an administrator, from the organization's Settings."));
        admin.MapGet("", ListAsync);
        admin.MapPost("/{id:guid}/put-back", PutBackAsync);
    }

    private static async Task<IResult> ListAsync(DeliosDbContext db, CancellationToken cancellationToken, string? kind = null)
    {
        var query = db.Set<KeptCopy>().AsNoTracking();
        if (!string.IsNullOrWhiteSpace(kind))
        {
            var k = kind.Trim().ToUpperInvariant();
            query = k.EndsWith(':') ? query.Where(c => c.Kind.StartsWith(k)) : query.Where(c => c.Kind == k);
        }
        var rows = await query.OrderByDescending(c => c.KeptAt).ToListAsync(cancellationToken);
        var ids = rows.Where(c => c.ProjectId != null).Select(c => c.ProjectId!.Value).Distinct().ToList();
        var projects = await db.Projects.AsNoTracking().Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, cancellationToken);
        // The organization's own copies have no project; a project's whose project is gone stays out, as before.
        return Results.Ok(rows.Where(c => c.ProjectId is null || projects.ContainsKey(c.ProjectId.Value)).Select(c =>
        {
            var project = c.ProjectId is { } id ? projects[id] : null;
            return new KeptCopyView(c.Id, c.ProjectId, project?.Code, project?.Name, c.Kind, c.Title, c.KeptAt.ToDateTimeOffset(),
                c.KeptByName, c.Reason, c.PutBackAt?.ToDateTimeOffset(), c.PutBackByName, c.PutBackReason);
        }));
    }

    /// <summary>
    /// Puts a kept copy back on its project: the project holds again what it held when it was put back to the
    /// organization's. Only while it uses the organization's (a copy of its own made since is put back to the
    /// organization's first, which keeps that one too). With why, logged, its control function told.
    /// </summary>
    private static async Task<IResult> PutBackAsync(Guid id, PutBackRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        Notifier notifier, IClock clock, CancellationToken cancellationToken)
    {
        var reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim();
        if (reason is null) return Problems.Invalid("REASON_REQUIRED", "Say why it goes back on the project.", new { field = "reason" });
        var copy = await db.Set<KeptCopy>().SingleOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (copy is null) return Problems.NotFound("COPY_NOT_FOUND", "No such kept copy.");
        if (copy.PutBackAt is not null) return Problems.Conflict("ALREADY_PUT_BACK", "It was put back already.");
        if (copy.ProjectId is null)
            return copy.Kind == OrganizationDefaults.Kind
                ? await OrganizationDefaults.PutBackAsync(copy, reason, http, db, audit, clock, cancellationToken)
                : Problems.Invalid("KIND_UNKNOWN", "This copy cannot be put back.");
        var project = await db.Projects.SingleOrDefaultAsync(p => p.Id == copy.ProjectId, cancellationToken);
        if (project is null) return Problems.NotFound("PROJECT_NOT_FOUND", "No such project.");
        var by = await db.Users.AsNoTracking().Where(u => u.Id == http.User.UserId()).Select(u => u.Name).SingleAsync(cancellationToken);
        var problem = copy.Kind switch
        {
            "NUMBERING" => await NumberingLevels.PutBackAsync(db, clock, project, copy.Payload, by, cancellationToken),
            "REVISIONS" => await RevisionSchemeEndpoints.PutBackAsync(db, clock, project, copy.Payload, by, cancellationToken),
            "FUNCTIONS" => await Identity.ProjectFunctions.PutBackAsync(db, project, copy.Payload, cancellationToken),
            "ROUTES" => await CatalogAdminEndpoints.PutBackRoutesAsync(db, clock, project, copy.Payload, by, cancellationToken),
            var k when k.StartsWith("LIST:") => await ProjectLists.PutBackAsync(db, clock, project, k[5..], copy.Payload, by, cancellationToken),
            var k when k.StartsWith("FORM:") => await FormRules.PutBackAsync(db, clock, project, k[5..], copy.Payload, by, cancellationToken),
            _ => Problems.Invalid("KIND_UNKNOWN", "This copy cannot be put back."),
        };
        if (problem is not null) return problem;
        copy.PutBackAt = clock.GetCurrentInstant();
        copy.PutBackByName = by;
        copy.PutBackReason = reason;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(http.User.UserId(), by), "SETTING_PUT_BACK", "Project", project.Id, $"{project.Code}: {copy.Title}", reason,
            project.Id, cancellationToken);
        await notifier.NotifyAsync(project.TenantId, project.Id, await Actions.NoticeLog.HoldersAsync(db, project.Id, Verbs.Control, cancellationToken),
            NotificationKinds.General, $"{project.Code} has its own {copy.Title} again",
            $"{by} put back {project.Code}'s own {copy.Title}, as it was on {copy.KeptAt.InUtc().Date:d MMM yyyy}: {reason}.",
            "/settings", cancellationToken);
        return Results.NoContent();
    }

    /// <summary>Refused when the project already holds its own copy again.</summary>
    public static IResult OwnAgain(string code, string title) =>
        Problems.Conflict("OWN_AGAIN", $"{code} has its own {title} again: put that back to the organization's first (it is kept too).");
}
