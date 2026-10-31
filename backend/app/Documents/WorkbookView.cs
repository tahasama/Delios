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
        fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) || fileName.EndsWith(".xlsm", StringComparison.OrdinalIgnoreCase) || IsCsv(fileName) || fileName.EndsWith(".xls", StringComparison.OrdinalIgnoreCase);

    private static bool IsCsv(string fileName) => fileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// An old Excel workbook (.xls, before 2007) read for the screen (owner: "xls"): every sheet as the values its cells
    /// hold (no formatting, no bold or merges: the old format is read for its values only). Nothing in it runs.
    /// </summary>
    public static (Book? Book, string? Problem) ReadXls(Stream content)
    {
        System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
        try
        {
            using var copy = new MemoryStream();
            content.CopyTo(copy);
            copy.Position = 0;
            using var reader = ExcelDataReader.ExcelReaderFactory.CreateBinaryReader(copy);
            var sheets = new List<Sheet>();
            var count = 0;
            do
            {
                count++;
                if (sheets.Count >= MaxSheets) continue;
                var rows = new List<string?[]>();
                var lastRow = 0;
                var lastColumn = 0;
                while (reader.Read())
                {
                    lastRow++;
                    lastColumn = Math.Max(lastColumn, reader.FieldCount);
                    if (rows.Count >= MaxRows) continue;
                    var row = new string?[Math.Min(reader.FieldCount, MaxColumns)];
                    for (var c = 0; c < row.Length; c++)
                    {
                        var value = reader.GetValue(c);
                        row[c] = value switch
                        {
                            null => null,
                            DateTime d => d.TimeOfDay == TimeSpan.Zero ? d.ToString("dd MMM yyyy", System.Globalization.CultureInfo.InvariantCulture) : d.ToString("dd MMM yyyy HH:mm", System.Globalization.CultureInfo.InvariantCulture),
                            double n => n.ToString(System.Globalization.CultureInfo.InvariantCulture),
                            _ => value.ToString(),
                        };
                    }
                    rows.Add(row);
                }
                // From A1 to the last cell holding something.
                while (rows.Count > 0 && rows[^1].All(string.IsNullOrEmpty)) rows.RemoveAt(rows.Count - 1);
                var columns = rows.Count == 0 ? 0 : Math.Min(MaxColumns, rows.Max(r => Array.FindLastIndex(r, v => !string.IsNullOrEmpty(v)) + 1));
                var cells = rows.Select(r => Enumerable.Range(0, columns).Select(c => c < r.Length && !string.IsNullOrEmpty(r[c])
                    ? new Cell(r[c]!.Length > 2000 ? r[c]![..2000] + "…" : r[c]!, false, double.TryParse(r[c], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out _))
                    : null).ToArray()).ToArray();
                var widths = Enumerable.Range(0, columns).Select(c => (double)Math.Clamp(cells.Max(r => r[c]?.V.Length ?? 0) + 2, 8, 60)).ToArray();
                var hidden = !string.Equals(reader.VisibleState, "visible", StringComparison.OrdinalIgnoreCase);
                sheets.Add(new Sheet(reader.Name, hidden, lastRow, lastColumn, lastRow > MaxRows || lastColumn > MaxColumns, widths, cells, []));
            } while (reader.NextResult());
            return (new Book([.. sheets], count), null);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return (null, "The old Excel workbook could not be opened (it may be damaged or protected by a password).");
        }
    }

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
