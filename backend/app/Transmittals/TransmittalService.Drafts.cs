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
    // ── Drafts ────────────────────────────────────────────────────────────────

    /// <summary>Keeps a transmittal as a draft: checked as if it were issued now, sent to nobody, numbered when issued.</summary>
    public async Task<(TransmittalDraft? Draft, IResult? Problem)> SaveDraftAsync(ProjectAccess access, ComposeRequest request, CancellationToken cancellationToken)
    {
        var (prepared, problem) = await PrepareAsync(access, request with { Draft = false }, cancellationToken);
        if (problem is not null) return (null, problem);
        var draft = new TransmittalDraft
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            CreatedById = access.UserId,
            CreatedByName = access.UserName,
            CreatedAt = clock.GetCurrentInstant(),
            Subject = prepared!.Subject,
            Body = JsonSerializer.Serialize(request with { Draft = false }),
        };
        db.Add(draft);
        await db.SaveChangesAsync(cancellationToken);
        return (draft, null);
    }

    /// <summary>A draft the caller may see: their own, or any for the control function. Null otherwise.</summary>
    public Task<TransmittalDraft?> DraftAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken) =>
        db.Set<TransmittalDraft>().SingleOrDefaultAsync(d => d.Id == id && d.ProjectId == access.Project.Id
            && (d.CreatedById == access.UserId || access.Holds(Verbs.Control)), cancellationToken);

    /// <summary>The drafts not yet issued that the caller may see, newest first.</summary>
    public Task<List<TransmittalDraft>> DraftsAsync(ProjectAccess access, CancellationToken cancellationToken) =>
        db.Set<TransmittalDraft>().AsNoTracking()
            .Where(d => d.ProjectId == access.Project.Id && d.IssuedAt == null && (d.CreatedById == access.UserId || access.Holds(Verbs.Control)))
            .OrderByDescending(d => d.CreatedAt).ToListAsync(cancellationToken);

    /// <summary>Issues a draft as it stands, checked again today: it becomes numbered transmittals, and the draft records which.</summary>
    public async Task<(IReadOnlyList<Transmittal> Sent, IResult? Problem)> IssueDraftAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var draft = await DraftAsync(access, id, cancellationToken);
        if (draft is null) return ([], NotFound());
        if (draft.IssuedAt is not null) return ([], Problems.Conflict("ALREADY_ISSUED", $"This draft was issued as {draft.IssuedAs}."));
        var body = JsonSerializer.Deserialize<ComposeRequest>(draft.Body)!;
        // Dated the day it goes, unless the draft named a day.
        var (sent, problem) = await ComposeAsync(access, body, cancellationToken);
        if (problem is not null) return ([], problem);
        draft.IssuedAt = clock.GetCurrentInstant();
        draft.IssuedAs = string.Join(", ", sent.Select(t => t.Number));
        await db.SaveChangesAsync(cancellationToken);
        return (sent, null);
    }

    /// <summary>A draft shown as the transmittal it will be: no number, nobody told yet.</summary>
    public async Task<TransmittalView> DraftViewAsync(ProjectAccess access, TransmittalDraft draft, CancellationToken cancellationToken)
    {
        var body = JsonSerializer.Deserialize<ComposeRequest>(draft.Body)!;
        var revisionIds = body.RevisionIds ?? [];
        var items = await (from r in db.Revisions
                           join d in db.Documents on r.DocumentId equals d.Id
                           where revisionIds.Contains(r.Id)
                           orderby d.Number
                           select new TransmittalItemView(r.Id, TransmittalItemKinds.Revision, d.Id, r.Id, d.Number, d.Title, r.Value, r.StatusCode,
                               null, null, null, null, null, new List<ItemFileView>())).ToListAsync(cancellationToken);
        var members = await MembersAsync(access.Project, cancellationToken);
        var partyIds = body.PartyIds ?? [];
        var parties = await db.Parties.AsNoTracking().Where(p => partyIds.Contains(p.Id)).ToListAsync(cancellationToken);
        var recipients = members.Where(m => (body.UserIds ?? []).Contains(m.UserId))
            .Select(m => new RecipientView(m.UserId, m.Name, m.PartyName, true, null, null, null, null, null, null, null, RecipientKinds.To, m.UserId))
            .Concat(parties.Select(p => new RecipientView(p.Id, p.Name, p.Name, false, null, null, null, null, null, null, null, RecipientKinds.To, null, p.Id)))
            .Concat(members.Where(m => (body.CopyUserIds ?? []).Contains(m.UserId))
                .Select(m => new RecipientView(m.UserId, m.Name, m.PartyName, true, null, null, null, null, null, null, null, RecipientKinds.Cc, m.UserId)))
            .ToList();
        return new TransmittalView(draft.Id, "Draft", TransmittalDirections.Outgoing, body.Reason ?? "", draft.Subject, body.Message,
            parties.Count == 0 ? "Internal distribution" : string.Join(", ", parties.Select(p => p.Name)), false, body.ResponseDue,
            draft.CreatedAt.ToDateTimeOffset(), draft.CreatedByName, null, null, items, recipients, State: "DRAFT", IssuedById: draft.CreatedById,
            Extras: body.Extras is null ? null : JsonSerializer.SerializeToElement(body.Extras));
    }
}
