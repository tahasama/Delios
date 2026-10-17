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
    // ── Who may ───────────────────────────────────────────────────────────────

    /// <summary>
    /// The people close enough to a revision to know who needs it: whoever wrote
    /// it or registered the document, whoever started its review or sat on it,
    /// and anyone who may transmit it.
    /// </summary>
    private async Task<bool> HasStandingAsync(ProjectAccess access, Document document, Revision revision, CancellationToken cancellationToken)
    {
        if (access.Allows(Verbs.Transmit, document.Facts) || access.Allows(Verbs.Control, document.Facts)) return true;
        var me = access.UserId;
        if (revision.AuthoredById == me || document.CreatedById == me) return true;
        return await db.Reviews.AnyAsync(r => r.RevisionId == revision.Id && (r.StartedById == me
            || db.ReviewSteps.Any(s => s.ReviewId == r.Id && s.Participants.Any(p => p.UserId == me))), cancellationToken);
    }

    /// <summary>What a screen asks before offering to ask for a revision to be sent.</summary>
    public sealed record Standing(bool MayRequest, bool LetsItOut, string? Author, Guid? AuthorId);

    /// <summary>
    /// Whether the caller has standing to ask for this revision to be sent, whether its decision lets it out at all,
    /// and who wrote it. Null when the revision is not the caller's to see.
    /// </summary>
    public async Task<Standing?> StandingAsync(ProjectAccess access, Guid revisionId, CancellationToken cancellationToken)
    {
        var revision = await db.Revisions.AsNoTracking().SingleOrDefaultAsync(r => r.Id == revisionId, cancellationToken);
        var document = revision is null ? null : await VisibleDocumentAsync(access, revision.DocumentId, cancellationToken);
        if (revision is null || document is null) return null;
        var decided = await db.Reviews.AsNoTracking().Where(r => r.RevisionId == revisionId && r.Verdict != null)
            .OrderByDescending(r => r.DecidedAt).Select(r => new { r.Verdict, r.VerdictSet }).FirstOrDefaultAsync(cancellationToken);
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var letsItOut = decided is null || ReviewSets.Proceeds(catalog, decided.VerdictSet, decided.Verdict!);
        var running = await db.Reviews.AnyAsync(r => r.RevisionId == revisionId && r.State == ReviewStates.InProgress, cancellationToken);
        var settled = revision.State is RevisionStates.Released or RevisionStates.InReview or RevisionStates.InPreparation;
        var may = settled && letsItOut && !running && await HasStandingAsync(access, document, revision, cancellationToken);
        // Who a "leave it to them" goes to: whoever started its latest review, else its author.
        var initiator = await db.Reviews.AsNoTracking().Where(r => r.RevisionId == revisionId).OrderByDescending(r => r.StartedAt)
            .Select(r => new { r.StartedByName, r.StartedById }).FirstOrDefaultAsync(cancellationToken);
        return new Standing(may, letsItOut, initiator?.StartedByName ?? revision.AuthoredByName, initiator?.StartedById ?? revision.AuthoredById);
    }

    /// <summary>
    /// The control function sends. Where nobody on the project holds it, whoever asked
    /// sends it themselves.
    /// </summary>
    private async Task<bool> MayCarryOutAsync(ProjectAccess access, Document document, IssueRequest request, CancellationToken cancellationToken)
    {
        if (access.Allows(Verbs.Control, document.Facts) || access.Allows(Verbs.Transmit, document.Facts)) return true;
        return request.RaisedById == access.UserId && !await AnyControlHolderAsync(access.Project.Id, cancellationToken);
    }

    /// <summary>Whether this person carries the exchange with a party that answers by proxy.</summary>
    public async Task<bool> CarriesAsync(ProjectAccess access, Guid partyId, CancellationToken cancellationToken) =>
        (await CarriedPartiesAsync(access, cancellationToken)).Contains(partyId);

    /// <summary>
    /// The outside parties this person carries the exchange with: those naming them, those whose custodian function is
    /// theirs, plus those naming nobody when they hold Control. Empty for people outside our organization.
    /// </summary>
    private async Task<List<Guid>> CarriedPartiesAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        if (!access.IsInternal) return [];
        var code = access.Function.Code;
        var control = access.Holds(Verbs.Control);
        var me = access.UserId;
        return await db.Parties.AsNoTracking()
            .Where(p => !p.IsInternal && (p.CarriedByUserId == me
                || (p.CarriedByUserId == null && (p.CustodianFunction == code || (p.CustodianFunction == null && control)))))
            .Select(p => p.Id).ToListAsync(cancellationToken);
    }

    /// <summary>The people who carry the exchange with a party: the person it names, its custodian function, else the control function.</summary>
    public async Task<List<User>> CustodiansAsync(Guid projectId, Party party, CancellationToken cancellationToken)
    {
        var ours = from m in db.Memberships
                   join u in db.Users on m.UserId equals u.Id
                   where m.ProjectId == projectId && m.Active && m.Function!.Active && u.Active
                       && (u.PartyId == null || u.Party!.IsInternal)
                   select new { m, u };
        if (party.CarriedByUserId is { } carrier)
        {
            var named = await ours.Where(x => x.u.Id == carrier).Select(x => x.u).ToListAsync(cancellationToken);
            if (named.Count > 0) return named;
        }
        ours = party.CustodianFunction is { } code
            ? ours.Where(x => x.m.Function!.Code == code)
            : ours.Where(x => (x.m.ActsAsControl || x.m.Function!.Rules.Any(r => r.Verbs.Contains(Verbs.Control))));
        return await ours.OrderBy(x => x.u.Name).Select(x => x.u).ToListAsync(cancellationToken);
    }

    /// <summary>Whether anyone active on the project holds CONTROL (the control function).</summary>
    private Task<bool> AnyControlHolderAsync(Guid projectId, CancellationToken cancellationToken) =>
        db.Memberships.AnyAsync(m => m.ProjectId == projectId && m.Active && m.Function!.Active
            && (m.ActsAsControl || m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control)))
            && db.Users.Any(u => u.Id == m.UserId && u.Active), cancellationToken);
}
