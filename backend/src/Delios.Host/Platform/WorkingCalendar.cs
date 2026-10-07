using NodaTime;

namespace Delios.Host.Platform;

/// <summary>Working days in a project's calendar: its weekend, not the server's.</summary>
public static class WorkingCalendar
{
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

    /// <summary>Today at the site.</summary>
    public static LocalDate Today(IClock clock, string timeZone) =>
        clock.GetCurrentInstant().InZone(DateTimeZoneProviders.Tzdb.GetZoneOrNull(timeZone) ?? DateTimeZone.Utc).Date;
}
