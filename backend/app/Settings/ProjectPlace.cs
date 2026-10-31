using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Settings;

/// <summary>
/// Where a project's site is (owner): its time zone, the days it does not work and its country, which picks the public
/// holidays its working days skip. Each project keeps its own; the organization's are what a new project starts with
/// (Defaults for new projects), never changing a project already open. Nothing set: UTC, Saturday and Sunday, no country.
/// </summary>
public static class ProjectPlace
{
    public const string TimeZoneKey = "PROJECT_TIME_ZONE";
    public const string WeekendKey = "PROJECT_WEEKEND";
    public const string CountryKey = "PROJECT_COUNTRY";

    /// <summary>Where a new project starts: the organization's, else the app's.</summary>
    public sealed record Place(string TimeZone, int[] WeekendDays, string? Country);

    private static readonly string[] Days = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    /// <summary>The organization's place for new projects.</summary>
    public static async Task<Place> OrganizationAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var rows = await db.Set<Setting>().AsNoTracking()
            .Where(s => s.ProjectId == null && (s.Key == TimeZoneKey || s.Key == WeekendKey || s.Key == CountryKey))
            .ToDictionaryAsync(s => s.Key, s => s.Value, cancellationToken);
        var zone = rows.GetValueOrDefault(TimeZoneKey) is { Length: > 0 } z && DateTimeZoneProviders.Tzdb.GetZoneOrNull(z) is not null ? z : "UTC";
        var weekend = ReadWeekend(rows.GetValueOrDefault(WeekendKey)) ?? [6, 7];
        var country = rows.GetValueOrDefault(CountryKey) is { Length: 2 } c ? c : null;
        return new(zone, weekend, country);
    }

    private static int[]? ReadWeekend(string? value)
    {
        if (value is null) return null;
        var days = value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(d => int.TryParse(d, out var n) ? n : 0).ToArray();
        return WeekendRefusal(days) is null ? days.Distinct().Order().ToArray() : null;
    }

    /// <summary>A weekend is days 1 (Monday) to 7 (Sunday), leaving at least one working day; none is allowed.</summary>
    public static IResult? WeekendRefusal(int[] days) =>
        days.Any(d => d is < 1 or > 7) ? Problems.Invalid("WEEKEND_INVALID", "Weekend days are numbered 1 (Monday) to 7 (Sunday).", new { field = "weekend" })
        : days.Distinct().Count() >= 7 ? Problems.Invalid("WEEKEND_INVALID", "A week needs at least one working day.", new { field = "weekend" })
        : null;

    /// <summary>A country is two letters (ISO 3166), or none.</summary>
    public static IResult? CountryRefusal(string? country) =>
        country is null || (country.Length == 2 && country.All(char.IsAsciiLetterUpper)) ? null
        : Problems.Invalid("COUNTRY_UNKNOWN", $"{country} is not a country code (two letters, such as FR or AE).", new { field = "country" });

    /// <summary>A weekend in words, for the log: "Saturday, Sunday", or "none".</summary>
    public static string WeekendWords(IEnumerable<int> days) => days.Any() ? string.Join(", ", days.Select(d => Days[d])) : "none";

    /// <summary>Body of setting where new projects start.</summary>
    public sealed record PlaceRequest(string? TimeZone, int[]? WeekendDays, string? Country);

    /// <summary>Registers <c>GET</c> and <c>PUT /api/admin/project-place</c> (administrators).</summary>
    public static void MapProjectPlaceEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/project-place").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("Where new projects start is set by an administrator."));
        group.MapGet("", async (DeliosDbContext db, CancellationToken c) => Results.Ok(await OrganizationAsync(db, c)));
        group.MapPut("", PutAsync);
    }

    /// <summary>Where every new project starts. Projects already open keep their own.</summary>
    private static async Task<IResult> PutAsync(PlaceRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        var zone = string.IsNullOrWhiteSpace(request.TimeZone) ? "UTC" : request.TimeZone.Trim();
        if (DateTimeZoneProviders.Tzdb.GetZoneOrNull(zone) is null)
            return Problems.Invalid("TIME_ZONE_UNKNOWN", $"{zone} is not a time zone.", new { field = "timeZone" });
        var weekend = request.WeekendDays ?? [6, 7];
        if (WeekendRefusal(weekend) is { } badWeekend) return badWeekend;
        var country = string.IsNullOrWhiteSpace(request.Country) ? null : request.Country.Trim().ToUpperInvariant();
        if (CountryRefusal(country) is { } badCountry) return badCountry;

        var was = await OrganizationAsync(db, cancellationToken);
        var by = (await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), cancellationToken)).Name;
        await WriteAsync(db, http.User.TenantId(), TimeZoneKey, zone == "UTC" ? null : zone, by, clock, cancellationToken);
        var days = weekend.Distinct().Order().ToArray();
        await WriteAsync(db, http.User.TenantId(), WeekendKey, days.SequenceEqual([6, 7]) ? null : string.Join(",", days), by, clock, cancellationToken);
        await WriteAsync(db, http.User.TenantId(), CountryKey, country, by, clock, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "PROJECT_PLACE_SET", "Setting", null, "Where new projects start",
            $"Time zone {was.TimeZone} → {zone}; weekend {WeekendWords(was.WeekendDays)} → {WeekendWords(days)}; country {was.Country ?? "none"} → {country ?? "none"}.",
            cancellationToken: cancellationToken);
        return Results.Ok(new Place(zone, days, country));
    }

    private static async Task WriteAsync(DeliosDbContext db, Guid tenantId, string key, string? value, string by, IClock clock, CancellationToken cancellationToken)
    {
        var row = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == null && s.Key == key, cancellationToken);
        if (value is null)
        {
            if (row is not null) db.Remove(row);
            return;
        }
        if (row is null)
            db.Add(new Setting { TenantId = tenantId, ProjectId = null, Key = key, Value = value, UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = by });
        else
        {
            row.Value = value;
            row.UpdatedAt = clock.GetCurrentInstant();
            row.UpdatedByName = by;
        }
    }
}
