using System.Globalization;
using System.Text;
using ClosedXML.Excel;
using NodaTime;

namespace Delios.Host.Schedules;

/// <summary>One activity as the schedule file states it; departments as the file names them.</summary>
public sealed record ParsedActivity(string Code, string Name, LocalDate? Start, LocalDate? Finish, string? Responsible, string[] Departments);

/// <summary>
/// Reads activities from a schedule exported to Excel (.xlsx) or CSV, as Primavera
/// P6 and Microsoft Project both export them. Columns are found by their headings:
/// the ones the project named, or the usual ones ("Activity ID", "Activity Name",
/// "Start", "Finish"…). P6's markers on dates ("A" actual, "*" constrained) are ignored.
/// </summary>
public static class ScheduleReader
{
    private static readonly Dictionary<string, string[]> Usual = new()
    {
        ["code"] = ["activity id", "activityid", "activity code", "task id", "code", "id", "unique id"],
        ["name"] = ["activity name", "task name", "name", "description", "activity description"],
        ["start"] = ["start", "start date", "planned start", "early start", "baseline start"],
        ["finish"] = ["finish", "finish date", "end", "end date", "planned finish", "early finish", "baseline finish"],
        ["responsible"] = ["responsible", "owner", "responsible party", "responsible manager", "resource"],
        ["departments"] = ["departments", "department", "disciplines", "discipline"],
    };

    private static readonly string[] DateFormats =
    [
        "dd-MMM-yy", "dd-MMM-yy HH:mm", "dd-MMM-yyyy", "dd-MMM-yyyy HH:mm", "yyyy-MM-dd", "yyyy-MM-dd HH:mm",
        "yyyy-MM-ddTHH:mm:ss", "dd/MM/yyyy", "dd/MM/yyyy HH:mm", "d/M/yyyy", "dd.MM.yyyy", "d MMM yyyy", "MMM d, yyyy",
    ];

    public static bool CanRead(string fileName) =>
        fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) || fileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase);

    /// <summary>The activities, or why the file cannot be read; the error names the row.</summary>
    public static (IReadOnlyList<ParsedActivity>? Activities, string? Error) Read(Stream content, string fileName, ScheduleColumns columns)
    {
        List<string[]> rows;
        try
        {
            rows = fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) ? ReadExcel(content, columns.Sheet) : ReadCsv(content);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return (null, $"The file could not be read: {e.Message}");
        }

        // The heading row is the first, within the first ten, that names a code and a name.
        for (var headerRow = 0; headerRow < Math.Min(10, rows.Count); headerRow++)
        {
            var headings = rows[headerRow].Select(Normalize).ToArray();
            int Find(string field, string? named)
            {
                var wanted = named is null ? Usual[field].Select(Normalize) : [Normalize(named)];
                foreach (var name in wanted)
                {
                    var at = Array.IndexOf(headings, name);
                    if (at >= 0) return at;
                }
                return -1;
            }
            var code = Find("code", columns.Code);
            var name = Find("name", columns.Name);
            if (code < 0 || name < 0) continue;
            var start = Find("start", columns.Start);
            var finish = Find("finish", columns.Finish);
            var responsible = Find("responsible", columns.Responsible);
            var departments = Find("departments", columns.Departments);
            if (start < 0) return (null, "No start date column was found. Name it in the schedule settings.");

            var activities = new List<ParsedActivity>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (var r = headerRow + 1; r < rows.Count; r++)
            {
                string? Cell(int index) => index >= 0 && index < rows[r].Length && !string.IsNullOrWhiteSpace(rows[r][index]) ? rows[r][index].Trim() : null;
                var id = Cell(code);
                if (id is null) continue;
                if (!seen.Add(id)) return (null, $"Row {r + 1}: activity {id} appears twice.");
                var (startDate, startOk) = ParseDate(Cell(start));
                var (finishDate, finishOk) = ParseDate(Cell(finish));
                if (!startOk) return (null, $"Row {r + 1}: '{Cell(start)}' is not a date.");
                if (!finishOk) return (null, $"Row {r + 1}: '{Cell(finish)}' is not a date.");
                activities.Add(new ParsedActivity(id, Cell(name) ?? id, startDate, finishDate, Cell(responsible),
                    (Cell(departments) ?? "").Split([',', ';', '|', '/'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                        .Distinct(StringComparer.OrdinalIgnoreCase).ToArray()));
            }
            return activities.Count == 0 ? (null, "The file has headings but no activities.") : (activities, null);
        }
        return (null, "No heading row with an activity code and name was found in the first ten rows.");
    }

    private static List<string[]> ReadExcel(Stream content, string? sheetName)
    {
        using var copy = new MemoryStream();
        content.CopyTo(copy);
        copy.Position = 0;
        using var workbook = new XLWorkbook(copy);
        var sheet = sheetName is null ? workbook.Worksheets.First() : workbook.Worksheet(sheetName);
        var rows = new List<string[]>();
        var range = sheet.RangeUsed();
        if (range is null) return rows;
        foreach (var row in range.Rows())
        {
            rows.Add(row.Cells().Select(c => c.DataType == XLDataType.DateTime
                ? c.GetDateTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                : c.GetFormattedString()).ToArray());
        }
        return rows;
    }

    /// <summary>Comma, semicolon or tab separated (whichever the heading line uses most), with quoted fields.</summary>
    private static List<string[]> ReadCsv(Stream content)
    {
        using var reader = new StreamReader(content, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        var lines = new List<string>();
        while (reader.ReadLine() is { } line) lines.Add(line);
        if (lines.Count == 0) return [];
        var separator = new[] { ',', ';', '\t' }.MaxBy(s => lines[0].Count(c => c == s));
        return lines.Select(line => SplitCsv(line, separator)).ToList();
    }

    private static string[] SplitCsv(string line, char separator)
    {
        var fields = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < line.Length && line[i + 1] == '"') { field.Append('"'); i++; }
                else if (c == '"') quoted = false;
                else field.Append(c);
            }
            else if (c == '"') quoted = true;
            else if (c == separator) { fields.Add(field.ToString()); field.Clear(); }
            else field.Append(c);
        }
        fields.Add(field.ToString());
        return [.. fields];
    }

    /// <summary>Empty is fine (no date); anything else must be a date.</summary>
    private static (LocalDate? Date, bool Ok) ParseDate(string? text)
    {
        if (text is null) return (null, true);
        // P6 marks actual dates with " A" and constrained ones with "*".
        var cleaned = text.TrimEnd('*', ' ').Trim();
        if (cleaned.EndsWith(" A", StringComparison.Ordinal)) cleaned = cleaned[..^2].Trim();
        if (DateTime.TryParseExact(cleaned, DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var exact))
            return (LocalDate.FromDateTime(exact), true);
        if (double.TryParse(cleaned, NumberStyles.Float, CultureInfo.InvariantCulture, out var serial) && serial is > 20000 and < 80000)
            return (LocalDate.FromDateTime(DateTime.FromOADate(serial)), true);
        return (null, false);
    }

    private static string Normalize(string text) => new(text.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
}
