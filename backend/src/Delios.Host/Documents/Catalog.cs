using System.Text.Json;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

/// <summary>The tenant's published values, read once per request.</summary>
public sealed class Catalog
{
    private readonly Dictionary<string, Dictionary<string, ValueEntry>> _sets;

    private Catalog(IEnumerable<ValueEntry> values) =>
        _sets = values.GroupBy(v => v.SetKey)
            .ToDictionary(g => g.Key, g => g.ToDictionary(v => v.Code, StringComparer.Ordinal));

    public static async Task<Catalog> LoadAsync(DeliosDbContext db, CancellationToken cancellationToken) =>
        new(await db.ValueEntries.AsNoTracking().ToListAsync(cancellationToken));

    public bool IsActive(string setKey, string code) =>
        _sets.TryGetValue(setKey, out var set) && set.TryGetValue(code, out var v) && v.Status == ValueStatus.Active;

    public JsonElement? Prop(string setKey, string code, string prop) =>
        _sets.TryGetValue(setKey, out var set) && set.TryGetValue(code, out var v)
            && v.Props?.RootElement.TryGetProperty(prop, out var value) == true
            ? value
            : null;

    /// <summary>The active value of a set flagged <c>"default": true</c>.</summary>
    public string? DefaultOf(string setKey) =>
        _sets.TryGetValue(setKey, out var set)
            ? set.Values.Where(v => v.Status == ValueStatus.Active)
                .FirstOrDefault(v => v.Props?.RootElement.TryGetProperty("default", out var d) == true
                    && d.ValueKind == JsonValueKind.True)?.Code
            : null;

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
    public string? RetentionFor(string? criticality)
    {
        if (criticality is not null
            && Prop(ValueSets.Criticality, criticality, "retention") is { ValueKind: JsonValueKind.String } mapped
            && IsActive(ValueSets.RetentionClasses, mapped.GetString()!))
        {
            return mapped.GetString();
        }
        return DefaultOf(ValueSets.RetentionClasses);
    }

    /// <summary>Fields a deliverable type requires, from its <c>"required"</c> list.</summary>
    public IReadOnlyList<string> RequiredFieldsOf(string deliverableType) =>
        Prop(ValueSets.DeliverableTypes, deliverableType, "required") is { ValueKind: JsonValueKind.Array } list
            ? list.EnumerateArray().Select(e => e.GetString()!).ToList()
            : [];
}
