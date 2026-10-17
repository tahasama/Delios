using System.Text.Json;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

/// <summary>The tenant's published values, read once per request.</summary>
public sealed class Catalog
{
    /// <summary>The values by set key, then by code.</summary>
    private readonly Dictionary<string, Dictionary<string, ValueEntry>> _sets;

    /// <summary>The sets of each list (a list holds one or more; each serves the deliverable types it names).</summary>
    private readonly Dictionary<string, List<ValueSet>> _listSets;

    /// <summary>Groups the loaded values by set and by code for quick look-ups.</summary>
    private Catalog(IEnumerable<ValueEntry> values, IEnumerable<ValueSet> sets)
    {
        _sets = values.GroupBy(v => v.SetKey)
            .ToDictionary(g => g.Key, g => g.ToDictionary(v => v.Code, StringComparer.Ordinal));
        _listSets = sets.GroupBy(s => s.ListKey).ToDictionary(g => g.Key, g => g.ToList());
    }

    /// <summary>Reads every value of the current tenant from the database. Called by <see cref="DocumentService"/> when it needs the lists.</summary>
    public static async Task<Catalog> LoadAsync(DeliosDbContext db, CancellationToken cancellationToken) =>
        new(await db.ValueEntries.AsNoTracking().ToListAsync(cancellationToken), await db.ListSets.AsNoTracking().ToListAsync(cancellationToken));

    /// <summary>
    /// True when the value is active and in the set of its list that serves this deliverable type (`ListRules.Serving`):
    /// a list with one set offers it for every type. Without a type, any active value.
    /// </summary>
    public bool IsOfferedFor(string setKey, string code, string? deliverableType) =>
        IsActive(setKey, code) && (deliverableType is null || ServedBy(setKey, _sets[setKey][code], deliverableType));

    /// <summary>Whether a value is in the set serving a deliverable type; a value with no set is the default set's.</summary>
    private bool ServedBy(string setKey, ValueEntry value, string deliverableType)
    {
        if (!_listSets.TryGetValue(setKey, out var sets) || sets.Count <= 1) return true;
        var serving = ListRules.Serving(sets, deliverableType);
        return serving is not null && (value.SetId ?? sets.FirstOrDefault(s => s.IsDefault)?.Id) == serving.Id;
    }

    /// <summary>The active values offered for a deliverable type (all active ones without a type), in order.</summary>
    private IEnumerable<ValueEntry> Offered(string setKey, string? deliverableType) =>
        _sets.TryGetValue(setKey, out var set)
            ? set.Values.Where(v => v.Status == ValueStatus.Active && (deliverableType is null || ServedBy(setKey, v, deliverableType))).OrderBy(v => v.Sort)
            : [];

    /// <summary>True when the code is in the set and still active (not retired).</summary>
    public bool IsActive(string setKey, string code) =>
        _sets.TryGetValue(setKey, out var set) && set.TryGetValue(code, out var v) && v.Status == ValueStatus.Active;

    /// <summary>The set's active values, in their published order: code and label.</summary>
    public IReadOnlyList<(string Code, string Label)> Active(string setKey) =>
        _sets.TryGetValue(setKey, out var set)
            ? set.Values.Where(v => v.Status == ValueStatus.Active).OrderBy(v => v.Sort).Select(v => (v.Code, v.Label)).ToList()
            : [];

    /// <summary>One property of a value's <c>Props</c> JSON, or null when the value or the property does not exist.</summary>
    public JsonElement? Prop(string setKey, string code, string prop) =>
        _sets.TryGetValue(setKey, out var set) && set.TryGetValue(code, out var v)
            && (v.Props?.RootElement.TryGetProperty(prop, out var value) == true
                || (OldNames.TryGetValue(prop, out var old) && v.Props?.RootElement.TryGetProperty(old, out value) == true))
            ? value
            : null;

    /// <summary>The names Settings once saved two properties under, still read where a value was saved so.</summary>
    private static readonly Dictionary<string, string> OldNames = new() { ["executes"] = "executionFlag", ["responseDays"] = "responsePeriodDays" };

    /// <summary>
    /// The active value a person or a file names, by its code or its label, ignoring
    /// case: "EL", "el" and "Electrical" all find EL. Null when nothing matches.
    /// </summary>
    public string? Find(string setKey, string? text)
    {
        var wanted = text?.Trim();
        if (string.IsNullOrEmpty(wanted) || !_sets.TryGetValue(setKey, out var set)) return null;
        var active = set.Values.Where(v => v.Status == ValueStatus.Active).OrderBy(v => v.Sort).ToList();
        return (active.FirstOrDefault(v => v.Code.Equals(wanted, StringComparison.OrdinalIgnoreCase))
            ?? active.FirstOrDefault(v => v.Label.Equals(wanted, StringComparison.OrdinalIgnoreCase)))?.Code;
    }

    /// <summary>What people read for a code: its label, or the code itself when it is not in the list.</summary>
    public string Label(string setKey, string code) =>
        _sets.TryGetValue(setKey, out var set) && set.TryGetValue(code, out var v) ? v.Label : code;

    /// <summary>The first active value whose string property equals the one given.</summary>
    /// <summary>The first active code of a set whose property is this true/false value; null when none.</summary>
    public string? CodeWhere(string setKey, string prop, bool value) =>
        _sets.TryGetValue(setKey, out var set)
            ? set.Values.Where(v => v.Status == ValueStatus.Active).OrderBy(v => v.Sort)
                .FirstOrDefault(v => v.Props?.RootElement.TryGetProperty(prop, out var p) == true
                    && p.ValueKind == (value ? JsonValueKind.True : JsonValueKind.False))?.Code
            : null;

    public string? CodeWhere(string setKey, string prop, string value) =>
        _sets.TryGetValue(setKey, out var set)
            ? set.Values.Where(v => v.Status == ValueStatus.Active).OrderBy(v => v.Sort)
                .FirstOrDefault(v => v.Props?.RootElement.TryGetProperty(prop, out var p) == true
                    && p.ValueKind == JsonValueKind.String && p.GetString() == value)?.Code
            : null;

    /// <summary>Every active value, in order, whose string property equals the one given.</summary>
    public IReadOnlyList<string> CodesWhere(string setKey, string prop, string value) =>
        _sets.TryGetValue(setKey, out var set)
            ? set.Values.Where(v => v.Status == ValueStatus.Active).OrderBy(v => v.Sort)
                .Where(v => v.Props?.RootElement.TryGetProperty(prop, out var p) == true
                    && p.ValueKind == JsonValueKind.String && p.GetString() == value).Select(v => v.Code).ToList()
            : [];

    /// <summary>The active value flagged <c>"default": true</c>, among those offered for the deliverable type when one is given.</summary>
    public string? DefaultOf(string setKey, string? deliverableType = null) =>
        Offered(setKey, deliverableType).FirstOrDefault(v => v.Props?.RootElement.TryGetProperty("default", out var d) == true
            && d.ValueKind == JsonValueKind.True)?.Code;

    /// <summary>
    /// The first active value in the published order, among those offered for the deliverable type when one is given: for
    /// confidentiality, the lowest level (ranks follow that order).
    /// </summary>
    public string? LowestOf(string setKey, string? deliverableType = null) => Offered(setKey, deliverableType).FirstOrDefault()?.Code;

    /// <summary>The organization's words that, alone, make a title generic.</summary>
    public IReadOnlySet<string> GenericTitleWords() =>
        _sets.TryGetValue(ValueSets.GenericTitleWords, out var set)
            ? set.Values.Where(v => v.Status == ValueStatus.Active).Select(v => v.Code.ToLowerInvariant()).ToHashSet()
            : new HashSet<string>();

    /// <summary>Confidentiality levels read only by the people named on the document.</summary>
    public IReadOnlyList<string> RestrictedLevels() =>
        _sets.TryGetValue(ValueSets.Confidentiality, out var set)
            ? set.Values.Where(v => v.Props?.RootElement.TryGetProperty("restricted", out var r) == true
                && r.ValueKind == JsonValueKind.True).Select(v => v.Code).ToList()
            : [];

    /// <summary>
    /// The retention class a document gets when none is chosen: the one its
    /// criticality maps to, else the default class.
    /// </summary>
    public string? RetentionFor(string? criticality, string? deliverableType = null)
    {
        if (criticality is not null
            && Prop(ValueSets.Criticality, criticality, "retention") is { ValueKind: JsonValueKind.String } mapped
            && IsOfferedFor(ValueSets.RetentionClasses, mapped.GetString()!, deliverableType))
        {
            return mapped.GetString();
        }
        return DefaultOf(ValueSets.RetentionClasses, deliverableType);
    }

    /// <summary>Fields a deliverable type requires, from its <c>"required"</c> list.</summary>
    public IReadOnlyList<string> RequiredFieldsOf(string deliverableType) =>
        Prop(ValueSets.DeliverableTypes, deliverableType, "required") is { ValueKind: JsonValueKind.Array } list
            ? list.EnumerateArray().Select(e => e.GetString()!).ToList()
            : [];
}
