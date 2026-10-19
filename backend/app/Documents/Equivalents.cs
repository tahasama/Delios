using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>Body of taking a matched number back: why, kept beside it.</summary>
public sealed record TakeBackRequest(string? Reason);

/// <summary>A document's number with another organization, as the screens read it.</summary>
public sealed record EquivalentView(Guid Id, Guid PartyId, string PartyCode, string PartyName, string Number, string Source,
    string RecordedByName, DateTimeOffset RecordedAt, DateTimeOffset? TakenBackAt, string? TakenBackByName, string? TakenBackReason);

/// <summary>
/// Equivalence (owner): one document known under another organization's number and ours, matched one to one. Our
/// numbering stays first in our register, theirs in theirs; neither changes the other. Recorded by itself when what
/// they sent is matched to one of ours or registered from what came; never typed (owner: numbering is never manual).
/// </summary>
public static class Equivalents
{
    /// <summary>Registers the routes under <c>/api/projects/{projectId}</c>.</summary>
    public static void MapEquivalentEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Documents")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("/documents/{documentId:guid}/numbers", ListAsync);
        project.MapPost("/documents/{documentId:guid}/numbers/{equivalentId:guid}/take-back", TakeBackAsync);
    }

    /// <summary>
    /// Keeps another organization's number for a document. The same number already kept says nothing; one the document
    /// already has under another number for that organization, or one another document carries, is refused.
    /// </summary>
    public static async Task<IResult?> RecordAsync(DeliosDbContext db, IClock clock, Document document, Guid partyId, string? number,
        string source, string by, CancellationToken cancellationToken)
    {
        var written = number?.Trim();
        if (string.IsNullOrEmpty(written)) return null;
        if (written.Length > 200) return Problems.Invalid("NUMBER_TOO_LONG", "Keep the number under 200 characters.");
        var live = db.NumberEquivalents.Where(e => e.ProjectId == document.ProjectId && e.PartyId == partyId && e.TakenBackAt == null);
        if (await live.AnyAsync(e => e.DocumentId == document.Id && e.Number == written, cancellationToken)) return null;
        if (await live.FirstOrDefaultAsync(e => e.DocumentId == document.Id, cancellationToken) is { } other)
            return Problems.Conflict("ALREADY_MATCHED", $"{document.Number} is already matched to their {other.Number}. Take that back first, saying why.");
        if (await live.AnyAsync(e => e.Number == written, cancellationToken))
            return Problems.Conflict("NUMBER_MATCHED_ELSEWHERE", $"Their {written} is already matched to another of our documents.");
        db.NumberEquivalents.Add(new NumberEquivalent
        {
            TenantId = document.TenantId,
            ProjectId = document.ProjectId,
            DocumentId = document.Id,
            PartyId = partyId,
            Number = written,
            Source = source,
            RecordedByName = by,
            RecordedAt = clock.GetCurrentInstant(),
        });
        return null;
    }

    /// <summary>The document another organization's number is matched to, if any.</summary>
    public static Task<Guid?> FindAsync(DeliosDbContext db, Guid projectId, Guid partyId, string? number, CancellationToken cancellationToken)
    {
        var written = number?.Trim() ?? "";
        return db.NumberEquivalents.Where(e => e.ProjectId == projectId && e.PartyId == partyId && e.Number == written && e.TakenBackAt == null)
            .Select(e => (Guid?)e.DocumentId).FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>Who keeps matched numbers: the control function, or with none, whoever of ours exchanges documents.</summary>
    private static async Task<bool> KeepsAsync(DeliosDbContext db, ProjectAccess access, Document document, CancellationToken cancellationToken) =>
        access.IsInternal && (access.Allows(Verbs.Control, document.Facts) || await StandIns.ExchangesAsync(db, access, cancellationToken));

    private static async Task<IResult> ListAsync(Guid documentId, HttpContext http, DeliosDbContext db, DocumentService documents,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var visible = await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(cancellationToken))
            .AnyAsync(d => d.Id == documentId, cancellationToken);
        if (!visible || !access.IsInternal) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        var rows = await (
            from e in db.NumberEquivalents.AsNoTracking()
            join p in db.Parties.AsNoTracking() on e.PartyId equals p.Id
            where e.DocumentId == documentId
            orderby e.RecordedAt
            select new { e, p.Code, p.Name }).ToListAsync(cancellationToken);
        return Results.Ok(rows.Select(r => new EquivalentView(r.e.Id, r.e.PartyId, r.Code, r.Name, r.e.Number, r.e.Source,
            r.e.RecordedByName, r.e.RecordedAt.ToDateTimeOffset(), r.e.TakenBackAt?.ToDateTimeOffset(), r.e.TakenBackByName, r.e.TakenBackReason)));
    }

    private static async Task<IResult> TakeBackAsync(Guid documentId, Guid equivalentId, TakeBackRequest request, HttpContext http,
        DeliosDbContext db, DocumentService documents, AuditLog audit, IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var document = await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(cancellationToken))
            .SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (!await KeepsAsync(db, access, document, cancellationToken))
            return Problems.Forbidden("CONTROL_ONLY", "The control function takes a matched number back.");
        var equivalent = await db.NumberEquivalents.SingleOrDefaultAsync(e => e.Id == equivalentId && e.DocumentId == documentId, cancellationToken);
        if (equivalent is null || equivalent.TakenBackAt is not null) return Problems.NotFound("NOT_MATCHED", "No such matched number.");
        var why = request.Reason?.Trim() ?? "";
        if (why.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it is taken back.", new { field = "reason" });
        equivalent.TakenBackAt = clock.GetCurrentInstant();
        equivalent.TakenBackByName = access.UserName;
        equivalent.TakenBackReason = why;
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "NUMBER_UNMATCHED", "Document", document.Id, document.Number,
            $"No longer matched to their {equivalent.Number}: {why}", access.Project.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }
}
