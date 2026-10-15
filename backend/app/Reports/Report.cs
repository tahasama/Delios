namespace Delios.Host.Reports;

/// <summary>A headline number. Tone: good, warn or bad, when the number says something by itself.</summary>
public sealed record Figure(string Label, string Value, string? Tone = null);

/// <summary>One colour of the chart's stacked bars. Tone: good, info, warn, bad or muted.</summary>
public sealed record Segment(string Key, string Label, string Tone);

/// <summary>One bar: how many items of each segment it holds.</summary>
public sealed record Bar(string Label, Dictionary<string, int> Values)
{
    /// <summary>Adds one item to the given segment of this bar. Used by the report builder while it counts.</summary>
    public void Add(string segment) => Values[segment] = Values.GetValueOrDefault(segment) + 1;
}

/// <summary>The one stacked-bar chart a report shows: its title, its colours (segments) and its bars.</summary>
public sealed record Chart(string Title, IReadOnlyList<Segment> Segments, IReadOnlyList<Bar> Bars);

/// <summary>
/// One cell of the detail list. <see cref="Kind"/> and <see cref="Id"/> say what it
/// opens (a document, a review, a transmittal, an activity); the screen decides where.
/// </summary>
public sealed record Cell(string Text, string? Tone = null, string? Kind = null, Guid? Id = null)
{
    /// <summary>Lets plain text be used wherever a cell is expected, as a cell with no tone and no link.</summary>
    public static implicit operator Cell(string text) => new(text);
}

/// <summary>
/// A report answers one question with a few headline figures, one chart and the
/// list behind them, which is what the export carries. Counted from the register
/// each time it is opened: never stored, never stale.
/// </summary>
/// <remarks>
/// <see cref="RowBars"/> says, for each row, which bar of the chart it is counted in (the bar's label): a bar chosen
/// on the screen narrows the list and the download to its own rows.
/// </remarks>
public sealed record Report(
    string Id, string Title, string Question, string Audience, IReadOnlyList<Figure> Figures, Chart Chart,
    IReadOnlyList<string> Columns, IReadOnlyList<IReadOnlyList<Cell>> Rows, string Empty, DateTimeOffset CountedAt,
    IReadOnlyList<string?>? RowBars = null);

/// <summary>The windows and limits a reader may change; the defaults are only a starting point.</summary>
/// <param name="HorizonDays">Readiness: how far ahead to look.</param>
/// <param name="Months">Transmittals: how many months back.</param>
/// <param name="WarnDays">Reviews: waiting this long is worth a word.</param>
/// <param name="LateDays">Reviews: waiting longer than this is a problem.</param>
/// <param name="TurnaroundDays">Reviews: the period the average turnaround is taken over.</param>
/// <param name="OnTimeTarget">Deliveries: the share delivered on time that counts as good, in percent.</param>
/// <param name="On">Register on a date: the day the register is read as it stood (end of that day, project time).</param>
/// <param name="Party">Another organization reading: only its own documents are counted (Deliveries only).</param>
/// <param name="By">Deliveries: one bar per sender (each organization, and us as one) or per discipline (whoever sends).</param>
public sealed record ReportOptions(
    int HorizonDays = 30, int Months = 6, int WarnDays = 7, int LateDays = 14, int TurnaroundDays = 90, int OnTimeTarget = 80,
    NodaTime.LocalDate? On = null, string? Party = null, string By = "sender")
{
    /// <summary>Checks the options are in range. Returns a message saying what is wrong, or null when they are all valid. Called by the report endpoints before building.</summary>
    public string? Invalid() =>
        HorizonDays is < 1 or > 366 ? "horizonDays is between 1 and 366."
        : Months is < 1 or > 36 ? "months is between 1 and 36."
        : WarnDays < 1 || LateDays < WarnDays || LateDays > 366 ? "warnDays is at least 1 and lateDays between warnDays and 366."
        : TurnaroundDays is < 1 or > 731 ? "turnaroundDays is between 1 and 731."
        : OnTimeTarget is < 0 or > 100 ? "onTimeTarget is a percentage."
        : By is not ("sender" or "discipline") ? "by is sender or discipline."
        : null;
}

/// <summary>The ids of the reports, as used in the report URLs. <see cref="All"/> is the list the reports page shows, in order.</summary>
public static class ReportIds
{
    public const string Register = "register";
    public const string Deliveries = "deliveries";
    public const string Reviews = "reviews";
    public const string Transmittals = "transmittals";
    public const string Readiness = "readiness";
    /// <summary>The register as it stood at the end of a given day: which revision was current, and which is now.</summary>
    public const string AsOf = "asof";

    public static readonly IReadOnlyList<string> All = [Register, Deliveries, Reviews, Transmittals, Readiness, AsOf];
    /// <summary>What another organization's people may read: their own deliveries against plan.</summary>
    public static readonly IReadOnlyList<string> Outside = [Deliveries];
}
