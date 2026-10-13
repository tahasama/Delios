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
    public static LocalDate AddWorkingDays(LocalDate start, int days, IReadOnlyCollection<int> weekendDays)
    {
        if (weekendDays.Count >= 7) throw new ArgumentException("A week needs at least one working day.", nameof(weekendDays));
        var date = start;
        for (var added = 0; added < days;)
        {
            date = date.PlusDays(1);
            if (!weekendDays.Contains((int)date.DayOfWeek)) added++;
        }
        return date;
    }

    /// <summary>The working day that many working days before <paramref name="end"/>: counting back, as a deadline is.</summary>
    public static LocalDate SubtractWorkingDays(LocalDate end, int days, IReadOnlyCollection<int> weekendDays)
    {
        if (weekendDays.Count >= 7) throw new ArgumentException("A week needs at least one working day.", nameof(weekendDays));
        var date = end;
        for (var taken = 0; taken < days;)
        {
            date = date.PlusDays(-1);
            if (!weekendDays.Contains((int)date.DayOfWeek)) taken++;
        }
        return date;
    }

    /// <summary>Today at the site.</summary>
    public static LocalDate Today(IClock clock, string timeZone) =>
        clock.GetCurrentInstant().InZone(DateTimeZoneProviders.Tzdb.GetZoneOrNull(timeZone) ?? DateTimeZone.Utc).Date;
}
