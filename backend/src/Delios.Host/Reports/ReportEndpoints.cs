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
    private static readonly Dictionary<string, (string Title, string Question)> Catalogue = new()
    {
        [ReportIds.Register] = ("Register status", "Where does every document stand?"),
        [ReportIds.Deliveries] = ("Deliveries against plan", "Who is delivering on time, and what is overdue?"),
        [ReportIds.Reviews] = ("Reviews waiting", "What is with reviewers, and for how long?"),
        [ReportIds.Transmittals] = ("Transmittal log", "What went out and came in, and what is still waiting?"),
        [ReportIds.Readiness] = ("Activity readiness", "Are the coming activities covered by their documents?"),
    };

    public static void MapReportEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}/reports").WithTags("Reports")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>()
            .AddEndpointFilter(async (context, next) => ProjectAccessFilter.Of(context.HttpContext) is { IsInternal: true } access
                && access.Holds(Verbs.Read)
                ? await next(context)
                : Problems.Forbidden("REPORTS_NOT_ALLOWED", "Reports are read by the project's own people."));
        project.MapGet("", () => Results.Ok(ReportIds.All.Select(id => new { id, title = Catalogue[id].Title, question = Catalogue[id].Question })));
        project.MapGet("/{reportId}", ReportAsync);
        project.MapGet("/{reportId}/export", ExportAsync);
    }

    private static async Task<IResult> ReportAsync(
        string reportId, HttpContext http, ReportBuilder builder, ReadDatabase reads, CancellationToken cancellationToken, string? q = null,
        int? horizonDays = null, int? months = null, int? warnDays = null, int? lateDays = null, int? turnaroundDays = null, int? onTimeTarget = null)
    {
        var (report, problem) = await BuildAsync(reportId, http, builder, reads, q,
            Options(horizonDays, months, warnDays, lateDays, turnaroundDays, onTimeTarget), cancellationToken);
        return problem ?? Results.Ok(report);
    }

    /// <summary>The report's list as a file, headed with what it is and when it was counted.</summary>
    private static async Task<IResult> ExportAsync(
        string reportId, HttpContext http, ReportBuilder builder, ReadDatabase reads, CancellationToken cancellationToken, string format = "csv", string? q = null,
        int? horizonDays = null, int? months = null, int? warnDays = null, int? lateDays = null, int? turnaroundDays = null, int? onTimeTarget = null)
    {
        if (format is not ("csv" or "xlsx")) return Problems.Invalid("FORMAT_INVALID", "csv or xlsx.");
        var (report, problem) = await BuildAsync(reportId, http, builder, reads, q,
            Options(horizonDays, months, warnDays, lateDays, turnaroundDays, onTimeTarget), cancellationToken);
        if (problem is not null) return problem;
        var project = ProjectAccessFilter.Of(http).Project;
        var heading = $"{report!.Title}, {project.Code}, counted {report.CountedAt:yyyy-MM-dd HH:mm} UTC";
        var name = $"{project.Code}-{report.Id}-{report.CountedAt:yyyy-MM-dd}";
        return format == "csv"
            ? Results.File(Csv(heading, report), "text/csv; charset=utf-8", $"{name}.csv")
            : Results.File(Excel(heading, report), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"{name}.xlsx");
    }

    private static ReportOptions Options(int? horizonDays, int? months, int? warnDays, int? lateDays, int? turnaroundDays, int? onTimeTarget)
    {
        var d = new ReportOptions();
        return new ReportOptions(horizonDays ?? d.HorizonDays, months ?? d.Months, warnDays ?? d.WarnDays, lateDays ?? d.LateDays,
            turnaroundDays ?? d.TurnaroundDays, onTimeTarget ?? d.OnTimeTarget);
    }

    private static async Task<(Report? Report, IResult? Problem)> BuildAsync(
        string reportId, HttpContext http, ReportBuilder builder, ReadDatabase reads, string? q, ReportOptions options, CancellationToken cancellationToken)
    {
        if (!ReportIds.All.Contains(reportId)) return (null, Problems.NotFound("REPORT_NOT_FOUND", "No such report."));
        if (options.Invalid() is { } invalid) return (null, Problems.Invalid("REPORT_OPTIONS_INVALID", invalid));
        // Reports are heavy reads: on the replica when there is one.
        var project = ProjectAccessFilter.Of(http).Project;
        var report = await reads.ReadAsync(db => builder.BuildAsync(db, project, reportId, options, cancellationToken), cancellationToken);
        var needle = q?.Trim();
        return (string.IsNullOrEmpty(needle) ? report
            : report with { Rows = [.. report.Rows.Where(r => r.Any(c => c.Text.Contains(needle, StringComparison.OrdinalIgnoreCase)))] }, null);
    }

    private static byte[] Csv(string heading, Report report)
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

    private static byte[] Excel(string heading, Report report)
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
