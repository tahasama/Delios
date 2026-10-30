using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Settings;

/// <summary>
/// A day nobody counts as a working day, beyond the days off each week (owner, "the calendar"): the organization's
/// public holidays, each kept for a country or for every country, and a project's own days off (a site shutdown, a local
/// holiday). Marked on the calendar, taken off it the same way.
/// </summary>
public sealed class DayOff
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    /// <summary>None: the organization's public holiday. A project: that project's own day off.</summary>
    public Guid? ProjectId { get; set; }
    public LocalDate Day { get; set; }
    public required string Name { get; set; }
    /// <summary>The country an organization's holiday is kept in (ISO, two letters); none: every country. A project's own: none.</summary>
    public string? Country { get; set; }
    public Instant CreatedAt { get; set; }
    public required string CreatedByName { get; set; }
}

/// <summary>Tells EF Core how to store <see cref="DayOff"/>.</summary>
internal sealed class DayOffConfiguration : IEntityTypeConfiguration<DayOff>
{
    public void Configure(EntityTypeBuilder<DayOff> b)
    {
        b.ToTable("days_off");
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Day });
        b.Property(x => x.Name).HasMaxLength(120);
        b.Property(x => x.Country).HasMaxLength(2);
        b.Property(x => x.CreatedByName).HasMaxLength(200);
    }
}

/// <summary>
/// The calendar (owner): the organization's (Settings → Calendar: how dates read, where a new project's site starts,
/// the public holidays by country) and a project's (its site, its country's holidays read from the organization's, its
/// own days off where the organization leaves them free, switch <c>CALENDAR</c>), and the Calendar page every one of
/// ours reads, with the schedule's action days on it.
/// </summary>
public static class Calendar
{
    public const string Switch = "CALENDAR";

    /// <summary>The days a project does not count, besides its days off each week: its country's holidays and its own.</summary>
    public static async Task<IReadOnlySet<LocalDate>> DaysOffAsync(DeliosDbContext db, Project project, CancellationToken cancellationToken)
    {
        var days = await db.Set<DayOff>().AsNoTracking()
            .Where(d => d.ProjectId == project.Id || (d.ProjectId == null && (d.Country == null || d.Country == project.Country)))
            .Select(d => d.Day).ToListAsync(cancellationToken);
        return days.ToHashSet();
    }

    public sealed record DayView(Guid Id, DateOnly Day, string Name, string? Country, string Source, DateTimeOffset At, string By);
    public sealed record ActionDay(string Code, string Name, DateOnly? Start, DateOnly? Finish);
    public sealed record DayRequest(DateOnly? Day, string? Name, string? Country);
    public sealed record OneDay(DateOnly Day, string Name);
    /// <summary>A country's public holidays, filled in at once (owner: from a list that knows them).</summary>
    public sealed record ManyRequest(string? Country, OneDay[]? Days);

    private static DayView View(DayOff d) =>
        new(d.Id, d.Day.ToDateOnly(), d.Name, d.Country, d.ProjectId is null ? "ORGANIZATION" : "PROJECT", d.CreatedAt.ToDateTimeOffset(), d.CreatedByName);

    /// <summary>Registers the organization's calendar (administrators) and a project's.</summary>
    public static void MapCalendarEndpoints(this IEndpointRouteBuilder app)
    {
        var org = app.MapGroup("/api/admin/calendar").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("The organization's calendar is kept by an administrator."));
        org.MapGet("", OrganizationAsync);
        org.MapPost("/days", MarkHolidayAsync);
        org.MapPost("/days/many", MarkManyAsync);
        org.MapDelete("/days/{dayId:guid}", (Guid dayId, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken c) =>
            UnmarkAsync(db, audit, http.User.Actor(), dayId, null, c));

        var project = app.MapGroup("/api/projects/{projectId:guid}/calendar").WithTags("Calendar")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("", ProjectAsync);
        project.MapPut("/place", PlaceAsync);
        project.MapPost("/days", MarkOwnAsync);
        project.MapDelete("/days/{dayId:guid}", async (Guid dayId, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken c) =>
        {
            var access = ProjectAccessFilter.Of(http);
            if (await KeeperRefusalAsync(http, access) is { } refused) return refused;
            return await UnmarkAsync(db, audit, http.User.Actor(), dayId, access.Project.Id, c);
        });
    }

    private static (LocalDate From, LocalDate To) YearOf(int? year, IClock clock)
    {
        var y = year is >= 1900 and <= 2200 ? year.Value : clock.GetCurrentInstant().InUtc().Year;
        return (new LocalDate(y, 1, 1), new LocalDate(y, 12, 31));
    }

    /// <summary>The organization's calendar for a year: its holidays (every country), how dates read, where new projects start.</summary>
    private static async Task<IResult> OrganizationAsync(int? year, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var (from, to) = YearOf(year, clock);
        var days = await db.Set<DayOff>().AsNoTracking().Where(d => d.ProjectId == null && d.Day >= from && d.Day <= to)
            .OrderBy(d => d.Day).ToListAsync(cancellationToken);
        var format = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == null && s.Key == DateFormat.Key)
            .Select(s => s.Value).FirstOrDefaultAsync(cancellationToken);
        return Results.Ok(new
        {
            Year = from.Year,
            DateFormat = DateFormat.Codes.Contains(format) ? format : DateFormat.Default,
            Place = await ProjectPlace.OrganizationAsync(db, cancellationToken),
            Holidays = days.Select(View),
        });
    }

    /// <summary>
    /// The months a project's calendar spans (owner: "from the month a project starts to the month it finishes"): from the
    /// first day of its start's month (as it says it, else the month it was opened) to the last day of its planned end's
    /// month; no end said, to twelve months from today; widened to the months of its first and last actions.
    /// </summary>
    private static async Task<(LocalDate From, LocalDate To)> SpanAsync(DeliosDbContext db, Project project, IClock clock, CancellationToken cancellationToken)
    {
        var info = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == project.Id && s.Key == "PROJECT_INFO")
            .Select(s => s.Value).FirstOrDefaultAsync(cancellationToken);
        LocalDate? Read(string name)
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(info ?? "{}");
                return doc.RootElement.TryGetProperty(name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String
                    && DateOnly.TryParse(v.GetString(), out var d) ? LocalDate.FromDateOnly(d) : null;
            }
            catch (System.Text.Json.JsonException) { return null; }
        }
        var start = Read("startDate") ?? project.CreatedAt.InUtc().Date;
        var today = WorkingCalendar.Today(clock, project.TimeZone);
        LocalDate end = Read("endDate") is { } said && said >= start ? said : today.PlusMonths(12);
        // Every action of the schedule is on it (owner: "show more months"), even one its dates leave out.
        var actions = db.Activities.AsNoTracking().Where(a => a.ProjectId == project.Id && a.State == Actions.ActivityStates.Active && a.Start != null);
        var first = await actions.MinAsync(a => a.Start, cancellationToken);
        var last = await actions.MaxAsync(a => a.Finish ?? a.Start, cancellationToken);
        if (first is { } f && f < start) start = f;
        if (last is { } l && l > end) end = l;
        var from = new LocalDate(start.Year, start.Month, 1);
        var to = new LocalDate(end.Year, end.Month, 1).PlusMonths(1).PlusDays(-1);
        return (from, to);
    }

    /// <summary>
    /// A project's calendar, from the month it starts to the month it finishes: where its site is, the days it does not count (its country's holidays and its own)
    /// and, for our own people, the schedule's action days. Whether this person may change it, and whether it is free.
    /// </summary>
    private static async Task<IResult> ProjectAsync(HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var project = access.Project;
        var (from, to) = await SpanAsync(db, project, clock, cancellationToken);
        var days = await db.Set<DayOff>().AsNoTracking()
            .Where(d => d.Day >= from && d.Day <= to
                && (d.ProjectId == project.Id || (d.ProjectId == null && (d.Country == null || d.Country == project.Country))))
            .OrderBy(d => d.Day).ToListAsync(cancellationToken);
        // The schedule is ours: another organization's people read the days off only.
        var actions = new List<ActionDay>();
        if (access.IsInternal)
        {
            var rows = await db.Activities.AsNoTracking()
                .Where(a => a.ProjectId == project.Id && a.State == Actions.ActivityStates.Active
                    && a.Start != null && a.Start <= to && (a.Finish ?? a.Start) >= from)
                .OrderBy(a => a.Start).Select(a => new { a.Code, a.Name, a.Start, a.Finish }).ToListAsync(cancellationToken);
            actions.AddRange(rows.Select(a => new ActionDay(a.Code, a.Name, a.Start?.ToDateOnly(), a.Finish?.ToDateOnly())));
        }
        var keeper = access.IsInternal && (access.Holds(Verbs.Control) || await Keepers.ConfiguresAsync(http));
        var free = await Liberty.IsFreeAsync(db, Switch, project.Id, cancellationToken);
        return Results.Ok(new
        {
            From = from.ToDateOnly(),
            To = to.ToDateOnly(),
            Place = new ProjectPlace.Place(project.TimeZone, project.WeekendDays, project.Country),
            Today = WorkingCalendar.Today(clock, project.TimeZone).ToDateOnly(),
            DaysOff = days.Select(View),
            Actions = actions,
            MayChange = keeper,
            OwnDaysFree = free,
            Exception = await Liberty.ExceptionHereAsync(db, Switch, project.Id, cancellationToken),
        });
    }

    private static async Task<IResult?> KeeperRefusalAsync(HttpContext http, ProjectAccess access) =>
        access.IsInternal && (access.Holds(Verbs.Control) || await Keepers.ConfiguresAsync(http))
            ? null
            : Problems.Forbidden("CONTROL_ONLY", "The control function keeps the project's calendar.");

    /// <summary>Where the project's site is: its time zone, days off each week and country (the control function).</summary>
    private static async Task<IResult> PlaceAsync(ProjectPlace.PlaceRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (await KeeperRefusalAsync(http, access) is { } refused) return refused;
        var zone = string.IsNullOrWhiteSpace(request.TimeZone) ? "UTC" : request.TimeZone.Trim();
        if (DateTimeZoneProviders.Tzdb.GetZoneOrNull(zone) is null)
            return Problems.Invalid("TIME_ZONE_UNKNOWN", $"{zone} is not a time zone.", new { field = "timeZone" });
        var weekend = (request.WeekendDays ?? [6, 7]).Distinct().Order().ToArray();
        if (ProjectPlace.WeekendRefusal(weekend) is { } badWeekend) return badWeekend;
        var country = string.IsNullOrWhiteSpace(request.Country) ? null : request.Country.Trim().ToUpperInvariant();
        if (ProjectPlace.CountryRefusal(country) is { } badCountry) return badCountry;
        var project = await db.Projects.SingleAsync(p => p.Id == access.Project.Id, cancellationToken);
        var changes = new List<string>();
        if (zone != project.TimeZone) { changes.Add($"time zone {project.TimeZone} → {zone}"); project.TimeZone = zone; }
        if (!weekend.SequenceEqual(project.WeekendDays))
        {
            changes.Add($"days off {ProjectPlace.WeekendWords(project.WeekendDays)} → {ProjectPlace.WeekendWords(weekend)}");
            project.WeekendDays = weekend;
        }
        if (country != project.Country) { changes.Add($"country {project.Country ?? "none"} → {country ?? "none"}"); project.Country = country; }
        if (changes.Count == 0) return Results.NoContent();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "PROJECT_UPDATED", "Project", project.Id, project.Code, string.Join("; ", changes), project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>An organization's public holiday: its day, its name, its country (none: every country).</summary>
    private static async Task<IResult> MarkHolidayAsync(DayRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        var country = string.IsNullOrWhiteSpace(request.Country) ? null : request.Country.Trim().ToUpperInvariant();
        if (ProjectPlace.CountryRefusal(country) is { } badCountry) return badCountry;
        return await MarkAsync(db, audit, clock, http, null, request.Day, request.Name, country, cancellationToken);
    }

    /// <summary>
    /// A country's public holidays filled in at once (owner: "some recognise national holidays"): each day not marked yet
    /// for that country is added under its name, each logged as one marked by hand; those already marked are left as
    /// they are. Nothing is filled by itself: an administrator asks for it, having read the list.
    /// </summary>
    private static async Task<IResult> MarkManyAsync(ManyRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        var country = string.IsNullOrWhiteSpace(request.Country) ? null : request.Country.Trim().ToUpperInvariant();
        if (country is null) return Problems.Invalid("COUNTRY_REQUIRED", "Choose the country whose holidays these are.", new { field = "country" });
        if (ProjectPlace.CountryRefusal(country) is { } badCountry) return badCountry;
        var days = (request.Days ?? []).Where(d => !string.IsNullOrWhiteSpace(d.Name)).DistinctBy(d => d.Day).Take(100).ToList();
        if (days.Count == 0) return Problems.Invalid("DAYS_REQUIRED", "There is no day to add.");
        var wanted = days.Select(d => LocalDate.FromDateOnly(d.Day)).ToList();
        var there = (await db.Set<DayOff>().AsNoTracking()
            .Where(d => d.ProjectId == null && d.Country == country && wanted.Contains(d.Day)).Select(d => d.Day).ToListAsync(cancellationToken)).ToHashSet();
        var by = (await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), cancellationToken)).Name;
        var added = new List<DayOff>();
        foreach (var one in days)
        {
            var day = LocalDate.FromDateOnly(one.Day);
            if (there.Contains(day)) continue;
            var words = one.Name.Trim();
            if (words.Length > 120) words = words[..120];
            var row = new DayOff
            {
                TenantId = http.User.TenantId(),
                ProjectId = null,
                Day = day,
                Name = words,
                Country = country,
                CreatedAt = clock.GetCurrentInstant(),
                CreatedByName = by,
            };
            db.Add(row);
            added.Add(row);
        }
        await db.SaveChangesAsync(cancellationToken);
        foreach (var row in added)
            await audit.WriteAsync(http.User.Actor(), "DAY_OFF_MARKED", "Calendar", row.Id, row.Name, $"{row.Day:yyyy-MM-dd}, {country}",
                cancellationToken: cancellationToken);
        return Results.Ok(new { added = added.Count, alreadyThere = days.Count - added.Count });
    }

    /// <summary>A project's own day off, where the organization leaves the calendar free (ROOM_FIXED otherwise).</summary>
    private static async Task<IResult> MarkOwnAsync(DayRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (await KeeperRefusalAsync(http, access) is { } refused) return refused;
        if (!await Liberty.IsFreeAsync(db, Switch, access.Project.Id, cancellationToken))
            return Problems.Forbidden("ROOM_FIXED", "Days off: the organization keeps the calendar the same on every project. An administrator marks them on the organization's calendar.");
        return await MarkAsync(db, audit, clock, http, access.Project, request.Day, request.Name, null, cancellationToken);
    }

    private static async Task<IResult> MarkAsync(DeliosDbContext db, AuditLog audit, IClock clock, HttpContext http, Project? project,
        DateOnly? date, string? name, string? country, CancellationToken cancellationToken)
    {
        if (date is null) return Problems.Invalid("DAY_REQUIRED", "Choose the day.", new { field = "day" });
        var day = LocalDate.FromDateOnly(date.Value);
        var words = name?.Trim() ?? "";
        if (words.Length == 0) return Problems.Invalid("NAME_REQUIRED", "Say what the day is (Christmas Day, site shutdown…).", new { field = "name" });
        if (words.Length > 120) words = words[..120];
        var projectId = project?.Id;
        if (await db.Set<DayOff>().AnyAsync(d => d.ProjectId == projectId && d.Day == day && d.Country == country, cancellationToken))
            return Problems.Conflict("DAY_ALREADY_MARKED", "That day is already marked here.", new { field = "day" });
        var by = (await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), cancellationToken)).Name;
        var row = new DayOff
        {
            TenantId = http.User.TenantId(),
            ProjectId = projectId,
            Day = day,
            Name = words,
            Country = country,
            CreatedAt = clock.GetCurrentInstant(),
            CreatedByName = by,
        };
        db.Add(row);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "DAY_OFF_MARKED", "Calendar", row.Id, words,
            $"{day:yyyy-MM-dd}{(country is null ? "" : $", {country}")}{(project is null ? (country is null ? ", every country" : "") : $", {project.Code} only")}",
            projectId, cancellationToken);
        return Results.Ok(View(row));
    }

    private static async Task<IResult> UnmarkAsync(DeliosDbContext db, AuditLog audit, Actor actor, Guid dayId, Guid? projectId,
        CancellationToken cancellationToken)
    {
        var row = await db.Set<DayOff>().SingleOrDefaultAsync(d => d.Id == dayId && d.ProjectId == projectId, cancellationToken);
        if (row is null) return Problems.NotFound("DAY_NOT_FOUND", "That day is not marked here.");
        db.Remove(row);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(actor, "DAY_OFF_UNMARKED", "Calendar", row.Id, row.Name, $"{row.Day:yyyy-MM-dd}{(row.Country is null ? "" : $", {row.Country}")}",
            projectId, cancellationToken);
        return Results.NoContent();
    }
}
