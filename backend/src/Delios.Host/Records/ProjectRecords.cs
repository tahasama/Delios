using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Schedules;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Records;

// ── Entities ──────────────────────────────────────────────────────────────────

/// <summary>A tag of the project's asset breakdown: equipment, a system, an area. Documents are linked to the tags they describe.</summary>
public sealed class Asset
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    /// <summary>The tag, as drawings cite it. Never changes once given.</summary>
    public required string Code { get; set; }
    public required string Name { get; set; }
    public string? Area { get; set; }
    public string? System { get; set; }
    public string? Unit { get; set; }
    public string? Description { get; set; }
    /// <summary>The organization's own fields, as JSON.</summary>
    public string? Extras { get; set; }
    /// <summary>Retired tags stay on record and are offered no more.</summary>
    public bool Active { get; set; } = true;
    public Instant CreatedAt { get; set; }
}

/// <summary>A document describes an asset.</summary>
public sealed class DocumentAsset
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid DocumentId { get; set; }
    public Guid AssetId { get; set; }
    public required string CreatedByName { get; set; }
    public Instant CreatedAt { get; set; }
}

/// <summary>A published exception to the standard: what, which clauses, why, on whose authority, from when, reviewed when.</summary>
public sealed class ExceptionEntry
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public required string Item { get; set; }
    public required string Clauses { get; set; }
    public required string Reason { get; set; }
    public required string Authority { get; set; }
    public LocalDate StartDate { get; set; }
    public LocalDate? ReviewPoint { get; set; }
    public required string RecordedByName { get; set; }
    public Instant CreatedAt { get; set; }
}

/// <summary>A block of numbers given to a named party to number its own documents with.</summary>
public sealed class NumberRange
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    /// <summary>The fields the range covers, as they lead the number (P1001-ACME-ME-DWG).</summary>
    public required string Prefix { get; set; }
    public int From { get; set; }
    public int To { get; set; }
    /// <summary>The last number the party said it used; From - 1 before the first.</summary>
    public int LastIssued { get; set; }
    public required string IssuedTo { get; set; }
    /// <summary>OPEN, EXHAUSTED or CLOSED.</summary>
    public string Status { get; set; } = "OPEN";
    public required string IssuedByName { get; set; }
    public Instant CreatedAt { get; set; }
}

/// <summary>Document Control asks a department what documents the activities it is tagged on need, by a date.</summary>
public sealed class RequirementCall
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public required string Department { get; set; }
    /// <summary>The activities the call covers, as issued.</summary>
    public string[] ActivityCodes { get; set; } = [];
    public LocalDate DueOn { get; set; }
    public Instant IssuedAt { get; set; }
    public required string IssuedByName { get; set; }
    public int Reminders { get; set; }
    public Instant? LastRemindedAt { get; set; }
    public Instant? AnsweredAt { get; set; }
    public string? AnswerNote { get; set; }
}

/// <summary>A department says, before an activity, whether its documents are there.</summary>
public sealed class ReadinessConfirmation
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid ActivityId { get; set; }
    public required string Department { get; set; }
    public bool Available { get; set; }
    public string? Note { get; set; }
    public required string ConfirmedByName { get; set; }
    public Instant ConfirmedAt { get; set; }
}

/// <summary>The requirements list as it was issued to one sender (a supplier's code, or DEPT:{discipline}).</summary>
public sealed class SenderIssue
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public required string Sender { get; set; }
    public int EntryCount { get; set; }
    /// <summary>The needs it listed, so what changed since is known.</summary>
    public Guid[] NeedIds { get; set; } = [];
    public required string IssuedByName { get; set; }
    public Instant IssuedAt { get; set; }
}

/// <summary>
/// An uploaded list waiting for a decision before it applies: a draft, submitted,
/// then approved (and applied) or rejected. The version in force is the last approved.
/// </summary>
public sealed class ControlledVersion
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    /// <summary>Empty for the organization's own lists.</summary>
    public Guid? ProjectId { get; set; }
    public required string Kind { get; set; }
    public required string Key { get; set; }
    public required string Title { get; set; }
    /// <summary>Given once, never reused: v1, v2…</summary>
    public required string VersionLabel { get; set; }
    /// <summary>DRAFT, SUBMITTED, APPROVED, REJECTED or SUPERSEDED.</summary>
    public string State { get; set; } = "DRAFT";
    public required string Payload { get; set; }
    public string? Diff { get; set; }
    public int RowCount { get; set; }
    public string? SourceName { get; set; }
    public long? SourceSize { get; set; }
    public string? SourceHash { get; set; }
    public string? Notes { get; set; }
    public Guid CreatedById { get; set; }
    public required string CreatedByName { get; set; }
    public Instant CreatedAt { get; set; }
    public Guid? SubmittedById { get; set; }
    public string? SubmittedByName { get; set; }
    public Instant? SubmittedAt { get; set; }
    public string? DecidedByName { get; set; }
    public Instant? DecidedAt { get; set; }
    public string? DecisionReason { get; set; }
    public Instant? AppliedAt { get; set; }
    public string? AppliedSummary { get; set; }
    public Instant? SupersededAt { get; set; }
}

internal sealed class RecordsConfiguration :
    IEntityTypeConfiguration<Asset>, IEntityTypeConfiguration<DocumentAsset>, IEntityTypeConfiguration<ExceptionEntry>,
    IEntityTypeConfiguration<NumberRange>, IEntityTypeConfiguration<RequirementCall>, IEntityTypeConfiguration<ReadinessConfirmation>,
    IEntityTypeConfiguration<SenderIssue>, IEntityTypeConfiguration<ControlledVersion>
{
    public void Configure(EntityTypeBuilder<Asset> b)
    {
        b.ToTable("assets");
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Code }).IsUnique();
        b.Property(x => x.Code).HasMaxLength(64);
        b.Property(x => x.Name).HasMaxLength(300);
        b.Property(x => x.Area).HasMaxLength(100);
        b.Property(x => x.System).HasMaxLength(100);
        b.Property(x => x.Unit).HasMaxLength(100);
        b.Property(x => x.Description).HasMaxLength(2000);
        b.Property(x => x.Extras).HasColumnType("jsonb");
    }

    public void Configure(EntityTypeBuilder<DocumentAsset> b)
    {
        b.ToTable("document_assets");
        b.HasOne<Document>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Asset>().WithMany().HasForeignKey(x => x.AssetId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.DocumentId, x.AssetId }).IsUnique();
        b.HasIndex(x => x.AssetId);
        b.Property(x => x.CreatedByName).HasMaxLength(200);
    }

    public void Configure(EntityTypeBuilder<ExceptionEntry> b)
    {
        b.ToTable("exception_entries");
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.ProjectId);
        b.Property(x => x.Item).HasMaxLength(500);
        b.Property(x => x.Clauses).HasMaxLength(200);
        b.Property(x => x.Reason).HasMaxLength(2000);
        b.Property(x => x.Authority).HasMaxLength(200);
        b.Property(x => x.RecordedByName).HasMaxLength(200);
    }

    public void Configure(EntityTypeBuilder<NumberRange> b)
    {
        b.ToTable("number_ranges");
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Prefix });
        b.Property(x => x.Prefix).HasMaxLength(200);
        b.Property(x => x.IssuedTo).HasMaxLength(200);
        b.Property(x => x.Status).HasMaxLength(16);
        b.Property(x => x.IssuedByName).HasMaxLength(200);
    }

    public void Configure(EntityTypeBuilder<RequirementCall> b)
    {
        b.ToTable("requirement_calls");
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Department });
        b.Property(x => x.Department).HasMaxLength(64);
        b.Property(x => x.IssuedByName).HasMaxLength(200);
        b.Property(x => x.AnswerNote).HasMaxLength(2000);
    }

    public void Configure(EntityTypeBuilder<ReadinessConfirmation> b)
    {
        b.ToTable("readiness_confirmations");
        b.HasOne<Activity>().WithMany().HasForeignKey(x => x.ActivityId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ActivityId, x.Department }).IsUnique();
        b.HasIndex(x => x.ProjectId);
        b.Property(x => x.Department).HasMaxLength(64);
        b.Property(x => x.Note).HasMaxLength(2000);
        b.Property(x => x.ConfirmedByName).HasMaxLength(200);
    }

    public void Configure(EntityTypeBuilder<SenderIssue> b)
    {
        b.ToTable("sender_issues");
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Sender, x.IssuedAt });
        b.Property(x => x.Sender).HasMaxLength(100);
        b.Property(x => x.IssuedByName).HasMaxLength(200);
    }

    public void Configure(EntityTypeBuilder<ControlledVersion> b)
    {
        b.ToTable("controlled_versions");
        b.HasIndex(x => new { x.TenantId, x.ProjectId, x.Kind, x.Key, x.VersionLabel }).IsUnique().AreNullsDistinct(false);
        b.HasIndex(x => new { x.TenantId, x.ProjectId, x.Kind, x.Key, x.State });
        b.Property(x => x.Kind).HasMaxLength(64);
        b.Property(x => x.Key).HasMaxLength(128);
        b.Property(x => x.Title).HasMaxLength(200);
        b.Property(x => x.VersionLabel).HasMaxLength(16);
        b.Property(x => x.State).HasMaxLength(16);
        b.Property(x => x.Payload).HasColumnType("jsonb");
        b.Property(x => x.Diff).HasColumnType("jsonb");
        b.Property(x => x.SourceName).HasMaxLength(300);
        b.Property(x => x.SourceHash).HasMaxLength(64);
        b.Property(x => x.Notes).HasMaxLength(2000);
        b.Property(x => x.CreatedByName).HasMaxLength(200);
        b.Property(x => x.SubmittedByName).HasMaxLength(200);
        b.Property(x => x.DecidedByName).HasMaxLength(200);
        b.Property(x => x.DecisionReason).HasMaxLength(2000);
        b.Property(x => x.AppliedSummary).HasMaxLength(2000);
    }
}

// ── Requests ──────────────────────────────────────────────────────────────────

public sealed record AssetRequest(string? Code, string? Name, string? Area = null, string? System = null, string? Unit = null,
    string? Description = null, Dictionary<string, string?>? Extras = null);
public sealed record LinkAssetRequest(string? AssetCode);
public sealed record ExceptionRequest(string? Item, string? Clauses, string? Reason, string? Authority, DateOnly? StartDate, DateOnly? ReviewPoint = null);
public sealed record NumberRangeRequest(string? Prefix, int From, int To, string? IssuedTo);
public sealed record CallsRequest(string[]? Departments, DateOnly? DueOn);
public sealed record AnswerCallRequest(string? Note);
public sealed record ReadinessRequest(string? Department, bool Available, string? Note);
public sealed record SenderIssueRequest(string? Sender);
public sealed record ControlledUpload(string? Kind, string? Key, string? Title, JsonElement Payload, JsonElement? Diff = null, int RowCount = 0,
    string? SourceName = null, long? SourceSize = null, string? SourceHash = null, string? Notes = null, string? VersionLabel = null);
public sealed record ControlledDecision(bool Approve, string? Reason = null, string? AppliedSummary = null);

// ── Endpoints ─────────────────────────────────────────────────────────────────

/// <summary>
/// The project's own records kept beside the register: assets and the documents
/// that describe them, published exceptions, number ranges given to parties, the
/// calls to departments and their readiness, the lists issued to senders, and
/// uploaded lists waiting for a decision.
/// </summary>
public static class ProjectRecordEndpoints
{
    public static void MapProjectRecordEndpoints(this IEndpointRouteBuilder app)
    {
        var p = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Records")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();

        // Assets
        p.MapGet("/assets", AssetsAsync);
        p.MapGet("/assets/{assetId:guid}", AssetAsync);
        p.MapPost("/assets", AddAssetAsync);
        p.MapPut("/assets/{assetId:guid}", UpdateAssetAsync);
        p.MapPost("/assets/{assetId:guid}/retire", RetireAssetAsync);
        p.MapGet("/documents/{documentId:guid}/assets", DocumentAssetsAsync);
        p.MapPost("/documents/{documentId:guid}/assets", LinkAssetAsync);
        p.MapDelete("/document-assets/{linkId:guid}", UnlinkAssetAsync);

        // Exceptions and number ranges
        p.MapGet("/exceptions", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
            Results.Ok(await db.Set<ExceptionEntry>().AsNoTracking().Where(x => x.ProjectId == ProjectAccessFilter.Of(h).Project.Id)
                .OrderByDescending(x => x.StartDate).ToListAsync(c)));
        p.MapPost("/exceptions", AddExceptionAsync);
        p.MapGet("/number-ranges", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
            Results.Ok(await db.Set<NumberRange>().AsNoTracking().Where(x => x.ProjectId == ProjectAccessFilter.Of(h).Project.Id)
                .OrderBy(x => x.Prefix).ThenBy(x => x.From).ToListAsync(c)));
        p.MapPost("/number-ranges", IssueRangeAsync);

        // Calls to departments, readiness, lists issued to senders
        p.MapGet("/requirement-calls", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
            Results.Ok(await db.Set<RequirementCall>().AsNoTracking().Where(x => x.ProjectId == ProjectAccessFilter.Of(h).Project.Id)
                .OrderBy(x => x.Department).ThenByDescending(x => x.IssuedAt).ToListAsync(c)));
        p.MapPost("/requirement-calls", IssueCallsAsync);
        p.MapPost("/requirement-calls/{callId:guid}/remind", RemindCallAsync);
        p.MapPost("/requirement-calls/{callId:guid}/answer", AnswerCallAsync);
        p.MapGet("/readiness", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
            Results.Ok(await db.Set<ReadinessConfirmation>().AsNoTracking().Where(x => x.ProjectId == ProjectAccessFilter.Of(h).Project.Id)
                .ToListAsync(c)));
        p.MapPost("/activities/{activityId:guid}/readiness", ConfirmReadinessAsync);
        p.MapPost("/activities/{activityId:guid}/notify-departments", NotifyDepartmentsAsync);
        p.MapPut("/activities/{activityId:guid}/departments", SetDepartmentsAsync);
        p.MapGet("/sender-issues", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
            Results.Ok(await db.Set<SenderIssue>().AsNoTracking().Where(x => x.ProjectId == ProjectAccessFilter.Of(h).Project.Id)
                .OrderByDescending(x => x.IssuedAt).ToListAsync(c)));
        p.MapPost("/sender-issues", IssueToSenderAsync);

        // Uploaded lists for a decision: the project's, and (outside a project) the organization's.
        p.MapGet("/controlled", (HttpContext h, DeliosDbContext db, CancellationToken c, string? kind, string? key) =>
            ControlledListAsync(db, ProjectAccessFilter.Of(h).Project.Id, kind, key, c));
        p.MapPost("/controlled", (ControlledUpload r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c) =>
            UploadAsync(h, db, audit, clock, ProjectAccessFilter.Of(h).Project.Id, r, c));
        var org = app.MapGroup("/api/controlled").WithTags("Records").RequireAuthorization().AddEndpointFilter<TransactionFilter>();
        org.MapGet("", (DeliosDbContext db, CancellationToken c, string? kind, string? key) => ControlledListAsync(db, null, kind, key, c));
        org.MapPost("", (ControlledUpload r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c) =>
            UploadAsync(h, db, audit, clock, null, r, c));
        org.MapPost("/{versionId:guid}/submit", SubmitAsync);
        org.MapPost("/{versionId:guid}/decide", DecideAsync);
        org.MapPost("/{versionId:guid}/discard", DiscardAsync);
    }

    private static Actor Who(ProjectAccess a) => new(a.UserId, a.UserName);

    /// <summary>Document Control on this project, or whoever configures the organization.</summary>
    private static async Task<bool> KeepsAsync(HttpContext h, ProjectAccess a) => a.Holds(Verbs.Control) || await Keepers.ConfiguresAsync(h);

    private static IResult KeepersOnly(string what) => Problems.Forbidden("CONTROL_ONLY", $"Document Control keeps {what}.");

    // ── Assets ────────────────────────────────────────────────────────────────

    private sealed record AssetView(Guid Id, string Code, string Name, string? Area, string? System, string? Unit, string? Description,
        JsonElement? Extras, bool Active, int Documents);

    private static AssetView View(Asset a, int documents) => new(a.Id, a.Code, a.Name, a.Area, a.System, a.Unit, a.Description,
        a.Extras is null ? null : JsonDocument.Parse(a.Extras).RootElement.Clone(), a.Active, documents);

    private static async Task<IResult> AssetsAsync(HttpContext h, DeliosDbContext db, CancellationToken c, string? q = null, bool all = false)
    {
        var access = ProjectAccessFilter.Of(h);
        var query = db.Set<Asset>().AsNoTracking().Where(a => a.ProjectId == access.Project.Id && (all || a.Active));
        if (!string.IsNullOrWhiteSpace(q))
        {
            var like = $"%{q.Trim()}%";
            query = query.Where(a => EF.Functions.ILike(a.Code, like) || EF.Functions.ILike(a.Name, like)
                || (a.Area != null && EF.Functions.ILike(a.Area, like)) || (a.System != null && EF.Functions.ILike(a.System, like)));
        }
        var rows = await query.OrderBy(a => a.Code).Take(2000)
            .Select(a => new { a, Documents = db.Set<DocumentAsset>().Count(l => l.AssetId == a.Id) }).ToListAsync(c);
        return Results.Ok(rows.Select(x => View(x.a, x.Documents)));
    }

    private static async Task<IResult> AssetAsync(Guid assetId, HttpContext h, DeliosDbContext db, DocumentService documents, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        var asset = await db.Set<Asset>().AsNoTracking().SingleOrDefaultAsync(a => a.Id == assetId && a.ProjectId == access.Project.Id, c);
        if (asset is null) return Problems.NotFound("ASSET_NOT_FOUND", "No such asset.");
        var linked = db.Set<DocumentAsset>().Where(l => l.AssetId == assetId).Select(l => l.DocumentId);
        var docs = await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(c)).AsNoTracking()
            .Where(d => linked.Contains(d.Id)).OrderBy(d => d.Number)
            .Select(d => new
            {
                d.Id,
                d.Number,
                d.Title,
                d.DocType,
                d.Discipline,
                d.State,
                Current = d.Revisions.Where(r => r.State == RevisionStates.Released).Select(r => new { r.Value, r.StatusCode }).FirstOrDefault(),
            }).ToListAsync(c);
        var count = await db.Set<DocumentAsset>().CountAsync(l => l.AssetId == assetId, c);
        return Results.Ok(new { asset = View(asset, count), documents = docs });
    }

    private static async Task<IResult> AddAssetAsync(AssetRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await KeepsAsync(h, access)) return KeepersOnly("the asset list");
        var code = r.Code?.Trim().ToUpperInvariant() ?? "";
        var name = r.Name?.Trim() ?? "";
        if (code.Length == 0 || name.Length == 0) return Problems.Invalid("CODE_AND_NAME_REQUIRED", "A tag and a name are required.");
        if (await db.Set<Asset>().AnyAsync(a => a.ProjectId == access.Project.Id && a.Code == code, c))
            return Problems.Conflict("ASSET_EXISTS", $"{code} is already in the list.");
        var asset = new Asset
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            Code = code,
            Name = name,
            Area = Blank(r.Area),
            System = Blank(r.System),
            Unit = Blank(r.Unit),
            Description = Blank(r.Description),
            Extras = OwnFields.Write(null, r.Extras),
            CreatedAt = clock.GetCurrentInstant(),
        };
        db.Add(asset);
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "ASSET_ADDED", "Asset", asset.Id, code, name, access.Project.Id, c);
        return Results.Created($"/api/projects/{access.Project.Id}/assets/{asset.Id}", View(asset, 0));
    }

    private static async Task<IResult> UpdateAssetAsync(Guid assetId, AssetRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await KeepsAsync(h, access)) return KeepersOnly("the asset list");
        var asset = await db.Set<Asset>().SingleOrDefaultAsync(a => a.Id == assetId && a.ProjectId == access.Project.Id, c);
        if (asset is null) return Problems.NotFound("ASSET_NOT_FOUND", "No such asset.");
        var name = r.Name?.Trim() ?? "";
        if (name.Length == 0) return Problems.Invalid("NAME_REQUIRED", "An asset needs a name.");
        var was = asset.Name;
        // The tag itself does not change: documents and drawings cite it.
        asset.Name = name;
        asset.Area = Blank(r.Area);
        asset.System = Blank(r.System);
        asset.Unit = Blank(r.Unit);
        asset.Description = Blank(r.Description);
        if (r.Extras is not null) asset.Extras = OwnFields.Write(asset.Extras, r.Extras);
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "ASSET_UPDATED", "Asset", asset.Id, asset.Code, was == name ? "Details changed." : $"{was} → {name}",
            access.Project.Id, c);
        return Results.Ok(View(asset, await db.Set<DocumentAsset>().CountAsync(l => l.AssetId == assetId, c)));
    }

    private static async Task<IResult> RetireAssetAsync(Guid assetId, HttpContext h, DeliosDbContext db, AuditLog audit, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await KeepsAsync(h, access)) return KeepersOnly("the asset list");
        var asset = await db.Set<Asset>().SingleOrDefaultAsync(a => a.Id == assetId && a.ProjectId == access.Project.Id, c);
        if (asset is null) return Problems.NotFound("ASSET_NOT_FOUND", "No such asset.");
        var links = await db.Set<DocumentAsset>().CountAsync(l => l.AssetId == assetId, c);
        if (links > 0) return Problems.Conflict("ASSET_IN_USE", $"{asset.Code} describes {links} document{(links == 1 ? "" : "s")}; unlink them first.");
        asset.Active = false;
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "ASSET_RETIRED", "Asset", asset.Id, asset.Code, "Retired while unused; kept on record.", access.Project.Id, c);
        return Results.NoContent();
    }

    private static async Task<IResult> DocumentAssetsAsync(Guid documentId, HttpContext h, DeliosDbContext db, DocumentService documents, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(c)).AnyAsync(d => d.Id == documentId, c))
            return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        return Results.Ok(await (from l in db.Set<DocumentAsset>()
                                 join a in db.Set<Asset>() on l.AssetId equals a.Id
                                 where l.DocumentId == documentId
                                 orderby a.Code
                                 select new { l.Id, AssetId = a.Id, a.Code, a.Name, CreatedBy = l.CreatedByName, l.CreatedAt }).ToListAsync(c));
    }

    private static async Task<IResult> LinkAssetAsync(Guid documentId, LinkAssetRequest r, HttpContext h, DeliosDbContext db, DocumentService documents,
        AuditLog audit, IClock clock, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        var document = await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(c)).SingleOrDefaultAsync(d => d.Id == documentId, c);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (!MayEdit(access, document)) return Problems.Forbidden("EDIT_NOT_ALLOWED", "Your function on this project cannot change this document's details.");
        var code = r.AssetCode?.Trim().ToUpperInvariant() ?? "";
        if (code.Length == 0) return Problems.Invalid("ASSET_REQUIRED", "Enter an asset code.");
        var asset = await db.Set<Asset>().SingleOrDefaultAsync(a => a.ProjectId == access.Project.Id && a.Code == code && a.Active, c);
        if (asset is null) return Problems.Invalid("ASSET_UNKNOWN", $"Asset \"{code}\" is not in the asset breakdown.");
        if (await db.Set<DocumentAsset>().AnyAsync(l => l.DocumentId == documentId && l.AssetId == asset.Id, c))
            return Problems.Conflict("ALREADY_LINKED", "Already associated with this asset.");
        db.Add(new DocumentAsset
        {
            TenantId = document.TenantId,
            ProjectId = document.ProjectId,
            DocumentId = document.Id,
            AssetId = asset.Id,
            CreatedByName = access.UserName,
            CreatedAt = clock.GetCurrentInstant(),
        });
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "RELATIONSHIP", "Document", document.Id, document.Number, $"Associated with asset {asset.Code} — {asset.Name}.",
            access.Project.Id, c);
        return Results.NoContent();
    }

    private static async Task<IResult> UnlinkAssetAsync(Guid linkId, HttpContext h, DeliosDbContext db, DocumentService documents, AuditLog audit, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        var link = await db.Set<DocumentAsset>().SingleOrDefaultAsync(l => l.Id == linkId && l.ProjectId == access.Project.Id, c);
        if (link is null) return Results.NoContent();
        var document = await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(c)).SingleOrDefaultAsync(d => d.Id == link.DocumentId, c);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (!MayEdit(access, document)) return Problems.Forbidden("EDIT_NOT_ALLOWED", "Your function on this project cannot change this document's details.");
        var code = await db.Set<Asset>().Where(a => a.Id == link.AssetId).Select(a => a.Code).SingleAsync(c);
        db.Remove(link);
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "RELATIONSHIP", "Document", document.Id, document.Number, $"No longer associated with asset {code}.",
            access.Project.Id, c);
        return Results.NoContent();
    }

    private static bool MayEdit(ProjectAccess a, Document d) => a.IsInternal
        && (a.Allows(Verbs.Create, d.Facts) || a.Allows(Verbs.Revise, d.Facts) || a.Allows(Verbs.Control, d.Facts));

    // ── Exceptions and number ranges ──────────────────────────────────────────

    private static async Task<IResult> AddExceptionAsync(ExceptionRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await KeepsAsync(h, access)) return KeepersOnly("the published exceptions");
        if (Blank(r.Item) is not { } item || Blank(r.Clauses) is not { } clauses || Blank(r.Reason) is not { } reason
            || Blank(r.Authority) is not { } authority || r.StartDate is not { } start)
            return Problems.Invalid("FIELDS_REQUIRED", "An exception says what, which clauses, why, on whose authority, and from when.");
        if (r.ReviewPoint is { } review && review < start) return Problems.Invalid("REVIEW_BEFORE_START", "It is reviewed after it starts, not before.");
        var row = new ExceptionEntry
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            Item = item,
            Clauses = clauses,
            Reason = reason,
            Authority = authority,
            StartDate = LocalDate.FromDateOnly(start),
            ReviewPoint = r.ReviewPoint is { } rp ? LocalDate.FromDateOnly(rp) : null,
            RecordedByName = access.UserName,
            CreatedAt = clock.GetCurrentInstant(),
        };
        db.Add(row);
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "EXCEPTION_RECORDED", "Exception", row.Id, item, $"Clauses {clauses}, on the authority of {authority}: {reason}",
            access.Project.Id, c);
        return Results.Ok(row);
    }

    private static async Task<IResult> IssueRangeAsync(NumberRangeRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await KeepsAsync(h, access)) return KeepersOnly("the number ranges");
        var prefix = r.Prefix?.Trim() ?? "";
        var to = Blank(r.IssuedTo);
        if (prefix.Length == 0 || to is null) return Problems.Invalid("FIELDS_REQUIRED", "Say which numbers (the fields they start with) and who gets them.");
        if (r.From < 0 || r.To < r.From) return Problems.Invalid("RANGE_INVALID", "A range runs from a number up to a number no smaller.");
        var overlap = await db.Set<NumberRange>().AnyAsync(x => x.ProjectId == access.Project.Id && x.Prefix == prefix && x.Status != "CLOSED"
            && x.From <= r.To && r.From <= x.To, c);
        if (overlap) return Problems.Conflict("RANGE_OVERLAPS", "Those numbers overlap a range already given out.");
        var row = new NumberRange
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            Prefix = prefix,
            From = r.From,
            To = r.To,
            LastIssued = r.From - 1,
            IssuedTo = to,
            IssuedByName = access.UserName,
            CreatedAt = clock.GetCurrentInstant(),
        };
        db.Add(row);
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "NUMBER_RANGE_ISSUED", "NumberRange", row.Id, $"{prefix} {r.From}–{r.To}", $"Given to {to}.", access.Project.Id, c);
        return Results.Ok(row);
    }

    // ── Calls to departments, readiness, senders ──────────────────────────────

    private static async Task<IResult> IssueCallsAsync(CallsRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock,
        Notifications.Notifier notifier, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control issues the calls to departments.");
        var departments = r.Departments?.Select(d => d.Trim().ToUpperInvariant()).Where(d => d.Length > 0).Distinct().ToList() ?? [];
        if (departments.Count == 0) return Problems.Invalid("DEPARTMENTS_REQUIRED", "Choose the departments to ask.");
        if (r.DueOn is not { } due || LocalDate.FromDateOnly(due) < WorkingCalendar.Today(clock, access.Project.TimeZone))
            return Problems.Invalid("DUE_REQUIRED", "Say by when they answer: today or later.");
        var activities = await db.Activities.AsNoTracking().Where(a => a.ProjectId == access.Project.Id && a.State == ActivityStates.Active)
            .Select(a => new { a.Code, a.Departments }).ToListAsync(c);
        var earlier = await db.Set<RequirementCall>().AsNoTracking().Where(x => x.ProjectId == access.Project.Id).ToListAsync(c);
        var now = clock.GetCurrentInstant();
        var issued = new List<RequirementCall>();
        foreach (var department in departments)
        {
            // A call covers what no earlier call covered: a new schedule version asks only about what is new.
            var covered = earlier.Where(x => x.Department == department).SelectMany(x => x.ActivityCodes).ToHashSet();
            var codes = activities.Where(a => a.Departments.Contains(department) && !covered.Contains(a.Code)).Select(a => a.Code).OrderBy(x => x).ToArray();
            if (codes.Length == 0) continue;
            var call = new RequirementCall
            {
                TenantId = access.Project.TenantId,
                ProjectId = access.Project.Id,
                Department = department,
                ActivityCodes = codes,
                DueOn = LocalDate.FromDateOnly(due),
                IssuedAt = now,
                IssuedByName = access.UserName,
            };
            db.Add(call);
            issued.Add(call);
            await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, await DepartmentMembersAsync(db, access.Project.Id, department, c),
                Notifications.NotificationKinds.General, $"What documents does {department} need? Answer by {due:yyyy-MM-dd}",
                $"{codes.Length} activit{(codes.Length == 1 ? "y" : "ies")}: {string.Join(", ", codes.Take(20))}{(codes.Length > 20 ? "…" : "")}.",
                "/actions/requirements", c);
            await audit.WriteAsync(Who(access), "REQUIREMENT_CALL", "RequirementCall", call.Id, department,
                $"Asked for the documents of {codes.Length} activities, by {due:yyyy-MM-dd}.", access.Project.Id, c);
        }
        if (issued.Count == 0) return Problems.Conflict("NOTHING_TO_ASK", "Every activity those departments are tagged on has already been asked about.");
        await db.SaveChangesAsync(c);
        return Results.Ok(issued);
    }

    private static async Task<IResult> RemindCallAsync(Guid callId, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock,
        Notifications.Notifier notifier, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control sends reminders.");
        var call = await db.Set<RequirementCall>().SingleOrDefaultAsync(x => x.Id == callId && x.ProjectId == access.Project.Id, c);
        if (call is null) return Problems.NotFound("CALL_NOT_FOUND", "No such call.");
        if (call.AnsweredAt is not null) return Problems.Conflict("CALL_ANSWERED", "That department has answered.");
        call.Reminders++;
        call.LastRemindedAt = clock.GetCurrentInstant();
        await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, await DepartmentMembersAsync(db, access.Project.Id, call.Department, c),
            Notifications.NotificationKinds.General, $"Reminder: {call.Department}'s documents were due {call.DueOn:yyyy-MM-dd}",
            $"Activities: {string.Join(", ", call.ActivityCodes.Take(20))}.", "/actions/requirements", c);
        await audit.WriteAsync(Who(access), "REQUIREMENT_CALL_REMINDED", "RequirementCall", call.Id, call.Department, $"Reminder {call.Reminders}.",
            access.Project.Id, c);
        await db.SaveChangesAsync(c);
        return Results.Ok(call);
    }

    private static async Task<IResult> AnswerCallAsync(Guid callId, AnswerCallRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control records the answer.");
        var call = await db.Set<RequirementCall>().SingleOrDefaultAsync(x => x.Id == callId && x.ProjectId == access.Project.Id, c);
        if (call is null) return Problems.NotFound("CALL_NOT_FOUND", "No such call.");
        if (call.AnsweredAt is not null) return Problems.Conflict("CALL_ANSWERED", "That department has answered.");
        call.AnsweredAt = clock.GetCurrentInstant();
        call.AnswerNote = Blank(r.Note);
        await audit.WriteAsync(Who(access), "REQUIREMENT_CALL_ANSWERED", "RequirementCall", call.Id, call.Department, call.AnswerNote ?? "Answered.",
            access.Project.Id, c);
        await db.SaveChangesAsync(c);
        return Results.Ok(call);
    }

    private static async Task<IResult> ConfirmReadinessAsync(Guid activityId, ReadinessRequest r, HttpContext h, DeliosDbContext db, AuditLog audit,
        IClock clock, Notifications.Notifier notifier, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        var activity = await db.Activities.AsNoTracking().SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, c);
        if (activity is null) return Problems.NotFound("ACTIVITY_NOT_FOUND", "No such activity.");
        var department = r.Department?.Trim().ToUpperInvariant() ?? "";
        if (!activity.Departments.Contains(department)) return Problems.Invalid("NOT_CONCERNED", $"{activity.Code} does not concern {department}.");
        var mine = await db.Memberships.AnyAsync(m => m.ProjectId == access.Project.Id && m.UserId == access.UserId && m.Active && m.Department == department, c);
        if (!mine && !access.Holds(Verbs.Control)) return Problems.Forbidden("NOT_YOUR_DEPARTMENT", $"Someone who answers for {department} confirms its documents.");
        var note = Blank(r.Note);
        if (!r.Available && note is null) return Problems.Invalid("NOTE_REQUIRED", "Say what is missing and why: Document Control is alerted with it.");
        // Going ahead with this discipline's documents missing is always explained.
        if (r.Available && note is null && await db.Set<Schedules.Requirement>().AnyAsync(n => n.ActivityId == activityId && n.Department == department
                && n.State != RequirementStates.Met && n.State != RequirementStates.Waived, c))
            return Problems.Invalid("NOTE_REQUIRED", "Some of its documents are missing: say why it can go ahead without them.");
        var row = await db.Set<ReadinessConfirmation>().SingleOrDefaultAsync(x => x.ActivityId == activityId && x.Department == department, c);
        if (row is null)
        {
            row = new ReadinessConfirmation
            {
                TenantId = access.Project.TenantId,
                ProjectId = access.Project.Id,
                ActivityId = activityId,
                Department = department,
                ConfirmedByName = access.UserName,
            };
            db.Add(row);
        }
        row.Available = r.Available;
        row.Note = note;
        row.ConfirmedByName = access.UserName;
        row.ConfirmedAt = clock.GetCurrentInstant();
        await audit.WriteAsync(Who(access), "READINESS_CONFIRMED", "Activity", activity.Id, activity.Code,
            $"{department}: {(r.Available ? "documents available" : "not available")}.{(note is null ? "" : $" {note}")}", access.Project.Id, c);
        if (!r.Available)
        {
            await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, await notifier.ControlHoldersAsync(access.Project.Id, c),
                Notifications.NotificationKinds.General, $"{activity.Code}: {department} is short of documents", note, $"/actions/{activity.Code}", c);
        }
        await db.SaveChangesAsync(c);
        return Results.Ok(row);
    }

    private static async Task<IResult> NotifyDepartmentsAsync(Guid activityId, HttpContext h, DeliosDbContext db, AuditLog audit,
        Notifications.Notifier notifier, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await KeepsAsync(h, access)) return Problems.Forbidden("CONTROL_ONLY", "Document Control tells the departments where they stand.");
        var activity = await db.Activities.AsNoTracking().Include(a => a.Requirements)
            .SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, c);
        if (activity is null) return Problems.NotFound("ACTIVITY_NOT_FOUND", "No such activity.");
        if (activity.Departments.Length == 0) return Problems.Conflict("NO_DEPARTMENTS", "No department is tagged on this activity.");
        var shortages = activity.Requirements.Where(n => n.State != RequirementStates.Met && n.State != RequirementStates.Waived)
            .GroupBy(n => n.Department ?? "").ToDictionary(g => g.Key, g => g.Count());
        var totals = activity.Requirements.GroupBy(n => n.Department ?? "").ToDictionary(g => g.Key, g => g.Count());
        var summary = string.Join(", ", activity.Departments.Where(shortages.ContainsKey)
            .Select(d => $"{d} {shortages[d]} of {totals.GetValueOrDefault(d)} missing"));
        var subject = $"{activity.Code} on {activity.Start?.ToString("yyyy-MM-dd", null) ?? "no date"}: "
            + (summary.Length == 0 ? "every document is there" : $"at risk — {summary}");
        var people = new List<Guid>();
        foreach (var d in activity.Departments) people.AddRange(await DepartmentMembersAsync(db, access.Project.Id, d, c));
        await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, people, Notifications.NotificationKinds.General, subject,
            activity.Name, $"/actions/{activity.Code}", c);
        await audit.WriteAsync(Who(access), "DEPARTMENTS_NOTIFIED", "Activity", activity.Id, activity.Code, subject, access.Project.Id, c);
        return Results.Ok(new { subject, told = people.Distinct().Count() });
    }

    private sealed record DepartmentsRequest(string[]? Departments);

    private static async Task<IResult> SetDepartmentsAsync(Guid activityId, HttpContext h, DeliosDbContext db, AuditLog audit, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await KeepsAsync(h, access)) return Problems.Forbidden("CONTROL_ONLY", "The project manager's approved list, or Document Control, tags activities.");
        var body = await h.Request.ReadFromJsonAsync<DepartmentsRequest>(c);
        var activity = await db.Activities.SingleOrDefaultAsync(a => a.Id == activityId && a.ProjectId == access.Project.Id, c);
        if (activity is null) return Problems.NotFound("ACTIVITY_NOT_FOUND", "No such activity.");
        var departments = body?.Departments?.Select(d => d.Trim().ToUpperInvariant()).Where(d => d.Length > 0).Distinct().OrderBy(d => d).ToArray() ?? [];
        var catalog = await Catalog.LoadAsync(db, c);
        if (departments.FirstOrDefault(d => !catalog.IsActive(ValueSets.Disciplines, d)) is { } unknown)
            return Problems.Invalid("VALUE_NOT_PUBLISHED", $"{unknown} is not a published discipline.", new { field = "departments", value = unknown });
        var was = string.Join(", ", activity.Departments);
        activity.Departments = departments;
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "ACTIVITY_DEPARTMENTS", "Activity", activity.Id, activity.Code,
            $"{(was.Length == 0 ? "none" : was)} → {(departments.Length == 0 ? "none" : string.Join(", ", departments))}", access.Project.Id, c);
        return Results.NoContent();
    }

    private static async Task<IResult> IssueToSenderAsync(SenderIssueRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock,
        Notifications.Notifier notifier, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control issues the list to senders.");
        var sender = r.Sender?.Trim() ?? "";
        if (sender.Length == 0) return Problems.Invalid("SENDER_REQUIRED", "Say who it goes to.");
        var department = sender.StartsWith("DEPT:", StringComparison.Ordinal) ? sender[5..] : null;
        var needs = await (from n in db.Requirements
                           join a in db.Activities on n.ActivityId equals a.Id
                           join d in db.Documents on n.DocumentId equals d.Id
                           where a.ProjectId == access.Project.Id && a.State == ActivityStates.Active
                               && (department == null ? d.Originator == sender : d.Originator == null && d.Discipline == department)
                           select n.Id).ToListAsync(c);
        if (needs.Count == 0) return Problems.Conflict("NOTHING_TO_ISSUE", "No document on the list comes from them.");
        var row = new SenderIssue
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            Sender = sender,
            EntryCount = needs.Count,
            NeedIds = [.. needs],
            IssuedByName = access.UserName,
            IssuedAt = clock.GetCurrentInstant(),
        };
        db.Add(row);
        var people = department is not null
            ? await DepartmentMembersAsync(db, access.Project.Id, department, c)
            : await (from m in db.Memberships
                     join u in db.Users on m.UserId equals u.Id
                     where m.ProjectId == access.Project.Id && m.Active && u.Active && u.Party != null && u.Party.Code == sender
                     select u.Id).ToListAsync(c);
        await notifier.NotifyAsync(access.Project.TenantId, access.Project.Id, people, Notifications.NotificationKinds.General,
            $"The documents you are to send: {needs.Count}", "Document Control issued the requirements list; each has a date it is needed by.",
            "/actions/requirements", c);
        await audit.WriteAsync(Who(access), "REQUIREMENTS_ISSUED", "SenderIssue", row.Id, sender, $"{needs.Count} documents.", access.Project.Id, c);
        await db.SaveChangesAsync(c);
        return Results.Ok(row);
    }

    private static Task<List<Guid>> DepartmentMembersAsync(DeliosDbContext db, Guid projectId, string department, CancellationToken c) =>
        (from m in db.Memberships
         join u in db.Users on m.UserId equals u.Id
         where m.ProjectId == projectId && m.Active && u.Active && m.Department == department
         select u.Id).Distinct().ToListAsync(c);

    // ── Uploaded lists for a decision ─────────────────────────────────────────

    private static async Task<IResult> ControlledListAsync(DeliosDbContext db, Guid? projectId, string? kind, string? key, CancellationToken c)
    {
        var query = db.Set<ControlledVersion>().AsNoTracking().Where(v => v.ProjectId == projectId);
        if (!string.IsNullOrEmpty(kind)) query = query.Where(v => v.Kind == kind);
        if (!string.IsNullOrEmpty(key)) query = query.Where(v => v.Key == key);
        var rows = await query.OrderByDescending(v => v.CreatedAt).Take(500).ToListAsync(c);
        return Results.Ok(rows.Select(ControlledView));
    }

    private static object ControlledView(ControlledVersion v) => new
    {
        v.Id,
        v.ProjectId,
        v.Kind,
        v.Key,
        v.Title,
        v.VersionLabel,
        v.State,
        v.SubmittedById,
        v.RowCount,
        v.SourceName,
        v.SourceSize,
        v.SourceHash,
        v.Notes,
        Payload = JsonDocument.Parse(v.Payload).RootElement.Clone(),
        Diff = v.Diff is null ? (JsonElement?)null : JsonDocument.Parse(v.Diff).RootElement.Clone(),
        CreatedBy = v.CreatedByName,
        CreatedById = v.CreatedById,
        CreatedAt = v.CreatedAt.ToDateTimeOffset(),
        SubmittedBy = v.SubmittedByName,
        SubmittedAt = v.SubmittedAt?.ToDateTimeOffset(),
        DecidedBy = v.DecidedByName,
        DecidedAt = v.DecidedAt?.ToDateTimeOffset(),
        v.DecisionReason,
        AppliedAt = v.AppliedAt?.ToDateTimeOffset(),
        v.AppliedSummary,
        SupersededAt = v.SupersededAt?.ToDateTimeOffset(),
    };

    /// <summary>Who keeps controlled lists: whoever configures the organization, or Document Control on some project.</summary>
    private static async Task<bool> MayControlAsync(HttpContext h, DeliosDbContext db, Guid? projectId)
    {
        if (await Keepers.ConfiguresAsync(h)) return true;
        var me = h.User.UserId();
        return await db.Memberships.AnyAsync(m => m.UserId == me && m.Active && (projectId == null || m.ProjectId == projectId)
            && m.Function!.Active && m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control)), h.RequestAborted);
    }

    private static async Task<IResult> UploadAsync(HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, Guid? projectId,
        ControlledUpload r, CancellationToken c)
    {
        if (!await MayControlAsync(h, db, projectId)) return Problems.Forbidden("CONTROL_ONLY", "Document Control or an administrator uploads a controlled list.");
        var kind = r.Kind?.Trim() ?? "";
        var key = string.IsNullOrWhiteSpace(r.Key) ? "default" : r.Key.Trim();
        if (kind.Length == 0) return Problems.Invalid("KIND_REQUIRED", "Say which list this is.");
        var labels = await db.Set<ControlledVersion>().Where(v => v.ProjectId == projectId && v.Kind == kind && v.Key == key)
            .Select(v => v.VersionLabel).ToListAsync(c);
        var next = labels.Select(l => int.TryParse(l.TrimStart('v'), out var n) ? n : 0).DefaultIfEmpty(0).Max() + 1;
        // The uploader names the version; a name is never reused.
        var label = Blank(r.VersionLabel) ?? $"v{next}";
        if (label.Length > 16) return Problems.Invalid("LABEL_TOO_LONG", "A version label is at most 16 characters.");
        if (labels.Contains(label)) return Problems.Conflict("LABEL_TAKEN", $"Version {label} already exists here. Labels are never reused.");
        var pending = await db.Set<ControlledVersion>().AsNoTracking()
            .Where(v => v.ProjectId == projectId && v.Kind == kind && v.Key == key && (v.State == "DRAFT" || v.State == "SUBMITTED"))
            .Select(v => new { v.VersionLabel, v.State }).FirstOrDefaultAsync(c);
        if (pending is not null)
            return Problems.Conflict("VERSION_PENDING", $"{pending.VersionLabel} is already {pending.State.ToLowerInvariant()} here. Decide on it before uploading another.");
        var me = await db.Users.AsNoTracking().SingleAsync(u => u.Id == h.User.UserId(), c);
        var version = new ControlledVersion
        {
            TenantId = h.User.TenantId(),
            ProjectId = projectId,
            Kind = kind,
            Key = key,
            Title = Blank(r.Title) ?? kind,
            VersionLabel = label,
            Payload = r.Payload.GetRawText(),
            Diff = r.Diff?.GetRawText(),
            RowCount = r.RowCount,
            SourceName = Blank(r.SourceName),
            SourceSize = r.SourceSize,
            SourceHash = Blank(r.SourceHash),
            Notes = Blank(r.Notes),
            CreatedById = me.Id,
            CreatedByName = me.Name,
            CreatedAt = clock.GetCurrentInstant(),
        };
        db.Add(version);
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(new Actor(me.Id, me.Name), "CONTROLLED_UPLOADED", "ControlledVersion", version.Id, $"{kind} {version.VersionLabel}",
            $"{r.RowCount} rows{(version.SourceName is null ? "" : $" from {version.SourceName}")}.", projectId, c);
        return Results.Ok(ControlledView(version));
    }

    private static async Task<(ControlledVersion? Version, User? Me, IResult? Problem)> LoadVersionAsync(HttpContext h, DeliosDbContext db, Guid id, CancellationToken c)
    {
        var version = await db.Set<ControlledVersion>().SingleOrDefaultAsync(v => v.Id == id, c);
        if (version is null) return (null, null, Problems.NotFound("VERSION_NOT_FOUND", "No such version."));
        if (!await MayControlAsync(h, db, version.ProjectId)) return (null, null, Problems.Forbidden("CONTROL_ONLY", "Document Control or an administrator decides a controlled list."));
        var me = await db.Users.AsNoTracking().SingleAsync(u => u.Id == h.User.UserId(), c);
        return (version, me, null);
    }

    private static async Task<IResult> SubmitAsync(Guid versionId, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c)
    {
        var (version, me, problem) = await LoadVersionAsync(h, db, versionId, c);
        if (problem is not null) return problem;
        if (version!.State != "DRAFT") return Problems.Conflict("NOT_A_DRAFT", "Only a draft is submitted.");
        version.State = "SUBMITTED";
        version.SubmittedById = me!.Id;
        version.SubmittedByName = me.Name;
        version.SubmittedAt = clock.GetCurrentInstant();
        await audit.WriteAsync(new Actor(me.Id, me.Name), "CONTROLLED_SUBMITTED", "ControlledVersion", version.Id, $"{version.Kind} {version.VersionLabel}",
            null, version.ProjectId, c);
        await db.SaveChangesAsync(c);
        return Results.Ok(ControlledView(version));
    }

    /// <summary>
    /// Approves (once its contents are applied, which the caller has done and summarizes) or rejects a submitted
    /// version. The approved one supersedes the version in force.
    /// </summary>
    private static async Task<IResult> DecideAsync(Guid versionId, ControlledDecision r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken c)
    {
        var (version, me, problem) = await LoadVersionAsync(h, db, versionId, c);
        if (problem is not null) return problem;
        if (version!.State is not ("SUBMITTED" or "DRAFT")) return Problems.Conflict("ALREADY_DECIDED", "That version has been decided.");
        if (!r.Approve && Blank(r.Reason) is null) return Problems.Invalid("REASON_REQUIRED", "Say why it is rejected.");
        var now = clock.GetCurrentInstant();
        version.DecidedByName = me!.Name;
        version.DecidedAt = now;
        version.DecisionReason = Blank(r.Reason);
        version.SubmittedAt ??= now;
        version.SubmittedByName ??= me.Name;
        version.SubmittedById ??= me.Id;
        if (r.Approve)
        {
            foreach (var before in await db.Set<ControlledVersion>().Where(v => v.ProjectId == version.ProjectId && v.Kind == version.Kind
                && v.Key == version.Key && v.State == "APPROVED").ToListAsync(c))
            {
                before.State = "SUPERSEDED";
                before.SupersededAt = now;
            }
            version.State = "APPROVED";
            version.AppliedAt = now;
            version.AppliedSummary = Blank(r.AppliedSummary);
        }
        else version.State = "REJECTED";
        await audit.WriteAsync(new Actor(me.Id, me.Name), r.Approve ? "CONTROLLED_APPROVED" : "CONTROLLED_REJECTED", "ControlledVersion", version.Id,
            $"{version.Kind} {version.VersionLabel}", r.Approve ? version.AppliedSummary : version.DecisionReason, version.ProjectId, c);
        await db.SaveChangesAsync(c);
        return Results.Ok(ControlledView(version));
    }

    private static async Task<IResult> DiscardAsync(Guid versionId, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c)
    {
        var (version, me, problem) = await LoadVersionAsync(h, db, versionId, c);
        if (problem is not null) return problem;
        if (version!.State is not ("DRAFT" or "SUBMITTED")) return Problems.Conflict("ALREADY_DECIDED", "That version has been decided.");
        // Kept, marked so: an upload is part of the record even when nobody went on with it.
        version.State = "REJECTED";
        version.DecidedByName = me!.Name;
        version.DecidedAt = clock.GetCurrentInstant();
        version.DecisionReason = "Discarded by whoever uploaded it, before a decision.";
        await audit.WriteAsync(new Actor(me.Id, me.Name), "CONTROLLED_DISCARDED", "ControlledVersion", version.Id, $"{version.Kind} {version.VersionLabel}",
            null, version.ProjectId, c);
        await db.SaveChangesAsync(c);
        return Results.NoContent();
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
