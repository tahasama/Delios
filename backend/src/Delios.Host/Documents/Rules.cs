namespace Delios.Host.Documents;

public static class Titles
{
    /// <summary>Titles that only repeat the document type say nothing about which document it is.</summary>
    public static readonly IReadOnlySet<string> Generic = new HashSet<string>(StringComparer.Ordinal)
    {
        "report", "drawing", "layout", "document", "specification", "spec", "sketch", "plan", "note", "memo",
        "list", "schedule", "calculation", "datasheet", "procedure", "manual", "untitled", "test",
    };

    public static bool IsGeneric(string title)
    {
        var words = title.Trim().ToLowerInvariant();
        if (words.EndsWith('s')) words = words[..^1];
        return words.Length == 0 || Generic.Contains(words);
    }
}

public static class RevisionValues
{
    // Letters that read as digits or as each other on a drawing are never used.
    private static readonly HashSet<string> Excluded = ["I", "O", "Q", "S", "X", "Z"];

    /// <summary>
    /// The next revision value in a series. Design runs A, B, C… skipping the
    /// excluded letters, then AA, AB…; execution is numeric from its published start.
    /// A value already used is never used again.
    /// </summary>
    public static string Next(string series, IReadOnlyCollection<string> existing, int executionStart = 0)
    {
        var used = existing.Select(v => v.ToUpperInvariant()).ToHashSet();
        if (series == RevisionSeries.Execution)
        {
            var n = executionStart;
            while (used.Contains(n.ToString(System.Globalization.CultureInfo.InvariantCulture))) n++;
            return n.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        for (var n = existing.Count; ; n++)
        {
            var candidate = Letters(n);
            if (!Excluded.Contains(candidate) && !used.Contains(candidate)) return candidate;
        }
    }

    /// <summary>0 is A, 25 is Z, 26 is AA.</summary>
    private static string Letters(int n)
    {
        var s = "";
        for (n += 1; n > 0; n = (n - 1) / 26)
        {
            s = (char)('A' + ((n - 1) % 26)) + s;
        }
        return s;
    }
}
