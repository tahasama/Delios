using System.Text.Json;
using Delios.Host.Documents;
using Delios.Host.Reviews;

namespace Delios.Host.Transmittals;

/// <summary>What Document Control's check on arrival said of one submission: still to check, returned, or accepted; who, when, why.</summary>
public sealed record ArrivalView(string State, string? By, DateTimeOffset? At, string? Note);

/// <summary>
/// Where a submission another organization sent stands with Document Control's check on arrival, said once for the
/// transmittal list and the transmittal page. The check is kept on the submission itself (<see cref="SubmissionRecord.Check"/>);
/// a submission checked before that was kept is read from the revision: still received is to check, back with the
/// sender is returned, and an older submission is returned when its outcome is a return.
/// </summary>
public static class Arrivals
{
    public const string ToCheck = "TO_CHECK", Returned = "RETURNED", Accepted = "ACCEPTED";

    /// <summary>The check on the submission an item carried; null for anything that is not a submission.</summary>
    public static ArrivalView? Of(string kind, int? submission, Revision? revision, Catalog catalog)
    {
        if (revision is null || kind != TransmittalItemKinds.Submission) return null;
        var number = submission ?? revision.Submission;
        var record = revision.Submissions.FirstOrDefault(s => s.Number == number);
        if (record?.Check is { } check)
            return new ArrivalView(check, record.CheckedByName, record.CheckedAt?.ToDateTimeOffset(), check == Returned ? record.CheckNote : null);
        var current = revision.Submission == number;
        if (current && revision.State == RevisionStates.Received) return new ArrivalView(ToCheck, null, null, null);
        var returned = current
            ? revision.State is RevisionStates.Correcting or RevisionStates.Returned
            : record?.Outcome is { } outcome
                ? catalog.Prop(ReviewSets.ControlOutcomes, outcome, "act") is { ValueKind: JsonValueKind.String } act && act.GetString() == ControlService.Return
                : record?.Note is not null;
        return new ArrivalView(returned ? Returned : Accepted, record?.DecidedByName, record?.DecidedAt?.ToDateTimeOffset(),
            returned ? (current ? revision.ReturnedReason : record?.Note) : null);
    }

    /// <summary>The check on a whole incoming transmittal, read from its submissions: to check while one waits, else returned, partly returned or accepted.</summary>
    public static string? Overall(IEnumerable<ArrivalView> arrivals)
    {
        var all = arrivals.Select(a => a.State).ToList();
        if (all.Count == 0) return null;
        return all.Contains(ToCheck) ? ToCheck : all.All(a => a == Returned) ? Returned : all.Contains(Returned) ? "PARTLY_RETURNED" : Accepted;
    }
}
