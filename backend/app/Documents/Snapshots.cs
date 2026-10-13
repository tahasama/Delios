using System.Text.Json;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>
/// The document as it was at one recorded point: its details, revisions and files,
/// taken at the end of the request that changed it. Never changed afterwards.
/// </summary>
public sealed class DocumentSnapshot
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid DocumentId { get; set; }
    /// <summary>The revision the event was about, when it was about one.</summary>
    public Guid? RevisionId { get; set; }
    public Instant CapturedAt { get; set; }
    /// <summary>The audit action that caused it (REGISTERED, RELEASED…), and its words.</summary>
    public required string EventType { get; set; }
    public string? EventLabel { get; set; }
    public required string ActorName { get; set; }
    /// <summary>The document as GET /documents/{id} showed it then, as JSON.</summary>
    public required string Payload { get; set; }
}

/// <summary>EF Core mapping for <see cref="DocumentSnapshot"/>.</summary>
internal sealed class DocumentSnapshotConfiguration : IEntityTypeConfiguration<DocumentSnapshot>
{
    public void Configure(EntityTypeBuilder<DocumentSnapshot> b)
    {
        b.ToTable("document_snapshots");
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Document>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.DocumentId, x.CapturedAt });
        b.Property(x => x.EventType).HasMaxLength(64);
        b.Property(x => x.EventLabel).HasMaxLength(2000);
        b.Property(x => x.ActorName).HasMaxLength(200);
        b.Property(x => x.Payload).HasColumnType("jsonb");
    }
}

/// <summary>
/// Notes, as a request audits changes, which documents they touched; at the end of
/// the request, inside its transaction and after its changes are saved, takes one
/// snapshot of each. Requests outside a transaction (the worker) take none.
/// </summary>
public sealed class SnapshotRecorder(DeliosDbContext db, IClock clock)
{
    private sealed record Noted(string EntityType, Guid EntityId, string Action, string? Detail, string Actor);
    private readonly List<Noted> _noted = [];

    /// <summary>Called by the audit log for every event; keeps those about a document, a revision or a review.</summary>
    public void Note(string? entityType, Guid? entityId, string action, string? detail, string actor)
    {
        if (entityId is { } id && entityType is "Document" or "Revision" or "Review") _noted.Add(new(entityType, id, action, detail, actor));
    }

    /// <summary>Takes the snapshots noted during this request. Called by the transaction filter before it commits.</summary>
    public async Task CaptureAsync(CancellationToken cancellationToken)
    {
        if (_noted.Count == 0) return;
        await db.SaveChangesAsync(cancellationToken);
        var byDocument = new Dictionary<Guid, (Noted Event, Guid? RevisionId)>();
        foreach (var noted in _noted)
        {
            (Guid DocumentId, Guid? RevisionId)? target = null;
            if (noted.EntityType == "Document") target = (noted.EntityId, null);
            else if (noted.EntityType == "Revision")
            {
                var r = await db.Revisions.AsNoTracking().Where(x => x.Id == noted.EntityId).Select(x => new { x.DocumentId, x.Id })
                    .SingleOrDefaultAsync(cancellationToken);
                if (r is not null) target = (r.DocumentId, r.Id);
            }
            else
            {
                var r = await db.Reviews.AsNoTracking().Where(x => x.Id == noted.EntityId).Select(x => new { x.DocumentId, x.RevisionId })
                    .SingleOrDefaultAsync(cancellationToken);
                if (r is not null) target = (r.DocumentId, r.RevisionId);
            }
            // The first event of the request names the point; a later one only fills in the revision.
            if (target is { } t && !byDocument.ContainsKey(t.DocumentId)) byDocument[t.DocumentId] = (noted, t.RevisionId);
        }
        _noted.Clear();
        foreach (var (documentId, (noted, revisionId)) in byDocument)
        {
            var document = await db.Documents.AsNoTracking().Include(d => d.Revisions).ThenInclude(r => r.Files)
                .AsSplitQuery().SingleOrDefaultAsync(d => d.Id == documentId, cancellationToken);
            if (document is null) continue;
            document.Revisions = [.. document.Revisions.OrderBy(r => r.CreatedAt)];
            var payload = JsonSerializer.Serialize(DocumentEndpoints.View(document), JsonSerializerOptions.Web);
            var last = await db.Set<DocumentSnapshot>().AsNoTracking().Where(s => s.DocumentId == documentId)
                .OrderByDescending(s => s.CapturedAt).Select(s => s.Payload).FirstOrDefaultAsync(cancellationToken);
            if (last is not null && Same(last, payload)) continue;
            db.Add(new DocumentSnapshot
            {
                TenantId = document.TenantId,
                ProjectId = document.ProjectId,
                DocumentId = documentId,
                RevisionId = revisionId,
                CapturedAt = clock.GetCurrentInstant(),
                EventType = noted.Action,
                EventLabel = noted.Detail is { Length: > 2000 } d ? d[..2000] : noted.Detail,
                ActorName = noted.Actor,
                Payload = payload,
            });
        }
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>Two payloads that differ only in when the document was last touched are the same point.</summary>
    private static bool Same(string a, string b)
    {
        static string Strip(string json)
        {
            var node = System.Text.Json.Nodes.JsonNode.Parse(json)!.AsObject();
            node.Remove("updatedAt");
            return node.ToJsonString();
        }
        return Strip(a) == Strip(b);
    }
}

/// <summary>A recorded point as the history page reads it.</summary>
public sealed record SnapshotView(Guid Id, Guid? RevisionId, DateTimeOffset CapturedAt, string EventType, string? EventLabel, string ActorName,
    JsonElement Document);

/// <summary>GET <c>/documents/{id}/snapshots</c>: every recorded point of a document the caller may read, oldest first.</summary>
public static class SnapshotEndpoints
{
    public static void MapSnapshotEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Documents")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("/documents/{documentId:guid}/snapshots", async (Guid documentId, HttpContext h, DeliosDbContext db, DocumentService documents,
            CancellationToken c) =>
        {
            var access = ProjectAccessFilter.Of(h);
            if (!await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(c)).AnyAsync(d => d.Id == documentId, c))
                return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
            var rows = await db.Set<DocumentSnapshot>().AsNoTracking().Where(s => s.DocumentId == documentId).OrderBy(s => s.CapturedAt)
                .ToListAsync(c);
            return Results.Ok(rows.Select(s => new SnapshotView(s.Id, s.RevisionId, s.CapturedAt.ToDateTimeOffset(), s.EventType, s.EventLabel,
                s.ActorName, JsonDocument.Parse(s.Payload).RootElement.Clone())));
        });
    }
}
