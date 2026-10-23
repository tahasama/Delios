using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Platform;

/// <summary>Working days in a project's calendar: its weekend, not the server's.</summary>
public static class WorkingCalendar
{
    /// <summary>
    /// The moment to record for something said to have happened on a day: now when the day is today, midday in the
    /// project's time zone otherwise. Null with a problem when the day is still to come.
    /// </summary>
    public static (Instant? At, string? Problem) Moment(IClock clock, string timeZone, DateOnly? day)
    {
        if (day is null) return (clock.GetCurrentInstant(), null);
        var date = LocalDate.FromDateOnly(day.Value);
        var today = Today(clock, timeZone);
        if (date > today) return (null, "That day has not come yet.");
        if (date == today) return (clock.GetCurrentInstant(), null);
        var zone = DateTimeZoneProviders.Tzdb.GetZoneOrNull(timeZone) ?? DateTimeZone.Utc;
        return (date.At(new LocalTime(12, 0)).InZoneLeniently(zone).ToInstant(), null);
    }

    /// <summary>
    /// Returns the date that is <c>days</c> working days after <c>start</c>, skipping the given weekend days (ISO numbers, 1 Monday to 7 Sunday).
    /// Used to work out due dates for reviews and transmittals.
    /// </summary>
    public static LocalDate AddWorkingDays(LocalDate start, int days, IReadOnlyCollection<int> weekendDays,
        IReadOnlySet<LocalDate>? holidays = null)
    {
        if (weekendDays.Count >= 7) throw new ArgumentException("A week needs at least one working day.", nameof(weekendDays));
        var date = start;
        for (var added = 0; added < days;)
        {
            date = date.PlusDays(1);
            if (!weekendDays.Contains((int)date.DayOfWeek) && holidays?.Contains(date) != true) added++;
        }
        return date;
    }

    /// <summary>The working day that many working days before <paramref name="end"/>: counting back, as a deadline is.</summary>
    public static LocalDate SubtractWorkingDays(LocalDate end, int days, IReadOnlyCollection<int> weekendDays,
        IReadOnlySet<LocalDate>? holidays = null)
    {
        if (weekendDays.Count >= 7) throw new ArgumentException("A week needs at least one working day.", nameof(weekendDays));
        var date = end;
        for (var taken = 0; taken < days;)
        {
            date = date.PlusDays(-1);
            if (!weekendDays.Contains((int)date.DayOfWeek) && holidays?.Contains(date) != true) taken++;
        }
        return date;
    }

    /// <summary>The list of public holidays (Types &amp; sets, group Schedule).</summary>
    public const string HolidaysList = "HOLIDAYS";

    /// <summary>
    /// The public holidays a project's working days skip (owner): each value of the Public holidays list whose code starts
    /// with its day (2026-12-25, or 2026-12-25-FR where two countries share a day), in use, and kept for the project's
    /// country or for every country (no country said). Read from the project's own copy of the list where it has one,
    /// else the organization's, whichever project the request is about.
    /// </summary>
    public static async Task<IReadOnlySet<LocalDate>> HolidaysAsync(DeliosDbContext db, Identity.Project project, CancellationToken cancellationToken)
    {
        Guid? owner = project.OwnListKeys.Contains(HolidaysList) ? project.Id : null;
        var values = await db.ValueEntries.IgnoreQueryFilters().AsNoTracking()
            .Where(v => v.SetKey == HolidaysList && v.ProjectId == owner && v.Status == Documents.ValueStatus.Active)
            .Select(v => new { v.Code, v.Props }).ToListAsync(cancellationToken);
        var days = new HashSet<LocalDate>();
        foreach (var value in values)
        {
            if (value.Code.Length < 10 || !DateOnly.TryParseExact(value.Code[..10], "yyyy-MM-dd", out var day)) continue;
            var country = value.Props?.RootElement is { ValueKind: System.Text.Json.JsonValueKind.Object } props
                && props.TryGetProperty("country", out var c) && c.ValueKind == System.Text.Json.JsonValueKind.String ? c.GetString() : null;
            if (string.IsNullOrEmpty(country) || string.Equals(country, project.Country, StringComparison.OrdinalIgnoreCase))
                days.Add(LocalDate.FromDateOnly(day));
        }
        return days;
    }

    /// <summary>Today at the site.</summary>
    public static LocalDate Today(IClock clock, string timeZone) =>
        clock.GetCurrentInstant().InZone(DateTimeZoneProviders.Tzdb.GetZoneOrNull(timeZone) ?? DateTimeZone.Utc).Date;
}
