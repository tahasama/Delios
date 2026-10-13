using System.Text.Json;

namespace Delios.Host.Documents;

/// <summary>
/// Who holds a document exchanged with a supplier (<see cref="Document.WithSupplier"/>), read from what the
/// organization's lists mean, never from their codes.
/// </summary>
public static class SupplierHold
{
    /// <summary>
    /// Whether a review's verdict hands the supplier's document back to them: one that sends it back (work may not
    /// proceed), or one whose comments go into the next revision. Accepted, or taken for information, it stays with
    /// us. Every verdict list says one of those four meanings, whatever it calls them.
    /// </summary>
    public static bool HandsToSupplier(Catalog catalog, string verdictSet, string verdict) =>
        catalog.Prop(verdictSet, verdict, "proceed") is not { ValueKind: JsonValueKind.True }
        || catalog.Prop(verdictSet, verdict, "resubmit") is { ValueKind: JsonValueKind.True };
}
