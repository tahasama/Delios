using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Settings;
using Delios.Host.Tenancy;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>Body of voiding a revision: why (required), and what was found of the work done from it, when already known.</summary>
public sealed record VoidRequest(string? Reason, string? Reassessment = null);
/// <summary>Body of recording the reassessment of work done from a voided revision.</summary>
public sealed record ReassessmentRequest(string? Note);
/// <summary>Body of putting a document on legal hold, or lifting it.</summary>
public sealed record LegalHoldRequest(bool On, string? Reason = null);
/// <summary>Body of naming readers of a closed document.</summary>
public sealed record ReadersRequest(Guid[]? UserIds, string? Reason = null);

/// <summary>A voided revision whose reassessment is still to be written.</summary>
public sealed record UnresolvedVoid(Guid RevisionId, Guid DocumentId, string Number, string Title, string Value, string? VoidReason,
    DateTimeOffset VoidedAt, string? VoidAuthority);
/// <summary>Somebody named to read a closed document.</summary>
public sealed record ReaderView(Guid Id, Guid UserId, string Name, string? AddedByName, string? Reason, DateTimeOffset CreatedAt);

/// <summary>
/// The acts that keep the record honest after the fact: voiding a revision that
/// should not have counted (and saying what came of the work done from it),
/// holding a document against disposal, and naming who may read a closed one.
/// </summary>
public sealed class KeepingService(
    DeliosDbContext db, AuditLog audit, IClock clock, TransmittalService transmittals, Notifications.Notifier notifier)
{
    // ── Void ──────────────────────────────────────────────────────────────────

    /// <summary>
    /// Voids the newest revision of a document: one released in error, or one never
    /// reviewed. What was released is voided by the authority that decided it or by
    /// Document Control (or, where the people doing the work carry this out, its
    /// author); what was never reviewed, by its author or Document Control. Whoever
    /// received it is told to stop using it.
    /// </summary>
    public async Task<(Revision? Revision, IResult? Problem)> VoidAsync(
        HttpContext http, ProjectAccess access, Guid documentId, Guid revisionId, VoidRequest request, CancellationToken cancellationToken)
    {
        var document = await VisibleAsync(access, documentId, cancellationToken);
        var revision = document is null ? null
            : await db.Revisions.SingleOrDefaultAsync(r => r.Id == revisionId && r.DocumentId == documentId, cancellationToken);
        if (document is null || revision is null) return (null, Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        var reason = request.Reason?.Trim() ?? "";
        if (reason.Length == 0) return (null, Problems.Invalid("REASON_REQUIRED", "Voiding is recorded with a reason."));
        var newer = await db.Revisions.AsNoTracking().Where(r => r.DocumentId == documentId && r.CreatedAt > revision.CreatedAt)
            .OrderByDescending(r => r.CreatedAt).Select(r => r.Value).FirstOrDefaultAsync(cancellationToken);
        if (newer is not null)
        {
            return (null, Problems.Conflict("NOT_NEWEST",
                $"Rev {revision.Value} has already been replaced by rev {newer}. Only the newest revision can be voided; everything before it is frozen as it was issued."));
        }
        var reviews = await db.Reviews.AsNoTracking().Include(r => r.Steps).ThenInclude(s => s.Participants)
            .Where(r => r.RevisionId == revision.Id && r.Steps.Any()).ToListAsync(cancellationToken);
        var neverReviewed = revision.State == RevisionStates.InPreparation && reviews.Count == 0;
        if (revision.State != RevisionStates.Released && !neverReviewed)
        {
            return (null, Problems.Conflict("NOT_VOIDABLE",
                $"Rev {revision.Value} is {revision.State.ToLowerInvariant().Replace('_', ' ')}. A revision is voided when it was released in error, or when it was never reviewed at all.",
                new { state = revision.State }));
        }

        var control = access.Allows(Verbs.Control, document.Facts) || await Keepers.ConfiguresAsync(http);
        var author = revision.AuthoredById == access.UserId;
        var decider = reviews.Any(r => r.State == ReviewStates.Released
            && r.Steps.Any(s => s.Deciding && s.Participants.Any(p => p.UserId == access.UserId && p.AnsweredAt != null)));
        var selfCarries = !await ProjectAnswers.ControlDoesAsync(db, access.Project.Id, "VOID", cancellationToken);
        var allowed = control || (neverReviewed ? author : decider || (selfCarries && author));
        if (!allowed)
        {
            return (null, Problems.Forbidden("VOID_NOT_ALLOWED", neverReviewed
                ? "Its author or Document Control voids a revision nobody reviewed."
                : "Voiding what was issued is decided by the authority that approved it, or Document Control."));
        }

        var now = clock.GetCurrentInstant();
        var was = revision.State;
        revision.State = RevisionStates.Void;
        revision.VoidedAt = now;
        revision.VoidReason = reason;
        revision.VoidAuthority = access.UserName;
        db.Enqueue(Reviews.RevisionMarked.RoutingKey, new Reviews.RevisionMarked(revision.TenantId, revision.Id, FileKinds.Void, $"Void: {reason}"));
        if (request.Reassessment?.Trim() is { Length: > 0 } reassessment)
        {
            revision.VoidReassessment = reassessment;
            revision.VoidReassessedAt = now;
        }
        if (document.LatestRevisionId == revision.Id) document.LatestRevisionState = RevisionStates.Void;
        document.UpdatedAt = now;
        await transmittals.LapseOpenAsync(revision.Id, access.UserName, cancellationToken);
        var label = $"{document.Number} rev {revision.Value}";
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "VOIDED", "Revision", revision.Id, label,
            $"{(was == RevisionStates.Released ? "Released" : "Never reviewed")} → Void. {reason}", access.Project.Id, cancellationToken);
        await notifier.NotifyAsync(document.TenantId, document.ProjectId, await ReceivedByAsync(revision.Id, cancellationToken),
            Notifications.NotificationKinds.General, $"Void: {label}",
            $"{reason} Stop using it, and reassess the work done from it.", $"/documents/{document.Id}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (revision, null);
    }

    /// <summary>Records what was found of the work done from a voided revision. Whoever may void it records it.</summary>
    public async Task<(Revision? Revision, IResult? Problem)> ReassessAsync(
        HttpContext http, ProjectAccess access, Guid revisionId, ReassessmentRequest request, CancellationToken cancellationToken)
    {
        var revision = await db.Revisions.SingleOrDefaultAsync(r => r.Id == revisionId && r.ProjectId == access.Project.Id, cancellationToken);
        var document = revision is null ? null : await VisibleAsync(access, revision.DocumentId, cancellationToken);
        if (revision is null || document is null) return (null, Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
        if (revision.State != RevisionStates.Void) return (null, Problems.Conflict("NOT_VOID", "Only a voided revision is reassessed."));
        var note = request.Note?.Trim() ?? "";
        if (note.Length == 0) return (null, Problems.Invalid("NOTE_REQUIRED", "Describe the reassessment of work performed."));
        var selfCarries = !await ProjectAnswers.ControlDoesAsync(db, access.Project.Id, "VOID", cancellationToken);
        if (!access.Allows(Verbs.Control, document.Facts) && !await Keepers.ConfiguresAsync(http)
            && !(revision.AuthoredById == access.UserId && (selfCarries || revision.ReleasedAt is null)))
        {
            return (null, Problems.Forbidden("REASSESS_NOT_ALLOWED", "Whoever carries out voiding records its reassessment."));
        }
        revision.VoidReassessment = note;
        revision.VoidReassessedAt = clock.GetCurrentInstant();
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "VOID_REASSESSED", "Revision", revision.Id,
            $"{document.Number} rev {revision.Value}", note, access.Project.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (revision, null);
    }

    /// <summary>Voided revisions nobody has reassessed yet, newest first.</summary>
    public async Task<IReadOnlyList<UnresolvedVoid>> UnresolvedVoidsAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        var restricted = (await Catalog.LoadAsync(db, cancellationToken)).RestrictedLevels();
        var visible = DocumentQueries.Visible(db, access, restricted).Select(d => d.Id);
        return await (from r in db.Revisions
                      join d in db.Documents on r.DocumentId equals d.Id
                      where r.ProjectId == access.Project.Id && r.State == RevisionStates.Void && r.VoidReassessment == null
                          && visible.Contains(d.Id)
                      orderby r.VoidedAt descending
                      select new UnresolvedVoid(r.Id, d.Id, d.Number, d.Title, r.Value, r.VoidReason, r.VoidedAt!.Value.ToDateTimeOffset(), r.VoidAuthority))
            .ToListAsync(cancellationToken);
    }

    // ── Legal hold ────────────────────────────────────────────────────────────

    /// <summary>Document Control or an administrator puts a document on legal hold, or lifts it.</summary>
    public async Task<IResult> LegalHoldAsync(
        HttpContext http, ProjectAccess access, Guid documentId, LegalHoldRequest request, CancellationToken cancellationToken)
    {
        var document = await VisibleAsync(access, documentId, cancellationToken);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (!access.Allows(Verbs.Control, document.Facts) && !await Keepers.ConfiguresAsync(http))
            return Problems.Forbidden("CONTROL_ONLY", "Only the control function records legal holds.");
        if (document.LegalHold == request.On) return Results.NoContent();
        document.LegalHold = request.On;
        document.LegalHoldReason = request.On ? request.Reason?.Trim() is { Length: > 0 } why ? why : null : null;
        document.LegalHoldAt = request.On ? clock.GetCurrentInstant() : null;
        document.LegalHoldByName = request.On ? access.UserName : null;
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "LEGAL_HOLD", "Document", document.Id, document.Number,
            request.On ? $"Legal hold: nothing about it may be disposed of.{(document.LegalHoldReason is null ? "" : $" {document.LegalHoldReason}")}" : "Legal hold cleared.",
            access.Project.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    // ── Readers of a closed document ──────────────────────────────────────────

    /// <summary>The people named to read a document, by name.</summary>
    public async Task<IReadOnlyList<ReaderView>?> ReadersAsync(ProjectAccess access, Guid documentId, CancellationToken cancellationToken)
    {
        if (await VisibleAsync(access, documentId, cancellationToken) is null) return null;
        return await (from a in db.DocumentAccess
                      join u in db.Users on a.UserId equals u.Id
                      where a.DocumentId == documentId
                      orderby u.Name
                      select new ReaderView(a.Id, a.UserId, u.Name, a.AddedByName, a.Reason, a.CreatedAt.ToDateTimeOffset()))
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// Names people who may read a closed document. Only whoever is answerable for its
    /// content names them: the person who registered it, whoever authored a revision of
    /// it, or an administrator. Each reader is told.
    /// </summary>
    public async Task<IResult> AddReadersAsync(
        HttpContext http, ProjectAccess access, Guid documentId, ReadersRequest request, CancellationToken cancellationToken)
    {
        var document = await VisibleAsync(access, documentId, cancellationToken);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (!await MayNameAsync(http, access, document, cancellationToken))
        {
            return Problems.Forbidden("NOT_ANSWERABLE",
                "Only the person who registered this document, or whoever authored a revision of it, says who may read it.");
        }
        var ids = request.UserIds?.Distinct().ToList() ?? [];
        if (ids.Count == 0) return Problems.Invalid("READERS_REQUIRED", "Say who.");
        var people = await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id) && u.Active)
            .Where(u => db.Memberships.Any(m => m.UserId == u.Id && m.ProjectId == access.Project.Id && m.Active))
            .Select(u => new { u.Id, u.Name }).ToListAsync(cancellationToken);
        if (people.Count != ids.Count) return Problems.Invalid("READER_NOT_ON_PROJECT", "Some people chosen have no active place on this project.");
        var already = await db.DocumentAccess.Where(a => a.DocumentId == documentId && ids.Contains(a.UserId)).Select(a => a.UserId)
            .ToListAsync(cancellationToken);
        var reason = request.Reason?.Trim() is { Length: > 0 } why ? why : null;
        var added = people.Where(p => !already.Contains(p.Id)).ToList();
        foreach (var person in added)
        {
            db.DocumentAccess.Add(new DocumentAccess
            {
                TenantId = document.TenantId,
                DocumentId = document.Id,
                UserId = person.Id,
                AddedById = access.UserId,
                AddedByName = access.UserName,
                Reason = reason,
                CreatedAt = clock.GetCurrentInstant(),
            });
            await audit.WriteAsync(new Actor(access.UserId, access.UserName), "ACCESS_GRANTED", "Document", document.Id, document.Number,
                $"{person.Name} may read it. {reason ?? "Named as a reader of a closed document."}", access.Project.Id, cancellationToken);
        }
        await notifier.NotifyAsync(document.TenantId, document.ProjectId, added.Select(p => p.Id), Notifications.NotificationKinds.General,
            $"You may now read {document.Number}", document.Title, $"/documents/{document.Id}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { added = added.Select(p => p.Name), already = people.Where(p => already.Contains(p.Id)).Select(p => p.Name) });
    }

    /// <summary>Takes somebody off a document's readers. Same people as naming them.</summary>
    public async Task<IResult> RemoveReaderAsync(
        HttpContext http, ProjectAccess access, Guid documentId, Guid userId, CancellationToken cancellationToken)
    {
        var document = await VisibleAsync(access, documentId, cancellationToken);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (!await MayNameAsync(http, access, document, cancellationToken))
            return Problems.Forbidden("NOT_ANSWERABLE", "Only whoever is answerable for this document's content says who may read it.");
        var row = await db.DocumentAccess.SingleOrDefaultAsync(a => a.DocumentId == documentId && a.UserId == userId, cancellationToken);
        if (row is null) return Results.NoContent();
        var name = await db.Users.Where(u => u.Id == userId).Select(u => u.Name).SingleAsync(cancellationToken);
        db.DocumentAccess.Remove(row);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "ACCESS_REVOKED", "Document", document.Id, document.Number,
            $"{name} may no longer read it.", access.Project.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private async Task<bool> MayNameAsync(HttpContext http, ProjectAccess access, Document document, CancellationToken cancellationToken) =>
        document.CreatedById == access.UserId || await Keepers.ConfiguresAsync(http)
        || await db.Revisions.AnyAsync(r => r.DocumentId == document.Id && r.AuthoredById == access.UserId, cancellationToken);

    /// <summary>Everybody of ours who was sent this revision on a transmittal.</summary>
    private Task<List<Guid>> ReceivedByAsync(Guid revisionId, CancellationToken cancellationToken) =>
        (from i in db.TransmittalItems
         join r in db.TransmittalRecipients on i.TransmittalId equals r.TransmittalId
         where i.RevisionId == revisionId && r.UserId != null
         select r.UserId!.Value).Distinct().ToListAsync(cancellationToken);

    private async Task<Document?> VisibleAsync(ProjectAccess access, Guid documentId, CancellationToken cancellationToken)
    {
        var restricted = (await Catalog.LoadAsync(db, cancellationToken)).RestrictedLevels();
        return await DocumentQueries.Visible(db, access, restricted).SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
    }
}

/// <summary>The keeping URLs under <c>/api/projects/{projectId}</c>.</summary>
public static class KeepingEndpoints
{
    public static void MapKeepingEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Documents")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapPost("/documents/{documentId:guid}/revisions/{revisionId:guid}/void",
            async (Guid documentId, Guid revisionId, VoidRequest r, HttpContext h, KeepingService s, CancellationToken c) =>
            {
                var (revision, problem) = await s.VoidAsync(h, ProjectAccessFilter.Of(h), documentId, revisionId, r, c);
                return problem ?? Results.Ok(new { revision!.Id, revision.State, revision.VoidReason });
            });
        project.MapPost("/revisions/{revisionId:guid}/reassessment",
            async (Guid revisionId, ReassessmentRequest r, HttpContext h, KeepingService s, CancellationToken c) =>
            {
                var (revision, problem) = await s.ReassessAsync(h, ProjectAccessFilter.Of(h), revisionId, r, c);
                return problem ?? Results.NoContent();
            });
        project.MapGet("/exposures/void", async (HttpContext h, KeepingService s, CancellationToken c) =>
            Results.Ok(await s.UnresolvedVoidsAsync(ProjectAccessFilter.Of(h), c)));
        project.MapGet("/exposures/untold", async (HttpContext h, Transmittals.Supersession s, CancellationToken c) =>
            Results.Ok(await s.UntoldAsync(ProjectAccessFilter.Of(h), c)));
        project.MapPost("/documents/{documentId:guid}/legal-hold",
            (Guid documentId, LegalHoldRequest r, HttpContext h, KeepingService s, CancellationToken c) =>
                s.LegalHoldAsync(h, ProjectAccessFilter.Of(h), documentId, r, c));
        project.MapGet("/documents/{documentId:guid}/readers", async (Guid documentId, HttpContext h, KeepingService s, CancellationToken c) =>
            await s.ReadersAsync(ProjectAccessFilter.Of(h), documentId, c) is { } rows ? Results.Ok(rows) : Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document."));
        project.MapPost("/documents/{documentId:guid}/readers",
            (Guid documentId, ReadersRequest r, HttpContext h, KeepingService s, CancellationToken c) =>
                s.AddReadersAsync(h, ProjectAccessFilter.Of(h), documentId, r, c));
        project.MapDelete("/document-readers/{accessId:guid}", async (Guid accessId, HttpContext h, DeliosDbContext db, KeepingService s, CancellationToken c) =>
        {
            var row = await db.DocumentAccess.AsNoTracking().SingleOrDefaultAsync(a => a.Id == accessId, c);
            return row is null ? Results.NoContent() : await s.RemoveReaderAsync(h, ProjectAccessFilter.Of(h), row.DocumentId, row.UserId, c);
        });
        project.MapDelete("/documents/{documentId:guid}/readers/{userId:guid}",
            (Guid documentId, Guid userId, HttpContext h, KeepingService s, CancellationToken c) =>
                s.RemoveReaderAsync(h, ProjectAccessFilter.Of(h), documentId, userId, c));
    }
}
