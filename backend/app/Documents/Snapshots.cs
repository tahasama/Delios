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
    /// <summary>
    /// The document as GET /documents/{id} showed it then, as JSON: whole when <see cref="IsChange"/> is false, else only
    /// what changed since the point before (<see cref="SnapshotChanges"/>; owner: never the whole document again).
    /// </summary>
    public required string Payload { get; set; }
    /// <summary>The payload holds only what changed since the point before.</summary>
    public bool IsChange { get; set; }
}

/// <summary>
/// What changed between two points of a document, and the point rebuilt from the one before and its change. An object
/// keeps only the fields that changed ($o), a list of records with an id only the records that changed and their order
/// ($a), anything else is written whole ($v); a field gone is marked ($d).
/// </summary>
public static class SnapshotChanges
{
    /// <summary>A whole point is kept every so many, so rebuilding one never reads far back.</summary>
    public const int WholeEvery = 20;

    public static System.Text.Json.Nodes.JsonNode? Diff(System.Text.Json.Nodes.JsonNode? before, System.Text.Json.Nodes.JsonNode? after)
    {
        if (System.Text.Json.Nodes.JsonNode.DeepEquals(before, after)) return null;
        if (before is System.Text.Json.Nodes.JsonObject a && after is System.Text.Json.Nodes.JsonObject b)
        {
            var changes = new System.Text.Json.Nodes.JsonObject();
            foreach (var (key, value) in b)
                if ((a.ContainsKey(key) ? Diff(a[key], value) : Whole(value)) is { } change) changes[key] = change;
            foreach (var (key, _) in a)
                if (!b.ContainsKey(key)) changes[key] = new System.Text.Json.Nodes.JsonObject { ["$d"] = true };
            return new System.Text.Json.Nodes.JsonObject { ["$o"] = changes };
        }
        if (before is System.Text.Json.Nodes.JsonArray x && after is System.Text.Json.Nodes.JsonArray y && Keyed(x) && Keyed(y))
        {
            var was = x.ToDictionary(e => Id(e)!, e => e);
            var items = new System.Text.Json.Nodes.JsonObject();
            var ids = new System.Text.Json.Nodes.JsonArray();
            foreach (var element in y)
            {
                var id = Id(element)!;
                ids.Add(id);
                if ((was.TryGetValue(id, out var old) ? Diff(old, element) : Whole(element)) is { } change) items[id] = change;
            }
            return new System.Text.Json.Nodes.JsonObject { ["$a"] = new System.Text.Json.Nodes.JsonObject { ["ids"] = ids, ["items"] = items } };
        }
        return Whole(after);
    }

    public static System.Text.Json.Nodes.JsonNode? Apply(System.Text.Json.Nodes.JsonNode? before, System.Text.Json.Nodes.JsonNode change)
    {
        var patch = change.AsObject();
        if (patch.TryGetPropertyValue("$v", out var value)) return value?.DeepClone();
        if (patch["$o"] is System.Text.Json.Nodes.JsonObject fields)
        {
            var result = before is System.Text.Json.Nodes.JsonObject o ? o.DeepClone().AsObject() : new System.Text.Json.Nodes.JsonObject();
            foreach (var (key, field) in fields)
            {
                if (field is System.Text.Json.Nodes.JsonObject f && f.ContainsKey("$d")) { result.Remove(key); continue; }
                result[key] = Apply(result[key], field!);
            }
            return result;
        }
        if (patch["$a"] is System.Text.Json.Nodes.JsonObject list)
        {
            var was = before is System.Text.Json.Nodes.JsonArray arr && Keyed(arr) ? arr.ToDictionary(e => Id(e)!, e => e) : [];
            var items = list["items"]!.AsObject();
            var result = new System.Text.Json.Nodes.JsonArray();
            foreach (var id in list["ids"]!.AsArray().Select(i => i!.GetValue<string>()))
            {
                was.TryGetValue(id, out var old);
                result.Add(items.TryGetPropertyValue(id, out var c) && c is not null ? Apply(old, c) : old?.DeepClone());
            }
            return result;
        }
        return before?.DeepClone();
    }

    private static System.Text.Json.Nodes.JsonObject Whole(System.Text.Json.Nodes.JsonNode? value) => new() { ["$v"] = value?.DeepClone() };

    private static bool Keyed(System.Text.Json.Nodes.JsonArray list) =>
        list.All(e => Id(e) is not null) && list.Select(Id).Distinct().Count() == list.Count;

    private static string? Id(System.Text.Json.Nodes.JsonNode? element) =>
        element is System.Text.Json.Nodes.JsonObject o && o["id"] is System.Text.Json.Nodes.JsonValue v && v.TryGetValue<string>(out var id) ? id : null;

    /// <summary>Every point of a document, rebuilt whole, oldest first.</summary>
    public static List<(DocumentSnapshot Row, string Whole)> Rebuild(IEnumerable<DocumentSnapshot> rows)
    {
        var points = new List<(DocumentSnapshot, string)>();
        System.Text.Json.Nodes.JsonNode? current = null;
        foreach (var row in rows)
        {
            var payload = System.Text.Json.Nodes.JsonNode.Parse(row.Payload);
            current = row.IsChange && payload is not null ? Apply(current, payload) : payload;
            points.Add((row, current?.ToJsonString() ?? "null"));
        }
        return points;
    }
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
            // The last point, rebuilt from the last whole one and the changes after it.
            var lastWhole = await db.Set<DocumentSnapshot>().AsNoTracking().Where(s => s.DocumentId == documentId && !s.IsChange)
                .OrderByDescending(s => s.CapturedAt).Select(s => (Instant?)s.CapturedAt).FirstOrDefaultAsync(cancellationToken);
            var since = lastWhole is { } from
                ? await db.Set<DocumentSnapshot>().AsNoTracking().Where(s => s.DocumentId == documentId && s.CapturedAt >= from)
                    .OrderBy(s => s.CapturedAt).ToListAsync(cancellationToken)
                : [];
            var last = since.Count > 0 ? SnapshotChanges.Rebuild(since)[^1].Whole : null;
            if (last is not null && Same(last, payload)) continue;
            // Only what changed, but a whole point every so often.
            var change = last is not null && since.Count < SnapshotChanges.WholeEvery
                ? SnapshotChanges.Diff(System.Text.Json.Nodes.JsonNode.Parse(last), System.Text.Json.Nodes.JsonNode.Parse(payload))?.ToJsonString()
                : null;
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
                Payload = change ?? payload,
                IsChange = change is not null,
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
            var seen = await DocumentQueries.Visible(db, access).Where(d => d.Id == documentId).Select(d => new { d.Originator })
                .FirstOrDefaultAsync(c);
            if (seen is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
            // Each point holds the whole document as it stood, revisions never sent included: another organization reads
            // none of one of ours (its History lists the revisions sent to it, from the document's context).
            if (!OutsideReading.Whole(access, seen.Originator)) return Results.Ok(Array.Empty<SnapshotView>());
            var rows = await db.Set<DocumentSnapshot>().AsNoTracking().Where(s => s.DocumentId == documentId).OrderBy(s => s.CapturedAt)
                .ToListAsync(c);
            return Results.Ok(SnapshotChanges.Rebuild(rows).Select(p => new SnapshotView(p.Row.Id, p.Row.RevisionId, p.Row.CapturedAt.ToDateTimeOffset(),
                p.Row.EventType, p.Row.EventLabel, p.Row.ActorName, JsonDocument.Parse(p.Whole).RootElement.Clone())));
        });
    }
}
