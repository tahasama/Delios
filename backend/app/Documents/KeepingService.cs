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

/// <summary>Body of voiding a revision: why (required), and what was found of the work done from it, when already known.</summary>
public sealed record VoidRequest(string? Reason, string? Reassessment = null);
/// <summary>Body of recording the reassessment of work done from a voided revision.</summary>
public sealed record ReassessmentRequest(string? Note);
/// <summary>Body of putting a document on legal hold, or lifting it.</summary>
public sealed record LegalHoldRequest(bool On, string? Reason = null);
/// <summary>Body of sending a supplier's document to them for an update (what they are told), or asking it back (why).</summary>
public sealed record SupplierNoteRequest(string? Note);
/// <summary>Body of answering an ask to hand a document back: accepted or not, and why (required to refuse).</summary>
public sealed record AnswerAskRequest(bool Accept, string? Answer = null);
/// <summary>An ask to hand a supplier's document back (RETURN_FOR_UPDATE), with its answer.</summary>
public sealed record HandBackView(Guid Id, string Kind, bool FromSupplier, string AskedBy, string Reason, DateTimeOffset AskedAt,
    DateTimeOffset? AnsweredAt, string? AnsweredBy, bool? Accepted, string? Answer);
/// <summary>Body of naming readers of a closed document.</summary>
public sealed record ReadersRequest(Guid[]? UserIds, string? Reason = null);

/// <summary>A voided revision whose reassessment is still to be written.</summary>
public sealed record UnresolvedVoid(Guid RevisionId, Guid DocumentId, string Number, string Title, string Value, string? VoidReason,
    DateTimeOffset VoidedAt, string? VoidAuthority);
/// <summary>Somebody named to read a closed document.</summary>
public sealed record ReaderView(Guid Id, Guid UserId, string Name, string? AddedByName, string? Reason, DateTimeOffset CreatedAt);

/// <summary>
/// The acts that keep the record honest after the fact: voiding a revision that
/// should not have counted (and saying what came of the work done from it),
/// holding a document against disposal, and naming who may read a closed one.
/// </summary>
public sealed partial class KeepingService(
    DeliosDbContext db, AuditLog audit, IClock clock, TransmittalService transmittals, Notifications.Notifier notifier)
{
}
