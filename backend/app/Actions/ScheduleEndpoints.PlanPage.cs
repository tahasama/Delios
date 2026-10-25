using Delios.Host.Identity;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Actions;

/// <summary>An action as a list names it: the Action filter, the calendar's days.</summary>
public sealed record PlanLight(string Code, string Name, DateOnly? Start, DateOnly? Finish);

/// <summary>
/// The Schedule as its page shows it (owner: "we have pagination and we are pointing at this month, meaning you do not
/// hit the full schedule"): the actions on screen in full (the plan's first ones, or the table's page), and of the rest
/// only what is counted or named.
/// </summary>
public sealed record PlanPage(
    string? VersionInForce,
    IReadOnlyList<PlanAction> Actions,
    int Matching, int Undated, int Everywhere,
    DateOnly? WindowFrom, DateOnly? WindowTo, DateOnly? SpanFrom, DateOnly? SpanTo,
    bool HasWbs, string Sort, string Dir, int WithoutNote,
    IReadOnlyList<PlanLight> Codes, IReadOnlyList<PlanLight> Calendar);

public static partial class ScheduleEndpoints
{
    /// <summary>How many days either side of today the plan opens on, held inside the schedule's span.</summary>
    private const int PlanWindowDays = 30;

    private static readonly string[] PlanSorts = ["code", "name", "date", "documents", "wbs"];

    /// <summary>
    /// GET /plan/page: the Schedule's page. Every action is looked at from itself and its needs only (where it stands
    /// needs no document); the filters on documents (their discipline, type, supplier, number or title) are answered by the
    /// database; only the actions shown are read in full, with their documents, decisions and confirmations.
    /// </summary>
    private static async Task<IResult> PlanPageAsync(HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken,
        string? view = null, string? all = null, string? q = null, string? state = null, string? happened = null, string? nodate = null,
        string? untagged = null, string? discipline = null, string? docType = null, string? supplier = null, string? code = null,
        string? from = null, string? to = null, string? sort = null, string? dir = null, int page = 1, int per = 50, int show = 25)
    {
        var access = ProjectAccessFilter.Of(http);
        var project = access.Project;
        var today = WorkingCalendar.Today(clock, project.TimeZone);
        var window = (await ScheduleDays.ForProjectAsync(db, project.Id, cancellationToken)).Risk;
        var activities = await db.Activities.AsNoTracking().Include(a => a.Requirements)
            .Where(a => a.ProjectId == project.Id && a.State == ActivityStates.Active).AsSplitQuery().ToListAsync(cancellationToken);
        var visible = await OutsideViewAsync(db, access, cancellationToken);
        if (visible is not null) activities = Narrow(activities, visible);

        // Postponed: a published decision that does not proceed, not taken back.
        var catalog = await Documents.Catalog.LoadAsync(db, cancellationToken);
        var ids = activities.Select(a => a.Id).ToList();
        var postponed = (await db.ActivityDecisions.AsNoTracking().Where(d => ids.Contains(d.ActivityId) && d.ReversedAt == null)
                .Select(d => new { d.ActivityId, d.Decision }).ToListAsync(cancellationToken))
            .Where(d => !ActionNotices.Proceeds(catalog, d.Decision)).Select(d => d.ActivityId).ToHashSet();
        var facts = activities.ToDictionary(a => a.Id, a => FactsOf(a, today, window));

        // Which actions need a document matching the document filters, asked of the database (never each document read).
        async Task<HashSet<(Guid Activity, Guid Document)>> NeedingAsync(System.Linq.Expressions.Expression<Func<Documents.Document, bool>> match)
        {
            var documents = db.Documents.Where(d => d.ProjectId == project.Id).Where(match).Select(d => d.Id);
            return (await db.Requirements.AsNoTracking().Where(r => r.ProjectId == project.Id && documents.Contains(r.DocumentId))
                .Select(r => new { r.ActivityId, r.DocumentId }).Distinct().ToListAsync(cancellationToken))
                .Select(x => (x.ActivityId, x.DocumentId)).ToHashSet();
        }
        bool Needs(Activity a, HashSet<(Guid, Guid)> pairs) => a.Requirements.Any(r => pairs.Contains((a.Id, r.DocumentId)));
        static string Like(string word) => "%" + word.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

        discipline = Blank(discipline); docType = Blank(docType); supplier = Blank(supplier); code = Blank(code);
        var byDiscipline = discipline is null ? null : await NeedingAsync(d => d.Discipline == discipline);
        var byDocument = docType is null && supplier is null ? null
            : await NeedingAsync(d => (docType == null || d.DocType == docType) && (supplier == null || d.Originator == supplier));
        // A space narrows, a comma widens: every word of a part found somewhere on the action, any part matching.
        var searches = ReadSearch(q);
        var byWord = new Dictionary<string, HashSet<(Guid, Guid)>>();
        foreach (var word in searches.SelectMany(s => s).Distinct())
        {
            var pattern = Like(word);
            byWord[word] = await NeedingAsync(d => EF.Functions.ILike(d.Number, pattern) || EF.Functions.ILike(d.Title, pattern));
        }
        static bool Has(string? text, string word) => text is not null && text.Contains(word, StringComparison.OrdinalIgnoreCase);

        bool ShortOnTheDay(Activity a) => a.Requirements.Count > 0 && facts[a.Id].Passed
            && (!facts[a.Id].Covered || (facts[a.Id].LastMet is { } met && a.Start is { } s && met > s.AtStartOfDayInZone(DateTimeZone.Utc).ToDateTimeOffset()));
        bool Happened(Activity a, string which) => which switch
        {
            "WITH" => a.Requirements.Count > 0 && facts[a.Id].Passed && !ShortOnTheDay(a) && !postponed.Contains(a.Id),
            "WITHOUT" => ShortOnTheDay(a) && !postponed.Contains(a.Id),
            "STOPPED" => postponed.Contains(a.Id),
            "NONE" => a.Requirements.Count == 0 && facts[a.Id].Passed && !postponed.Contains(a.Id),
            _ => true,
        };
        bool OutsideWindow(Activity a) =>
            (code is null || a.Code == code)
            && (Blank(state) is not { } st || facts[a.Id].State == st)
            && (Blank(happened) is not { } h || Happened(a, h))
            && (nodate != "1" || a.Start is null)
            && (untagged != "1" || a.Departments.Length == 0)
            && (byDiscipline is null || a.Departments.Contains(discipline) || Needs(a, byDiscipline))
            && (byDocument is null || Needs(a, byDocument))
            && (searches.Count == 0 || searches.Any(words => words.All(word =>
                Has(a.Code, word) || Has(a.Name, word) || Has(a.ExternalId, word) || Needs(a, byWord[word]))));

        // Where the schedule runs, and the window the plan opens on: two months around today, held inside it.
        var dates = activities.SelectMany(a => new[] { a.Start, a.Finish }).OfType<LocalDate>().ToList();
        LocalDate? spanFrom = dates.Count > 0 ? dates.Min() : null;
        LocalDate? spanTo = dates.Count > 0 ? dates.Max() : null;
        var fromDay = ReadDay(from);
        var toDay = ReadDay(to) ?? fromDay;
        var view_ = view is "table" or "calendar" ? view : "plan";
        var windowed = fromDay is null && toDay is null && view_ == "plan" && all != "1";
        LocalDate? planFrom = fromDay, planTo = toDay;
        if (windowed)
        {
            var start = today.PlusDays(-PlanWindowDays);
            if (spanTo is { } end && start > end.PlusDays(-2 * PlanWindowDays)) start = end.PlusDays(-2 * PlanWindowDays);
            if (spanFrom is { } first && start < first) start = first;
            var stop = start.PlusDays(2 * PlanWindowDays);
            if (spanTo is { } last) stop = LocalDate.Min(stop, LocalDate.Max(last, start));
            (planFrom, planTo) = (start, stop);
        }
        bool InWindow(Activity a) => planFrom is null && planTo is null
            || (a.Start is { } s && (planFrom is null || s >= planFrom) && (planTo is null || s <= planTo));

        var hasWbs = activities.Any(a => a.Wbs.Length > 0);
        var sortKey = sort is not null && PlanSorts.Contains(sort) ? sort : hasWbs ? "wbs" : "date";
        var descending = dir == "desc" && sort is not null && PlanSorts.Contains(sort);
        var maxDay = LocalDate.MaxIsoValue;
        IOrderedEnumerable<Activity> Sorted(IEnumerable<Activity> rows)
        {
            var byDate = rows.OrderBy(a => a.Start ?? maxDay).ThenBy(a => a.Code, StringComparer.Ordinal);
            IOrderedEnumerable<Activity> ordered = sortKey switch
            {
                "code" => rows.OrderBy(a => a.Code, StringComparer.Ordinal),
                "name" => rows.OrderBy(a => a.Name, StringComparer.CurrentCulture),
                "documents" => rows.OrderBy(a => a.Requirements.Count).ThenBy(a => a.Code, StringComparer.Ordinal),
                "wbs" => rows.OrderBy(a => a.WbsOrder ?? int.MaxValue).ThenBy(a => a.Start ?? maxDay).ThenBy(a => a.Code, StringComparer.Ordinal),
                _ => byDate,
            };
            return descending ? ordered.Reverse().OrderBy(_ => 0) : ordered;
        }

        var allMatching = activities.Where(OutsideWindow).ToList();
        var found = Sorted(allMatching.Where(InWindow)).ToList();
        var shown = view_ == "table"
            ? found.Skip((Math.Max(page, 1) - 1) * Math.Clamp(per, 1, 500)).Take(Math.Clamp(per, 1, 500)).ToList()
            : view_ == "plan" ? found.Take(Math.Clamp(show, 1, 2000)).ToList() : [];
        var actions = await PlanActionsAsync(db, clock, project, shown, cancellationToken);
        if (visible is not null) actions = actions.Select(ForOutside).ToList();

        return Results.Ok(new PlanPage(
            await VersionInForceAsync(db, project.Id, cancellationToken), actions,
            found.Count, allMatching.Count(a => a.Start is null), windowed ? allMatching.Count : 0,
            planFrom?.ToDateOnly(), planTo?.ToDateOnly(), spanFrom?.ToDateOnly(), spanTo?.ToDateOnly(),
            hasWbs, sortKey, descending ? "desc" : "asc", activities.Count(a => Happened(a, "WITHOUT")),
            activities.OrderBy(a => a.Start ?? maxDay).ThenBy(a => a.Code, StringComparer.Ordinal)
                .Select(a => new PlanLight(a.Code, a.Name, null, null)).ToList(),
            view_ == "calendar" ? found.Select(a => new PlanLight(a.Code, a.Name, a.Start?.ToDateOnly(), a.Finish?.ToDateOnly())).ToList() : []));
    }

    /// <summary>
    /// GET /plan/progress?from=&amp;to=: how far the project is from knowing what every action needs (the Schedule's
    /// stages), counted from the actions and their needs alone: how many are tagged, how many discipline · action pairs
    /// have their documents listed, and of the actions in the window (a month either side of today, or the dates chosen)
    /// how many have everything.
    /// </summary>
    private static async Task<IResult> PlanProgressAsync(HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken,
        string? from = null, string? to = null)
    {
        var access = ProjectAccessFilter.Of(http);
        var today = WorkingCalendar.Today(clock, access.Project.TimeZone);
        var window = (await ScheduleDays.ForProjectAsync(db, access.Project.Id, cancellationToken)).Risk;
        var activities = await db.Activities.AsNoTracking().Include(a => a.Requirements)
            .Where(a => a.ProjectId == access.Project.Id && a.State == ActivityStates.Active).AsSplitQuery().ToListAsync(cancellationToken);
        if (await OutsideViewAsync(db, access, cancellationToken) is { } visible) activities = Narrow(activities, visible);
        var untagged = activities.Count(a => a.Departments.Length == 0);
        var pairs = activities.SelectMany(a => a.Departments.Select(d => (a, d))).ToList();
        var answered = pairs.Count(p => p.a.Requirements.Any(n => n.Department == p.d));
        var first = ReadDay(from) ?? today.PlusDays(-PlanWindowDays);
        var last = ReadDay(to) ?? today.PlusDays(PlanWindowDays);
        var listed = activities.Where(a => a.Start is { } s && s >= first && s <= last && a.Requirements.Count > 0).ToList();
        var complete = listed.Count(a => FactsOf(a, today, window).State is ActionStates.Ready or ActionStates.Done or ActionStates.LateReceipt);
        var at = activities.Count == 0 ? 0 : untagged > 0 ? 1 : answered < pairs.Count || listed.Count == 0 ? 2 : complete == listed.Count ? 4 : 3;
        return Results.Ok(new { at, actions = activities.Count, untagged, answered, asked = pairs.Count, complete, listed = listed.Count,
            from = first.ToDateOnly(), to = last.ToDateOnly() });
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static LocalDate? ReadDay(string? value) =>
        value is not null && DateOnly.TryParseExact(value, "yyyy-MM-dd", out var day) ? LocalDate.FromDateOnly(day) : null;

    /// <summary>The words of a search, as the register reads them: parts split by commas, words by spaces or "quotes".</summary>
    private static List<string[]> ReadSearch(string? q) =>
        (q ?? "").Split(',').Select(part => part.Trim()).Where(part => part.Length > 0).Take(8)
            .Select(part => System.Text.RegularExpressions.Regex.Matches(part, "\"([^\"]+)\"|(\\S+)")
                .Select(m => (m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value).Trim()).Where(w => w.Length > 0).Take(6).ToArray())
            .Where(words => words.Length > 0).ToList();
}
