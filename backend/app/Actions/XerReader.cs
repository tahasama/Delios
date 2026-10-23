using System.Globalization;
using System.Text;
using NodaTime;

namespace Delios.Host.Actions;

/// <summary>
/// Reads the activities of a Primavera P6 export (.xer) directly (owner: "to be able to extract data from it directly in
/// addition to the excel upload"). An XER is text: for each table a line <c>%T name</c>, its fields <c>%F …</c> and its
/// rows <c>%R …</c>, tab separated, ending with <c>%E</c>. The activities are the TASK table: our planner's ID is its
/// <c>task_code</c>, its name <c>task_name</c>; its start and finish are read as P6 shows them in its Start and Finish
/// columns (the actual date once it happened, else the early date, else the remaining, else the planned). WBS summary
/// rows are not activities. An export of several projects is read for the one the schedule settings name (the same
/// setting that names a workbook's sheet), else refused, naming them.
/// </summary>
public static class XerReader
{
    public static bool IsXer(string fileName) => fileName.EndsWith(".xer", StringComparison.OrdinalIgnoreCase);

    /// <summary>The tables of an XER, each its fields and rows, by table name.</summary>
    private sealed record Table(string[] Fields, List<string[]> Rows)
    {
        public int At(string field) => Array.FindIndex(Fields, f => f.Equals(field, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The activities, or why the file cannot be read.</summary>
    public static (IReadOnlyList<ParsedActivity>? Activities, string? Error) Read(Stream content, string? projectNamed)
    {
        Dictionary<string, Table> tables;
        try { tables = Tables(content); }
        catch (Exception e) when (e is not OperationCanceledException) { return (null, $"The file could not be read: {e.Message}"); }
        if (tables.Count == 0) return (null, "This is not a Primavera P6 export (.xer): no table was found in it.");
        if (!tables.TryGetValue("TASK", out var task)) return (null, "The export holds no activities (no TASK table). Export the project with its activities from P6.");

        int code = task.At("task_code"), name = task.At("task_name"), proj = task.At("proj_id"), type = task.At("task_type");
        if (code < 0 || name < 0) return (null, "The TASK table has no task_code or task_name: this export cannot be read.");

        // Which project: the one named in the schedule settings, else the only one.
        string? onlyProject = null;
        if (tables.TryGetValue("PROJECT", out var projects) && projects.Rows.Count > 0)
        {
            int id = projects.At("proj_id"), shortName = projects.At("proj_short_name");
            var named = projects.Rows.Select(r => (Id: Cell(r, id), Name: Cell(r, shortName))).Where(p => p.Id is not null).ToList();
            var inTasks = task.Rows.Select(r => Cell(r, proj)).Where(p => p is not null).Distinct().ToHashSet();
            named = named.Where(p => inTasks.Contains(p.Id)).ToList();
            if (!string.IsNullOrWhiteSpace(projectNamed))
            {
                var wanted = named.FirstOrDefault(p => string.Equals(p.Name, projectNamed.Trim(), StringComparison.OrdinalIgnoreCase));
                if (wanted.Id is null)
                    return (null, $"The export holds no project named {projectNamed}. It holds: {string.Join(", ", named.Select(p => p.Name ?? p.Id))}.");
                onlyProject = wanted.Id;
            }
            else if (named.Count > 1)
                return (null, $"The export holds {named.Count} projects ({string.Join(", ", named.Select(p => p.Name ?? p.Id))}). Name the one to read in the schedule settings (where a workbook's sheet is named), or export it alone.");
        }

        string? Date(string[] row, params string[] fields)
        {
            foreach (var field in fields)
                if (Cell(row, task.At(field)) is { } value) return value;
            return null;
        }

        var activities = new List<ParsedActivity>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in task.Rows)
        {
            if (onlyProject is not null && Cell(row, proj) != onlyProject) continue;
            if (string.Equals(Cell(row, type), "TT_WBS", StringComparison.OrdinalIgnoreCase)) continue;
            var id = Cell(row, code);
            if (id is null) continue;
            if (!seen.Add(id)) return (null, $"Activity {id} appears twice in the export.");
            var startText = Date(row, "act_start_date", "early_start_date", "restart_date", "target_start_date");
            var finishText = Date(row, "act_end_date", "early_end_date", "reend_date", "target_end_date");
            var (start, startOk) = ParseDate(startText);
            var (finish, finishOk) = ParseDate(finishText);
            if (!startOk) return (null, $"Activity {id}: '{startText}' is not a date.");
            if (!finishOk) return (null, $"Activity {id}: '{finishText}' is not a date.");
            activities.Add(new ParsedActivity(id, Cell(row, name) ?? id, start, finish, null, null));
        }
        return activities.Count == 0 ? (null, "The export holds no activities.") : (activities, null);
    }

    /// <summary>The activities as rows, the way an uploaded list is kept: a heading row, then one row each.</summary>
    public static List<string[]> Rows(Stream content, string? projectNamed)
    {
        var (activities, error) = Read(content, projectNamed);
        if (activities is null) throw new InvalidDataException(error);
        return [["Activity ID", "Activity Name", "Start", "Finish"],
            .. activities.Select(a => new[] { a.Code, a.Name, a.Start?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "",
                a.Finish?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "" })];
    }

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
                if (++rows > Documents.SheetGuard.MaxRows * 5)
                    throw new InvalidDataException("The export holds far more rows than a schedule does.");
                current.Rows.Add(line[3..].Split('\t'));
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
