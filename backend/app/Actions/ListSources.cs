using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Records;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Actions;

/// <summary>
/// Which register document a project's list is read from (owner: "the register document should not be designated by the
/// app, but chosen by the control function from the register"), and, for the lists of Import &amp; export, which of its
/// revisions was last brought in. One per project and list: the schedule's three lists and Import &amp; export's four.
/// </summary>
public sealed class ListSource
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    /// <summary>One of <see cref="ListSources.Kinds"/>.</summary>
    public required string Kind { get; set; }
    /// <summary>The register document chosen; null: none chosen (the schedule's lists then fall back to the app's old rule).</summary>
    public Guid? DocumentId { get; set; }
    public string? ChosenByName { get; set; }
    public Instant? ChosenAt { get; set; }
    public string? Reason { get; set; }
    /// <summary>What was brought in last (Import &amp; export's lists): DOCUMENT (a released revision) or UPLOAD, when, by whom.</summary>
    public string? LastFrom { get; set; }
    public Guid? LastRevisionId { get; set; }
    public string? LastLabel { get; set; }
    public string? LastByName { get; set; }
    public Instant? LastAt { get; set; }
}

internal sealed class ListSourceConfiguration : IEntityTypeConfiguration<ListSource>
{
    public void Configure(EntityTypeBuilder<ListSource> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Document>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.ToTable("list_sources");
        b.HasIndex(x => new { x.ProjectId, x.Kind }).IsUnique();
        b.Property(x => x.Kind).HasMaxLength(32);
        b.Property(x => x.LastFrom).HasMaxLength(16);
        b.Property(x => x.LastLabel).HasMaxLength(200);
        b.Property(x => x.Reason).HasMaxLength(2000);
    }
}

/// <summary>Choosing a list's register document: the document (none: not chosen), and why, optionally.</summary>
public sealed record ListSourceRequest(Guid? DocumentId, string? Reason = null);

/// <summary>A list of Import &amp; export just brought in: from a released revision of its document, or from a file uploaded.</summary>
public sealed record ListBroughtRequest(string From, Guid? RevisionId = null, string? Label = null);

/// <summary>A list as its page reads it: its register document and released revision, and what was read last, from where.</summary>
public sealed record ListSourceView(string Kind, string Title, string Where, ListDocumentView? Document, ListLastView? Last, bool MayChoose);
public sealed record ListDocumentView(Guid Id, string Number, string Title, Guid? ReleasedRevisionId, string? ReleasedValue, Instant? ReleasedAt,
    bool ChosenByApp);
public sealed record ListLastView(string From, string? Label, string? ByName, Instant? At, Guid? RevisionId);

public static class ListSources
{
    public const string Schedule = "SCHEDULE";
    public const string Deliverables = "DELIVERABLES";
    public const string Team = "TEAM";
    public const string Matrix = "MATRIX";
    public const string Lists = "LISTS";

    /// <summary>Every list read from a register document or an upload: its title, and the page it is brought in on.</summary>
    public static readonly (string Kind, string Title, string Where)[] Kinds =
    [
        (Schedule, "Schedule", "SCHEDULE"),
        (DepartmentsImporter.Kind, "Disciplines per action", "SCHEDULE"),
        (RequirementsImporter.Kind, "Document requirements", "SCHEDULE"),
        (Deliverables, "Deliverable list", "IMPORT"),
        (Team, "Team list", "IMPORT"),
        (Matrix, "Distribution matrix", "IMPORT"),
        (Lists, "Settings lists", "IMPORT"),
    ];

    public static void MapListSourceEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}/lists/sources").WithTags("Schedule")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("", ReadAsync);
        project.MapPut("/{kind}", ChooseAsync);
        project.MapPost("/{kind}/brought", BroughtAsync);
    }

    /// <summary>The document chosen for a list on a project, or null when none was chosen.</summary>
    public static async Task<Guid?> ChosenAsync(DeliosDbContext db, Guid projectId, string kind, CancellationToken cancellationToken) =>
        await db.Set<ListSource>().AsNoTracking().Where(s => s.ProjectId == projectId && s.Kind == kind)
            .Select(s => s.DocumentId).SingleOrDefaultAsync(cancellationToken);

    /// <summary>
    /// Whether a document is the list of its kind on its project: the document chosen for it, once one is; before any is
    /// chosen, the app's old rule (<paramref name="fallback"/>: the document's type marked as that list).
    /// </summary>
    public static async Task<bool> IsChosenAsync(DeliosDbContext db, Guid documentId, string kind, Func<Task<bool>> fallback, CancellationToken cancellationToken)
    {
        var projectId = await db.Documents.AsNoTracking().Where(d => d.Id == documentId).Select(d => (Guid?)d.ProjectId).SingleOrDefaultAsync(cancellationToken);
        if (projectId is null) return false;
        return await ChosenAsync(db, projectId.Value, kind, cancellationToken) is { } chosen ? chosen == documentId : await fallback();
    }

    /// <summary>GET <c>/lists/sources</c>: every list, its register document and released revision, and what was read last.</summary>
    private static async Task<IResult> ReadAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal) return Results.Ok(Array.Empty<ListSourceView>());
        var projectId = access.Project.Id;
        var kept = await db.Set<ListSource>().AsNoTracking().Where(s => s.ProjectId == projectId).ToListAsync(cancellationToken);
        var scheduleDoc = await db.ScheduleSources.AsNoTracking().Where(s => s.ProjectId == projectId).Select(s => (Guid?)s.DocumentId).SingleOrDefaultAsync(cancellationToken);
        // The document each list reads: the one chosen, else (the schedule's lists) the one the app found by its old rule.
        var documentOf = new Dictionary<string, (Guid Id, bool ByApp)>();
        foreach (var (kind, _, _) in Kinds)
        {
            if (kept.FirstOrDefault(s => s.Kind == kind)?.DocumentId is { } chosen) documentOf[kind] = (chosen, false);
            else if (kind == Schedule && scheduleDoc is { } named) documentOf[kind] = (named, true);
        }
        foreach (var kind in new[] { DepartmentsImporter.Kind, RequirementsImporter.Kind }.Where(k => !documentOf.ContainsKey(k)))
        {
            var marker = kind == DepartmentsImporter.Kind ? DepartmentsImporter.Marker : RequirementsImporter.Marker;
            var types = (await db.ValueEntries.AsNoTracking().Where(v => v.SetKey == ValueSets.DocumentTypes && v.Props != null).ToListAsync(cancellationToken))
                .Where(v => v.Props!.RootElement.TryGetProperty(marker, out var p) && p.ValueKind == System.Text.Json.JsonValueKind.True).Select(v => v.Code).ToList();
            var found = types.Count == 0 ? null : await db.Documents.AsNoTracking().Where(d => d.ProjectId == projectId && types.Contains(d.DocType))
                .OrderBy(d => d.CreatedAt).Select(d => (Guid?)d.Id).FirstOrDefaultAsync(cancellationToken);
            if (found is { } byType) documentOf[kind] = (byType, true);
        }
        var ids = documentOf.Values.Select(v => v.Id).Distinct().ToList();
        var documents = await db.Documents.AsNoTracking().Where(d => ids.Contains(d.Id)).ToDictionaryAsync(d => d.Id, cancellationToken);
        var released = await db.Revisions.AsNoTracking().Where(r => ids.Contains(r.DocumentId) && r.State == RevisionStates.Released)
            .Select(r => new { r.DocumentId, r.Id, r.Value, r.ReleasedAt }).ToListAsync(cancellationToken);
        var lastOfSchedule = await LastReadsAsync(db, projectId, cancellationToken);
        var mayChoose = access.Holds(Verbs.Control);
        var views = Kinds.Select(k =>
        {
            ListDocumentView? document = null;
            if (documentOf.TryGetValue(k.Kind, out var of) && documents.TryGetValue(of.Id, out var d))
            {
                var rev = released.Where(r => r.DocumentId == d.Id).OrderByDescending(r => r.ReleasedAt).FirstOrDefault();
                document = new ListDocumentView(d.Id, d.Number, d.Title, rev?.Id, rev?.Value, rev?.ReleasedAt, of.ByApp);
            }
            var source = kept.FirstOrDefault(s => s.Kind == k.Kind);
            var last = k.Where == "SCHEDULE" ? lastOfSchedule.GetValueOrDefault(k.Kind)
                : source?.LastFrom is { } from ? new ListLastView(from, source.LastLabel, source.LastByName, source.LastAt, source.LastRevisionId) : null;
            return new ListSourceView(k.Kind, k.Title, k.Where, document, last, mayChoose);
        }).ToList();
        return Results.Ok(views);
    }

    /// <summary>What each schedule list was last read from: the newest of an upload kept and a released revision read.</summary>
    private static async Task<Dictionary<string, ListLastView>> LastReadsAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken)
    {
        var kinds = new[] { Schedule, DepartmentsImporter.Kind, RequirementsImporter.Kind };
        var versions = await db.Set<ControlledVersion>().AsNoTracking()
            .Where(v => v.ProjectId == projectId && kinds.Contains(v.Kind) && v.State == "APPROVED")
            .GroupBy(v => v.Kind).Select(g => g.OrderByDescending(v => v.CreatedAt).First()).ToListAsync(cancellationToken);
        var read = await db.ScheduleImports.AsNoTracking()
            .Where(i => i.ProjectId == projectId && i.Status == ScheduleImportStatuses.Done)
            .OrderByDescending(i => i.ImportedAt).FirstOrDefaultAsync(cancellationToken);
        var result = new Dictionary<string, ListLastView>();
        foreach (var v in versions)
            result[v.Kind] = new ListLastView(v.FileId is null ? "UPLOAD" : "DOCUMENT", v.VersionLabel, v.CreatedByName, v.CreatedAt, null);
        if (read is not null && (!result.TryGetValue(Schedule, out var up) || up.At < read.ImportedAt))
            result[Schedule] = new ListLastView("DOCUMENT", $"rev {read.RevisionValue}", null, read.ImportedAt, read.RevisionId);
        return result;
    }

    /// <summary>
    /// PUT <c>/lists/sources/{kind}</c>: the control function chooses the register document a list is read from (none:
    /// back to no document chosen). Kept with who and why, logged (LIST_SOURCE_SET); the schedule's own record follows.
    /// </summary>
    private static async Task<IResult> ChooseAsync(string kind, ListSourceRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal || !access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "The control function chooses which register document a list is read from.");
        var list = Kinds.FirstOrDefault(k => string.Equals(k.Kind, kind, StringComparison.OrdinalIgnoreCase));
        if (list.Kind is null) return Problems.NotFound("LIST_UNKNOWN", "No such list.");
        Document? document = null;
        if (request.DocumentId is { } id)
        {
            document = await db.Documents.AsNoTracking().SingleOrDefaultAsync(d => d.Id == id && d.ProjectId == access.Project.Id, cancellationToken);
            if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "That document is not in this project's register.");
            // One document holds one list: a schedule cannot also be the requirements.
            var other = await db.Set<ListSource>().AsNoTracking().Where(s => s.ProjectId == access.Project.Id && s.DocumentId == id && s.Kind != list.Kind)
                .Select(s => s.Kind).FirstOrDefaultAsync(cancellationToken);
            if (other is not null)
                return Problems.Conflict("DOCUMENT_HOLDS_ANOTHER_LIST", $"{document.Number} is already the {Kinds.First(k => k.Kind == other).Title.ToLowerInvariant()}: one document holds one list.");
        }
        var source = await db.Set<ListSource>().SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id && s.Kind == list.Kind, cancellationToken);
        if (source is null)
        {
            source = new ListSource { TenantId = access.Project.TenantId, ProjectId = access.Project.Id, Kind = list.Kind };
            db.Add(source);
        }
        var before = source.DocumentId;
        source.DocumentId = document?.Id;
        source.ChosenByName = access.UserName;
        source.ChosenAt = clock.GetCurrentInstant();
        source.Reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim();
        if (list.Kind == Schedule && document is not null)
        {
            var schedule = await db.ScheduleSources.SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id, cancellationToken);
            if (schedule is null) db.ScheduleSources.Add(new ScheduleSource { TenantId = access.Project.TenantId, ProjectId = access.Project.Id, DocumentId = document.Id });
            else schedule.DocumentId = document.Id;
        }
        await db.SaveChangesAsync(cancellationToken);
        var was = before is { } old ? await db.Documents.AsNoTracking().Where(d => d.Id == old).Select(d => d.Number).SingleOrDefaultAsync(cancellationToken) : null;
        await audit.WriteAsync(http.User.Actor(), "LIST_SOURCE_SET", "Project", access.Project.Id, list.Title,
            $"{list.Title}: {was ?? "no document"} → {document?.Number ?? "no document"}" + (source.Reason is null ? "" : $". Why: {source.Reason}"),
            access.Project.Id, cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// POST <c>/lists/sources/{kind}/brought</c>: a list of Import &amp; export was just brought in, from a released revision
    /// of its document or from a file uploaded. Kept, so the page and Home can say whether a newer revision waits.
    /// </summary>
    private static async Task<IResult> BroughtAsync(string kind, ListBroughtRequest request, HttpContext http, DeliosDbContext db, IClock clock,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal) return Problems.Forbidden("OURS_ONLY", "Our own people bring lists in.");
        var list = Kinds.FirstOrDefault(k => string.Equals(k.Kind, kind, StringComparison.OrdinalIgnoreCase) && k.Where == "IMPORT");
        if (list.Kind is null) return Problems.NotFound("LIST_UNKNOWN", "No such list.");
        if (request.From is not ("DOCUMENT" or "UPLOAD")) return Problems.Invalid("FROM_UNKNOWN", "A list comes from its register document or from a file uploaded.");
        var source = await db.Set<ListSource>().SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id && s.Kind == list.Kind, cancellationToken);
        if (source is null)
        {
            source = new ListSource { TenantId = access.Project.TenantId, ProjectId = access.Project.Id, Kind = list.Kind };
            db.Add(source);
        }
        source.LastFrom = request.From;
        source.LastRevisionId = request.From == "DOCUMENT" ? request.RevisionId : null;
        source.LastLabel = request.Label is { Length: > 200 } l ? l[..200] : request.Label;
        source.LastByName = access.UserName;
        source.LastAt = clock.GetCurrentInstant();
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }
}
