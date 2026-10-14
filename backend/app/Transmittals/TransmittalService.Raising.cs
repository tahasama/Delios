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
    // ── Raising ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Someone a transmittal is addressed to: a user (<c>UserId</c> set) or an organization with nobody here
    /// (<c>UserId</c> empty, <c>PartyId</c> set).
    /// </summary>
    public sealed record Addressee(Guid? UserId, Guid? PartyId, string Name, string? Organization, string Kind = RecipientKinds.To);

    /// <summary>
    /// Everything needed to raise one transmittal. Built by issue requests, review steps sent to a party, and package
    /// delivery, then passed to <c>RaiseAsync</c>. <c>Dispatched</c> is set when it was already sent outside the
    /// system.
    /// </summary>
    public sealed record Raise(
        Project Project, Actor Actor, string Reason, string Subject, string? Message, Party? To, string ToName,
        IReadOnlyList<(Document Document, Revision Revision)> Items, IReadOnlyList<Addressee> Recipients,
        Guid? IssueRequestId = null, Guid? ReviewStepId = null, LocalDate? ResponseDue = null, Guid? PackageId = null,
        DispatchRequest? Dispatched = null, IReadOnlyList<(Document Document, LocalDate? Due)>? Placeholders = null,
        IReadOnlyList<Addressee>? Copies = null, Instant? IssuedAt = null, Guid? InReplyToId = null, Guid? FollowsId = null,
        string? FollowKind = null, string? Extras = null, Guid? ActivityId = null, string? ActivityAsk = null);

    /// <summary>
    /// The whole transmittal, as its page shows it, for the email each person it goes to receives: number, project,
    /// subject, who sent it and when, to whom and who is copied in, what it is issued for and by when an answer is
    /// due, the message, and every document with its revision and status.
    /// </summary>
    private static string TransmittalEmail(Project project, Transmittal t, Catalog catalog, IReadOnlyList<Addressee> addressed, string? ours, string listed)
    {
        static string Who(Addressee a) => a.Organization is null || a.Organization == a.Name ? a.Name : $"{a.Name} ({a.Organization})";
        var to = addressed.Where(a => a.Kind != RecipientKinds.Cc).Select(Who).ToList();
        var copies = addressed.Where(a => a.Kind == RecipientKinds.Cc).Select(Who).ToList();
        var text = new System.Text.StringBuilder();
        text.AppendLine($"Transmittal {t.Number} · {project.Code} {project.Name}");
        text.AppendLine(t.Subject);
        text.AppendLine();
        text.AppendLine($"From: {t.IssuedByName}{(ours is null ? "" : $" ({ours})")}, {t.IssuedAt.InZone(DateTimeZoneProviders.Tzdb.GetZoneOrNull(project.TimeZone) ?? DateTimeZone.Utc).Date:yyyy-MM-dd}");
        if (to.Count > 0) text.AppendLine($"To: {string.Join(", ", to)}");
        if (copies.Count > 0) text.AppendLine($"Copied in: {string.Join(", ", copies)}");
        text.AppendLine($"Issued for: {catalog.Label(TransmittalSets.Reasons, t.Reason)}");
        if (t.ResponseDue is { } due) text.AppendLine($"Answer by: {due:yyyy-MM-dd}");
        if (!string.IsNullOrWhiteSpace(t.Message))
        {
            text.AppendLine();
            text.AppendLine(t.Message);
        }
        text.AppendLine();
        text.AppendLine(t.Items.Count == 0 ? "No documents: the message is the transmittal." : $"Documents ({t.Items.Count}):");
        if (t.Items.Count > 0) text.AppendLine(listed);
        text.AppendLine();
        text.Append("Open it to see the files and acknowledge it:");
        return text.ToString();
    }

    /// <summary>A numbered transmittal. What it records is never changed afterwards.</summary>
    public async Task<Transmittal> RaiseAsync(Raise raise, CancellationToken cancellationToken)
    {
        var project = raise.Project;
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var ours = await db.Parties.AsNoTracking().Where(p => p.IsInternal && p.Active).OrderBy(p => p.Code)
            .Select(p => p.Code).FirstOrDefaultAsync(cancellationToken);
        var number = await numbering.RecordAsync(project.TenantId, project.Id, RecordKinds.Transmittal,
            NumberFields.ForRecord(project.Code, ours, raise.To?.Code ?? ours), "TR", cancellationToken);

        var now = clock.GetCurrentInstant();
        var responseRequired = catalog.Prop(TransmittalSets.Reasons, raise.Reason, "response") is { ValueKind: JsonValueKind.True };
        var due = raise.ResponseDue;
        if (due is null && responseRequired
            && catalog.Prop(TransmittalSets.Reasons, raise.Reason, "responseDays") is { ValueKind: JsonValueKind.Number } days)
        {
            due = WorkingCalendar.AddWorkingDays(WorkingCalendar.Today(clock, project.TimeZone), days.GetInt32(), project.WeekendDays);
        }

        var transmittal = new Transmittal
        {
            TenantId = project.TenantId,
            ProjectId = project.Id,
            Number = number,
            Reason = raise.Reason,
            Subject = raise.Subject,
            Message = raise.Message,
            ToPartyId = raise.To?.Id,
            ToName = raise.ToName,
            ResponseRequired = responseRequired || raise.ResponseDue is not null,
            ResponseDue = due,
            IssuedAt = raise.IssuedAt ?? now,
            InReplyToId = raise.InReplyToId,
            FollowsId = raise.FollowsId,
            FollowKind = raise.FollowKind,
            Extras = raise.Extras,
            ActivityId = raise.ActivityId,
            ActivityAskKind = raise.ActivityAsk,
            // Whether management confirms it is the project's answer when it is raised, and stays so.
            ActivityConfirm = raise.ActivityId is not null
                && await Delios.Host.Settings.ProjectAnswers.NeedsConfirmationAsync(db, project.Id, "ACTION_LINKS", cancellationToken),
            IssuedById = raise.Actor.Id,
            IssuedByName = raise.Actor.Name,
            IssueRequestId = raise.IssueRequestId,
            ReviewStepId = raise.ReviewStepId,
            PackageId = raise.PackageId,
        };
        transmittal.Items = raise.Items.Select(x => new TransmittalItem
        {
            TenantId = project.TenantId,
            TransmittalId = transmittal.Id,
            DocumentId = x.Document.Id,
            RevisionId = x.Revision.Id,
            DocumentNumber = x.Document.Number,
            Title = x.Document.Title,
            RevisionValue = x.Revision.Value,
            StatusCode = x.Revision.StatusCode,
        }).ToList();
        // Placeholders a supplier is asked to fill: no revision yet, a date each is due.
        transmittal.Items.AddRange((raise.Placeholders ?? []).Select(x => new TransmittalItem
        {
            TenantId = project.TenantId,
            TransmittalId = transmittal.Id,
            Kind = TransmittalItemKinds.Placeholder,
            DocumentId = x.Document.Id,
            DocumentNumber = x.Document.Number,
            Title = x.Document.Title,
            RevisionValue = "",
            DueDate = x.Due,
        }));
        // A placeholder sent hands the document to the supplier: only they change it now.
        var placed = (raise.Placeholders ?? []).Select(x => x.Document.Id).ToList();
        if (placed.Count > 0)
        {
            // The documents are the ones loaded when the transmittal was prepared: changed there, saved once with it
            // (a second, direct update would leave them out of date and the save would be refused).
            var held = new Dictionary<Guid, Document>();
            foreach (var id in placed)
                if (await db.Documents.FindAsync([id], cancellationToken) is { } one) { one.WithSupplier = true; held[id] = one; }
            // Its line in the supplier's package says it was asked, whichever way it went (package or register).
            var askedAt = clock.GetCurrentInstant();
            await db.PackageMembers.Where(m => placed.Contains(m.DocumentId) && m.RequestedAt == null
                    && db.Packages.Any(p => p.Id == m.PackageId && p.Kind == Packages.PackageKinds.Supply))
                .ExecuteUpdateAsync(m => m.SetProperty(x => x.RequestedAt, askedAt), cancellationToken);
            // A revision not yet reviewed goes to them as it is: they send it back under the same value.
            var unreviewed = await db.Revisions.Where(r => placed.Contains(r.DocumentId) && db.Documents.Any(d => d.LatestRevisionId == r.Id)
                && (r.State == RevisionStates.Received || r.State == RevisionStates.InPreparation || r.State == RevisionStates.Correcting))
                .ToListAsync(cancellationToken);
            var handedAt = clock.GetCurrentInstant();
            foreach (var r in unreviewed)
            {
                r.State = RevisionStates.Correcting;
                r.ResentAt = handedAt;
                r.ResentByName = raise.Actor.Name;
                r.ResentNote = raise.Message;
            }
            if (unreviewed.Count > 0)
            {
                var back = unreviewed.Select(r => r.DocumentId).ToList();
                foreach (var id in back) if (held.TryGetValue(id, out var one)) one.LatestRevisionState = RevisionStates.Correcting;
            }
        }
        var addressed = raise.Recipients
            .Concat((raise.Copies ?? []).Where(c => !raise.Recipients.Any(r => r.UserId == c.UserId))).ToList();
        transmittal.Recipients = addressed.Select(a => new TransmittalRecipient
        {
            TenantId = project.TenantId,
            TransmittalId = transmittal.Id,
            Kind = a.Kind,
            NotifiedAt = a.UserId is null ? null : now,
            UserId = a.UserId,
            PartyId = a.PartyId,
            Name = a.Name,
            Organization = a.Organization,
            DispatchedAt = a.UserId is null && raise.Dispatched is not null ? now : null,
            DispatchChannel = a.UserId is null ? raise.Dispatched?.Channel : null,
            DispatchRef = a.UserId is null ? raise.Dispatched?.Reference : null,
            DispatchedByName = a.UserId is null && raise.Dispatched is not null ? raise.Actor.Name : null,
            ProofFileId = a.UserId is null ? raise.Dispatched?.ProofFileId : null,
        }).ToList();
        db.Transmittals.Add(transmittal);
        await audit.WriteAsync(raise.Actor, "TRANSMITTAL_ISSUED", "Transmittal", transmittal.Id, number,
            $"{raise.Reason} to {raise.ToName}: {string.Join(", ", transmittal.Items.Select(i => i.Kind == TransmittalItemKinds.Placeholder
                ? $"{i.DocumentNumber} (to send by {i.DueDate?.ToString("yyyy-MM-dd", null) ?? "no date"})" : $"{i.DocumentNumber} rev {i.RevisionValue}"))}.",
            project.Id, cancellationToken);
        // The people it goes to who hold accounts are told, and emailed under the transmittal switch; an
        // organization answering through one of ours is sent it by that person, as the dispatch records.
        var listed = string.Join("\n", transmittal.Items.Select(i => i.Kind == TransmittalItemKinds.Placeholder
            ? $"- {i.DocumentNumber} {i.Title} (to send by {i.DueDate?.ToString("yyyy-MM-dd", null) ?? "no date"})"
            : $"- {i.DocumentNumber} rev {i.RevisionValue} {i.Title}{(i.StatusCode is null ? "" : $" ({i.StatusCode})")}"));
        await notifier.NotifyAsync(project.TenantId, project.Id, addressed.Where(a => a.UserId is not null).Select(a => a.UserId!.Value),
            Notifications.NotificationKinds.TransmittalReceived, $"{number}: {raise.Subject}",
            $"{raise.Reason} from {raise.Actor.Name}{(due is null ? "" : $", answer by {due:yyyy-MM-dd}")}.\n{listed}{(raise.Message is null ? "" : $"\n\n{raise.Message}")}",
            $"/transmittals/{transmittal.Id}", cancellationToken, Notifications.EmailKinds.Transmittal,
            TransmittalEmail(project, transmittal, catalog, addressed, ours, listed));
        // An organization nobody of which signs in here gets it by email, with its files and a reply address of its own.
        var forThem = TransmittalEmail(project, transmittal, catalog, addressed, ours, listed);
        await emailReplies.SendToOrganizationsAsync(project, transmittal, forThem[..forThem.LastIndexOf('\n')].TrimEnd(), cancellationToken);
        return transmittal;
    }
}
