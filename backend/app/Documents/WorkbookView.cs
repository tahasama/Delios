using ClosedXML.Excel;

namespace Delios.Host.Documents;

/// <summary>
/// An Excel workbook read for the screen (owner: "excel (can it do workbooks too?)"): every sheet, in its order, as the
/// text each cell shows (its last calculated value, as Excel formats it: formulas are not recalculated), with bold, the
/// cells merged, the columns' widths and numbers set right. Nothing in it runs: macros are never read, links never
/// followed. Read within limits so a huge or hostile file costs nothing: the file's size, what it unpacks to, and the
/// first rows and columns of each sheet (said when cut).
/// </summary>
public static class WorkbookView
{
    public const int MaxBytes = SheetGuard.MaxBytes;
    private const int MaxSheets = 30;
    private const int MaxRows = 2000;
    private const int MaxColumns = 100;

    public sealed record Cell(string V, bool B, bool N);
    public sealed record Merge(int Row, int Column, int Rows, int Columns);
    public sealed record Sheet(string Name, bool Hidden, int Rows, int Columns, bool Cut, double[] Widths, Cell?[][] Cells, Merge[] Merges);
    public sealed record Book(Sheet[] Sheets, int SheetCount);

    public static bool CanShow(string fileName) =>
        fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) || fileName.EndsWith(".xlsm", StringComparison.OrdinalIgnoreCase) || IsCsv(fileName);

    private static bool IsCsv(string fileName) => fileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase);

    /// <summary>A CSV file shown as one sheet (owner: "i uploaded a csv file didnt preview it"): its cells as text, nothing in it run.</summary>
    public static Book ReadCsv(Stream content, string fileName)
    {
        var rows = Actions.ScheduleReader.ReadCsv(content);
        int lastRow = rows.Count, lastColumn = rows.Count == 0 ? 0 : rows.Max(r => r.Length);
        int shownRows = Math.Min(lastRow, MaxRows), shownColumns = Math.Min(lastColumn, MaxColumns);
        var cells = rows.Take(shownRows).Select(r => Enumerable.Range(0, shownColumns)
            .Select(c => c < r.Length && r[c].Length > 0
                ? new Cell(r[c].Length > 2000 ? r[c][..2000] + "…" : r[c], false, double.TryParse(r[c], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out _))
                : null).ToArray()).ToArray();
        // Each column as wide as its longest cell shown, within Excel's own bounds.
        var widths = Enumerable.Range(0, shownColumns)
            .Select(c => (double)Math.Clamp(cells.Max(r => r[c]?.V.Length ?? 0) + 2, 8, 60)).ToArray();
        var name = Path.GetFileNameWithoutExtension(fileName);
        return new Book([new Sheet(name, false, lastRow, lastColumn, lastRow > shownRows || lastColumn > shownColumns, widths, cells, [])], 1);
    }

    /// <summary>The workbook, or why it cannot be shown.</summary>
    public static async Task<(Book? Book, string? Problem)> ReadAsync(Stream content, CancellationToken cancellationToken)
    {
        using var copy = new MemoryStream();
        await content.CopyToAsync(copy, cancellationToken);
        var bytes = copy.ToArray();
        // Its size unpacked and its parts, before anything opens it (a macro is shown as a cell's text, never run).
        if (SheetGuard.WorkbookProblem(bytes, macrosAllowed: true) is { } problem) return (null, problem);
        try
        {
            copy.Position = 0;
            using var workbook = new XLWorkbook(copy);
            var sheets = new List<Sheet>();
            foreach (var sheet in workbook.Worksheets.Take(MaxSheets))
            {
                cancellationToken.ThrowIfCancellationRequested();
                sheets.Add(Read(sheet));
            }
            return (new Book([.. sheets], workbook.Worksheets.Count), null);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return (null, "The workbook could not be opened.");
        }
    }

    private static Sheet Read(IXLWorksheet sheet)
    {
        var hidden = sheet.Visibility != XLWorksheetVisibility.Visible;
        var used = sheet.RangeUsed(XLCellsUsedOptions.Contents | XLCellsUsedOptions.MergedRanges);
        if (used is null) return new Sheet(sheet.Name, hidden, 0, 0, false, [], [], []);
        // From A1, as the sheet reads, to the last cell used.
        int lastRow = used.LastRow().RowNumber(), lastColumn = used.LastColumn().ColumnNumber();
        int rows = Math.Min(lastRow, MaxRows), columns = Math.Min(lastColumn, MaxColumns);
        var cells = Enumerable.Range(0, rows).Select(_ => new Cell?[columns]).ToArray();
        // Only the cells that hold something are walked.
        foreach (var cell in sheet.CellsUsed(XLCellsUsedOptions.Contents))
        {
            int r = cell.Address.RowNumber, c = cell.Address.ColumnNumber;
            if (r > rows || c > columns) continue;
            string text;
            try { text = cell.GetFormattedString(); }
            catch (Exception) { text = cell.CachedValue.ToString() ?? ""; }
            if (text.Length > 2000) text = text[..2000] + "…";
            cells[r - 1][c - 1] = new Cell(text, cell.Style.Font.Bold, cell.DataType is XLDataType.Number or XLDataType.DateTime or XLDataType.TimeSpan);
        }
        var widths = Enumerable.Range(1, columns).Select(c => Math.Round(sheet.Column(c).Width, 1)).ToArray();
        var merges = sheet.MergedRanges
            .Select(m => new Merge(m.FirstRow().RowNumber(), m.FirstColumn().ColumnNumber(), m.RowCount(), m.ColumnCount()))
            .Where(m => m.Row <= rows && m.Column <= columns)
            .Select(m => m with { Rows = Math.Min(m.Rows, rows - m.Row + 1), Columns = Math.Min(m.Columns, columns - m.Column + 1) })
            .ToArray();
        return new Sheet(sheet.Name, hidden, lastRow, lastColumn, lastRow > rows || lastColumn > columns, widths, cells, merges);
    }
}
