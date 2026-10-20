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
    // ── Start ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Starts a review of a revision that is in preparation, after checking its files passed scanning, it has a readable PDF, a route serves the document, every step has someone to answer it and the deciding function may approve.
    /// Creates the review and its steps from the route, opens step 1 and moves the revision to in-review. Called by the start endpoint in <see cref="ReviewEndpoints"/>.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> StartAsync(
        ProjectAccess access, Guid revisionId, StartReviewRequest request, CancellationToken cancellationToken)
    {
        var revision = await db.Revisions.Include(r => r.Files).SingleOrDefaultAsync(r => r.Id == revisionId, cancellationToken);
        var document = revision is null ? null : await VisibleDocumentAsync(access, revision.DocumentId, cancellationToken);
        if (revision is null || document is null) return Fail(Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        if (!access.Allows(Verbs.Create, document.Facts) && !access.Allows(Verbs.Revise, document.Facts)
            && revision.AuthoredById != access.UserId)
        {
            return Fail(Problems.Forbidden("REVIEW_NOT_ALLOWED", "Only the author or someone who may revise it can send it for review."));
        }
        if (revision.State != RevisionStates.InPreparation)
        {
            return Fail(Problems.Conflict("REVISION_NOT_IN_PREPARATION",
                $"Revision {revision.Value} is {Words(revision.State)}; only a revision in preparation is sent for review.",
                new { state = revision.State }));
        }
        // Nothing is reviewed that nobody can read: a verdict on a file that failed
        // its scan, or on no readable copy at all, is worth less than no verdict.
        if (revision.FilesState != FilesStates.Ready)
        {
            return Fail(Problems.Conflict("FILES_NOT_READY", "The revision's files have not all passed scanning.",
                new { filesState = revision.FilesState }));
        }
        if (!revision.Files.Any(f => f.Kind == FileKinds.Rendition && f.Status == FileStatuses.Clean && f.Submission == revision.Submission))
        {
            return Fail(Problems.Conflict("NO_RENDITION", "A review needs a PDF people can read. Upload one with the revision."));
        }

        var candidates = await RoutesForAsync(document, cancellationToken);
        var route = request.RouteId is { } id ? candidates.FirstOrDefault(r => r.Id == id) : candidates.FirstOrDefault();
        if (route is null || route.Steps.Count == 0)
        {
            return Fail(Problems.Invalid("NO_ROUTE", request.RouteId is null
                ? "No review route serves this document. An administrator publishes one."
                : "That route does not serve this document."));
        }

        // What the project's review form insists on (Settings, Forms & fields): someone copied in, where it says so.
        var reviewForm = await Settings.FormRules.ReadAsync(db, access.Project.Id, "REVIEW", cancellationToken);
        if (await Settings.FormRules.CheckAsync(db, access.Project.Id, "REVIEW",
                new Dictionary<string, bool> { ["copies"] = request.Copies is { Length: > 0 } }, null, cancellationToken) is { } formProblem)
            return Fail(formProblem);
        // The sender's choice of people on a step of ours replaces the route's for this
        // review: they answer it, and nobody else. The route itself is unchanged.
        var chosenBySender = new List<string>();
        for (var i = 0; i < route.Steps.Count && request.People is { } chosen && i < chosen.Length; i++)
        {
            if (route.Steps[i].PartyCode is not null || chosen[i] is not { Length: > 0 } ids) continue;
            route.Steps[i].FunctionCode = null;
            route.Steps[i].UserIds = ids.Distinct().ToArray();
            chosenBySender.Add($"step {i + 1}");
        }

        // Every step must have someone to answer it, a party's step a reason to
        // send it to them, and the one who decides, if ours, must be allowed to
        // approve this document. An outside party's approval is theirs to give.
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var parties = await db.Parties.AsNoTracking().Where(p => p.Active && !p.IsInternal).ToDictionaryAsync(p => p.Code, cancellationToken);
        for (var i = 0; i < route.Steps.Count; i++)
        {
            var step = route.Steps[i];
            Party? party = null;
            if (step.PartyCode is { } code)
            {
                if (!parties.TryGetValue(code, out party))
                {
                    return Fail(Problems.Invalid("STEP_PARTY_UNKNOWN",
                        $"Step {i + 1} ({step.Title}) names {code}, which is not an active outside party.",
                        new { step = i + 1, party = code }));
                }
                if (step.Reason is null || !catalog.IsActive(TransmittalSets.Reasons, step.Reason))
                {
                    return Fail(Problems.Invalid("STEP_NEEDS_REASON",
                        $"Step {i + 1} ({step.Title}) goes to {party.Name} by transmittal and needs a published reason for issue.",
                        new { step = i + 1, reason = step.Reason }));
                }
            }
            if ((await SeatsAsync(access.Project, step.FunctionCode, party, party?.Participation, cancellationToken, step.UserIds, document)).Count == 0)
            {
                return Fail(Problems.Invalid("STEP_HAS_NO_HOLDER",
                    party is null ? step.FunctionCode is null
                        ? $"Nobody named on step {i + 1} ({step.Title}) is on this project and cleared for {document.Confidentiality ?? "this document"}, so it could not be answered."
                        : $"Nobody {(step.UserIds.Length > 0 ? "named on it, nor anybody holding " : "holds ")}{step.FunctionCode} on this project with a clearance that reaches {document.Confidentiality ?? "this document"}, so step {i + 1} ({step.Title}) could not be answered."
                    : party.Participation == Participations.InApp
                        ? $"Nobody from {party.Name} is on this project, so step {i + 1} ({step.Title}) could not be answered."
                        : $"Nobody on this project carries the exchange with {party.Name}, so step {i + 1} ({step.Title}) could not be answered.",
                    new { step = i + 1, function = step.FunctionCode, party = step.PartyCode }));
            }
        }
        var deciding = route.Steps[^1];
        if (deciding.PartyCode is null && deciding.FunctionCode is null)
        {
            // Only people named: each decides on the strength of a function of theirs on the project.
            var named = await db.Memberships.AsNoTracking().Include(m => m.Function!).ThenInclude(f => f.Rules)
                .Where(m => m.ProjectId == access.Project.Id && m.Active && m.Function!.Active && deciding.UserIds.Contains(m.UserId))
                .ToListAsync(cancellationToken);
            if (!named.Any(m => Allows(m.Function!, access.Project, Verbs.Approve, document.Facts)))
            {
                return Fail(Problems.Invalid("DECIDER_CANNOT_APPROVE",
                    "Nobody named on the deciding step may approve this document.", new { step = route.Steps.Count }));
            }
        }
        else if (deciding.PartyCode is null)
        {
            var decider = await db.Functions.AsNoTracking().Include(f => f.Rules)
                .SingleOrDefaultAsync(f => f.Code == deciding.FunctionCode && f.Active, cancellationToken);
            if (decider is null || !Allows(decider, access.Project, Verbs.Approve, document.Facts))
            {
                return Fail(Problems.Invalid("DECIDER_CANNOT_APPROVE",
                    $"The deciding step is answered by {deciding.FunctionCode}, which may not approve this document.",
                    new { function = deciding.FunctionCode }));
            }
        }

        var number = await numbering.RecordAsync(access.Project.TenantId, access.Project.Id, RecordKinds.Review,
            NumberFields.ForRecord(access.Project.Code), "RV", cancellationToken);
        var now = clock.GetCurrentInstant();
        var review = new Review
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            DocumentId = document.Id,
            RevisionId = revision.Id,
            Number = number,
            RouteName = route.Name,
            VerdictSet = ReviewSets.Verdicts,
            // The route's own set of verdicts, else the set serving the document's deliverable type (owner).
            Verdicts = route.Verdicts ?? (await Catalog.LoadAsync(db, cancellationToken)).ServingSetName(ReviewSets.Verdicts, document.DeliverableType),
            Advice = route.Advice ?? (await Catalog.LoadAsync(db, cancellationToken)).ServingSetName(ReviewSets.Advice, document.DeliverableType),
            StartedById = access.UserId,
            StartedByName = access.UserName,
            StartedAt = now,
            Steps = route.Steps.Select((s, i) =>
            {
                var party = s.PartyCode is null ? null : parties[s.PartyCode];
                return new ReviewStep
                {
                    TenantId = access.Project.TenantId,
                    Index = i,
                    Title = s.Title,
                    FunctionCode = party is null ? s.FunctionCode : null,
                    // A route stored before steps named people has no list at all: none named.
                    UserIds = party is null ? s.UserIds ?? [] : [],
                    PartyId = party?.Id,
                    PartyName = party?.Name,
                    Participation = party?.Participation,
                    Reason = party is null ? null : s.Reason,
                    // One of ours records the party's single answer.
                    Mode = party?.Participation == Participations.ByProxy ? StepModes.Any : s.Mode,
                    Deciding = i == route.Steps.Count - 1,
                    Days = s.Days,
                    GrantsStatuses = s.GrantsStatuses ?? [],
                };
            }).ToList(),
        };
        // Copied in: people on the project, told now and of what comes of it.
        // Not asked on this project: nobody is copied in.
        var copies = reviewForm.Rules.GetValueOrDefault("copies") == Settings.FormRules.Off ? [] : (request.Copies ?? []).Distinct().ToList();
        review.CopyUserIds = copies.Count == 0 ? [] : [.. await db.Memberships.AsNoTracking()
            .Where(m => m.ProjectId == access.Project.Id && m.Active && copies.Contains(m.UserId)).Select(m => m.UserId).Distinct().ToListAsync(cancellationToken)];
        db.Reviews.Add(review);
        // Sending a review to its reviewers (REVIEW_ISSUE): where the control function carries it out, the review waits for
        // them to send it on (IssueToReviewersAsync); otherwise it goes to its first step's people at once.
        var held = !access.Holds(Verbs.Control)
            && await Settings.ProjectAnswers.ControlDoesAsync(db, access.Project.Id, "REVIEW_ISSUE", cancellationToken);
        if (!held) await OpenStepAsync(access, review, 0, cancellationToken);

        revision.State = RevisionStates.InReview;
        // Under review, a revision with no purpose yet is issued for review: each step confirms it or changes it.
        if (revision.StatusCode is null && catalog.IsActive(ReviewSets.Statuses, "IFR")) revision.StatusCode = "IFR";
        document.LatestRevisionState = RevisionStates.InReview;
        document.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor(access), "REVIEW_STARTED", "Review", review.Id, review.Number,
            $"{document.Number} rev {revision.Value} sent for review on route {route.Name}"
            + (chosenBySender.Count > 0 ? $", the sender choosing the people on {string.Join(", ", chosenBySender)}." : ".")
            + (review.CopyUserIds.Length > 0 ? $" {review.CopyUserIds.Length} copied in." : "")
            + (held ? " Waiting for the control function to send it to its reviewers." : ""), access.Project.Id, cancellationToken);
        if (held)
            await TellAsync(review, await notifier.ControlHoldersAsync(access.Project.Id, cancellationToken), Notifications.NotificationKinds.ReviewStep,
                $"{TransmittalService.Label(document, revision)} sent for review: send it to its reviewers",
                $"Review {review.Number}, sent by {access.UserName} on route {route.Name}. It waits for you to send it to its first step.", cancellationToken);
        if (review.CopyUserIds.Length > 0)
            await TellAsync(review, review.CopyUserIds, Notifications.NotificationKinds.General,
                $"{TransmittalService.Label(document, revision)} sent for review: you are copied in",
                $"Review {review.Number}, sent by {access.UserName}. You are kept informed; nothing is asked of you.", cancellationToken);
        return (review, null);
    }
}
