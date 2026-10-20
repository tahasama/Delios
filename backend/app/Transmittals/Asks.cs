using Delios.Host.Identity;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Transmittals;

/// <summary>One decision the person reading may take on what a transmittal asks: its words, and where it is taken.</summary>
public sealed record AskChoice(string Label, string Href);

/// <summary>
/// What a request transmittal asks, worked out once here and read by its page (owner: "unify transmittals"): what it
/// asks, where that is decided (the action, People to confirm, the package: the decision needs its context, so it is
/// taken there), who it waits for, and once answered, by whom, when, what, and the reply that answered it. The person
/// asked gets the decisions as buttons, each opening the form where it is taken, already chosen; anyone else reads where
/// it stands.
/// </summary>
public sealed record TransmittalAsk(string Kind, string What, string Where, string Place, string? WaitingFor,
    DateTimeOffset? AnsweredAt, string? AnsweredBy, string? Answer, Guid? ReplyId, string? ReplyNumber, IReadOnlyList<AskChoice> Choices);

public static class Asks
{
    /// <summary>The address a decision opens: the page, the one to decide, and the choice made (`decide`, `as`).</summary>
    private static string Decide(string page, string key, string choice) =>
        $"{page}{(page.Contains('?') ? '&' : '?')}decide={key}&as={choice}#decide-{key}";

    /// <summary>What the transmittal asks, or null when it asks nothing that is decided elsewhere.</summary>
    public static async Task<TransmittalAsk?> OfAsync(DeliosDbContext db, ProjectAccess access, Guid transmittalId, CancellationToken cancellationToken)
    {
        var t = await db.Transmittals.AsNoTracking().SingleOrDefaultAsync(x => x.Id == transmittalId, cancellationToken);
        if (t is null || t.Direction != TransmittalDirections.Outgoing || !access.IsInternal) return null;
        var reply = await db.Transmittals.AsNoTracking().Where(x => x.InReplyToId == t.Id).OrderBy(x => x.IssuedAt)
            .Select(x => new { x.Id, x.Number }).FirstOrDefaultAsync(cancellationToken);
        static DateTimeOffset? At(Instant? at) => at?.ToDateTimeOffset();

        // Something to add to an action (a document, or a change to its disciplines): the control function answers it on
        // the action; where confirmation is asked, it checks it and whoever it names confirms.
        if (t.ActivityId is { } activityId)
        {
            var code = await db.Activities.AsNoTracking().Where(a => a.Id == activityId).Select(a => a.Code).SingleOrDefaultAsync(cancellationToken);
            if (code is null) return null;
            var page = $"/actions/{code}";
            var discipline = t.ActivityAskKind == "DISCIPLINE";
            var what = discipline ? $"A change to the disciplines of {code}" : $"A document to be added to {code}";
            var choices = new List<AskChoice>();
            string? waiting = null;
            if (t.ActivityAnsweredAt is null)
            {
                if (t.ActivityCheckedAt is null)
                {
                    waiting = "the control function";
                    if (access.Holds(Verbs.Control))
                    {
                        choices.Add(new(t.ActivityConfirm ? "Check it" : discipline ? "Change the disciplines" : "Add it", Decide(page, t.Id.ToString(), "add")));
                        choices.Add(new("Nothing to add", Decide(page, t.Id.ToString(), "refuse")));
                    }
                }
                else
                {
                    waiting = t.ActivityConfirmerName ?? "whoever holds Manage";
                    if (t.ActivityConfirmerId == access.UserId)
                    {
                        choices.Add(new("Confirm", Decide(page, t.Id.ToString(), "confirm")));
                        choices.Add(new("Refuse", Decide(page, t.Id.ToString(), "refuse")));
                    }
                }
            }
            return new TransmittalAsk(discipline ? "ACTION_DISCIPLINE" : "ACTION_DOCUMENT", what, page, code, waiting,
                At(t.ActivityAnsweredAt), t.ActivityAnsweredByName, t.ActivityAnswer, reply?.Id, reply?.Number, choices);
        }

        // A postponement, for whoever plans the project to confirm (the control function may take it back).
        var postponed = await (from d in db.ActivityDecisions.AsNoTracking()
                               join a in db.Activities.AsNoTracking() on d.ActivityId equals a.Id
                               where d.TransmittalId == t.Id
                               select new { d, a.Code }).FirstOrDefaultAsync(cancellationToken);
        if (postponed is not null)
        {
            var d = postponed.d;
            var page = $"/actions/{postponed.Code}";
            var open = d.ConfirmedAt is null && d.ReversedAt is null;
            var choices = new List<AskChoice>();
            if (open && access.Holds(Verbs.Plan)) choices.Add(new("Confirm the postponement", Decide(page, d.Id.ToString(), "confirm")));
            if (open && access.Holds(Verbs.Control)) choices.Add(new("Take it back", Decide(page, d.Id.ToString(), "refuse")));
            return new TransmittalAsk("POSTPONEMENT", $"{postponed.Code} postponed: whoever plans the project confirms it", page, postponed.Code,
                open ? "whoever plans the project" : null,
                At(d.ConfirmedAt ?? d.ReversedAt), d.ConfirmedByName ?? d.ReversedByName,
                d.ConfirmedAt is not null ? $"confirmed: {d.ConfirmNote}" : d.ReversedAt is not null ? $"taken back: {d.ReversedReason}" : null,
                reply?.Id, reply?.Number, choices);
        }

        // Someone to join the project, for whoever was named (else whoever answers) to confirm.
        var membership = await (from m in db.Memberships.AsNoTracking()
                                join u in db.Users.AsNoTracking() on m.UserId equals u.Id
                                where m.ConfirmTransmittalId == t.Id
                                select new { m, u.Name }).FirstOrDefaultAsync(cancellationToken);
        if (membership is not null)
        {
            var m = membership.m;
            const string page = "/people/confirm";
            var open = m.PendingSince is not null;
            var choices = new List<AskChoice>();
            if (open && (m.ConfirmerId == access.UserId || (m.ConfirmerId is null && await JoinRequests.AnswersAsync(db, access, cancellationToken))))
            {
                choices.Add(new("Confirm", Decide(page, m.Id.ToString(), "confirm")));
                choices.Add(new("Refuse", Decide(page, m.Id.ToString(), "refuse")));
            }
            return new TransmittalAsk("JOIN", $"{membership.Name} to join {access.Project.Code}", page, "People to confirm",
                open ? m.ConfirmerName ?? "whoever holds Manage" : null,
                open ? null : At(m.ConfirmedAt ?? m.RefusedAt), open ? null : m.ConfirmedByName ?? m.RefusedByName,
                open ? null : m.RefusedAt is not null ? $"refused: {m.RefusedReason}" : "confirmed",
                reply?.Id, reply?.Number, choices);
        }

        // What a delivery package is missing: may it go without it? Its acceptance authority answers on the package.
        if (t.PackageId is { } packageId && t.Reason == Actions.ActionLetters.Request && !await db.TransmittalItems.AnyAsync(i => i.TransmittalId == t.Id, cancellationToken))
        {
            var package = await db.Packages.AsNoTracking().SingleOrDefaultAsync(p => p.Id == packageId, cancellationToken);
            if (package is null) return null;
            var page = $"/packages/{package.Number}";
            var open = package.ShortfallAcceptedAt is null;
            var choices = open && package.AcceptorIds.Contains(access.UserId)
                ? new List<AskChoice> { new("Deliver it as it stands", Decide(page, "shortfall", "confirm")) } : [];
            return new TransmittalAsk("SHORTFALL", $"{package.Number}: may it go without what is missing?", page, package.Number,
                open ? "whoever accepts the package" : null, At(package.ShortfallAcceptedAt), package.ShortfallAcceptedByName,
                open ? null : "goes as it stands", reply?.Id, reply?.Number, choices);
        }
        return null;
    }
}
