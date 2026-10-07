namespace Delios.Host.Reports;

/// <summary>A headline number. Tone: good, warn or bad, when the number says something by itself.</summary>
public sealed record Figure(string Label, string Value, string? Tone = null);

/// <summary>One colour of the chart's stacked bars. Tone: good, info, warn, bad or muted.</summary>
public sealed record Segment(string Key, string Label, string Tone);

/// <summary>One bar: how many items of each segment it holds.</summary>
public sealed record Bar(string Label, Dictionary<string, int> Values)
{
    public void Add(string segment) => Values[segment] = Values.GetValueOrDefault(segment) + 1;
}

public sealed record Chart(string Title, IReadOnlyList<Segment> Segments, IReadOnlyList<Bar> Bars);

/// <summary>
/// One cell of the detail list. <see cref="Kind"/> and <see cref="Id"/> say what it
/// opens (a document, a review, a transmittal, an activity); the screen decides where.
/// </summary>
public sealed record Cell(string Text, string? Tone = null, string? Kind = null, Guid? Id = null)
{
    public static implicit operator Cell(string text) => new(text);
}

/// <summary>
/// A report answers one question with a few headline figures, one chart and the
/// list behind them, which is what the export carries. Counted from the register
/// each time it is opened: never stored, never stale.
/// </summary>
public sealed record Report(
    string Id, string Title, string Question, string Audience, IReadOnlyList<Figure> Figures, Chart Chart,
    IReadOnlyList<string> Columns, IReadOnlyList<IReadOnlyList<Cell>> Rows, string Empty, DateTimeOffset CountedAt);

/// <summary>The windows and limits a reader may change; the defaults are only a starting point.</summary>
/// <param name="HorizonDays">Readiness: how far ahead to look.</param>
/// <param name="Months">Transmittals: how many months back.</param>
/// <param name="WarnDays">Reviews: waiting this long is worth a word.</param>
/// <param name="LateDays">Reviews: waiting longer than this is a problem.</param>
/// <param name="TurnaroundDays">Reviews: the period the average turnaround is taken over.</param>
/// <param name="OnTimeTarget">Deliveries: the share delivered on time that counts as good, in percent.</param>
public sealed record ReportOptions(
    int HorizonDays = 30, int Months = 6, int WarnDays = 7, int LateDays = 14, int TurnaroundDays = 90, int OnTimeTarget = 80)
{
    public string? Invalid() =>
        HorizonDays is < 1 or > 366 ? "horizonDays is between 1 and 366."
        : Months is < 1 or > 36 ? "months is between 1 and 36."
        : WarnDays < 1 || LateDays < WarnDays || LateDays > 366 ? "warnDays is at least 1 and lateDays between warnDays and 366."
        : TurnaroundDays is < 1 or > 731 ? "turnaroundDays is between 1 and 731."
        : OnTimeTarget is < 0 or > 100 ? "onTimeTarget is a percentage."
        : null;
}

public static class ReportIds
{
    public const string Register = "register";
    public const string Deliveries = "deliveries";
    public const string Reviews = "reviews";
    public const string Transmittals = "transmittals";
    public const string Readiness = "readiness";

    public static readonly IReadOnlyList<string> All = [Register, Deliveries, Reviews, Transmittals, Readiness];
}
