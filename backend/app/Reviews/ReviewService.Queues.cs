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
    // ── Queues ────────────────────────────────────────────────────────────────

    /// <summary>One entry in a person's review to-do list. <c>Kind</c> says what to do (for example ANSWER_STEP, DISPATCH_STEP, RECORD_ANSWER, READY_TO_RELEASE, SEND_BACK); <c>Since</c> is when it started waiting.</summary>
    /// <summary>
    /// One review waiting on someone. <c>Deciding</c>: their step gives the verdict (otherwise it is advice). On Document
    /// Control's gate, <c>Verdict</c> and <c>Status</c> are what the review decided and the status it grants.
    /// </summary>
    public sealed record WorkItem(Guid ReviewId, string Number, Guid DocumentId, string DocumentNumber, string Title,
        string RevisionValue, string Kind, string? StepTitle, DateOnly? DueDate, DateTimeOffset Since, bool Deciding = false,
        string? Verdict = null, string? Status = null);

    /// <summary>What this person has waiting: their open steps, and the control function's gate.</summary>
    public async Task<object> WorkAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        var me = access.UserId;
        var today = WorkingCalendar.Today(clock, access.Project.TimeZone);
        var open = await (
            from p in db.ReviewParticipants
            join s in db.ReviewSteps on p.StepId equals s.Id
            join r in db.Reviews on s.ReviewId equals r.Id
            join d in db.Documents on r.DocumentId equals d.Id
            join v in db.Revisions on r.RevisionId equals v.Id
            where (p.UserId == me || db.Set<ReviewDelegation>().Any(dl => dl.ReviewId == r.Id && dl.StepIndex == s.Index
                    && dl.FromUserId == p.UserId && dl.ToUserId == me && dl.Status == DelegationStates.Active && dl.EndDate >= today))
                && p.AnsweredAt == null && s.State == StepStates.Open && r.ProjectId == access.Project.Id
            orderby s.OpenedAt
            select new
            {
                r.Id,
                r.Number,
                DocumentId = d.Id,
                DocumentNumber = d.Number,
                d.Title,
                v.Value,
                Title2 = s.Title,
                s.DueDate,
                s.OpenedAt,
                s.Participation,
                s.DispatchedAt,
                s.Deciding
            })
            .ToListAsync(cancellationToken);
        // A party's step answered by proxy is one task with two acts: send it, then record what came back.
        var mySteps = open.Select(x => new WorkItem(x.Id, x.Number, x.DocumentId, x.DocumentNumber, x.Title, x.Value,
            x.Participation != Participations.ByProxy ? "ANSWER_STEP" : x.DispatchedAt is null ? "DISPATCH_STEP" : "RECORD_ANSWER",
            x.Title2, x.DueDate?.ToDateOnly(), (x.DispatchedAt ?? x.OpenedAt)!.Value.ToDateTimeOffset(), x.Deciding)).ToList();

        List<WorkItem> gate = [];
        if (access.Holds(Verbs.Control))
        {
            var catalog = await Catalog.LoadAsync(db, cancellationToken);
            var decided = await (
                from r in db.Reviews
                join d in db.Documents on r.DocumentId equals d.Id
                join v in db.Revisions on r.RevisionId equals v.Id
                where r.ProjectId == access.Project.Id && r.State == ReviewStates.Decided
                orderby r.DecidedAt
                select new { r.Id, r.Number, DocumentId = d.Id, DocumentNumber = d.Number, d.Title, v.Value, r.Verdict, r.VerdictSet, r.GrantedStatus, r.DecidedAt })
                .ToListAsync(cancellationToken);
            gate = decided.Select(x => new WorkItem(x.Id, x.Number, x.DocumentId, x.DocumentNumber, x.Title, x.Value,
                x.Verdict is null || Proceeds(catalog, x.VerdictSet, x.Verdict) ? "READY_TO_RELEASE" : "SEND_BACK", null, null,
                x.DecidedAt!.Value.ToDateTimeOffset(), true, x.Verdict, x.GrantedStatus)).ToList();
        }
        return new
        {
            steps = mySteps,
            gate,
            revisions = await control.WorkAsync(access, cancellationToken),
            issues = await transmittals.WorkAsync(access, cancellationToken),
        };
    }
}
