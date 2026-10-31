using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Settings;

/// <summary>
/// The organization's defaults for new projects (<c>PROJECT_DEFAULTS</c>) replaced as a whole: taken from a project, or
/// put back to the app's own. Either way, always with why, what they held is kept first (owner: "a reset keeps a copy";
/// three levels, the organization's reset keeps a copy of its own), listed on the defaults' page under "Kept when
/// replaced", and may be put back, with why, which keeps what stands then in its turn. Changing one answer is not this:
/// it is saved on its own, and nothing is lost.
/// </summary>
public static class OrganizationDefaults
{
    public const string Key = "PROJECT_DEFAULTS";
    public const string Kind = "DEFAULTS";
    private const string Title = "defaults for new projects";

    /// <summary>Body of replacing the defaults: the new ones as a whole (none: back to the app's own), and why.</summary>
    public sealed record ReplaceRequest(JsonElement? Defaults, string? Reason);

    /// <summary>Registers <c>PUT /api/admin/project-defaults</c> (administrators).</summary>
    public static void MapOrganizationDefaultsEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGroup("/api/admin/project-defaults").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("The defaults for new projects are set by an administrator."))
            .MapPut("", ReplaceAsync);
    }

    private static async Task<IResult> ReplaceAsync(ReplaceRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        var reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim();
        if (reason is null) return Problems.Invalid("REASON_REQUIRED", "Say why the defaults are replaced.", new { field = "reason" });
        if (request.Defaults is { ValueKind: not (JsonValueKind.Object or JsonValueKind.Null or JsonValueKind.Undefined) })
            return Problems.Invalid("DEFAULTS_INVALID", "The defaults are a whole set of answers.");
        var by = await db.Users.AsNoTracking().Where(u => u.Id == http.User.UserId()).Select(u => u.Name).SingleAsync(cancellationToken);
        var value = request.Defaults is { ValueKind: JsonValueKind.Object } given ? given.GetRawText() : null;
        await WriteAsync(db, http.User.TenantId(), value, reason, by, clock, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(http.User.UserId(), by), "SETTING_RESET", "Setting", null,
            value is null ? "Defaults for new projects: back to the app's own" : "Defaults for new projects: replaced", reason, cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    /// <summary>Puts a kept copy back as the defaults; what stands then is kept in its turn.</summary>
    public static async Task<IResult> PutBackAsync(KeptCopy copy, string reason, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        var by = await db.Users.AsNoTracking().Where(u => u.Id == http.User.UserId()).Select(u => u.Name).SingleAsync(cancellationToken);
        await WriteAsync(db, copy.TenantId, copy.Payload, $"Replaced by the copy kept {copy.KeptAt.InUtc().Date:d MMM yyyy}: {reason}", by, clock, cancellationToken);
        copy.PutBackAt = clock.GetCurrentInstant();
        copy.PutBackByName = by;
        copy.PutBackReason = reason;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(http.User.UserId(), by), "SETTING_PUT_BACK", "Setting", null, "Defaults for new projects", reason,
            cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    /// <summary>Keeps the defaults as they stand (if any), then writes the new ones (none: the app's own).</summary>
    private static async Task WriteAsync(DeliosDbContext db, Guid tenantId, string? value, string reason, string by, IClock clock, CancellationToken cancellationToken)
    {
        var row = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == null && s.Key == Key, cancellationToken);
        if (row is not null && !string.IsNullOrWhiteSpace(row.Value))
            KeptCopies.Keep(db, clock, tenantId, null, Kind, Title, JsonDocument.Parse(row.Value).RootElement, by, reason);
        if (value is null)
        {
            if (row is not null) db.Remove(row);
            return;
        }
        if (row is null)
            db.Add(new Setting { TenantId = tenantId, Key = Key, Value = value, UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = by });
        else
        {
            row.Value = value;
            row.UpdatedAt = clock.GetCurrentInstant();
            row.UpdatedByName = by;
        }
    }
}
