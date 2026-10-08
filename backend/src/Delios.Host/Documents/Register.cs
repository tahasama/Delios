using System.Text.Json;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Reports;
using Delios.Host.Reviews;
using Delios.Host.Schedules;
using Delios.Host.Tenancy;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>A register question somebody keeps: a name and the filters (as a query string) that produced it.</summary>
public sealed class RegisterView
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid UserId { get; set; }
    public required string Name { get; set; }
    /// <summary>The register's filters as they appear in its address, without the page.</summary>
    public required string Query { get; set; }
    public Instant CreatedAt { get; set; }
}

internal sealed class RegisterViewConfiguration : IEntityTypeConfiguration<RegisterView>
{
    public void Configure(EntityTypeBuilder<RegisterView> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.UserId, x.Name }).IsUnique();
        b.Property(x => x.Name).HasMaxLength(60);
        b.Property(x => x.Query).HasMaxLength(2000);
    }
}

/// <summary>The register's filters, as the address carries them. Every one is optional.</summary>
/// <param name="Q">Comma-separated alternatives; within one, every word must appear in the number or title.</param>
/// <param name="Rev">The newest revision's state, or NONE for documents with no revision yet.</param>
/// <param name="On">Which date the from/to window reads: created, revStarted, fileAdded, planned, issued, released or updated.</param>
/// <param name="View">"current" (the default) leaves out withdrawn, cancelled and archived documents; "all" keeps them.</param>
/// <param name="Ids">Comma-separated document ids: only these (the rows someone selected).</param>
/// <param name="Released">True: only documents with a current released revision (what can be issued).</param>
public sealed record RegisterFilter(
    string? Q = null, string? State = null, string? Rev = null, string? Status = null, string? Verdict = null, string? Supplier = null,
    string? Discipline = null, string? DocType = null, string? Criticality = null, string? Confidentiality = null, string? Deliverable = null,
    string? Action = null, string? On = null, DateOnly? From = null, DateOnly? To = null, string? View = null, string? Sort = null, string? Dir = null,
    string? Ids = null, bool? Released = null, string? Po = null);

/// <summary>One row of the register: the document and the facts about its newest and its current revision.</summary>
public sealed record RegisterRow(
    Guid Id, string Number, string Title, string DeliverableType, string DocType, string Discipline, string? Originator, string? Subproject,
    string? ContractRef, string? Criticality, string? Confidentiality, string? RetentionClass, bool IsPlaceholder, string State,
    string? Revision, string? RevisionState, Guid? LatestRevisionId, Guid? ReleasedRevisionId, string? ReleasedRevision,
    string? ProposedStatus, string? ReleasedStatus, DateTimeOffset? ReleasedAt,
    string? Verdict, string? DecidedBy, DateOnly? PlannedDate, DateTimeOffset? IssuedAt, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
    DateTimeOffset? RevisionStartedAt, DateTimeOffset? FileAddedAt, int Packages, IReadOnlyList<RegisterActivity> Activities);

public sealed record RegisterActivity(string Code, string Name);

/// <summary>A value of one of the organization's lists, with what it means for the system.</summary>
public sealed record ListValue(string Code, string Label, string Status, JsonElement? Props);

/// <summary>
/// The register as people work it: filters, sorting by any column, page numbers,
/// every fact a row shows, the organization's lists the filters and notes need,
/// the views each person keeps, and the same rows as a file.
/// </summary>
public static class RegisterEndpoints
{
    public static readonly int[] PageSizes = [25, 50, 100, 250];
    private const int ExportLimit = 20_000;

    public static void MapRegisterEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}/register").WithTags("Register")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>()
            .AddEndpointFilter(async (context, next) => ProjectAccessFilter.Of(context.HttpContext).Holds(Verbs.Read)
                ? await next(context)
                : Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register."));
        project.MapGet("", PageAsync);
        project.MapGet("/export", ExportAsync);
        project.MapGet("/views", ViewsAsync);
        project.MapPut("/views", SaveViewAsync);
        project.MapDelete("/views/{viewId:guid}", DeleteViewAsync);
    }

    /// <summary><c>GET /register</c>: one page of matching rows, how many match, and the lists the screen needs.</summary>
    private static async Task<IResult> PageAsync(
        [AsParameters] RegisterFilter filter, HttpContext http, ReadDatabase reads, DocumentService documents, CancellationToken cancellationToken,
        int page = 1, int per = 50)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!PageSizes.Contains(per)) per = 50;
        var restricted = await documents.RestrictedAsync(cancellationToken);
        return Results.Ok(await reads.ReadAsync(async db =>
        {
            var query = Filter(db, Visible(db, access, restricted), filter);
            var total = await query.CountAsync(cancellationToken);
            var pages = Math.Max(1, (int)Math.Ceiling(total / (double)per));
            page = Math.Clamp(page, 1, pages);
            var ids = await Sort(db, query, filter).Skip((page - 1) * per).Take(per).Select(d => d.Id).ToListAsync(cancellationToken);
            var rows = await RowsAsync(db, ids, cancellationToken);
            return new
            {
                total,
                page,
                pages,
                per,
                sizes = PageSizes,
                rows,
                lists = await ListsAsync(db, access, cancellationToken),
            };
        }, cancellationToken));
    }

    /// <summary><c>GET /register/export</c>: every matching row (up to 20,000) as CSV or Excel, in the screen's order.</summary>
    private static async Task<IResult> ExportAsync(
        [AsParameters] RegisterFilter filter, HttpContext http, ReadDatabase reads, DocumentService documents, IClock clock,
        CancellationToken cancellationToken, string format = "csv")
    {
        if (format is not ("csv" or "xlsx")) return Problems.Invalid("FORMAT_INVALID", "csv or xlsx.");
        var access = ProjectAccessFilter.Of(http);
        var restricted = await documents.RestrictedAsync(cancellationToken);
        var rows = await reads.ReadAsync(async db =>
        {
            var ids = await Sort(db, Filter(db, Visible(db, access, restricted), filter), filter).Take(ExportLimit)
                .Select(d => d.Id).ToListAsync(cancellationToken);
            return await RowsAsync(db, ids, cancellationToken);
        }, cancellationToken);
        static string Day(DateTimeOffset? at) => at?.ToString("yyyy-MM-dd") ?? "";
        var report = new Report("register", "Document register", "", "", [], new Chart("", [], []),
            ["Document", "Title", "Deliverable type", "Type", "Discipline", "Originator", "Subproject", "Criticality", "Confidentiality",
             "State", "Revision", "Revision state", "Status", "Verdict", "Decided by", "Planned", "Released", "Issued", "Created", "Changed"],
            [.. rows.Select(r => (IReadOnlyList<Cell>)[
                r.Number, r.Title, r.DeliverableType, r.DocType, r.Discipline, r.Originator ?? "", r.Subproject ?? "", r.Criticality ?? "",
                r.Confidentiality ?? "", r.State, r.Revision ?? "", r.RevisionState ?? "", r.ReleasedStatus ?? r.ProposedStatus ?? "",
                r.Verdict ?? "", r.DecidedBy ?? "", r.PlannedDate?.ToString("yyyy-MM-dd") ?? "", Day(r.ReleasedAt), Day(r.IssuedAt),
                Day(r.CreatedAt), Day(r.UpdatedAt)])],
            "", clock.GetCurrentInstant().ToDateTimeOffset());
        var heading = $"Document register, {access.Project.Code}, counted {report.CountedAt:yyyy-MM-dd HH:mm} UTC";
        var name = $"{access.Project.Code}-register-{report.CountedAt:yyyy-MM-dd}";
        return format == "csv"
            ? Results.File(ReportEndpoints.Csv(heading, report), "text/csv; charset=utf-8", $"{name}.csv")
            : Results.File(ReportEndpoints.Excel(heading, report), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"{name}.xlsx");
    }

    // ── Saved views ───────────────────────────────────────────────────────────

    /// <summary><c>GET /register/views</c>: the views this person keeps on this project, oldest first.</summary>
    private static async Task<IResult> ViewsAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        return Results.Ok(await db.RegisterViews.AsNoTracking()
            .Where(v => v.ProjectId == access.Project.Id && v.UserId == access.UserId).OrderBy(v => v.CreatedAt)
            .Select(v => new { v.Id, v.Name, v.Query }).ToListAsync(cancellationToken));
    }

    public sealed record SaveViewRequest(string? Name, string? Query);

    /// <summary><c>PUT /register/views</c>: keeps a view; a name already used is replaced, not duplicated.</summary>
    private static async Task<IResult> SaveViewAsync(SaveViewRequest request, HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var name = (request.Name ?? "").Trim();
        if (name.Length is 0 or > 60) return Problems.Invalid("VIEW_NAME_INVALID", "A view needs a name of up to 60 characters.");
        // Which page somebody happened to be on is not part of the question.
        var asked = System.Web.HttpUtility.ParseQueryString((request.Query ?? "").TrimStart('?'));
        asked.Remove("page");
        var query = asked.ToString() ?? "";
        if (query.Length > 2000) return Problems.Invalid("VIEW_TOO_LONG", "The filters are too long to keep.");
        var view = await db.RegisterViews.SingleOrDefaultAsync(v => v.ProjectId == access.Project.Id && v.UserId == access.UserId && v.Name == name, cancellationToken);
        if (view is null)
        {
            db.RegisterViews.Add(new RegisterView
            {
                TenantId = access.Project.TenantId,
                ProjectId = access.Project.Id,
                UserId = access.UserId,
                Name = name,
                Query = query,
                CreatedAt = clock.GetCurrentInstant(),
            });
        }
        else
        {
            view.Query = query;
        }
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary><c>DELETE /register/views/{id}</c>: removes one of the person's own views.</summary>
    private static async Task<IResult> DeleteViewAsync(Guid viewId, HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var deleted = await db.RegisterViews.Where(v => v.Id == viewId && v.UserId == access.UserId && v.ProjectId == access.Project.Id)
            .ExecuteDeleteAsync(cancellationToken);
        return deleted == 0 ? Problems.NotFound("VIEW_NOT_FOUND", "No such view.") : Results.NoContent();
    }

    // ── The query ─────────────────────────────────────────────────────────────

    private static readonly string[] OutOfUse = [DocumentStates.Withdrawn, DocumentStates.Cancelled, DocumentStates.Archived];

    private static IQueryable<Document> Visible(DeliosDbContext db, ProjectAccess access, IReadOnlyList<string> restricted) =>
        DocumentQueries.Visible(db, access, restricted).AsNoTracking();

    /// <summary>Applies every filter given. Each narrows; none widens.</summary>
    public static IQueryable<Document> Filter(DeliosDbContext db, IQueryable<Document> query, RegisterFilter f)
    {
        if (Has(f.Ids))
        {
            var chosen = f.Ids!.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(x => Guid.TryParse(x, out var id) ? id : Guid.Empty).Where(id => id != Guid.Empty).Take(5000).ToList();
            query = query.Where(d => chosen.Contains(d.Id));
        }
        else if (f.View != "all") query = query.Where(d => !OutOfUse.Contains(d.State));
        if (Words(f.Q) is { Count: > 0 } alternatives)
        {
            // Each alternative: every word in the number or the title. Any alternative will do.
            var predicate = PredicateBuilder.False<Document>();
            foreach (var words in alternatives)
            {
                var all = PredicateBuilder.True<Document>();
                foreach (var word in words)
                {
                    var pattern = $"%{Escape(word)}%";
                    all = all.And(d => EF.Functions.ILike(d.Number, pattern) || EF.Functions.ILike(d.Title, pattern));
                }
                predicate = predicate.Or(all);
            }
            query = query.Where(predicate);
        }
        if (f.Released == true) query = query.Where(d => db.Revisions.Any(r => r.DocumentId == d.Id && r.State == RevisionStates.Released));
        if (Has(f.State)) query = query.Where(d => d.State == f.State);
        if (f.Rev == "NONE") query = query.Where(d => d.LatestRevisionId == null);
        // Reviewed and not yet released: the route is finished, Document Control has not published it.
        else if (f.Rev is "NOT_RELEASED" or "FOR_RELEASE")
            query = query.Where(d => d.LatestRevisionState == RevisionStates.InReview
                && db.Reviews.Any(r => r.RevisionId == d.LatestRevisionId && r.State == Reviews.ReviewStates.Decided));
        else if (Has(f.Rev)) query = query.Where(d => d.LatestRevisionState == f.Rev);
        if (Has(f.Status)) query = query.Where(d => db.Revisions.Any(r => r.DocumentId == d.Id && r.State == RevisionStates.Released && r.StatusCode == f.Status));
        if (Has(f.Verdict))
            query = query.Where(d => db.Reviews.Where(r => r.RevisionId == d.LatestRevisionId && r.Verdict != null)
                .OrderByDescending(r => r.DecidedAt).Select(r => r.Verdict).FirstOrDefault() == f.Verdict);
        if (Has(f.Supplier)) query = query.Where(d => d.Originator == f.Supplier);
        if (Has(f.Po)) query = query.Where(d => d.ContractRef == f.Po);
        if (Has(f.Discipline)) query = query.Where(d => d.Discipline == f.Discipline);
        if (Has(f.DocType)) query = query.Where(d => d.DocType == f.DocType);
        if (Has(f.Criticality)) query = query.Where(d => d.Criticality == f.Criticality);
        if (Has(f.Confidentiality)) query = query.Where(d => d.Confidentiality == f.Confidentiality);
        if (Has(f.Deliverable)) query = query.Where(d => d.DeliverableType == f.Deliverable);
        if (Has(f.Action))
            query = query.Where(d => db.Requirements.Any(n => n.DocumentId == d.Id
                && db.Activities.Any(a => a.Id == n.ActivityId && a.Code == f.Action && a.State == ActivityStates.Active)));
        if (f.From is not null || f.To is not null) query = Window(db, query, f.On, f.From, f.To);
        return query;
    }

    /// <summary>The date window on the date the reader named; an open end is open.</summary>
    private static IQueryable<Document> Window(DeliosDbContext db, IQueryable<Document> query, string? on, DateOnly? from, DateOnly? to)
    {
        // Days are compared as UTC instants from the start of the first day to the end of the last.
        var start = from is { } f ? Instant.FromUtc(f.Year, f.Month, f.Day, 0, 0) : Instant.MinValue;
        var end = to is { } t ? Instant.FromUtc(t.Year, t.Month, t.Day, 0, 0) + Duration.FromDays(1) : Instant.MaxValue;
        var startDay = from is { } fd ? LocalDate.FromDateOnly(fd) : LocalDate.MinIsoValue;
        var endDay = to is { } td ? LocalDate.FromDateOnly(td) : LocalDate.MaxIsoValue;
        return on switch
        {
            "revStarted" => query.Where(d => db.Revisions.Any(r => r.Id == d.LatestRevisionId && r.CreatedAt >= start && r.CreatedAt < end)),
            "fileAdded" => query.Where(d => db.StoredFiles.Any(x => x.DocumentId == d.Id && x.CreatedAt >= start && x.CreatedAt < end)),
            "planned" => query.Where(d => d.PlannedDate >= startDay && d.PlannedDate <= endDay),
            "issued" => query.Where(d => db.TransmittalItems.Any(i => i.DocumentId == d.Id
                && db.Transmittals.Any(x => x.Id == i.TransmittalId && x.ReviewStepId == null && x.IssuedAt >= start && x.IssuedAt < end))),
            "released" => query.Where(d => db.Revisions.Any(r => r.DocumentId == d.Id && r.ReleasedAt >= start && r.ReleasedAt < end)),
            "updated" => query.Where(d => d.UpdatedAt >= start && d.UpdatedAt < end),
            _ => query.Where(d => d.CreatedAt >= start && d.CreatedAt < end),
        };
    }

    /// <summary>Orders by the column named, newest change first when none is.</summary>
    public static IQueryable<Document> Sort(DeliosDbContext db, IQueryable<Document> query, RegisterFilter f)
    {
        var asc = f.Dir == "asc";
        IOrderedQueryable<Document> By<TKey>(System.Linq.Expressions.Expression<Func<Document, TKey>> key) =>
            asc ? query.OrderBy(key) : query.OrderByDescending(key);
        var ordered = f.Sort switch
        {
            "docNumber" => By(d => d.Number),
            "title" => By(d => d.Title),
            "discipline" => By(d => d.Discipline),
            "docType" => By(d => d.DocType),
            "originator" => By(d => d.Originator),
            "subProject" => By(d => d.Subproject),
            "contract" => By(d => d.ContractRef),
            "criticality" => By(d => d.Criticality),
            "confidentiality" => By(d => d.Confidentiality),
            "retention" => By(d => d.RetentionClass),
            "deliverable" => By(d => d.DeliverableType),
            "docState" => By(d => d.State),
            "rev" => By(d => d.LatestRevisionValue),
            "revState" => By(d => d.LatestRevisionState),
            "planned" => By(d => d.PlannedDate),
            "created" => By(d => d.CreatedAt),
            "releasedFor" => By(d => db.Revisions.Where(r => r.DocumentId == d.Id && r.State == RevisionStates.Released).Select(r => r.StatusCode).FirstOrDefault()),
            "released" => By(d => db.Revisions.Where(r => r.DocumentId == d.Id && r.State == RevisionStates.Released).Select(r => r.ReleasedAt).FirstOrDefault()),
            "verdict" => By(d => db.Reviews.Where(r => r.RevisionId == d.LatestRevisionId && r.Verdict != null).OrderByDescending(r => r.DecidedAt).Select(r => r.Verdict).FirstOrDefault()),
            "revStarted" => By(d => db.Revisions.Where(r => r.Id == d.LatestRevisionId).Select(r => (Instant?)r.CreatedAt).FirstOrDefault()),
            "fileAdded" => By(d => db.StoredFiles.Where(x => x.DocumentId == d.Id).Max(x => (Instant?)x.CreatedAt)),
            "issued" => By(d => db.TransmittalItems.Where(i => i.DocumentId == d.Id)
                .Join(db.Transmittals.Where(x => x.ReviewStepId == null), i => i.TransmittalId, x => x.Id, (i, x) => (Instant?)x.IssuedAt).Min()),
            _ => By(d => d.UpdatedAt),
        };
        // A stable order: two documents never swap between pages.
        return ordered.ThenBy(d => d.Number);
    }

    /// <summary>Every fact the rows show, for the documents given, in their order.</summary>
    public static async Task<List<RegisterRow>> RowsAsync(DeliosDbContext db, List<Guid> ids, CancellationToken cancellationToken)
    {
        if (ids.Count == 0) return [];
        var docs = await db.Documents.AsNoTracking().Where(d => ids.Contains(d.Id)).ToDictionaryAsync(d => d.Id, cancellationToken);
        var revisions = await db.Revisions.AsNoTracking().Where(r => ids.Contains(r.DocumentId))
            .Select(r => new { r.Id, r.DocumentId, r.Value, r.State, r.StatusCode, r.ReleasedAt, r.CreatedAt }).ToListAsync(cancellationToken);
        var latestIds = docs.Values.Where(d => d.LatestRevisionId != null).Select(d => d.LatestRevisionId!.Value).ToList();
        var decided = await (from r in db.Reviews
                             where latestIds.Contains(r.RevisionId) && r.Verdict != null
                             orderby r.DecidedAt descending
                             select new
                             {
                                 r.RevisionId,
                                 r.Verdict,
                                 Decider = r.Steps.Where(s => s.Deciding).Select(s => s.PartyName ?? s.FunctionCode).FirstOrDefault(),
                             }).AsNoTracking().ToListAsync(cancellationToken);
        var functions = await db.Functions.AsNoTracking().ToDictionaryAsync(f => f.Code, f => f.Name, cancellationToken);
        var files = await db.StoredFiles.AsNoTracking().Where(f => f.DocumentId != null && ids.Contains(f.DocumentId.Value))
            .GroupBy(f => f.DocumentId!.Value).Select(g => new { DocumentId = g.Key, At = g.Max(f => f.CreatedAt) }).ToDictionaryAsync(x => x.DocumentId, x => x.At, cancellationToken);
        var issued = await (from i in db.TransmittalItems
                            join t in db.Transmittals on i.TransmittalId equals t.Id
                            where i.DocumentId != null && ids.Contains(i.DocumentId.Value) && t.ReviewStepId == null
                                && t.Direction == TransmittalDirections.Outgoing && i.Kind == TransmittalItemKinds.Revision
                            group t by i.DocumentId!.Value into g
                            select new { DocumentId = g.Key, At = g.Min(t => t.IssuedAt) }).ToDictionaryAsync(x => x.DocumentId, x => x.At, cancellationToken);
        var packages = await db.PackageMembers.AsNoTracking().Where(m => ids.Contains(m.DocumentId))
            .GroupBy(m => m.DocumentId).Select(g => new { DocumentId = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.DocumentId, x => x.Count, cancellationToken);
        var activities = (await (from n in db.Requirements
                                 join a in db.Activities on n.ActivityId equals a.Id
                                 where ids.Contains(n.DocumentId) && a.State == ActivityStates.Active
                                 orderby n.NeededBy
                                 select new { n.DocumentId, a.Code, a.Name }).AsNoTracking().ToListAsync(cancellationToken))
            .GroupBy(x => x.DocumentId).ToDictionary(g => g.Key, g => g.DistinctBy(x => x.Code).Take(4).Select(x => new RegisterActivity(x.Code, x.Name)).ToList());

        return ids.Where(docs.ContainsKey).Select(id =>
        {
            var d = docs[id];
            var mine = revisions.Where(r => r.DocumentId == id).ToList();
            var latest = mine.FirstOrDefault(r => r.Id == d.LatestRevisionId);
            var released = mine.FirstOrDefault(r => r.State == RevisionStates.Released);
            var verdict = decided.FirstOrDefault(v => v.RevisionId == d.LatestRevisionId);
            var decider = verdict?.Decider is { } who ? functions.GetValueOrDefault(who, who) : null;
            return new RegisterRow(
                d.Id, d.Number, d.Title, d.DeliverableType, d.DocType, d.Discipline, d.Originator, d.Subproject, d.ContractRef, d.Criticality,
                d.Confidentiality, d.RetentionClass, d.IsPlaceholder, d.State, d.LatestRevisionValue, d.LatestRevisionState, d.LatestRevisionId,
                released?.Id, released?.Value, released is null ? latest?.StatusCode : null, released?.StatusCode, released?.ReleasedAt?.ToDateTimeOffset(),
                verdict?.Verdict, decider, d.PlannedDate?.ToDateOnly(), issued.TryGetValue(id, out var at) ? at.ToDateTimeOffset() : null,
                d.CreatedAt.ToDateTimeOffset(), d.UpdatedAt.ToDateTimeOffset(), latest?.CreatedAt.ToDateTimeOffset(),
                files.TryGetValue(id, out var added) ? added.ToDateTimeOffset() : null, packages.GetValueOrDefault(id),
                activities.GetValueOrDefault(id) ?? []);
        }).ToList();
    }

    /// <summary>The organization's lists the register's filters and notes read, and what this project holds.</summary>
    private static async Task<object> ListsAsync(DeliosDbContext db, ProjectAccess access, CancellationToken cancellationToken)
    {
        string[] sets = [ValueSets.Disciplines, ValueSets.DocumentTypes, ValueSets.DeliverableTypes, ValueSets.Criticality,
            ValueSets.Confidentiality, ValueSets.RetentionClasses, ReviewSets.Statuses, ReviewSets.Verdicts];
        var values = (await db.ValueEntries.AsNoTracking().Where(v => sets.Contains(v.SetKey)).OrderBy(v => v.Sort).ToListAsync(cancellationToken))
            .GroupBy(v => v.SetKey)
            .ToDictionary(g => g.Key, g => g.Select(v => new ListValue(v.Code, v.Label, v.Status, v.Props?.RootElement.Clone())).ToList());
        var used = await db.Documents.AsNoTracking().Where(d => d.ProjectId == access.Project.Id)
            .Select(d => new { d.Discipline, d.DocType }).Distinct().ToListAsync(cancellationToken);
        return new
        {
            values,
            usedDisciplines = used.Select(u => u.Discipline).Distinct().ToList(),
            usedDocTypes = used.Select(u => u.DocType).Distinct().ToList(),
            parties = await db.Parties.AsNoTracking().Where(p => p.Active && !p.IsInternal).OrderBy(p => p.Code)
                .Select(p => new { p.Code, p.Name }).ToListAsync(cancellationToken),
            // Only the activities that need something: one that needs nothing would filter to an empty register.
            activities = await db.Activities.AsNoTracking()
                .Where(a => a.ProjectId == access.Project.Id && a.State == ActivityStates.Active && a.NeedCount > 0)
                .OrderBy(a => a.Code).Select(a => new { a.Code, a.Name }).ToListAsync(cancellationToken),
        };
    }

    private static bool Has(string? value) => !string.IsNullOrWhiteSpace(value);

    private static string Escape(string word) => word.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    /// <summary>The search text as alternatives (split on commas), each a list of words; quoted phrases stay whole.</summary>
    public static List<List<string>> Words(string? q) =>
        (q ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(8)
            .Select(part => System.Text.RegularExpressions.Regex.Matches(part, "\"([^\"]+)\"|(\\S+)")
                .Select(m => (m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value).Trim()).Where(w => w.Length > 0).Take(6).ToList())
            .Where(words => words.Count > 0).ToList();
}

/// <summary>Builds "this or that", "this and that" conditions EF can translate into one SQL query.</summary>
internal static class PredicateBuilder
{
    public static System.Linq.Expressions.Expression<Func<T, bool>> True<T>() => _ => true;
    public static System.Linq.Expressions.Expression<Func<T, bool>> False<T>() => _ => false;

    public static System.Linq.Expressions.Expression<Func<T, bool>> And<T>(
        this System.Linq.Expressions.Expression<Func<T, bool>> left, System.Linq.Expressions.Expression<Func<T, bool>> right) =>
        Combine(left, right, System.Linq.Expressions.Expression.AndAlso);

    public static System.Linq.Expressions.Expression<Func<T, bool>> Or<T>(
        this System.Linq.Expressions.Expression<Func<T, bool>> left, System.Linq.Expressions.Expression<Func<T, bool>> right) =>
        Combine(left, right, System.Linq.Expressions.Expression.OrElse);

    private static System.Linq.Expressions.Expression<Func<T, bool>> Combine<T>(
        System.Linq.Expressions.Expression<Func<T, bool>> left, System.Linq.Expressions.Expression<Func<T, bool>> right,
        Func<System.Linq.Expressions.Expression, System.Linq.Expressions.Expression, System.Linq.Expressions.BinaryExpression> join)
    {
        var parameter = left.Parameters[0];
        var body = new Replace(right.Parameters[0], parameter).Visit(right.Body)!;
        return System.Linq.Expressions.Expression.Lambda<Func<T, bool>>(join(left.Body, body), parameter);
    }

    private sealed class Replace(System.Linq.Expressions.ParameterExpression from, System.Linq.Expressions.ParameterExpression to)
        : System.Linq.Expressions.ExpressionVisitor
    {
        protected override System.Linq.Expressions.Expression VisitParameter(System.Linq.Expressions.ParameterExpression node) =>
            node == from ? to : base.VisitParameter(node);
    }
}
