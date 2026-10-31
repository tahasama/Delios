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
    // ── A party answering by proxy ────────────────────────────────────────────

    /// <summary>
    /// One of ours records that the open step went to its party: when, how, their
    /// reference. The step's clock runs from here, and the transmittal that
    /// carried it is raised.
    /// </summary>
    public async Task<(Review? Review, IResult? Problem)> DispatchAsync(
        ProjectAccess access, Guid reviewId, DispatchRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        var step = OpenStep(review);
        if (review.State != ReviewStates.InProgress || step is null || !step.ByProxy || await SeatAsync(review, step, access, cancellationToken) is null)
        {
            return (null, Problems.Forbidden("NOT_CUSTODIAN",
                "Whoever carries the exchange with the party on the open step records that it went."));
        }
        if (step.DispatchedAt is not null) return (null, Problems.Conflict("ALREADY_DISPATCHED", "It is already recorded as sent."));
        var channel = request.Channel?.Trim() ?? "";
        if (channel.Length == 0) return (null, Problems.Invalid("CHANNEL_REQUIRED", "Say how it went: email, their portal, by hand."));
        if (request.ProofFileId is { } proof
            && await transmittals.BindEvidenceAsync(access, proof, review.RevisionId, cancellationToken) is { } bad) return (null, bad);

        var project = access.Project;
        var party = await db.Parties.AsNoTracking().SingleAsync(p => p.Id == step.PartyId, cancellationToken);
        var (document, revision) = await SubjectAsync(review, cancellationToken);
        step.DispatchedAt = clock.GetCurrentInstant();
        step.DispatchChannel = channel;
        step.DispatchRef = request.Reference?.Trim() is { Length: > 0 } reference ? reference : null;
        step.DispatchedByName = access.UserName;
        step.DueDate = step.Days is { } days
            ? WorkingCalendar.AddWorkingDays(WorkingCalendar.Today(clock, project.TimeZone), days, project.WeekendDays,
                await WorkingCalendar.HolidaysAsync(db, project, cancellationToken)) : null;
        var transmittal = await transmittals.RaiseAsync(new TransmittalService.Raise(project, Actor(access), step.Reason!,
            $"{TransmittalService.Label(document, revision)}: {step.Title}", null, party, party.Name, [(document, revision)],
            [new TransmittalService.Addressee(null, party.Id, party.Name, party.Name)], ReviewStepId: step.Id,
            ResponseDue: step.DueDate, Dispatched: request with { Channel = channel, Reference = step.DispatchRef }), cancellationToken);
        step.TransmittalId = transmittal.Id;
        await audit.WriteAsync(Actor(access), "STEP_DISPATCHED", "Review", review.Id, review.Number,
            $"Step {step.Index + 1} ({step.Title}) sent to {party.Name} by {channel} on {transmittal.Number}"
            + (step.DispatchRef is null ? "." : $", their reference {step.DispatchRef}."), review.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (review, null);
    }

    /// <summary>Somewhere to upload a party's proof: their stamped copy, the message that carried their answer.</summary>
    public async Task<(UploadTicket? Ticket, IResult? Problem)> EvidenceAsync(
        ProjectAccess access, Guid reviewId, UploadRequest request, CancellationToken cancellationToken)
    {
        var review = await LoadAsync(access, reviewId, cancellationToken);
        if (review is null) return (null, NotFound());
        var step = OpenStep(review);
        if (review.State != ReviewStates.InProgress || step is null || !step.ByProxy || await SeatAsync(review, step, access, cancellationToken) is null)
        {
            return (null, Problems.Forbidden("NOT_CUSTODIAN",
                "Whoever carries the exchange with the party on the open step files its proof."));
        }
        return await transmittals.EvidenceTicketAsync(access, review.DocumentId, review.RevisionId, request, cancellationToken);
    }
}
