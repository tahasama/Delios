using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Settings;
using Delios.Host.Tenancy;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Documents;

public sealed partial class KeepingService
{
    // ── Legal hold ────────────────────────────────────────────────────────────

    /// <summary>The refusal for ending or voiding anything of a document on legal hold.</summary>
    internal static IResult OnHold(Document document) => Problems.Conflict("ON_LEGAL_HOLD",
        $"It is on legal hold since {document.LegalHoldAt?.ToDateTimeUtc():d MMM yyyy}{(document.LegalHoldByName is null ? "" : $", by {document.LegalHoldByName}")}: {document.LegalHoldReason ?? "no reason given"}. Lift the hold first.");

    /// <summary>Document Control or an administrator puts a document on legal hold, or lifts it. A reason is required both ways.
    /// While held, the document cannot be retired and no revision of it voided; new revisions and reviews go on.</summary>
    public async Task<IResult> LegalHoldAsync(
        HttpContext http, ProjectAccess access, Guid documentId, LegalHoldRequest request, CancellationToken cancellationToken)
    {
        var document = await VisibleAsync(access, documentId, cancellationToken);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (!access.Allows(Verbs.Control, document.Facts) && !await Keepers.ConfiguresAsync(http))
            return Problems.Forbidden("CONTROL_ONLY", "Only the control function records legal holds.");
        if (document.LegalHold == request.On) return Results.NoContent();
        // Put on, and lifted, with a reason: both are recorded.
        var reason = request.Reason?.Trim() ?? "";
        if (reason.Length == 0)
            return Problems.Invalid("REASON_REQUIRED", request.On ? "Say why it is held: the claim, dispute or instruction." : "Say why the hold is lifted.");
        document.LegalHold = request.On;
        if (request.On)
        {
            document.LegalHoldReason = reason;
            document.LegalHoldAt = clock.GetCurrentInstant();
            document.LegalHoldByName = access.UserName;
            document.LegalHoldLiftedAt = null;
            document.LegalHoldLiftedByName = null;
            document.LegalHoldLiftReason = null;
        }
        else
        {
            // Lifted: the hold's reason stays, with why it was lifted beside it.
            document.LegalHoldLiftedAt = clock.GetCurrentInstant();
            document.LegalHoldLiftedByName = access.UserName;
            document.LegalHoldLiftReason = reason;
        }
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "LEGAL_HOLD", "Document", document.Id, document.Number,
            request.On ? $"Legal hold: it may not be retired nor any revision voided. {reason}" : $"Legal hold lifted. {reason}",
            access.Project.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }
}
