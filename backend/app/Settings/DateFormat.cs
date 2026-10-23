namespace Delios.Host.Settings;

/// <summary>
/// How dates read on every screen of the organization (owner): one choice, the organization's, the same on every project.
/// Each answer carries it to the screens (header <c>X-Delios-Date-Format</c>), which draw every date with it. Nothing
/// chosen: "05 Mar 2026".
/// </summary>
public static class DateFormat
{
    public const string Key = "DATE_FORMAT";
    public const string Header = "X-Delios-Date-Format";
    public const string Default = "DMY_SHORT";

    /// <summary>05 Mar 2026 · 05/03/2026 · 03/05/2026 · 2026-03-05.</summary>
    public static readonly string[] Codes = [Default, "DMY", "MDY", "ISO"];
}
