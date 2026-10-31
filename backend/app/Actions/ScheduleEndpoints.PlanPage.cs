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
        await ScheduleImporter.AskCatchUpAsync(db, project, cancellationToken);
        var today = WorkingCalendar.Today(clock, project.TimeZone);
        var window = (await ScheduleDays.ForProjectAsync(db, project.Id, cancellationToken)).Risk;
        // Every action as it keeps itself (owner: recorded when it happens, never worked out again on a reading): where it
        // stands comes from what Readiness wrote on it when its documents changed; its needs are read only for those shown.
        // Another organization reads only its own part of each action, so its actions are read with their needs, narrowed.
        var visible = await OutsideViewAsync(db, access, cancellationToken);
        var rows = await RowsAsync(db, project.Id, today, window, visible, cancellationToken);

        // Postponed: a published decision that does not proceed, not taken back.
        var catalog = await Documents.Catalog.LoadAsync(db, cancellationToken);
        var postponed = (await db.ActivityDecisions.AsNoTracking().Where(d => d.ProjectId == project.Id && d.ReversedAt == null)
                .Select(d => new { d.ActivityId, d.Decision }).ToListAsync(cancellationToken))
            .Where(d => !ActionNotices.Proceeds(catalog, d.Decision)).Select(d => d.ActivityId).ToHashSet();

        // Which actions need a document matching the document filters, asked of the database (never each document read).
        async Task<HashSet<(Guid Activity, Guid Document)>> NeedingAsync(System.Linq.Expressions.Expression<Func<Documents.Document, bool>> match)
        {
            var documents = db.Documents.Where(d => d.ProjectId == project.Id).Where(match).Select(d => d.Id);
            return (await db.Requirements.AsNoTracking().Where(r => r.ProjectId == project.Id && documents.Contains(r.DocumentId))
                .Select(r => new { r.ActivityId, r.DocumentId }).Distinct().ToListAsync(cancellationToken))
                .Select(x => (x.ActivityId, x.DocumentId)).ToHashSet();
        }
        // Another organization's action counts only the documents it sees.
        bool Needs(PlanRow a, HashSet<(Guid Activity, Guid Document)> pairs) =>
            a.Documents is null ? pairs.Any(p => p.Activity == a.Id) : a.Documents.Any(d => pairs.Contains((a.Id, d)));
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

        bool ShortOnTheDay(PlanRow a) => a.Needs > 0 && a.Facts.Passed
            && (!a.Facts.Covered || (a.Facts.LastMet is { } met && a.Start is { } s && met > s.AtStartOfDayInZone(DateTimeZone.Utc).ToDateTimeOffset()));
        bool Happened(PlanRow a, string which) => which switch
        {
            "WITH" => a.Needs > 0 && a.Facts.Passed && !ShortOnTheDay(a) && !postponed.Contains(a.Id),
            "WITHOUT" => ShortOnTheDay(a) && !postponed.Contains(a.Id),
            "STOPPED" => postponed.Contains(a.Id),
            "NONE" => a.Needs == 0 && a.Facts.Passed && !postponed.Contains(a.Id),
            _ => true,
        };
        bool OutsideWindow(PlanRow a) =>
            (code is null || a.Code == code)
            && (Blank(state) is not { } st || a.Facts.State == st)
            && (Blank(happened) is not { } h || Happened(a, h))
            && (nodate != "1" || a.Start is null)
            && (untagged != "1" || a.Departments.Length == 0)
            && (byDiscipline is null || a.Departments.Contains(discipline) || Needs(a, byDiscipline))
            && (byDocument is null || Needs(a, byDocument))
            && (searches.Count == 0 || searches.Any(words => words.All(word =>
                Has(a.Code, word) || Has(a.Name, word) || Has(a.ExternalId, word) || Needs(a, byWord[word]))));

        // Where the schedule runs, and the window the plan opens on: two months around today, held inside it.
        var dates = rows.SelectMany(a => new[] { a.Start, a.Finish }).OfType<LocalDate>().ToList();
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
        bool InWindow(PlanRow a) => planFrom is null && planTo is null
            || (a.Start is { } s && (planFrom is null || s >= planFrom) && (planTo is null || s <= planTo));

        var hasWbs = rows.Any(a => a.HasWbs);
        var sortKey = sort is not null && PlanSorts.Contains(sort) ? sort : hasWbs ? "wbs" : "date";
        var descending = dir == "desc" && sort is not null && PlanSorts.Contains(sort);
        var maxDay = LocalDate.MaxIsoValue;
        IOrderedEnumerable<PlanRow> Sorted(IEnumerable<PlanRow> list)
        {
            var byDate = list.OrderBy(a => a.Start ?? maxDay).ThenBy(a => a.Code, StringComparer.Ordinal);
            IOrderedEnumerable<PlanRow> ordered = sortKey switch
            {
                "code" => list.OrderBy(a => a.Code, StringComparer.Ordinal),
                "name" => list.OrderBy(a => a.Name, StringComparer.CurrentCulture),
                "documents" => list.OrderBy(a => a.Needs).ThenBy(a => a.Code, StringComparer.Ordinal),
                "wbs" => list.OrderBy(a => a.WbsOrder ?? int.MaxValue).ThenBy(a => a.Start ?? maxDay).ThenBy(a => a.Code, StringComparer.Ordinal),
                _ => byDate,
            };
            return descending ? ordered.Reverse().OrderBy(_ => 0) : ordered;
        }

        var allMatching = rows.Where(OutsideWindow).ToList();
        var found = Sorted(allMatching.Where(InWindow)).ToList();
        var shownRows = view_ == "table"
            ? found.Skip((Math.Max(page, 1) - 1) * Math.Clamp(per, 1, 500)).Take(Math.Clamp(per, 1, 500)).ToList()
            : view_ == "plan" ? found.Take(Math.Clamp(show, 1, 2000)).ToList() : [];
        // Only the actions shown are read in full, with their needs.
        var shown = await InFullAsync(db, shownRows, visible, cancellationToken);
        var actions = await PlanActionsAsync(db, clock, project, shown, cancellationToken);
        if (visible is not null) actions = actions.Select(ForOutside).ToList();

        return Results.Ok(new PlanPage(
            await VersionInForceAsync(db, project.Id, cancellationToken), actions,
            found.Count, allMatching.Count(a => a.Start is null), windowed ? allMatching.Count : 0,
            planFrom?.ToDateOnly(), planTo?.ToDateOnly(), spanFrom?.ToDateOnly(), spanTo?.ToDateOnly(),
            hasWbs, sortKey, descending ? "desc" : "asc", rows.Count(a => Happened(a, "WITHOUT")),
            rows.OrderBy(a => a.Start ?? maxDay).ThenBy(a => a.Code, StringComparer.Ordinal)
                .Select(a => new PlanLight(a.Code, a.Name, null, null)).ToList(),
            view_ == "calendar" ? found.Select(a => new PlanLight(a.Code, a.Name, a.Start?.ToDateOnly(), a.Finish?.ToDateOnly())).ToList() : []));
    }

    /// <summary>
    /// An action as the Schedule's page filters and sorts it, from what it keeps. <see cref="Documents"/>: for another
    /// organization, the documents of it that it sees (null for ours).
    /// </summary>
    private sealed record PlanRow(Guid Id, string Code, string Name, string? ExternalId, LocalDate? Start, LocalDate? Finish,
        string[] Departments, bool HasWbs, int? WbsOrder, int Needs, ActionFacts Facts, HashSet<Guid>? Documents, Activity? Whole);

    /// <summary>
    /// Every active action of the project. Ours: each one's own columns, where it stands from what Readiness wrote on it,
    /// its needs not read. Another organization's: read with its needs, narrowed to what it sees, and worked out from those.
    /// </summary>
    private static async Task<List<PlanRow>> RowsAsync(DeliosDbContext db, Guid projectId, LocalDate today, int window, HashSet<Guid>? visible,
        CancellationToken cancellationToken)
    {
        if (visible is not null)
        {
            var activities = Narrow(await db.Activities.AsNoTracking().Include(a => a.Requirements)
                .Where(a => a.ProjectId == projectId && a.State == ActivityStates.Active).AsSplitQuery().ToListAsync(cancellationToken), visible);
            return activities.Select(a => new PlanRow(a.Id, a.Code, a.Name, a.ExternalId, a.Start, a.Finish, a.Departments, a.Wbs.Length > 0,
                a.WbsOrder, a.Requirements.Count, FactsOf(a, today, window), a.Requirements.Select(r => r.DocumentId).ToHashSet(), a)).ToList();
        }
        var kept = await db.Activities.AsNoTracking().Where(a => a.ProjectId == projectId && a.State == ActivityStates.Active)
            .Select(a => new
            {
                a.Id,
                a.Code,
                a.Name,
                a.ExternalId,
                a.Start,
                a.Finish,
                a.Departments,
                HasWbs = a.Wbs.Length > 0,
                a.WbsOrder,
                a.NeedCount,
                a.MetCount,
                a.LastMetAt,
                a.RiskFrom,
            }).ToListAsync(cancellationToken);
        return kept.Select(a => new PlanRow(a.Id, a.Code, a.Name, a.ExternalId, a.Start, a.Finish, a.Departments, a.HasWbs, a.WbsOrder,
            a.NeedCount, RecordedFacts(a.NeedCount, a.MetCount, a.LastMetAt, a.RiskFrom, a.Start, today), null, null)).ToList();
    }

    /// <summary>The actions shown, in full with their needs, in the order shown.</summary>
    private static async Task<List<Activity>> InFullAsync(DeliosDbContext db, List<PlanRow> rows, HashSet<Guid>? visible, CancellationToken cancellationToken)
    {
        if (visible is not null) return rows.Select(r => r.Whole!).ToList();
        var ids = rows.Select(r => r.Id).ToList();
        var read = await db.Activities.AsNoTracking().Include(a => a.Requirements).Where(a => ids.Contains(a.Id))
            .AsSplitQuery().ToDictionaryAsync(a => a.Id, cancellationToken);
        return ids.Where(read.ContainsKey).Select(id => read[id]).ToList();
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
        // Where each action stands, from what it keeps (RowsAsync); which disciplines have documents listed, in one read.
        var visible = await OutsideViewAsync(db, access, cancellationToken);
        var activities = await RowsAsync(db, access.Project.Id, today, window, visible, cancellationToken);
        var listedFor = visible is not null
            ? activities.SelectMany(a => a.Whole!.Requirements.Select(n => (a.Id, n.Department))).ToHashSet()
            : (await db.Requirements.AsNoTracking().Where(n => n.ProjectId == access.Project.Id)
                .Select(n => new { n.ActivityId, n.Department }).Distinct().ToListAsync(cancellationToken))
                .Select(x => (x.ActivityId, x.Department)).ToHashSet();
        var untagged = activities.Count(a => a.Departments.Length == 0);
        var pairs = activities.SelectMany(a => a.Departments.Select(d => (a, d))).ToList();
        var answered = pairs.Count(p => listedFor.Contains((p.a.Id, p.d)));
        var first = ReadDay(from) ?? today.PlusDays(-PlanWindowDays);
        var last = ReadDay(to) ?? today.PlusDays(PlanWindowDays);
        var listed = activities.Where(a => a.Start is { } s && s >= first && s <= last && a.Needs > 0).ToList();
        var complete = listed.Count(a => a.Facts.State is ActionStates.Ready or ActionStates.Done or ActionStates.LateReceipt);
        var at = activities.Count == 0 ? 0 : untagged > 0 ? 1 : answered < pairs.Count || listed.Count == 0 ? 2 : complete == listed.Count ? 4 : 3;
        return Results.Ok(new
        {
            at,
            actions = activities.Count,
            untagged,
            answered,
            asked = pairs.Count,
            complete,
            listed = listed.Count,
            from = first.ToDateOnly(),
            to = last.ToDateOnly()
        });
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
