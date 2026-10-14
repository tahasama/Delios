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

/// <summary>Who a revision should go to, and why. Asked by people, carried out by Document Control.</summary>
/// <param name="Delegated">Leave it to whoever started the review to say who receives it: they are told, and ask themselves.</param>
/// <param name="ApproverPartyId">An outside party that must approve it first: release waits for them, or a released revision is held.</param>
public sealed record IssueAsk(
    string? Reason, Guid[]? UserIds = null, Guid[]? PartyIds = null, string? Note = null, string? OffDistributionReason = null,
    bool Delegated = false, Guid? ApproverPartyId = null);

/// <summary>That something went to an organization outside the system: when, how, their reference, the proof.</summary>
/// <param name="DispatchedOn">The day it went, when not today: not before the transmittal, not to come.</param>
public sealed record DispatchRequest(string? Channel, string? Reference = null, Guid? ProofFileId = null, DateOnly? DispatchedOn = null);

/// <summary>
/// Issuing: asking for a released revision to be sent, carrying the request out
/// as numbered transmittals, and the record of each recipient opening,
/// acknowledging, or being sent it by hand. Nothing here sends email: an
/// exchange outside the system is recorded, with its proof, by whoever carried it.
/// </summary>
public sealed partial class TransmittalService(
    DeliosDbContext db, Numbering numbering, AuditLog audit, FileStorage storage, IClock clock,
    IOptions<StorageOptions> storageOptions, Notifications.Notifier notifier, EmailReplies emailReplies)
{
    /// <summary>The reason a placeholder is sent with, set by itself: issued for use.</summary>
    public const string PlaceholderReason = "IFU";

    // ── Distribution ──────────────────────────────────────────────────────────

    /// <summary>
    /// Who receives this class of document is the permission matrix read through
    /// RECEIVE, not a second list to keep. Everyone else on the project may still be
    /// chosen, with a reason.
    /// </summary>
    public async Task<DistributionView> DistributionAsync(Project project, Document document, CancellationToken cancellationToken)
    {
        var members = await MembersAsync(project, cancellationToken);
        // The matrix proposes; a clearance that does not reach the document's confidentiality takes the person off.
        var ranks = await Clearance.RanksAsync(db, cancellationToken);
        var proposed = members.Where(m => m.Internal && ProjectAccess.OfFunction(project, m.Function).Allows(Verbs.Receive, document.Facts)
                && Clearance.Reaches(ranks, m.Function.Clearance, document.Confidentiality))
            .ToList();
        var parties = await db.Parties.AsNoTracking().Where(p => p.Active && !p.IsInternal).OrderBy(p => p.Name)
            .Select(p => new PartyChoice(p.Id, p.Code, p.Name, p.Participation)).ToListAsync(cancellationToken);
        return new DistributionView(
            proposed.Select(m => m.View()).ToList(),
            members.Except(proposed).Select(m => m.View()).ToList(),
            parties);
    }
}
