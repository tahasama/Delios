using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Settings;

/// <summary>
/// One answer an organization (or one of its projects) gave about how it works: what a state is called, who carries
/// out an act, which way a policy goes. Kept as key and value so a new question needs no new table; the screens own
/// the meaning of each key. Every change is audited.
/// </summary>
public sealed class Setting
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    /// <summary>Empty for the organization's own answers; set for one project's.</summary>
    public Guid? ProjectId { get; set; }
    public required string Key { get; set; }
    public required string Value { get; set; }
    public Instant UpdatedAt { get; set; }
    public required string UpdatedByName { get; set; }
}

/// <summary>EF Core mapping for <see cref="Setting"/>: one value per key, per organization or per project.</summary>
internal sealed class SettingConfiguration : IEntityTypeConfiguration<Setting>
{
    /// <summary>Called by EF Core when it builds the database model at startup and for migrations.</summary>
    public void Configure(EntityTypeBuilder<Setting> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.ProjectId, x.Key }).IsUnique().AreNullsDistinct(false);
        b.Property(x => x.Key).HasMaxLength(128);
        b.Property(x => x.Value).HasMaxLength(4000);
        b.Property(x => x.UpdatedByName).HasMaxLength(200);
    }
}

/// <summary>Body of setting one answer. An empty value removes it, so the default applies again.</summary>
public sealed record SettingRequest(string? Value);

/// <summary>One answer as the screens read it.</summary>
public sealed record SettingView(string Key, string Value, DateTimeOffset UpdatedAt, string UpdatedBy);

/// <summary>
/// GET and PUT the organization's answers (<c>/api/settings</c>) and a project's (<c>/api/projects/{id}/settings</c>).
/// Anyone signed in reads them; an administrator changes the organization's, and an administrator or Document Control
/// a project's.
/// </summary>
public static class SettingEndpoints
{
    public static void MapSettingEndpoints(this IEndpointRouteBuilder app)
    {
        var org = app.MapGroup("/api/settings").WithTags("Settings").RequireAuthorization().AddEndpointFilter<TransactionFilter>();
        org.MapGet("", (HttpContext h, DeliosDbContext db, CancellationToken c, string? prefix) => ListAsync(db, null, prefix, c));
        org.MapPut("/{key}", async (string key, SettingRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c) =>
        {
            var me = await db.Users.AsNoTracking().SingleAsync(u => u.Id == h.User.UserId(), c);
            if (!await Keepers.ConfiguresAsync(h)) return Problems.Forbidden("ADMIN_ONLY", "An administrator answers for the organization.");
            return await SetAsync(db, audit, clock, h.User.TenantId(), null, key, r.Value, me.Id, me.Name, c);
        });

        var project = app.MapGroup("/api/projects/{projectId:guid}/settings").WithTags("Settings")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("", (HttpContext h, DeliosDbContext db, CancellationToken c, string? prefix) =>
            ListAsync(db, ProjectAccessFilter.Of(h).Project.Id, prefix, c));
        project.MapPut("/{key}", async (string key, SettingRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c) =>
        {
            var access = ProjectAccessFilter.Of(h);
            if (!await Keepers.ConfiguresAsync(h) && !access.Holds(Verbs.Control))
                return Problems.Forbidden("CONTROL_ONLY", "An administrator or Document Control answers for the project.");
            return await SetAsync(db, audit, clock, access.Project.TenantId, access.Project.Id, key, r.Value, access.UserId, access.UserName, c);
        });
    }

    private static async Task<IResult> ListAsync(DeliosDbContext db, Guid? projectId, string? prefix, CancellationToken cancellationToken)
    {
        var query = db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == projectId);
        if (!string.IsNullOrEmpty(prefix)) query = query.Where(s => s.Key.StartsWith(prefix));
        var rows = await query.OrderBy(s => s.Key).ToListAsync(cancellationToken);
        return Results.Ok(rows.Select(s => new SettingView(s.Key, s.Value, s.UpdatedAt.ToDateTimeOffset(), s.UpdatedByName)));
    }

    private static async Task<IResult> SetAsync(DeliosDbContext db, AuditLog audit, IClock clock, Guid tenantId, Guid? projectId,
        string key, string? value, Guid userId, string userName, CancellationToken cancellationToken)
    {
        key = key.Trim();
        if (key.Length is 0 or > 128) return Problems.Invalid("KEY_INVALID", "A setting is named by 1 to 128 characters.");
        if (value is { Length: > 4000 }) return Problems.Invalid("VALUE_TOO_LONG", "A setting holds at most 4000 characters.");
        var row = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == projectId && s.Key == key, cancellationToken);
        var was = row?.Value;
        if (string.IsNullOrWhiteSpace(value))
        {
            if (row is not null) db.Remove(row);
        }
        else if (row is null)
        {
            db.Add(new Setting { TenantId = tenantId, ProjectId = projectId, Key = key, Value = value.Trim(), UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = userName });
        }
        else
        {
            row.Value = value.Trim();
            row.UpdatedAt = clock.GetCurrentInstant();
            row.UpdatedByName = userName;
        }
        await audit.WriteAsync(new Actor(userId, userName), "SETTING_CHANGED", "Setting", null, key,
            $"{was ?? "(default)"} → {(string.IsNullOrWhiteSpace(value) ? "(default)" : value.Trim())}", projectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }
}
