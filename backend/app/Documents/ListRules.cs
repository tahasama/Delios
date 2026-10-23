using System.Text.Json;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Settings;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

/// <summary>One group of lists on Types &amp; sets, and whether a list of one's own may be added in it.</summary>
public sealed record ListGroup(string Key, string Title, bool TakesLists);

/// <summary>
/// What a list is, worked out once (owner, Types &amp; sets): its group, whether the app runs on it, whether it may hold
/// more than one set, and which of its sets serves a deliverable type. A list holds sets; each set names the deliverable
/// types it serves, the default set serves every type no other active set names, so a document always finds exactly one
/// set; two active sets never serve the same type.
/// </summary>
public static class ListRules
{
    public const string Numbering = "NUMBERING";
    public const string Classification = "CLASSIFICATION";
    public const string Review = "REVIEW";
    public const string Formats = "FORMATS";
    public const string Schedule = "SCHEDULE";

    /// <summary>The groups, in the order shown. A list of one's own goes into the first two only: it is a document field.</summary>
    public static readonly IReadOnlyList<ListGroup> Groups =
    [
        new(Numbering, "Numbering & identity", true),
        new(Classification, "Classification & keeping", true),
        new(Review, "Review & issue", false),
        new(Formats, "File formats", false),
        new(Schedule, "Schedule", false),
    ];

    /// <summary>The lists the app runs on, by group, in the order shown. They are never deleted nor switched off here.</summary>
    private static readonly Dictionary<string, string[]> AppLists = new()
    {
        [Numbering] =
        [
            ValueSets.ProjectCodes, ValueSets.Subprojects, ValueSets.Disciplines, ValueSets.DocumentTypes, ValueSets.DeliverableTypes,
            "SUPPLIER_CODES", ValueSets.PurchaseOrders, "DELIVERABLE_TYPE_FIELDS", ValueSets.ProjectKinds, "CONTRACT_ROLES",
            ValueSets.GenericTitleWords,
        ],
        [Review] =
        [
            ReviewSets.Verdicts, ReviewSets.Advice, ReviewSets.CommentClasses, ReviewSets.Statuses, "REASONS_FOR_ISSUE",
            ReviewSets.ReturnReasons, "ISSUE_CODES", ReviewSets.ControlOutcomes,
        ],
        [Classification] = [ValueSets.Criticality, ValueSets.Confidentiality, ValueSets.RetentionClasses, ValueSets.Phases],
        [Formats] = ["NATIVE_FORMATS", "RENDITION_FORMATS", "PRESERVATION_FORMATS"],
        [Schedule] = [Actions.ScheduleSets.Decisions, Platform.WorkingCalendar.HolidaysList],
    };

    /// <summary>Lists that hold one set only: what the sets are chosen by, what the app fills, and what describes the project.</summary>
    private static readonly HashSet<string> OneSet = [ValueSets.DeliverableTypes, ValueSets.ProjectCodes, ValueSets.ProjectKinds, "CONTRACT_ROLES"];

    /// <summary>True for a list the app runs on: its values and sets change, the list itself stays.</summary>
    public static bool IsAppList(string key) => AppLists.Values.Any(keys => keys.Contains(key));

    /// <summary>True for a list that may hold more than one set.</summary>
    public static bool TakesSets(string key) => !OneSet.Contains(key);

    /// <summary>Where a list is shown in the order of its group; one of one's own comes after the app's.</summary>
    public static int Rank(string key) =>
        AppLists.Values.Select(keys => Array.IndexOf(keys, key)).FirstOrDefault(i => i >= 0, -1) is var at and >= 0 ? at : 999;

    /// <summary>
    /// The group a list is in: the app's own by the app; a verdict list in Review &amp; issue; one of one's own where it was
    /// put (by its group's key or title), else Classification &amp; keeping.
    /// </summary>
    public static string GroupOf(string key, ListMeta meta)
    {
        foreach (var (group, keys) in AppLists) if (keys.Contains(key)) return group;
        if (meta.Kind == "VERDICTS") return Review;
        return Groups.FirstOrDefault(g => g.TakesLists && (g.Key == meta.Group || g.Title == meta.Group))?.Key ?? Classification;
    }

    /// <summary>A list's own name, description, group and switch, as kept in its <c>SET:</c> setting.</summary>
    public sealed record ListMeta(string? Title, string? Description, string? Group, string? Kind, bool Active)
    {
        public static ListMeta Read(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new(null, null, null, null, true);
            try
            {
                var root = JsonDocument.Parse(json).RootElement;
                string? Text(string name) => root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                var active = !root.TryGetProperty("active", out var a) || a.ValueKind != JsonValueKind.False;
                return new(Text("title"), Text("description"), Text("group"), Text("kind"), active);
            }
            catch (JsonException)
            {
                return new(null, null, null, null, true);
            }
        }
    }

    /// <summary>A list's name as people read it: its own, else its key in words.</summary>
    public static string TitleOf(string key, ListMeta meta)
    {
        if (!string.IsNullOrWhiteSpace(meta.Title)) return meta.Title!;
        if (key == ValueSets.ProjectKinds) return "Project types";
        if (key == Platform.WorkingCalendar.HolidaysList) return "Public holidays";
        var words = key.Replace('_', ' ').ToLowerInvariant();
        return char.ToUpperInvariant(words[0]) + words[1..];
    }

    /// <summary>Every list's meta, the project's over the organization's (none: the organization's only).</summary>
    public static async Task<Dictionary<string, ListMeta>> MetaAsync(DeliosDbContext db, Guid? projectId, CancellationToken cancellationToken)
    {
        var rows = await db.Set<Setting>().AsNoTracking()
            .Where(s => (s.ProjectId == null || s.ProjectId == projectId) && s.Key.StartsWith(ProjectLists.SetPrefix))
            .Select(s => new { s.Key, s.Value, s.ProjectId }).ToListAsync(cancellationToken);
        return rows.OrderBy(r => r.ProjectId is null ? 0 : 1)
            .GroupBy(r => r.Key[ProjectLists.SetPrefix.Length..])
            .ToDictionary(g => g.Key, g => ListMeta.Read(g.Last().Value), StringComparer.Ordinal);
    }

    /// <summary>
    /// The set of a list that serves a deliverable type: the active set naming it; else the default set, when it names no
    /// type (owner: the default may be given types of its own, and then serves those only). None: nothing is offered.
    /// </summary>
    public static ValueSet? Serving(IEnumerable<ValueSet> setsOfList, string? deliverableType)
    {
        var sets = setsOfList.ToList();
        return (deliverableType is null ? null : sets.FirstOrDefault(s => s.Active && s.DeliverableTypes.Contains(deliverableType)))
            ?? sets.FirstOrDefault(s => s.IsDefault && s.Active && s.DeliverableTypes.Length == 0);
    }

    /// <summary>The deliverable types another active set of the same list already serves, among those given.</summary>
    public static IReadOnlyList<(string Type, string Set)> Overlaps(IEnumerable<ValueSet> setsOfList, ValueSet set, IEnumerable<string> types) =>
        setsOfList.Where(s => s.Id != set.Id && s.Active)
            .SelectMany(s => s.DeliverableTypes.Intersect(types).Select(t => (t, s.Name))).ToList();
}
