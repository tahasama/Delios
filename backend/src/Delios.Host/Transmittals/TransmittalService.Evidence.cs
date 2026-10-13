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
    // ── Evidence ──────────────────────────────────────────────────────────────

    /// <summary>Somewhere to upload proof filed against a revision. It is scanned like any other file.</summary>
    public async Task<(UploadTicket? Ticket, IResult? Problem)> EvidenceTicketAsync(
        ProjectAccess access, Guid? documentId, Guid? revisionId, UploadRequest request, CancellationToken cancellationToken)
    {
        var (declared, invalid) = Uploads.Check(request, storageOptions.Value.MaxFileBytes);
        if (invalid is not null) return (null, invalid);
        var file = new StoredFile
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            DocumentId = documentId,
            RevisionId = revisionId,
            ObjectKey = "",
            Name = declared!.Name,
            ContentType = declared.ContentType,
            Size = request.Size,
            Sha256 = declared.Sha256,
            Kind = FileKinds.Evidence,
            UploadedById = access.UserId,
            UploadedByName = access.UserName,
            CreatedAt = clock.GetCurrentInstant(),
        };
        file.ObjectKey = FileStorage.KeyFor(file.TenantId, file.ProjectId, file.Id);
        db.StoredFiles.Add(file);
        await db.SaveChangesAsync(cancellationToken);
        var link = storage.PresignUpload(file.ObjectKey, file.ContentType);
        return (new UploadTicket(file.Id, "PUT", link.Url, link.Headers, link.ExpiresAt.ToDateTimeOffset()), null);
    }

    /// <summary>Puts uploaded proof to use and sends it for scanning. Null when it is fine.</summary>
    public async Task<IResult?> BindEvidenceAsync(ProjectAccess access, Guid fileId, Guid? revisionId, CancellationToken cancellationToken)
    {
        var file = await db.StoredFiles.SingleOrDefaultAsync(f => f.Id == fileId && f.RevisionId == revisionId
            && f.Kind == FileKinds.Evidence && f.UploadedById == access.UserId && f.Status == FileStatuses.AwaitingUpload,
            cancellationToken);
        if (file is null)
        {
            return Problems.Invalid("FILE_NOT_AVAILABLE", "That proof was not requested by you for this revision, or is already used.",
                new { fileId });
        }
        if (await Uploads.ArrivedAsync(storage, file, cancellationToken) is { } missing) return missing;
        file.Status = FileStatuses.Processing;
        db.Enqueue(FileUploaded.RoutingKey, new FileUploaded(file.TenantId, file.Id));
        return null;
    }
}
