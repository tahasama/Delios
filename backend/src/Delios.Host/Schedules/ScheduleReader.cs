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
    /// <summary>The usual column headings for each field, tried in order when the project has not named the column. Compared after <see cref="Normalize"/>.</summary>
    private static readonly Dictionary<string, string[]> Usual = new()
    {
        ["code"] = ["activity id", "activityid", "activity code", "task id", "code", "id", "unique id"],
        ["name"] = ["activity name", "task name", "name", "description", "activity description"],
        ["start"] = ["start", "start date", "planned start", "early start", "baseline start"],
        ["finish"] = ["finish", "finish date", "end", "end date", "planned finish", "early finish", "baseline finish"],
        ["responsible"] = ["responsible", "owner", "responsible party", "responsible manager", "resource"],
        ["departments"] = ["departments", "department", "disciplines", "discipline"],
    };

    /// <summary>The date layouts that cannot be misread: month by name, or year first.</summary>
    private static readonly string[] NamedFormats =
    [
        "dd-MMM-yy", "dd-MMM-yy HH:mm", "dd-MMM-yyyy", "dd-MMM-yyyy HH:mm", "yyyy-MM-dd", "yyyy-MM-dd HH:mm",
        "yyyy-MM-ddTHH:mm:ss", "d MMM yyyy", "MMM d, yyyy",
    ];

    /// <summary>Numeric layouts with the day first.</summary>
    private static readonly string[] DayFirst = ["d/M/yyyy", "d/M/yyyy H:mm", "d.M.yyyy", "d-M-yyyy"];

    /// <summary>Numeric layouts with the month first (US exports).</summary>
    private static readonly string[] MonthFirst = ["M/d/yyyy", "M/d/yyyy H:mm", "M/d/yyyy h:mm tt", "M.d.yyyy", "M-d-yyyy"];

    /// <summary>True for file names this reader can read (.xlsx or .csv). Used by the importer to pick the file of a revision.</summary>
    public static bool CanRead(string fileName) =>
        fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) || fileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase);

    /// <summary>Every used row of a spreadsheet (its first sheet) or a CSV file, as text.</summary>
    public static List<string[]> ReadRows(Stream content, string fileName) =>
        fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) ? ReadExcel(content, null) : ReadCsv(content);

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
                var monthFirst = string.Equals(columns.DateOrder, "MDY", StringComparison.OrdinalIgnoreCase);
                var (startDate, startOk) = ParseDate(Cell(start), monthFirst);
                var (finishDate, finishOk) = ParseDate(Cell(finish), monthFirst);
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

    /// <summary>Reads every used row of the named worksheet (or the first one) as text. Real dates become yyyy-MM-dd; other cells keep their displayed text.</summary>
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

    /// <summary>
    /// Comma, semicolon or tab separated (whichever the heading line uses most), with
    /// quoted fields. A quoted field may hold the separator, doubled quotes and line breaks.
    /// </summary>
    private static List<string[]> ReadCsv(Stream content)
    {
        using var reader = new StreamReader(content, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        var text = reader.ReadToEnd();
        if (text.Length == 0) return [];
        var firstLine = text.Split('\n', 2)[0];
        var separator = new[] { ',', ';', '\t' }.MaxBy(s => firstLine.Count(c => c == s));

        var rows = new List<string[]>();
        var fields = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < text.Length && text[i + 1] == '"') { field.Append('"'); i++; }
                else if (c == '"') quoted = false;
                else field.Append(c);
            }
            else if (c == '"') quoted = true;
            else if (c == separator) { fields.Add(field.ToString()); field.Clear(); }
            else if (c is '\n' or '\r')
            {
                if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
                fields.Add(field.ToString());
                field.Clear();
                rows.Add([.. fields]);
                fields.Clear();
            }
            else field.Append(c);
        }
        if (field.Length > 0 || fields.Count > 0)
        {
            fields.Add(field.ToString());
            rows.Add([.. fields]);
        }
        return rows;
    }

    /// <summary>Empty is fine (no date); anything else must be a date.</summary>
    private static (LocalDate? Date, bool Ok) ParseDate(string? text, bool monthFirst)
    {
        if (text is null) return (null, true);
        // P6 marks actual dates with " A" and constrained ones with "*".
        var cleaned = text.TrimEnd('*', ' ').Trim();
        if (cleaned.EndsWith(" A", StringComparison.Ordinal)) cleaned = cleaned[..^2].Trim();
        string[] formats = [.. NamedFormats, .. monthFirst ? MonthFirst : DayFirst];
        if (DateTime.TryParseExact(cleaned, formats, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var exact))
            return (LocalDate.FromDateTime(exact), true);
        if (double.TryParse(cleaned, NumberStyles.Float, CultureInfo.InvariantCulture, out var serial) && serial is > 20000 and < 80000)
            return (LocalDate.FromDateTime(DateTime.FromOADate(serial)), true);
        return (null, false);
    }

    /// <summary>Lower-cases a heading and keeps only letters and digits, so "Activity ID" and "activity_id" match.</summary>
    private static string Normalize(string text) => new(text.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
}
