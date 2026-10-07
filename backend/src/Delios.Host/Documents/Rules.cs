using System.Globalization;

namespace Delios.Host.Documents;

public static class Titles
{
    /// <summary>
    /// A title is generic when, once trimmed and singular, it is only one of the
    /// organization's generic words. Which words count is the organization's list.
    /// </summary>
    public static bool IsGeneric(string title, IReadOnlySet<string> genericWords)
    {
        var words = title.Trim().ToLowerInvariant();
        if (words.EndsWith('s')) words = words[..^1];
        return words.Length == 0 || genericWords.Contains(words);
    }
}

public abstract record NextValue
{
    public sealed record Value(string Text) : NextValue;
    public sealed record UnknownSeries(string Series) : NextValue;
    public sealed record Backwards(string From, string To) : NextValue;
}

/// <summary>
/// Works out the next revision value from the organization's revision scheme.
/// A value is never used twice on one document, whatever its series.
/// </summary>
public static class RevisionValues
{
    /// <param name="existing">The document's revisions so far, oldest first: their series and value.</param>
    /// <param name="series">The series asked for, or null to continue the latest one (or start the first).</param>
    public static NextValue Next(RevisionScheme scheme, IReadOnlyList<(string Series, string Value)> existing, string? series)
    {
        var latest = existing.Count > 0 ? existing[^1] : default((string Series, string Value)?);
        var code = series ?? latest?.Series ?? scheme.Series[0].Code;
        var index = scheme.Series.FindIndex(s => s.Code == code);
        if (index < 0) return new NextValue.UnknownSeries(code);

        if (scheme.ForwardOnly && latest is { } last)
        {
            var lastIndex = scheme.Series.FindIndex(s => s.Code == last.Series);
            if (lastIndex > index) return new NextValue.Backwards(last.Series, code);
        }

        var rule = scheme.Series[index];
        var used = existing.Select(e => e.Value.ToUpperInvariant()).ToHashSet();
        // Continue after the highest value already in this series; start at the start otherwise.
        var position = existing.Where(e => e.Series == code)
            .Select(e => Position(rule, e.Value)).Where(p => p >= 0).DefaultIfEmpty(-1).Max();
        position = position < 0 ? Position(rule, rule.Prefix + rule.Start) : position + 1;

        for (; ; position++)
        {
            var candidate = Format(rule, position);
            if (candidate is not null && !used.Contains(candidate.ToUpperInvariant())) return new NextValue.Value(candidate);
        }
    }

    /// <summary>Checks a series can produce values at all; null when it can.</summary>
    public static string? Problem(RevisionSeriesRule rule)
    {
        if (rule.Kind is not (SeriesKinds.Letters or SeriesKinds.Numbers)) return $"{rule.Code}: kind must be LETTERS or NUMBERS.";
        if (Position(rule, rule.Prefix + rule.Start) < 0) return $"{rule.Code}: '{rule.Start}' is not a valid start for {rule.Kind}.";
        if (rule.Kind == SeriesKinds.Letters && rule.ExcludedLetters.Length >= 26) return $"{rule.Code}: every letter is excluded.";
        return null;
    }

    /// <summary>The value at a position of the series, or null when it uses an excluded letter.</summary>
    private static string? Format(RevisionSeriesRule rule, long position)
    {
        if (rule.Kind == SeriesKinds.Numbers)
        {
            return rule.Prefix + position.ToString(CultureInfo.InvariantCulture).PadLeft(rule.Width, '0');
        }
        var letters = Letters(position);
        if (letters.Any(c => rule.ExcludedLetters.Contains(c.ToString(), StringComparer.OrdinalIgnoreCase))) return null;
        return rule.Prefix + (rule.Lowercase ? letters.ToLowerInvariant() : letters);
    }

    /// <summary>Where a value sits in the series, or -1 when it is not one of the series' values.</summary>
    private static long Position(RevisionSeriesRule rule, string value)
    {
        if (!value.StartsWith(rule.Prefix, StringComparison.OrdinalIgnoreCase)) return -1;
        var body = value[rule.Prefix.Length..];
        if (body.Length == 0) return -1;
        if (rule.Kind == SeriesKinds.Numbers)
        {
            return body.All(char.IsAsciiDigit) && long.TryParse(body, CultureInfo.InvariantCulture, out var n) ? n : -1;
        }
        if (!body.All(char.IsAsciiLetter)) return -1;
        long position = 0;
        foreach (var c in body.ToUpperInvariant()) position = position * 26 + (c - 'A' + 1);
        return position - 1;
    }

    /// <summary>0 is A, 25 is Z, 26 is AA.</summary>
    private static string Letters(long n)
    {
        var s = "";
        for (n += 1; n > 0; n = (n - 1) / 26)
        {
            s = (char)('A' + ((n - 1) % 26)) + s;
        }
        return s;
    }
}
