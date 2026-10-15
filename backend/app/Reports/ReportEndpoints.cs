using System.Text;
using ClosedXML.Excel;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;

namespace Delios.Host.Reports;

/// <summary>
/// The project's reports, read by its own people: the list, one report counted now,
/// and the same report as a CSV or Excel file. Filtering by text narrows the rows.
/// </summary>
public static class ReportEndpoints
{
    /// <summary>The title and question of each report, for the list of reports.</summary>
    private static readonly Dictionary<string, (string Title, string Question)> Catalogue = new()
    {
        [ReportIds.Register] = ("Register status", "Where does every document stand?"),
        [ReportIds.Deliveries] = ("Deliveries against plan", "Who is delivering on time, and what is overdue?"),
        [ReportIds.Reviews] = ("Reviews waiting", "What is with reviewers, and for how long?"),
        [ReportIds.Transmittals] = ("Transmittal log", "What went out and came in, and what is still waiting?"),
        [ReportIds.Readiness] = ("Activity readiness", "Are the coming activities covered by their documents?"),
        [ReportIds.Progress] = ("Progress by week", "Is the project moving, week by week?"),
        [ReportIds.Exchange] = ("Who owes what", "What does each side still owe the other?"),
        [ReportIds.AsOf] = ("Register on a date", "Which revision was current on a given day?"),
    };

    /// <summary>
    /// Registers the report URLs under /api/projects/{projectId}/reports: the list, one report, and its export. Only the project's own (internal) people with read access may call them.
    /// Called once at startup from PlatformSetup.
    /// </summary>
    public static void MapReportEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}/reports").WithTags("Reports")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>()
            // Our own people read every report; another organization reads its own deliveries against plan.
            .AddEndpointFilter(async (context, next) =>
            {
                var access = ProjectAccessFilter.Of(context.HttpContext);
                var id = context.HttpContext.GetRouteValue("reportId") as string;
                return access.Holds(Verbs.Read) && (access.IsInternal || id is null || ReportIds.Outside.Contains(id))
                    ? await next(context)
                    : Problems.Forbidden("REPORTS_NOT_ALLOWED", "This report is read by the project's own people.");
            });
        project.MapGet("", (HttpContext http) => Results.Ok((ProjectAccessFilter.Of(http).IsInternal ? ReportIds.All : ReportIds.Outside)
            .Select(id => new { id, title = Catalogue[id].Title, question = Catalogue[id].Question })));
        project.MapGet("/{reportId}", ReportAsync);
        project.MapGet("/{reportId}/export", ExportAsync);
    }

    /// <summary>GET /reports/{reportId}: counts one report now and returns it. The optional numbers override the report's default windows; <paramref name="q"/> filters the rows by text.</summary>
    private static async Task<IResult> ReportAsync(
        string reportId, HttpContext http, ReportBuilder builder, ReadDatabase reads, CancellationToken cancellationToken, string? q = null,
        int? horizonDays = null, int? months = null, int? warnDays = null, int? lateDays = null, int? turnaroundDays = null, int? onTimeTarget = null,
        string? on = null, string? bar = null, string? by = null, int? weeks = null)
    {
        if (Day(on) is { Problem: { } bad }) return bad;
        var (report, problem) = await BuildAsync(reportId, http, builder, reads, q, bar,
            Options(http, horizonDays, months, warnDays, lateDays, turnaroundDays, onTimeTarget, Day(on).Date, by, weeks), cancellationToken);
        return problem ?? Results.Ok(report);
    }

    /// <summary>The report's list as a file, headed with what it is and when it was counted.</summary>
    private static async Task<IResult> ExportAsync(
        string reportId, HttpContext http, ReportBuilder builder, ReadDatabase reads, CancellationToken cancellationToken, string format = "csv", string? q = null,
        int? horizonDays = null, int? months = null, int? warnDays = null, int? lateDays = null, int? turnaroundDays = null, int? onTimeTarget = null,
        string? on = null, string? bar = null, string? by = null, int? weeks = null)
    {
        if (format is not ("csv" or "xlsx")) return Problems.Invalid("FORMAT_INVALID", "csv or xlsx.");
        if (Day(on) is { Problem: { } bad }) return bad;
        var (report, problem) = await BuildAsync(reportId, http, builder, reads, q, bar,
            Options(http, horizonDays, months, warnDays, lateDays, turnaroundDays, onTimeTarget, Day(on).Date, by, weeks), cancellationToken);
        if (problem is not null) return problem;
        var project = ProjectAccessFilter.Of(http).Project;
        var heading = $"{report!.Title}, {project.Code}, counted {report.CountedAt:yyyy-MM-dd HH:mm} UTC";
        var name = $"{project.Code}-{report.Id}-{report.CountedAt:yyyy-MM-dd}";
        return format == "csv"
            ? Results.File(Csv(heading, report), "text/csv; charset=utf-8", $"{name}.csv")
            : Results.File(Excel(heading, report), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"{name}.xlsx");
    }

    /// <summary>
    /// Builds the report options from the query string, using the default for each value not given. Another
    /// organization's reader is always narrowed to its own documents.
    /// </summary>
    private static ReportOptions Options(HttpContext http, int? horizonDays, int? months, int? warnDays, int? lateDays, int? turnaroundDays,
        int? onTimeTarget, NodaTime.LocalDate? on, string? by, int? weeks)
    {
        var d = new ReportOptions();
        var access = ProjectAccessFilter.Of(http);
        return new ReportOptions(horizonDays ?? d.HorizonDays, months ?? d.Months, warnDays ?? d.WarnDays, lateDays ?? d.LateDays,
            turnaroundDays ?? d.TurnaroundDays, onTimeTarget ?? d.OnTimeTarget, on, access.IsInternal ? null : access.PartyCode ?? "\u0000",
            string.IsNullOrWhiteSpace(by) ? d.By : by.Trim().ToLowerInvariant(), weeks ?? d.Weeks);
    }

    /// <summary>The day asked for (yyyy-MM-dd), or the refusal when it is not a day, or still to come.</summary>
    private static (NodaTime.LocalDate? Date, IResult? Problem) Day(string? on)
    {
        if (string.IsNullOrWhiteSpace(on)) return (null, null);
        var parsed = NodaTime.Text.LocalDatePattern.Iso.Parse(on.Trim());
        if (!parsed.Success) return (null, Problems.Invalid("DATE_INVALID", $"\"{on}\" is not a day: write it as YYYY-MM-DD."));
        if (parsed.Value > NodaTime.SystemClock.Instance.GetCurrentInstant().InUtc().Date.PlusDays(1))
            return (null, Problems.Invalid("DATE_TO_COME", "That day is still to come: choose today or a day before."));
        return (parsed.Value, null);
    }

    /// <summary>
    /// Checks the report id and options, builds the report on the read database, and keeps only the rows containing the search text, if any.
    /// Returns either the report or the error answer to send back. Shared by <see cref="ReportAsync"/> and <see cref="ExportAsync"/>.
    /// </summary>
    private static async Task<(Report? Report, IResult? Problem)> BuildAsync(
        string reportId, HttpContext http, ReportBuilder builder, ReadDatabase reads, string? q, string? bar, ReportOptions options,
        CancellationToken cancellationToken)
    {
        if (!ReportIds.All.Contains(reportId)) return (null, Problems.NotFound("REPORT_NOT_FOUND", "No such report."));
        if (options.Invalid() is { } invalid) return (null, Problems.Invalid("REPORT_OPTIONS_INVALID", invalid));
        // Reports are heavy reads: on the replica when there is one.
        var project = ProjectAccessFilter.Of(http).Project;
        var report = await reads.ReadAsync(db => builder.BuildAsync(db, project, reportId, options, cancellationToken), cancellationToken);
        // A bar chosen keeps its own rows; words typed keep the rows that hold them. Both narrow the list and the download.
        var needle = q?.Trim();
        var keep = report.Rows.Select((row, i) => (Row: row, Bar: report.RowBars?[i]))
            .Where(x => string.IsNullOrEmpty(bar) || x.Bar == bar)
            .Where(x => string.IsNullOrEmpty(needle) || x.Row.Any(c => c.Text.Contains(needle, StringComparison.OrdinalIgnoreCase)))
            .ToList();
        return (report with { Rows = [.. keep.Select(x => x.Row)], RowBars = [.. keep.Select(x => x.Bar)] }, null);
    }

    /// <summary>Writes the report's list as a UTF-8 CSV file: a heading line, the column names, then the rows.</summary>
    internal static byte[] Csv(string heading, Report report)
    {
        static string Field(string text) =>
            text.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{text.Replace("\"", "\"\"")}\"" : text;
        // Formulas are not run from a downloaded list: a cell starting with = + - @ is kept as text.
        static string Safe(string text) => text.Length > 0 && "=+-@".Contains(text[0]) ? "'" + text : text;
        var csv = new StringBuilder();
        csv.AppendLine(Field(heading));
        csv.AppendLine(string.Join(',', report.Columns.Select(Field)));
        foreach (var row in report.Rows) csv.AppendLine(string.Join(',', row.Select(c => Field(Safe(c.Text)))));
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(csv.ToString())];
    }

    /// <summary>Writes the report's list as an Excel workbook: the heading in row 1, column names in row 3 (frozen), then the rows.</summary>
    internal static byte[] Excel(string heading, Report report)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.AddWorksheet(report.Title.Length > 31 ? report.Title[..31] : report.Title);
        sheet.Cell(1, 1).Value = heading;
        sheet.Cell(1, 1).Style.Font.Bold = true;
        for (var c = 0; c < report.Columns.Count; c++)
        {
            sheet.Cell(3, c + 1).Value = report.Columns[c];
            sheet.Cell(3, c + 1).Style.Font.Bold = true;
        }
        for (var r = 0; r < report.Rows.Count; r++)
        {
            for (var c = 0; c < report.Rows[r].Count; c++) sheet.Cell(r + 4, c + 1).SetValue(report.Rows[r][c].Text);
        }
        sheet.SheetView.FreezeRows(3);
        sheet.Columns().AdjustToContents(3, Math.Min(report.Rows.Count + 3, 200));
        using var output = new MemoryStream();
        workbook.SaveAs(output);
        return output.ToArray();
    }
}
