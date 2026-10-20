using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Reviews;

public sealed partial class ReviewService
{
    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>Loads a review of this project with its steps (in order), their participants and its comments, tracked so changes can be saved. Null if not found.</summary>
    private Task<Review?> LoadAsync(ProjectAccess access, Guid reviewId, CancellationToken cancellationToken) =>
        db.Reviews
            .Include(r => r.Steps.OrderBy(s => s.Index)).ThenInclude(s => s.Participants)
            .Include(r => r.Comments)
            .AsSplitQuery()
            .SingleOrDefaultAsync(r => r.Id == reviewId && r.ProjectId == access.Project.Id, cancellationToken);

    /// <summary>Loads a review for display, or null if it does not exist or its document is not visible to the caller. Called by the get-review endpoint.</summary>
    public async Task<Review?> ReadAsync(ProjectAccess access, Guid reviewId, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        return review is not null && await VisibleDocumentAsync(access, review.DocumentId, cancellationToken) is not null
            ? review : null;
    }

    /// <summary>The document if the caller may see it (taking restricted confidentiality levels into account), otherwise null.</summary>
    private async Task<Document?> VisibleDocumentAsync(ProjectAccess access, Guid documentId, CancellationToken cancellationToken)
    {
        var restricted = (await Catalog.LoadAsync(db, cancellationToken)).RestrictedLevels();
        return await DocumentQueries.Visible(db, access, restricted).SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
    }

    /// <summary>
    /// Who sits on a step: the holders of its function and the people named on it who are on the project; for a party
    /// answering here, its people on the project; for one answering by proxy, whoever of ours carries the exchange with it.
    /// </summary>
    private async Task<List<User>> SeatsAsync(
        Project project, string? functionCode, Party? party, string? participation, CancellationToken cancellationToken,
        Guid[]? named = null, Document? document = null)
    {
        if (party is null)
        {
            var holders = functionCode is null ? [] : await HoldersAsync(project.Id, functionCode, cancellationToken);
            var people = named is not { Length: > 0 } ? [] : await (from m in db.Memberships
                                                                    join u in db.Users on m.UserId equals u.Id
                                                                    where m.ProjectId == project.Id && m.Active && m.Function!.Active && u.Active && named.Contains(u.Id)
                                                                    select u).Distinct().ToListAsync(cancellationToken);
            var seated = holders.Concat(people).DistinctBy(u => u.Id).OrderBy(u => u.Name).ToList();
            return document is null ? seated : await ClearedAsync(project, document, seated, cancellationToken);
        }
        if (participation == Participations.ByProxy) return await transmittals.CustodiansAsync(project.Id, party, cancellationToken);
        // Its people on the project; those the step names, or those holding the function it names, where it names some.
        var theirs = await (from m in db.Memberships
                            join u in db.Users on m.UserId equals u.Id
                            where m.ProjectId == project.Id && m.Active && m.Function!.Active && u.Active && u.PartyId == party.Id
                            orderby u.Name
                            select new { User = u, m.Function!.Code }).ToListAsync(cancellationToken);
        var narrowed = named is { Length: > 0 } || functionCode is not null
            ? theirs.Where(x => (named ?? []).Contains(x.User.Id) || (functionCode is not null && x.Code == functionCode)).ToList()
            : theirs;
        return narrowed.Select(x => x.User).DistinctBy(u => u.Id).ToList();
    }

    /// <summary>
    /// Those of <paramref name="people"/> who may read the document: their function's clearance reaches its
    /// confidentiality, or they registered it, or they are named on it.
    /// </summary>
    private async Task<List<User>> ClearedAsync(Project project, Document document, List<User> people, CancellationToken cancellationToken)
    {
        if (document.Confidentiality is null || people.Count == 0) return people;
        var ids = people.Select(u => u.Id).ToList();
        var clearances = await db.Memberships.AsNoTracking().Where(m => m.ProjectId == project.Id && m.Active && ids.Contains(m.UserId))
            .Select(m => new { m.UserId, m.Function!.Clearance }).ToListAsync(cancellationToken);
        if (clearances.All(c => c.Clearance is null)) return people;
        var named = await db.DocumentAccess.AsNoTracking().Where(a => a.DocumentId == document.Id && ids.Contains(a.UserId))
            .Select(a => a.UserId).ToListAsync(cancellationToken);
        var ranks = await Clearance.RanksAsync(db, cancellationToken);
        return people.Where(u => u.Id == document.CreatedById || named.Contains(u.Id)
            || Clearance.Reaches(ranks, clearances.FirstOrDefault(c => c.UserId == u.Id)?.Clearance, document.Confidentiality)).ToList();
    }

    /// <summary>Loads the document and revision a review is about.</summary>
    private async Task<(Document Document, Revision Revision)> SubjectAsync(Review review, CancellationToken cancellationToken) =>
        (await db.Documents.SingleAsync(d => d.Id == review.DocumentId, cancellationToken),
         await db.Revisions.SingleAsync(r => r.Id == review.RevisionId, cancellationToken));

    /// <summary>The problem returned when someone tries to act on a by-proxy step before recording that it was sent to the party.</summary>
    private static IResult NotDispatched(ReviewStep step) => Problems.Conflict("NOT_DISPATCHED",
        $"Record that it went to {step.PartyName} first: what comes back is their answer to what was sent.");

    /// <summary>Active users who hold the given function on the project, by name.</summary>
    private Task<List<User>> HoldersAsync(Guid projectId, string functionCode, CancellationToken cancellationToken) =>
        (from m in db.Memberships
         join u in db.Users on m.UserId equals u.Id
         where m.ProjectId == projectId && m.Active && m.Function!.Code == functionCode && m.Function.Active && u.Active
         orderby u.Name
         select u).ToListAsync(cancellationToken);

    /// <summary>How many people hold a function with the CONTROL verb on the project.</summary>
    private Task<int> ControlHoldersAsync(Guid projectId, CancellationToken cancellationToken) =>
        db.Memberships.CountAsync(m => m.ProjectId == projectId && m.Active && m.Function!.Active
            && (m.ActsAsControl || db.PermissionRules.IgnoreQueryFilters().Any(r => r.FunctionId == m.FunctionId && r.ProjectId == (m.Project!.OwnFunctions ? (Guid?)m.ProjectId : null) && r.Verbs.Contains(Verbs.Control)))
            && db.Users.Any(u => u.Id == m.UserId && u.Active), cancellationToken);

    /// <summary>Whether the caller has the CONTROL verb on the review's document.</summary>
    private async Task<bool> HoldsControlAsync(ProjectAccess access, Review review, CancellationToken cancellationToken)
    {
        var document = await db.Documents.AsNoTracking().SingleAsync(d => d.Id == review.DocumentId, cancellationToken);
        return access.Allows(Verbs.Control, document.Facts);
    }

    /// <summary>The control function, or, where the project has nobody in that role, the people who decided.</summary>
    private async Task<bool> MayActForControlAsync(ProjectAccess access, Review review, CancellationToken cancellationToken)
    {
        if (await HoldsControlAsync(access, review, cancellationToken)) return true;
        if (await ControlHoldersAsync(access.Project.Id, cancellationToken) > 0) return false;
        // Not reviewed: whoever sent it on releases it.
        var deciding = review.Steps.Where(s => s.Deciding).ToList();
        return deciding.Count > 0 ? deciding.Any(s => s.Participants.Any(p => p.UserId == access.UserId)) : review.StartedById == access.UserId;
    }

    /// <summary>Whether a function, on this project, would allow the verb on a document with these facts. Used to check the deciding function may approve.</summary>
    private static bool Allows(Function function, Project project, string verb, DocumentFacts facts) =>
        ProjectAccess.OfFunction(project, function).Allows(verb, facts);

    /// <summary>The review's step that is open now, or null when none is.</summary>
    /// <summary>What the caller may do on this review now: answer the open step, act as the control function on it.</summary>
    /// <param name="OnBehalfOf">When the caller answers in somebody else's place, by a hand-over in force: that person's name.</param>
    public sealed record ReviewMe(bool Seated, bool Answered, bool Control, string? OnBehalfOf = null);

    /// <summary>For the review page: whether the caller sits on the open step (and has answered), and whether they act for the control function. Null when they cannot see it.</summary>
    public async Task<ReviewMe?> MeAsync(ProjectAccess access, Guid reviewId, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return null;
        var step = OpenStep(review);
        var seat = step is null ? null : await SeatAsync(review, step, access, cancellationToken);
        return new ReviewMe(seat is not null, seat?.AnsweredAt is not null, await MayActForControlAsync(access, review, cancellationToken),
            seat is not null && seat.UserId != access.UserId ? seat.UserName : null);
    }

    private static ReviewStep? OpenStep(Review review) => review.Steps.SingleOrDefault(s => s.State == StepStates.Open);
    /// <summary>
    /// The seat the caller answers on this step: their own, or that of somebody who
    /// handed the step to them by a hand-over in force today. Null when they have none.
    /// </summary>
    private async Task<ReviewParticipant?> SeatAsync(Review review, ReviewStep step, ProjectAccess access, CancellationToken cancellationToken)
    {
        var own = step.Participants.FirstOrDefault(p => p.UserId == access.UserId);
        if (own is not null) return own;
        var today = WorkingCalendar.Today(clock, access.Project.TimeZone);
        var from = await db.Set<ReviewDelegation>().AsNoTracking()
            .Where(d => d.ReviewId == review.Id && d.StepIndex == step.Index && d.ToUserId == access.UserId
                && d.Status == DelegationStates.Active && d.EndDate >= today)
            .Select(d => d.FromUserId).ToListAsync(cancellationToken);
        return step.Participants.FirstOrDefault(p => from.Contains(p.UserId));
    }

    /// <summary>How severe a verdict is: not proceeding (rejected) 2, accepted with comments to take in 1, accepted or for information 0.</summary>
    private static int Severity(Catalog catalog, string set, string verdict) =>
        !Proceeds(catalog, set, verdict) ? 2
            : catalog.Prop(set, verdict, "resubmit") is { ValueKind: JsonValueKind.True } ? 1 : 0;

    /// <summary>Whether a verdict lets the revision go on to release (its published <c>proceed</c> property is true).</summary>
    private static bool Proceeds(Catalog catalog, string set, string verdict) => ReviewSets.Proceeds(catalog, set, verdict);

    /// <summary>The published advice code for an advice kind (none, some, blocking); the kind in capitals when none is published.</summary>
    private static string AdviceCode(Catalog catalog, string kind, string? set = null) =>
        catalog.ActiveIn(ReviewSets.Advice, set).FirstOrDefault(code => AdviceKind(catalog, code) == kind)
            ?? catalog.CodeWhere(ReviewSets.Advice, "comments", kind) ?? kind.ToUpperInvariant();

    /// <summary>The advice kind (none, some, blocking) behind a published advice code; the code in lower case when it has none.</summary>
    private static string AdviceKind(Catalog catalog, string code) =>
        catalog.Prop(ReviewSets.Advice, code, "comments") is { ValueKind: JsonValueKind.String } k ? k.GetString()! : code.ToLowerInvariant();

    /// <summary>Marks a comment closed with its resolution, the time and who closed it.</summary>
    private void Close(ReviewComment comment, string resolution, string by)
    {
        comment.Status = CommentStatuses.Closed;
        comment.Resolution = resolution;
        comment.ClosedAt = clock.GetCurrentInstant();
        comment.ClosedByName = by;
    }

    /// <summary>Turns a state code such as IN_PREPARATION into words for messages ("in preparation").</summary>
    private static string Words(string state) => state.ToLowerInvariant().Replace('_', ' ');
    /// <summary>The caller as the actor recorded in the audit log.</summary>
    private static Audit.Actor Actor(ProjectAccess access) => new(access.UserId, access.UserName);
    /// <summary>The 404 problem for a review that does not exist or is not visible.</summary>
    private static IResult NotFound() => Problems.NotFound("REVIEW_NOT_FOUND", "No such review.");
    /// <summary>Shorthand for returning a problem with no review.</summary>
    private static (Review?, IResult?) Fail(IResult problem) => (null, problem);
}
