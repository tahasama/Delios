using Delios.Host.Audit;
using Prometheus;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Documents;

public sealed record FileUploaded(Guid TenantId, Guid FileId)
{
    public const string RoutingKey = "file.uploaded";
}

/// <summary>
/// The worker's part of an upload: read the stored bytes once, scanning them for
/// viruses, checking them against the size and checksum the uploader declared,
/// and identifying what they are. A revision is ready only when all its files pass.
/// Safe to run twice for the same file.
/// </summary>
public sealed class FileProcessor(
    DeliosDbContext db, TenantContext tenant, FileStorage storage, IVirusScanner scanner,
    AuditLog audit, IClock clock, ILogger<FileProcessor> logger)
{
    public async Task ProcessAsync(FileUploaded message, CancellationToken cancellationToken)
    {
        tenant.Set(message.TenantId);
        StoredFile? file;
        await using (var read = await db.Database.BeginTransactionAsync(cancellationToken))
        {
            file = await db.StoredFiles.AsNoTracking().SingleOrDefaultAsync(f => f.Id == message.FileId, cancellationToken);
            await read.CommitAsync(cancellationToken);
        }
        if (file is not { Status: FileStatuses.Processing, RevisionId: { } revisionId })
        {
            logger.LogInformation("File {FileId} is not waiting for processing; skipped", message.FileId);
            return;
        }

        // Scanning can take a while for a large file; no transaction is held meanwhile.
        using var timer = AppMetrics.FileProcessingSeconds.NewTimer();
        ScanResult scan;
        string sha256, detected;
        long size;
        await using (var content = new HashingStream(await storage.OpenReadAsync(file.ObjectKey, cancellationToken)))
        {
            scan = await scanner.ScanAsync(content, cancellationToken);
            sha256 = content.Sha256Hex();
            size = content.BytesRead;
            detected = FileSniffer.Detect(content.Head);
        }

        var (status, detail) = scan.Infected ? (FileStatuses.Infected, $"Virus found: {scan.Signature}")
            : size != file.Size ? (FileStatuses.Rejected, $"The stored file is {size} bytes; {file.Size} were declared.")
            : sha256 != file.Sha256 ? (FileStatuses.Rejected, "The stored bytes do not match the declared SHA-256.")
            : (FileStatuses.Clean, (string?)null);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        // Files of one revision finish one at a time, so the last one sees all the others.
        await db.Database.ExecuteSqlAsync($"SELECT 1 FROM revisions WHERE id = {revisionId} FOR UPDATE", cancellationToken);
        var now = clock.GetCurrentInstant();
        var updated = await db.StoredFiles
            .Where(f => f.Id == file.Id && f.Status == FileStatuses.Processing)
            .ExecuteUpdateAsync(f => f
                .SetProperty(x => x.Status, status)
                .SetProperty(x => x.StatusDetail, detail)
                .SetProperty(x => x.DetectedType, detected)
                .SetProperty(x => x.ScannedAt, now), cancellationToken);
        if (updated == 0) return;
        AppMetrics.FilesProcessed.WithLabels(status).Inc();

        await audit.WriteAsync(Actor.System, status switch
        {
            FileStatuses.Clean => "FILE_CLEAN",
            FileStatuses.Infected => "FILE_INFECTED",
            _ => "FILE_REJECTED",
        }, "StoredFile", file.Id, file.Name, detail, file.ProjectId, cancellationToken);

        // Evidence filed against a revision is scanned like anything else, but the
        // revision's own readiness is about what was submitted, not what came back.
        if (file.Kind == FileKinds.Evidence)
        {
            await transaction.CommitAsync(cancellationToken);
            return;
        }
        var revision = await db.Revisions.SingleAsync(r => r.Id == revisionId, cancellationToken);
        // Only the files of the revision's current submission say whether it is ready.
        var statuses = await db.StoredFiles
            .Where(f => f.RevisionId == revisionId && f.Kind != FileKinds.Evidence && f.Submission == revision.Submission)
            .Select(f => f.Status).ToListAsync(cancellationToken);
        var filesState = statuses.Any(s => s is FileStatuses.Infected or FileStatuses.Rejected) ? FilesStates.Rejected
            : statuses.All(s => s == FileStatuses.Clean) ? FilesStates.Ready
            : FilesStates.Processing;
        if (filesState != revision.FilesState)
        {
            revision.FilesState = filesState;
            await db.SaveChangesAsync(cancellationToken);
            if (filesState != FilesStates.Processing)
            {
                await audit.WriteAsync(Actor.System,
                    filesState == FilesStates.Ready ? "REVISION_FILES_READY" : "REVISION_FILES_REJECTED",
                    "Revision", revision.Id, $"rev {revision.Value}", null, file.ProjectId, cancellationToken);
            }
        }
        await transaction.CommitAsync(cancellationToken);
    }
}
