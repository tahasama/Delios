using System.Globalization;
using System.Text;
using NodaTime;

namespace Delios.Host.Actions;

/// <summary>
/// Reads a Primavera P6 export (.xer) directly (owner: "to be able to extract data from it directly in addition to the
/// excel upload"). An XER is text: for each table a line <c>%T name</c>, its fields <c>%F …</c> and its rows <c>%R …</c>,
/// tab separated, ending with <c>%E</c>. No column is chosen: P6 names its fields the same in every export. The
/// activities are the TASK table: the planner's ID is its <c>task_code</c>, its name <c>task_name</c>; its start and
/// finish are read as P6 shows them in its Start and Finish columns (the actual date once it happened, else the early
/// date, else the remaining, else the planned). WBS summary rows are not activities. An export of several projects is
/// read for the one whose P6 short name is our project's code, else refused, naming them. The same reading draws the
/// Preview of an .xer (every project, its WBS and activities).
/// </summary>
public static class XerReader
{
    public static bool IsXer(string fileName) => fileName.EndsWith(".xer", StringComparison.OrdinalIgnoreCase);

    /// <summary>One activity as P6 holds it: where it sits in the WBS, its type, its dates and whether they happened.</summary>
    public sealed record Activity(string Code, string Name, string? Wbs, string Type, DateOnly? Start, DateOnly? Finish, bool Started, bool Finished);
    /// <summary>A WBS element: its parent (none at the project's top), short name and name, in P6's order.</summary>
    public sealed record WbsNode(string Id, string? Parent, string Code, string Name, int Order);
    public sealed record ProjectOutline(string Id, string Code, string Name, WbsNode[] Wbs, Activity[] Activities);
    /// <summary>What an export holds: every project's outline, and the activities the schedule reads (or why none).</summary>
    public sealed record Reading(ProjectOutline[] Projects, IReadOnlyList<ParsedActivity>? Activities, string? Error, string? ReadId = null);

    private sealed record Table(string[] Fields, List<string[]> Rows)
    {
        public int At(string field) => Array.FindIndex(Fields, f => f.Equals(field, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The activities, or why the file cannot be read.</summary>
    public static (IReadOnlyList<ParsedActivity>? Activities, string? Error) Read(Stream content, string? projectCode)
    {
        var reading = Outline(content, projectCode);
        return (reading.Activities, reading.Error);
    }

    /// <summary>The activities as rows, the way an uploaded list is kept: a heading row, then one row each.</summary>
    public static List<string[]> Rows(Stream content, string? projectCode)
    {
        var (activities, error) = Read(content, projectCode);
        if (activities is null) throw new InvalidDataException(error);
        return [["Activity ID", "Activity Name", "Start", "Finish"],
            .. activities.Select(a => new[] { a.Code, a.Name, Day(a.Start), Day(a.Finish) })];
    }

    private static string Day(LocalDate? d) => d?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "";

    /// <summary>The whole export, read once: every project's WBS and activities, and the activities of the one the schedule reads.</summary>
    public static Reading Outline(Stream content, string? projectCode)
    {
        Dictionary<string, Table> tables;
        try { tables = Tables(content); }
        catch (Exception e) when (e is not OperationCanceledException) { return new([], null, $"The file could not be read: {e.Message}"); }
        if (tables.Count == 0) return new([], null, "This is not a Primavera P6 export (.xer): no table was found in it.");
        if (!tables.TryGetValue("TASK", out var task)) return new([], null, "The export holds no activities (no TASK table). Export the project with its activities from P6.");
        int code = task.At("task_code"), name = task.At("task_name"), proj = task.At("proj_id"), type = task.At("task_type"), wbs = task.At("wbs_id");
        if (code < 0 || name < 0) return new([], null, "The TASK table has no task_code or task_name: this export cannot be read.");

        // The projects, as P6 names them, in the order the export holds them.
        var projectNames = new Dictionary<string, (string Code, string Name)>();
        if (tables.TryGetValue("PROJECT", out var projects))
        {
            int id = projects.At("proj_id"), shortName = projects.At("proj_short_name");
            foreach (var r in projects.Rows)
                if (Cell(r, id) is { } pid) projectNames[pid] = (Cell(r, shortName) ?? pid, Cell(r, shortName) ?? pid);
        }
        var wbsNodes = new Dictionary<string, List<WbsNode>>();
        if (tables.TryGetValue("PROJWBS", out var projwbs))
        {
            int id = projwbs.At("wbs_id"), parent = projwbs.At("parent_wbs_id"), pid = projwbs.At("proj_id"), shortName = projwbs.At("wbs_short_name"),
                wbsName = projwbs.At("wbs_name"), seq = projwbs.At("seq_num"), node = projwbs.At("proj_node_flag");
            // The project's own node is its top: the elements under it have no parent here.
            var tops = projwbs.Rows.Where(r => Cell(r, node) == "Y").Select(r => Cell(r, id)).Where(x => x is not null).ToHashSet();
            foreach (var r in projwbs.Rows)
            {
                if (Cell(r, id) is not { } wid || Cell(r, pid) is not { } owner || Cell(r, node) == "Y") continue;
                var up = Cell(r, parent);
                (wbsNodes.TryGetValue(owner, out var list) ? list : wbsNodes[owner] = []).Add(new WbsNode(wid, up is not null && tops.Contains(up) ? null : up,
                    Cell(r, shortName) ?? wid, Cell(r, wbsName) ?? "", int.TryParse(Cell(r, seq), out var n) ? n : 0));
            }
        }

        string? Date(string[] row, params string[] fields)
        {
            foreach (var field in fields)
                if (Cell(row, task.At(field)) is { } value) return value;
            return null;
        }

        var byProject = new Dictionary<string, List<Activity>>();
        foreach (var row in task.Rows)
        {
            if (string.Equals(Cell(row, type), "TT_WBS", StringComparison.OrdinalIgnoreCase)) continue;
            if (Cell(row, code) is not { } id) continue;
            var startText = Date(row, "act_start_date", "early_start_date", "restart_date", "target_start_date");
            var finishText = Date(row, "act_end_date", "early_end_date", "reend_date", "target_end_date");
            var (start, startOk) = ParseDate(startText);
            var (finish, finishOk) = ParseDate(finishText);
            if (!startOk) return new([], null, $"Activity {id}: '{startText}' is not a date.");
            if (!finishOk) return new([], null, $"Activity {id}: '{finishText}' is not a date.");
            var owner = Cell(row, proj) ?? "";
            (byProject.TryGetValue(owner, out var list) ? list : byProject[owner] = []).Add(new Activity(id, Cell(row, name) ?? id, Cell(row, wbs),
                TypeWords(Cell(row, type)), start?.ToDateOnly(), finish?.ToDateOnly(), Cell(row, task.At("act_start_date")) is not null, Cell(row, task.At("act_end_date")) is not null));
        }

        var outlines = byProject.Select(p =>
        {
            var (shortName, _) = projectNames.TryGetValue(p.Key, out var known) ? known : (p.Key, p.Key);
            return new ProjectOutline(p.Key, shortName, shortName, [.. (wbsNodes.GetValueOrDefault(p.Key) ?? []).OrderBy(w => w.Order)], [.. p.Value]);
        }).ToArray();
        if (outlines.Length == 0) return new([], null, "The export holds no activities.");

        // Which project the schedule reads: the only one, else the one named as our project.
        var read = outlines.Length == 1 ? outlines[0]
            : outlines.FirstOrDefault(o => projectCode is not null && string.Equals(o.Code, projectCode.Trim(), StringComparison.OrdinalIgnoreCase));
        if (read is null)
            return new(outlines, null,
                $"The export holds {outlines.Length} projects ({string.Join(", ", outlines.Select(o => o.Code))}) and none is named {projectCode}. Choose the one to read when uploading it on the Schedule (the choice is kept for the schedule's next revisions), or export it alone from P6.");
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var a in read.Activities)
            if (!seen.Add(a.Code)) return new(outlines, null, $"Activity {a.Code} appears twice in the export.");
        // Each activity keeps where it sits in the WBS (owner: "keep the category/sub"), from the top down, and its
        // element's place in P6's order (the tree read top down, siblings by their sequence).
        var nodes = read.Wbs.ToDictionary(w => w.Id);
        var order = new Dictionary<string, int>();
        void Walk(string? parent)
        {
            foreach (var w in read.Wbs.Where(w => w.Parent == parent).OrderBy(w => w.Order))
            {
                order[w.Id] = order.Count;
                Walk(w.Id);
            }
        }
        Walk(null);
        string[] PathOf(string? id)
        {
            var path = new List<string>();
            for (var at = id; at is not null && nodes.TryGetValue(at, out var node) && path.Count < 30; at = node.Parent)
                path.Insert(0, string.IsNullOrWhiteSpace(node.Name) ? node.Code : $"{node.Code} {node.Name}");
            return [.. path];
        }
        return new(outlines, read.Activities.Select(a => new ParsedActivity(a.Code, a.Name,
            a.Start is { } s ? LocalDate.FromDateOnly(s) : null, a.Finish is { } f ? LocalDate.FromDateOnly(f) : null, null, null,
            a.Started, a.Finished, PathOf(a.Wbs), a.Wbs is not null && order.TryGetValue(a.Wbs, out var n) ? n : null)).ToList(), null, read.Id);
    }

    /// <summary>P6's activity types in plain words.</summary>
    private static string TypeWords(string? type) => type?.ToUpperInvariant() switch
    {
        "TT_MILE" => "Start milestone",
        "TT_FINMILE" => "Finish milestone",
        "TT_LOE" => "Level of effort",
        "TT_RSRC" => "Resource dependent",
        "TT_WBS" => "WBS summary",
        _ => "Task",
    };

    private static string? Cell(string[] row, int at) => at >= 0 && at < row.Length && !string.IsNullOrWhiteSpace(row[at]) ? row[at].Trim() : null;

    /// <summary>Every table of the export. P6 writes UTF-8 or the Windows code page: UTF-8 when it reads as such, else Latin-1.</summary>
    private static Dictionary<string, Table> Tables(Stream content)
    {
        using var copy = new MemoryStream();
        content.CopyTo(copy);
        var bytes = copy.ToArray();
        string text;
        try { text = new UTF8Encoding(false, true).GetString(bytes); }
        catch (DecoderFallbackException) { text = Encoding.Latin1.GetString(bytes); }

        var tables = new Dictionary<string, Table>(StringComparer.OrdinalIgnoreCase);
        Table? current = null;
        string? currentName = null;
        var rows = 0;
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (line.StartsWith("%T\t", StringComparison.Ordinal)) { currentName = line[3..].Trim(); current = null; }
            else if (line.StartsWith("%F\t", StringComparison.Ordinal) && currentName is not null)
            {
                current = new Table(line[3..].Split('\t'), []);
                tables[currentName] = current;
            }
            else if (line.StartsWith("%R\t", StringComparison.Ordinal) && current is not null)
            {
                if (++rows > 2_000_000) throw new InvalidDataException("The export holds far more rows than a schedule does.");
                // Only the tables read are kept: resources, costs and the rest are passed over.
                if (currentName is "TASK" or "PROJECT" or "PROJWBS") current.Rows.Add(line[3..].Split('\t'));
            }
            else if (line.StartsWith("%E", StringComparison.Ordinal)) break;
        }
        return tables;
    }

    /// <summary>P6 writes dates as "yyyy-MM-dd HH:mm"; empty is no date.</summary>
    private static (LocalDate? Date, bool Ok) ParseDate(string? text)
    {
        if (text is null) return (null, true);
        string[] formats = ["yyyy-MM-dd HH:mm", "yyyy-MM-dd H:mm", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd"];
        return DateTime.TryParseExact(text.Trim(), formats, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var d)
            ? (LocalDate.FromDateTime(d), true)
            : (null, false);
    }
}
