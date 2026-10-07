using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Reports;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Reviews;

/// <summary>The reviews list's filters, as the address carries them. Every one is optional.</summary>
/// <param name="Status">OPEN (running or decided, not yet closed) or CLOSED (released or returned).</param>
/// <param name="Due">OVERDUE (the open step is past its day), SOON (due within three days) or NONE (no day given).</param>
/// <param name="On">Which date the from/to window reads: opened, due or closed.</param>
public sealed record ReviewFilter(
    string? Q = null, string? Status = null, string? Verdict = null, string? Due = null, string? Discipline = null, string? DocType = null,
    string? Supplier = null, string? Deliverable = null, string? On = null, DateOnly? From = null, DateOnly? To = null,
    string? Sort = null, string? Dir = null, string? Ids = null);

/// <summary>One person on the open step, and whether they have answered.</summary>
public sealed record ReviewerView(string Name, bool Done);

/// <summary>A comment on the review, for the list's comment preview.</summary>
public sealed record ReviewCommentLine(string By, string Text, bool Blocking, bool Settled);

/// <summary>One row of the reviews list: the review, its document and revision, where it stands and who it waits on.</summary>
public sealed record ReviewRow(
    Guid Id, string Number, Guid DocumentId, string DocumentNumber, string Title, string Revision, string RouteName, string State,
    bool Open, int? CurrentStep, string? StepTitle, string? Verdict, string? GrantedStatus, string? DecidedBy,
    IReadOnlyList<ReviewerView> Reviewers, DateOnly? DueDate, DateOnly? RouteDueDate, DateTimeOffset StartedAt, string StartedBy,
    DateTimeOffset? ClosedAt, string Discipline, string DocType, string DeliverableType, string? Originator, string? ContractRef,
    DateTimeOffset? ReceivedAt, IReadOnlyList<ReviewCommentLine> Comments);

/// <summary>
/// Every review on the project, one row per review: filters, sorting, page
/// numbers and export, as the register has. A document appears once for each
/// time it was reviewed.
/// </summary>
public static class ReviewListEndpoints
{
    private static readonly string[] OpenStates = [ReviewStates.InProgress, ReviewStates.Decided];

    public static void MapReviewListEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}/reviews").WithTags("Reviews")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>()
            .AddEndpointFilter(async (context, next) => ProjectAccessFilter.Of(context.HttpContext).Holds(Verbs.Read)
                ? await next(context)
                : Problems.Forbidden("READ_NOT_ALLOWED", "Your function cannot read this register."));
        project.MapGet("", PageAsync);
        project.MapGet("/export", ExportAsync);
    }

    /// <summary><c>GET /reviews</c>: one page of matching reviews and how many match.</summary>
    private static async Task<IResult> PageAsync(
        [AsParameters] ReviewFilter filter, HttpContext http, ReadDatabase reads, DocumentService documents, IClock clock,
        CancellationToken cancellationToken, int page = 1, int per = 50)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!RegisterEndpoints.PageSizes.Contains(per)) per = 50;
        var restricted = await documents.RestrictedAsync(cancellationToken);
        var today = WorkingCalendar.Today(clock, access.Project.TimeZone);
        return Results.Ok(await reads.ReadAsync(async db =>
        {
            var query = Filter(db, Visible(db, access, restricted), filter, today);
            var total = await query.CountAsync(cancellationToken);
            var pages = Math.Max(1, (int)Math.Ceiling(total / (double)per));
            page = Math.Clamp(page, 1, pages);
            var ids = await Sort(db, query, filter).Skip((page - 1) * per).Take(per).Select(r => r.Id).ToListAsync(cancellationToken);
            return new { total, page, pages, per, sizes = RegisterEndpoints.PageSizes, rows = await RowsAsync(db, ids, cancellationToken) };
        }, cancellationToken));
    }

    /// <summary><c>GET /reviews/export</c>: every matching review (up to 20,000) as CSV or Excel.</summary>
    private static async Task<IResult> ExportAsync(
        [AsParameters] ReviewFilter filter, HttpContext http, ReadDatabase reads, DocumentService documents, IClock clock,
        CancellationToken cancellationToken, string format = "csv")
    {
        if (format is not ("csv" or "xlsx")) return Problems.Invalid("FORMAT_INVALID", "csv or xlsx.");
        var access = ProjectAccessFilter.Of(http);
        var restricted = await documents.RestrictedAsync(cancellationToken);
        var today = WorkingCalendar.Today(clock, access.Project.TimeZone);
        var rows = await reads.ReadAsync(async db =>
        {
            var ids = await Sort(db, Filter(db, Visible(db, access, restricted), filter, today), filter).Take(20_000)
                .Select(r => r.Id).ToListAsync(cancellationToken);
            return await RowsAsync(db, ids, cancellationToken);
        }, cancellationToken);
        static string Day(DateTimeOffset? at) => at?.ToString("yyyy-MM-dd") ?? "";
        var report = new Report("reviews", "Reviews", "", "", [], new Chart("", [], []),
            ["Review", "Document", "Title", "Revision", "Route", "State", "Step", "Waiting on", "Due", "Verdict", "Status granted",
             "Decided by", "Opened", "Opened by", "Closed", "Discipline", "Type"],
            [.. rows.Select(r => (IReadOnlyList<Cell>)[
                r.Number, r.DocumentNumber, r.Title, r.Revision, r.RouteName, r.State, r.StepTitle ?? "",
                string.Join(", ", r.Reviewers.Where(p => !p.Done).Select(p => p.Name)), r.DueDate?.ToString("yyyy-MM-dd") ?? "",
                r.Verdict ?? "", r.GrantedStatus ?? "", r.DecidedBy ?? "", Day(r.StartedAt), r.StartedBy, Day(r.ClosedAt), r.Discipline, r.DocType])],
            "", clock.GetCurrentInstant().ToDateTimeOffset());
        var heading = $"Reviews, {access.Project.Code}, counted {report.CountedAt:yyyy-MM-dd HH:mm} UTC";
        var name = $"{access.Project.Code}-reviews-{report.CountedAt:yyyy-MM-dd}";
        return format == "csv"
            ? Results.File(ReportEndpoints.Csv(heading, report), "text/csv; charset=utf-8", $"{name}.csv")
            : Results.File(ReportEndpoints.Excel(heading, report), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"{name}.xlsx");
    }

    /// <summary>The reviews of documents the caller may read.</summary>
    private static IQueryable<Review> Visible(DeliosDbContext db, ProjectAccess access, IReadOnlyList<string> restricted)
    {
        var documents = DocumentQueries.Visible(db, access, restricted).Select(d => d.Id);
        return db.Reviews.AsNoTracking().Where(r => r.ProjectId == access.Project.Id && documents.Contains(r.DocumentId));
    }

    /// <summary>Applies every filter given. Each narrows; none widens.</summary>
    private static IQueryable<Review> Filter(DeliosDbContext db, IQueryable<Review> query, ReviewFilter f, LocalDate today)
    {
        if (!string.IsNullOrWhiteSpace(f.Ids))
        {
            var chosen = f.Ids.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(x => Guid.TryParse(x, out var id) ? id : Guid.Empty).Where(id => id != Guid.Empty).Take(5000).ToList();
            query = query.Where(r => chosen.Contains(r.Id));
        }
        if (f.Status == "OPEN") query = query.Where(r => OpenStates.Contains(r.State));
        else if (f.Status == "CLOSED") query = query.Where(r => !OpenStates.Contains(r.State));
        if (RegisterEndpoints.Words(f.Q) is { Count: > 0 } alternatives)
        {
            var predicate = PredicateBuilder.False<Review>();
            foreach (var words in alternatives)
            {
                var all = PredicateBuilder.True<Review>();
                foreach (var word in words)
                {
                    var pattern = $"%{word.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_")}%";
                    all = all.And(r => EF.Functions.ILike(r.Number, pattern) || EF.Functions.ILike(r.Verdict ?? "", pattern)
                        || db.Documents.Any(d => d.Id == r.DocumentId && (EF.Functions.ILike(d.Number, pattern) || EF.Functions.ILike(d.Title, pattern)))
                        || r.Steps.Any(s => s.Participants.Any(p => EF.Functions.ILike(p.UserName, pattern))));
                }
                predicate = predicate.Or(all);
            }
            query = query.Where(predicate);
        }
        if (!string.IsNullOrWhiteSpace(f.Verdict)) query = query.Where(r => r.Verdict == f.Verdict);
        var soon = today.PlusDays(3);
        query = f.Due switch
        {
            "OVERDUE" => query.Where(r => r.Steps.Any(s => s.State == StepStates.Open && s.DueDate < today)),
            "SOON" => query.Where(r => r.Steps.Any(s => s.State == StepStates.Open && s.DueDate >= today && s.DueDate <= soon)),
            "NONE" => query.Where(r => r.Steps.Any(s => s.State == StepStates.Open && s.DueDate == null)),
            _ => query,
        };
        if (!string.IsNullOrWhiteSpace(f.Discipline)) query = query.Where(r => db.Documents.Any(d => d.Id == r.DocumentId && d.Discipline == f.Discipline));
        if (!string.IsNullOrWhiteSpace(f.DocType)) query = query.Where(r => db.Documents.Any(d => d.Id == r.DocumentId && d.DocType == f.DocType));
        if (!string.IsNullOrWhiteSpace(f.Supplier)) query = query.Where(r => db.Documents.Any(d => d.Id == r.DocumentId && d.Originator == f.Supplier));
        if (!string.IsNullOrWhiteSpace(f.Deliverable)) query = query.Where(r => db.Documents.Any(d => d.Id == r.DocumentId && d.DeliverableType == f.Deliverable));
        if (f.From is not null || f.To is not null)
        {
            var start = f.From is { } a ? Instant.FromUtc(a.Year, a.Month, a.Day, 0, 0) : Instant.MinValue;
            var end = f.To is { } b ? Instant.FromUtc(b.Year, b.Month, b.Day, 0, 0) + Duration.FromDays(1) : Instant.MaxValue;
            var startDay = f.From is { } c ? LocalDate.FromDateOnly(c) : LocalDate.MinIsoValue;
            var endDay = f.To is { } e ? LocalDate.FromDateOnly(e) : LocalDate.MaxIsoValue;
            query = f.On switch
            {
                "due" => query.Where(r => r.Steps.Any(s => s.State == StepStates.Open && s.DueDate >= startDay && s.DueDate <= endDay)),
                "closed" => query.Where(r => (r.ClosedAt ?? r.DecidedAt) >= start && (r.ClosedAt ?? r.DecidedAt) < end),
                _ => query.Where(r => r.StartedAt >= start && r.StartedAt < end),
            };
        }
        return query;
    }

    /// <summary>Orders by the column named; open reviews by when they opened, oldest first, when none is.</summary>
    private static IQueryable<Review> Sort(DeliosDbContext db, IQueryable<Review> query, ReviewFilter f)
    {
        var asc = f.Dir != "desc";
        IOrderedQueryable<Review> By<TKey>(System.Linq.Expressions.Expression<Func<Review, TKey>> key) =>
            asc ? query.OrderBy(key) : query.OrderByDescending(key);
        var ordered = f.Sort switch
        {
            "closed" => By(r => r.ClosedAt ?? r.DecidedAt),
            "due" => By(r => r.Steps.Where(s => s.State == StepStates.Open).Select(s => s.DueDate).FirstOrDefault()),
            "verdict" => By(r => r.Verdict),
            "kind" => By(r => r.RouteName),
            "rev" => By(r => db.Revisions.Where(v => v.Id == r.RevisionId).Select(v => v.Value).FirstOrDefault()),
            "discipline" => By(r => db.Documents.Where(d => d.Id == r.DocumentId).Select(d => d.Discipline).FirstOrDefault()),
            "docType" => By(r => db.Documents.Where(d => d.Id == r.DocumentId).Select(d => d.DocType).FirstOrDefault()),
            _ => By(r => r.StartedAt),
        };
        return ordered.ThenBy(r => r.Number);
    }

    /// <summary>Every fact the rows show, for the reviews given, in their order.</summary>
    private static async Task<List<ReviewRow>> RowsAsync(DeliosDbContext db, List<Guid> ids, CancellationToken cancellationToken)
    {
        if (ids.Count == 0) return [];
        var reviews = await db.Reviews.AsNoTracking().Include(r => r.Steps).ThenInclude(s => s.Participants).Include(r => r.Comments)
            .Where(r => ids.Contains(r.Id)).AsSplitQuery().ToDictionaryAsync(r => r.Id, cancellationToken);
        var documentIds = reviews.Values.Select(r => r.DocumentId).Distinct().ToList();
        var revisionIds = reviews.Values.Select(r => r.RevisionId).Distinct().ToList();
        var documents = await db.Documents.AsNoTracking().Where(d => documentIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id, cancellationToken);
        var revisions = await db.Revisions.AsNoTracking().Where(v => revisionIds.Contains(v.Id)).ToDictionaryAsync(v => v.Id, cancellationToken);
        var functions = await db.Functions.AsNoTracking().ToDictionaryAsync(f => f.Code, f => f.Name, cancellationToken);
        return ids.Where(reviews.ContainsKey).Select(id =>
        {
            var r = reviews[id];
            var d = documents[r.DocumentId];
            var v = revisions[r.RevisionId];
            var steps = r.Steps.OrderBy(s => s.Index).ToList();
            var open = steps.FirstOrDefault(s => s.State == StepStates.Open);
            var deciding = steps.FirstOrDefault(s => s.Deciding);
            var decidedBy = r.Verdict is null || deciding is null ? null
                : deciding.PartyName ?? (deciding.FunctionCode is { } code ? functions.GetValueOrDefault(code, code) : null);
            var reviewers = open is null ? [] : open.ByProxy
                ? [new ReviewerView(open.PartyName ?? "Another organization", open.CompletedAt is not null)]
                : open.Participants.OrderBy(p => p.UserName).Select(p => new ReviewerView(p.UserName, p.AnsweredAt is not null)).ToList();
            return new ReviewRow(
                r.Id, r.Number, d.Id, d.Number, d.Title, v.Value, r.RouteName, r.State, OpenStates.Contains(r.State),
                r.State == ReviewStates.InProgress ? r.CurrentStep + 1 : null, open?.Title, r.Verdict, r.GrantedStatus, decidedBy, reviewers,
                open?.DueDate?.ToDateOnly(), steps.LastOrDefault()?.DueDate?.ToDateOnly(), r.StartedAt.ToDateTimeOffset(), r.StartedByName,
                (r.ClosedAt ?? r.DecidedAt)?.ToDateTimeOffset(), d.Discipline, d.DocType, d.DeliverableType, d.Originator, d.ContractRef,
                v.AuthoredByParty is null ? null : v.Submissions.OrderBy(s => s.Number).FirstOrDefault()?.SubmittedAt.ToDateTimeOffset(),
                r.Comments.OrderBy(c => c.CreatedAt).Select(c => new ReviewCommentLine(c.AuthorName, c.Text, c.Blocking, c.Status != CommentStatuses.Open)).ToList());
        }).ToList();
    }
}
