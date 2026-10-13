using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Transmittals;

public sealed partial class TransmittalService
{
    // ── Files carried ─────────────────────────────────────────────────────────

    /// <summary>
    /// The files a transmittal's items carried: for a revision or a submission, the files of that revision as sent
    /// (originals, not stamped copies); for an unplanned item or one kept with it later, its own files.
    /// </summary>
    public async Task<List<StoredFile>> ItemFilesAsync(Transmittal transmittal, CancellationToken cancellationToken)
    {
        var revisions = transmittal.Items.Where(i => i.RevisionId != null).Select(i => i.RevisionId!.Value).ToList();
        var items = transmittal.Items.Where(i => i.Kind is TransmittalItemKinds.Unplanned or TransmittalItemKinds.Attachment).Select(i => i.Id).ToList();
        if (revisions.Count == 0 && items.Count == 0) return [];
        return await db.StoredFiles.AsNoTracking()
            .Where(f => (f.RevisionId != null && revisions.Contains(f.RevisionId.Value) && f.Kind != FileKinds.Evidence && f.DerivedFromId == null)
                || (f.TransmittalItemId != null && items.Contains(f.TransmittalItemId.Value)))
            .OrderBy(f => f.Name).ToListAsync(cancellationToken);
    }

    /// <summary>
    /// Which of <paramref name="files"/> one item carried. A submission carried the files of its own submission; a
    /// revision sent out carried the files of its latest submission at the time, which are those of its last one.
    /// </summary>
    public static IEnumerable<StoredFile> FilesOf(TransmittalItem item, IReadOnlyList<StoredFile> files)
    {
        if (item.Kind is TransmittalItemKinds.Unplanned or TransmittalItemKinds.Attachment) return files.Where(f => f.TransmittalItemId == item.Id);
        if (item.RevisionId is not { } revision) return [];
        var mine = files.Where(f => f.RevisionId == revision).ToList();
        var submission = item.Submission ?? (mine.Count == 0 ? 0 : mine.Max(f => f.Submission));
        return mine.Where(f => f.Submission == submission);
    }
}
