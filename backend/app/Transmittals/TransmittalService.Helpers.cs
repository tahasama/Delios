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
    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// One active project member with their function (role) and whether they belong to our own organization
    /// (<c>Internal</c>). Built by <c>MembersAsync</c>.
    /// </summary>
    public sealed record Member(Guid UserId, string Name, Guid? PartyId, string? PartyName, bool Internal, Function Function)
    {
        /// <summary>The member as shown in the distribution picker.</summary>
        public Person View() => new(UserId, Name, Function.Name, PartyName);
    }

    /// <summary>Everyone active on the project, with what their function may do.</summary>
    public async Task<List<Member>> MembersAsync(Project project, CancellationToken cancellationToken)
    {
        var memberships = await db.Memberships.AsNoTracking().Include(m => m.Function!).ThenInclude(f => f.Rules)
            .Where(m => m.ProjectId == project.Id && m.Active && m.Function!.Active).ToListAsync(cancellationToken);
        var ids = memberships.Select(m => m.UserId).ToList();
        var users = await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id) && u.Active)
            .Select(u => new
            {
                u.Id,
                u.Name,
                u.PartyId,
                PartyName = u.Party == null ? null : u.Party.Name,
                Internal = u.Party == null || u.Party.IsInternal
            })
            .ToDictionaryAsync(u => u.Id, cancellationToken);
        return memberships.Where(m => users.ContainsKey(m.UserId))
            .Select(m => (Membership: m, User: users[m.UserId]))
            .Select(x => new Member(x.User.Id, x.User.Name, x.User.PartyId, x.User.PartyName, x.User.Internal, x.Membership.Function!))
            .OrderBy(m => m.Name).ToList();
    }

    /// <summary>
    /// The transmittals this person may see: all of them for the control function and senders; otherwise those they issued,
    /// those sent to them, and those to parties whose custodian function is theirs.
    /// </summary>
    public IQueryable<Transmittal> Visible(ProjectAccess access)
    {
        var query = db.Transmittals.Where(t => t.ProjectId == access.Project.Id);
        if (access.IsInternal && (access.Holds(Verbs.Control) || access.Holds(Verbs.Transmit))) return query;
        var me = access.UserId;
        var code = access.Function.Code;
        var party = access.IsInternal ? null : access.PartyCode;
        return query.Where(t => t.IssuedById == me || t.Recipients.Any(r => r.UserId == me)
            // What an organization sent us, its own people see.
            || (party != null && t.FromPartyId != null && db.Parties.Any(p => p.Id == t.FromPartyId && p.Code == party))
            || (access.IsInternal && t.Recipients.Any(r => r.PartyId != null
                && db.Parties.Any(p => p.Id == r.PartyId && p.CustodianFunction == code)))
            || (access.IsInternal && t.FromPartyId != null && db.Parties.Any(p => p.Id == t.FromPartyId && p.CustodianFunction == code)));
    }

    /// <summary>
    /// Loads an issue request with its document and revision. All three are null when the request is missing, in
    /// another project, or its document is not visible to the caller.
    /// </summary>
    private async Task<(IssueRequest?, Document?, Revision?)> LoadRequestAsync(
        ProjectAccess access, Guid requestId, CancellationToken cancellationToken)
    {
        var request = await db.IssueRequests.SingleOrDefaultAsync(r => r.Id == requestId && r.ProjectId == access.Project.Id,
            cancellationToken);
        var document = request is null ? null : await VisibleDocumentAsync(access, request.DocumentId, cancellationToken);
        if (request is null || document is null) return (null, null, null);
        var revision = await db.Revisions.SingleAsync(r => r.Id == request.RevisionId, cancellationToken);
        return (request, document, revision);
    }

    /// <summary>The document when the caller may see it (respecting confidentiality levels), otherwise null.</summary>
    private async Task<Document?> VisibleDocumentAsync(ProjectAccess access, Guid documentId, CancellationToken cancellationToken)
    {
        var restricted = (await Catalog.LoadAsync(db, cancellationToken)).RestrictedLevels();
        return await DocumentQueries.Visible(db, access, restricted).SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
    }

    /// <summary>
    /// Whether the revision's review is decided with a verdict that lets it proceed to release. Such a revision may
    /// already be asked for.
    /// </summary>
    private async Task<bool> DecidedToProceedAsync(Guid revisionId, CancellationToken cancellationToken)
    {
        var verdict = await db.Reviews.Where(r => r.RevisionId == revisionId && r.State == ReviewStates.Decided)
            .Select(r => new { r.Verdict, r.VerdictSet }).FirstOrDefaultAsync(cancellationToken);
        if (verdict?.Verdict is null) return false;
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        return ReviewSets.Proceeds(catalog, verdict.VerdictSet, verdict.Verdict);
    }

    /// <summary>
    /// Marks an issue request as done or cancelled, with the time and who closed it. The caller saves the change.
    /// </summary>
    private void Close(IssueRequest request, string status, string by)
    {
        request.Status = status;
        request.ClosedAt = clock.GetCurrentInstant();
        request.ClosedByName = by;
    }

    /// <summary>
    /// Short label for a revision used in audit entries and subjects, for example P1001-ME-001 rev A.
    /// </summary>
    public static string Label(Document document, Revision revision) => $"{document.Number} rev {revision.Value}";

    /// <summary>Turns an <c>IssueRequest</c> entity into the shape returned to the browser.</summary>
    public static IssueRequestView View(IssueRequest r, IReadOnlyList<string> transmittals, IReadOnlyList<Guid>? transmittalIds = null) => new(
        r.Id, r.RevisionId, r.Reason, r.UserIds, r.PartyIds, r.Note, r.OffDistributionReason, r.RaisedByName,
        r.RaisedAt.ToDateTimeOffset(), r.Status, r.ClosedAt?.ToDateTimeOffset(), r.ClosedByName, transmittals, r.RaisedById,
        transmittalIds ?? [], r.Delegated, r.ApproverPartyId, r.ApprovalState, r.ReleaseNote);

    /// <summary>
    /// Whether a request can become transmittals now: it names somebody, no outside
    /// approval is still owed, and its revision is not on hold.
    /// </summary>
    public static bool Ready(IssueRequest r, Revision revision) =>
        !r.Delegated && r.ApprovalState is null or ApprovalStates.Approved && revision.HeldAt is null
        && r.UserIds.Length + r.PartyIds.Length > 0;

    /// <summary>The 404 answer for a transmittal that does not exist or is not visible.</summary>
    private static IResult NotFound() => Problems.NotFound("TRANSMITTAL_NOT_FOUND", "No such transmittal.");
    /// <summary>The 404 answer for an issue request that does not exist or is not visible.</summary>
    private static IResult RequestNotFound() => Problems.NotFound("ISSUE_REQUEST_NOT_FOUND", "No such request.");
}
