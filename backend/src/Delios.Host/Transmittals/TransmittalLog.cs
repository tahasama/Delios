using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Reports;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Transmittals;

/// <summary>The transmittal log's filters, as the address carries them. Every one is optional.</summary>
/// <param name="Status">TO_SEND, OVERDUE, AWAITING_REPLY, AWAITING_ACK, TO_REGISTER or COMPLETE: what it still waits on.</param>
/// <param name="Party">An outside party's code: only what went to it, or came from it.</param>
/// <param name="Direction">OUTGOING (what we sent) or INCOMING (what was sent to us).</param>
/// <param name="On">Which date the from/to window reads: issued (the default) or due.</param>
public sealed record TransmittalFilter(
    string? Q = null, string? Status = null, string? Reason = null, string? Party = null, string? On = null, DateOnly? From = null,
    DateOnly? To = null, string? Sort = null, string? Dir = null, string? Ids = null, string? Direction = null);

/// <summary>One recipient in a log row, and whether they have acknowledged it (or, for an organization outside, whether it went).</summary>
public sealed record LogRecipient(Guid Id, string Name, bool Seen);

/// <summary>One row of the transmittal log.</summary>
public sealed record LogRow(
    Guid Id, string Number, string Subject, string Reason, string ToName, string IssuedBy, DateTimeOffset IssuedAt, int Documents,
    string Status, IReadOnlyList<LogRecipient> Recipients, bool ResponseRequired, DateOnly? ResponseDue, bool ForReview,
    string Direction, string? From, string? TheirReference);

/// <summary>
/// The transmittal log: every transmittal the caller may see, with what each
/// still waits on, filters, sorting, page numbers and export.
/// </summary>
public static class TransmittalLogEndpoints
{
    public static class States
    {
        public const string ToSend = "TO_SEND", Overdue = "OVERDUE", AwaitingReply = "AWAITING_REPLY", AwaitingAck = "AWAITING_ACK", Complete = "COMPLETE";
        /// <summary>Incoming, with something unplanned Document Control has not registered yet.</summary>
        public const string ToRegister = "TO_REGISTER";
    }

    public static void MapTransmittalLogEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}/transmittals").WithTags("Transmittals")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("/log", PageAsync);
        project.MapGet("/log/export", ExportAsync);
    }

    /// <summary><c>GET /transmittals/log</c>: one page of matching transmittals and how many match.</summary>
    private static async Task<IResult> PageAsync(
        [AsParameters] TransmittalFilter filter, HttpContext http, DeliosDbContext db, TransmittalService transmittals, IClock clock,
        CancellationToken cancellationToken, int page = 1, int per = 50)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!RegisterEndpoints.PageSizes.Contains(per)) per = 50;
        var today = WorkingCalendar.Today(clock, access.Project.TimeZone);
        var query = Filter(db, transmittals.Visible(access).AsNoTracking(), filter, today);
        var total = await query.CountAsync(cancellationToken);
        var pages = Math.Max(1, (int)Math.Ceiling(total / (double)per));
        page = Math.Clamp(page, 1, pages);
        var ids = await Sort(db, query, filter, today).Skip((page - 1) * per).Take(per).Select(t => t.Id).ToListAsync(cancellationToken);
        return Results.Ok(new { total, page, pages, per, sizes = RegisterEndpoints.PageSizes, rows = await RowsAsync(db, ids, today, cancellationToken) });
    }

    /// <summary><c>GET /transmittals/log/export</c>: every matching transmittal (up to 20,000) as CSV or Excel.</summary>
    private static async Task<IResult> ExportAsync(
        [AsParameters] TransmittalFilter filter, HttpContext http, DeliosDbContext db, TransmittalService transmittals, IClock clock,
        CancellationToken cancellationToken, string format = "csv")
    {
        if (format is not ("csv" or "xlsx")) return Problems.Invalid("FORMAT_INVALID", "csv or xlsx.");
        var access = ProjectAccessFilter.Of(http);
        var today = WorkingCalendar.Today(clock, access.Project.TimeZone);
        var ids = await Sort(db, Filter(db, transmittals.Visible(access).AsNoTracking(), filter, today), filter, today).Take(20_000)
            .Select(t => t.Id).ToListAsync(cancellationToken);
        var rows = await RowsAsync(db, ids, today, cancellationToken);
        var report = new Report("transmittals", "Transmittal log", "", "", [], new Chart("", [], []),
            ["Transmittal", "Direction", "Issued", "From", "To", "Their reference", "Reason", "Subject", "Documents", "State", "Answer due", "Acknowledged"],
            [.. rows.Select(r => (IReadOnlyList<Cell>)[
                r.Number, r.Direction, r.IssuedAt.ToString("yyyy-MM-dd"), r.From ?? r.IssuedBy, r.ToName, r.TheirReference ?? "", r.Reason, r.Subject,
                r.Documents.ToString(), r.Status,
                r.ResponseDue?.ToString("yyyy-MM-dd") ?? "", $"{r.Recipients.Count(x => x.Seen)}/{r.Recipients.Count}"])],
            "", clock.GetCurrentInstant().ToDateTimeOffset());
        var heading = $"Transmittal log, {access.Project.Code}, counted {report.CountedAt:yyyy-MM-dd HH:mm} UTC";
        var name = $"{access.Project.Code}-transmittals-{report.CountedAt:yyyy-MM-dd}";
        return format == "csv"
            ? Results.File(ReportEndpoints.Csv(heading, report), "text/csv; charset=utf-8", $"{name}.csv")
            : Results.File(ReportEndpoints.Excel(heading, report), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"{name}.xlsx");
    }

    /// <summary>Whether a review step's answer is still awaited for this transmittal.</summary>
    private static IQueryable<Transmittal> AnswerAwaited(DeliosDbContext db, IQueryable<Transmittal> query) =>
        query.Where(t => t.ReviewStepId != null && t.ResponseRequired && db.ReviewSteps.Any(s => s.Id == t.ReviewStepId && s.CompletedAt == null));

    /// <summary>Applies every filter given. Each narrows; none widens.</summary>
    private static IQueryable<Transmittal> Filter(DeliosDbContext db, IQueryable<Transmittal> query, TransmittalFilter f, LocalDate today)
    {
        if (!string.IsNullOrWhiteSpace(f.Ids))
        {
            var chosen = f.Ids.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(x => Guid.TryParse(x, out var id) ? id : Guid.Empty).Where(id => id != Guid.Empty).Take(5000).ToList();
            query = query.Where(t => chosen.Contains(t.Id));
        }
        if (RegisterEndpoints.Words(f.Q) is { Count: > 0 } alternatives)
        {
            var predicate = PredicateBuilder.False<Transmittal>();
            foreach (var words in alternatives)
            {
                var all = PredicateBuilder.True<Transmittal>();
                foreach (var word in words)
                {
                    var pattern = $"%{word.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_")}%";
                    all = all.And(t => EF.Functions.ILike(t.Number, pattern) || EF.Functions.ILike(t.Subject, pattern) || EF.Functions.ILike(t.ToName, pattern)
                        || (t.FromName != null && EF.Functions.ILike(t.FromName, pattern)) || (t.TheirReference != null && EF.Functions.ILike(t.TheirReference, pattern))
                        || t.Items.Any(i => EF.Functions.ILike(i.DocumentNumber, pattern) || EF.Functions.ILike(i.Title, pattern)));
                }
                predicate = predicate.Or(all);
            }
            query = query.Where(predicate);
        }
        if (!string.IsNullOrWhiteSpace(f.Reason)) query = query.Where(t => t.Reason == f.Reason);
        if (!string.IsNullOrWhiteSpace(f.Party))
            query = query.Where(t => db.Parties.Any(p => (p.Id == t.ToPartyId || p.Id == t.FromPartyId) && p.Code == f.Party));
        if (f.Direction is TransmittalDirections.Outgoing or TransmittalDirections.Incoming) query = query.Where(t => t.Direction == f.Direction);
        var unregistered = query.Where(t => t.Items.Any(i => i.Kind == TransmittalItemKinds.Unplanned && i.RegisteredAt == null));
        var toSend = query.Where(t => t.Recipients.Any(r => r.UserId == null && r.DispatchedAt == null));
        query = f.Status switch
        {
            States.ToSend => toSend,
            States.Overdue => AnswerAwaited(db, query).Where(t => t.ResponseDue < today),
            States.AwaitingReply => AnswerAwaited(db, query).Where(t => t.ResponseDue == null || t.ResponseDue >= today),
            States.AwaitingAck => query.Where(t => t.Recipients.Any(r => r.UserId != null && r.AcknowledgedAt == null)),
            States.ToRegister => unregistered,
            States.Complete => query.Where(t => !t.Recipients.Any(r => (r.UserId == null && r.DispatchedAt == null) || (r.UserId != null && r.AcknowledgedAt == null))
                && !(t.ReviewStepId != null && t.ResponseRequired && db.ReviewSteps.Any(s => s.Id == t.ReviewStepId && s.CompletedAt == null))
                && !t.Items.Any(i => i.Kind == TransmittalItemKinds.Unplanned && i.RegisteredAt == null)),
            _ => query,
        };
        if (f.From is not null || f.To is not null)
        {
            if (f.On == "due")
            {
                var startDay = f.From is { } a ? LocalDate.FromDateOnly(a) : LocalDate.MinIsoValue;
                var endDay = f.To is { } b ? LocalDate.FromDateOnly(b) : LocalDate.MaxIsoValue;
                query = query.Where(t => t.ResponseDue >= startDay && t.ResponseDue <= endDay);
            }
            else
            {
                var start = f.From is { } a ? Instant.FromUtc(a.Year, a.Month, a.Day, 0, 0) : Instant.MinValue;
                var end = f.To is { } b ? Instant.FromUtc(b.Year, b.Month, b.Day, 0, 0) + Duration.FromDays(1) : Instant.MaxValue;
                query = query.Where(t => t.IssuedAt >= start && t.IssuedAt < end);
            }
        }
        return query;
    }

    /// <summary>Orders by the column named, newest first when none is.</summary>
    private static IQueryable<Transmittal> Sort(DeliosDbContext db, IQueryable<Transmittal> query, TransmittalFilter f, LocalDate today)
    {
        var asc = f.Dir == "asc";
        IOrderedQueryable<Transmittal> By<TKey>(System.Linq.Expressions.Expression<Func<Transmittal, TKey>> key) =>
            asc ? query.OrderBy(key) : query.OrderByDescending(key);
        var ordered = f.Sort switch
        {
            "due" => By(t => t.ResponseDue),
            "reason" => By(t => t.Reason),
            "to" => By(t => t.ToName),
            "from" => By(t => t.FromName ?? t.IssuedByName),
            "documents" => By(t => t.Items.Count),
            // What it waits on, most pressing first: to send, then to acknowledge, then nothing.
            "status" => By(t => t.Recipients.Any(r => r.UserId == null && r.DispatchedAt == null) ? 0
                : t.Recipients.Any(r => r.UserId != null && r.AcknowledgedAt == null) ? 1 : 2),
            _ => By(t => t.IssuedAt),
        };
        return ordered.ThenBy(t => t.Number);
    }

    /// <summary>Every fact the rows show, for the transmittals given, in their order.</summary>
    private static async Task<List<LogRow>> RowsAsync(DeliosDbContext db, List<Guid> ids, LocalDate today, CancellationToken cancellationToken)
    {
        if (ids.Count == 0) return [];
        var list = await db.Transmittals.AsNoTracking().Include(t => t.Recipients).Include(t => t.Items).AsSplitQuery()
            .Where(t => ids.Contains(t.Id)).ToDictionaryAsync(t => t.Id, cancellationToken);
        var stepIds = list.Values.Where(t => t.ReviewStepId != null).Select(t => t.ReviewStepId!.Value).ToList();
        var answered = (await db.ReviewSteps.AsNoTracking().Where(s => stepIds.Contains(s.Id) && s.CompletedAt != null).Select(s => s.Id)
            .ToListAsync(cancellationToken)).ToHashSet();
        return ids.Where(list.ContainsKey).Select(id =>
        {
            var t = list[id];
            var awaited = t.ReviewStepId is { } step && t.ResponseRequired && !answered.Contains(step);
            var status = t.Items.Any(i => i.Kind == TransmittalItemKinds.Unplanned && i.RegisteredAt is null) ? States.ToRegister
                : t.Recipients.Any(r => r.AwaitsDispatch) ? States.ToSend
                : awaited && t.ResponseDue < today ? States.Overdue
                : awaited ? States.AwaitingReply
                : t.Recipients.Any(r => r.UserId != null && r.AcknowledgedAt is null) ? States.AwaitingAck
                : States.Complete;
            return new LogRow(t.Id, t.Number, t.Subject, t.Reason, t.ToName, t.IssuedByName, t.IssuedAt.ToDateTimeOffset(), t.Items.Count, status,
                t.Recipients.OrderBy(r => r.Name).Select(r => new LogRecipient(r.Id, r.Name, r.UserId is null ? r.DispatchedAt is not null : r.AcknowledgedAt is not null)).ToList(),
                t.ResponseRequired, t.ResponseDue?.ToDateOnly(), t.ReviewStepId is not null, t.Direction, t.FromName, t.TheirReference);
        }).ToList();
    }
}
