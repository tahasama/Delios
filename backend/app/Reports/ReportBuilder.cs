using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Actions;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Reports;

/// <summary>
/// Builds each report for one project from the register as it stands. Labels come
/// from the organization's own lists (disciplines, statuses, reasons); only the
/// stages the system itself works out (in review, released, late…) are named here.
/// </summary>
public sealed partial class ReportBuilder(IClock clock)
{
    /// <summary>The database and the project being reported on, set at the start of each <see cref="BuildAsync"/> call. The builder is created once per request, so these are not shared between requests.</summary>
    private DeliosDbContext db = null!;
    private Project _project = null!;
    private Catalog _catalog = null!;
    /// <summary>The project's time zone; dates in the reports are shown in it.</summary>
    private DateTimeZone _zone = DateTimeZone.Utc;
    /// <summary>Today's date in the project's time zone, fixed for the whole report.</summary>
    private LocalDate _today;

    /// <summary>Builds on the database given: the read replica when there is one, the primary otherwise.</summary>
    public async Task<Report> BuildAsync(DeliosDbContext database, Project project, string id, ReportOptions options, CancellationToken cancellationToken)
    {
        db = database;
        _project = project;
        _catalog = await Catalog.LoadAsync(db, cancellationToken);
        _zone = DateTimeZoneProviders.Tzdb.GetZoneOrNull(project.TimeZone) ?? DateTimeZone.Utc;
        _today = clock.GetCurrentInstant().InZone(_zone).Date;
        return id switch
        {
            ReportIds.Register => await RegisterAsync(cancellationToken),
            ReportIds.Deliveries => await DeliveriesAsync(options, cancellationToken),
            ReportIds.Reviews => await ReviewsAsync(options, cancellationToken),
            ReportIds.Transmittals => await TransmittalsAsync(options, cancellationToken),
            ReportIds.Readiness => await ReadinessAsync(options, cancellationToken),
            ReportIds.AsOf => await AsOfAsync(options, cancellationToken),
            ReportIds.Progress => await ProgressAsync(options, cancellationToken),
            ReportIds.Exchange => await ExchangeAsync(options, cancellationToken),
            _ => throw new ArgumentOutOfRangeException(nameof(id), id, "No such report."),
        };
    }

    // ── Register status ───────────────────────────────────────────────────────

    /// <summary>The "Register status" report: every document of the project with its stage (not started, in work, in review, released, out of use), charted by discipline.</summary>
    private async Task<Report> RegisterAsync(CancellationToken cancellationToken)
    {
        var docs = await db.Documents.AsNoTracking().Where(d => d.ProjectId == _project.Id).OrderBy(d => d.Number)
            .Select(d => new
            {
                d.Id,
                d.Number,
                d.Title,
                d.Discipline,
                d.State,
                Revisions = d.Revisions.OrderByDescending(r => r.CreatedAt).Select(r => new { r.Value, r.State, r.StatusCode, r.ReleasedAt }).ToList(),
            })
            .ToListAsync(cancellationToken);
        Segment[] segments =
        [
            new("planned", "Not started", "muted"), new("work", "In work", "info"), new("review", "In review", "warn"),
            new("released", "Released", "good"), new("out", "Out of use", "bad"),
        ];
        string StageOf(string state, IReadOnlyList<string> revisionStates) =>
            state is DocumentStates.Withdrawn or DocumentStates.Cancelled or DocumentStates.Archived ? "out"
            : revisionStates.Contains(RevisionStates.Released) ? "released"
            : revisionStates.FirstOrDefault() is RevisionStates.InReview or RevisionStates.Received or RevisionStates.Correcting ? "review"
            : revisionStates.Count > 0 ? "work"
            : "planned";

        var bars = new SortedDictionary<string, Bar>(StringComparer.Ordinal);
        var rows = new List<(string?, IReadOnlyList<Cell>)>();
        var tally = segments.ToDictionary(s => s.Key, _ => 0);
        foreach (var d in docs)
        {
            var stage = StageOf(d.State, d.Revisions.Select(r => r.State).ToList());
            tally[stage]++;
            var discipline = _catalog.Label(ValueSets.Disciplines, d.Discipline);
            (bars.TryGetValue(discipline, out var bar) ? bar : bars[discipline] = new Bar(discipline, [])).Add(stage);
            var released = d.Revisions.FirstOrDefault(r => r.State == RevisionStates.Released);
            var current = released ?? d.Revisions.FirstOrDefault();
            rows.Add((discipline,
            [
                Doc(d.Id, d.Number), d.Title, discipline, Stage(segments, stage), current?.Value ?? "—",
                current?.StatusCode is { } status ? _catalog.Label(ReviewSets.Statuses, status) : "—", Date(released?.ReleasedAt),
            ]));
        }
        return Make(ReportIds.Register, "Register status", "Where does every document stand?",
            "The master document register: for the project manager or the client, weekly.",
            [
                new("Documents", docs.Count.ToString()),
                new("Released", $"{Percent(tally["released"], docs.Count)}%", "good"),
                new("In review", tally["review"].ToString()),
                new("Not started", tally["planned"].ToString(), tally["planned"] > 0 ? "warn" : null),
            ],
            new Chart("Documents by discipline", segments, [.. bars.Values]),
            ["Document", "Title", "Discipline", "Stage", "Current revision", "Status", "Released"], rows, "The register is empty.");
    }

    // ── Deliveries against plan ───────────────────────────────────────────────

    /// <summary>
    /// When each document is due (its planned date, or the earliest day an activity
    /// needs it, whichever comes first) against when it was first sent in or for review.
    /// </summary>
    private async Task<Report> DeliveriesAsync(ReportOptions options, CancellationToken cancellationToken)
    {
        var docs = await db.Documents.AsNoTracking()
            .Where(d => d.ProjectId == _project.Id && d.State != DocumentStates.Cancelled && d.State != DocumentStates.Withdrawn)
            // Another organization reading: its own documents only.
            .Where(d => options.Party == null || d.Originator == options.Party)
            .Select(d => new { d.Id, d.Number, d.Title, d.Originator, d.Discipline, d.PlannedDate }).ToListAsync(cancellationToken);
        var needed = await NeededByAsync(cancellationToken);
        var firstSent = await FirstSentAsync(cancellationToken);
        var parties = await db.Parties.AsNoTracking().ToDictionaryAsync(p => p.Code, p => p.Name, cancellationToken);

        Segment[] segments =
        [
            new("onTime", "Delivered on time", "good"), new("late", "Delivered late", "warn"),
            new("overdue", "Overdue", "bad"), new("coming", "Not due yet", "muted"),
        ];
        var order = new Dictionary<string, int> { ["overdue"] = 0, ["late"] = 1, ["coming"] = 2, ["onTime"] = 3 };
        var bars = new SortedDictionary<string, Bar>(StringComparer.Ordinal);
        var tally = segments.ToDictionary(s => s.Key, _ => 0);
        var lines = new List<(int Order, LocalDate Due, string Bar, IReadOnlyList<Cell> Row)>();
        foreach (var d in docs)
        {
            var due = Earliest(d.PlannedDate, needed.GetValueOrDefault(d.Id));
            if (due is not { } dueDate) continue;
            // Who sends it: an organization, or us as one. By discipline, whoever sends it.
            var sender = d.Originator is null ? "Us" : parties.GetValueOrDefault(d.Originator, d.Originator);
            var group = options.By == "discipline" ? _catalog.Label(ValueSets.Disciplines, d.Discipline) : sender;
            LocalDate? sent = firstSent.TryGetValue(d.Id, out var at) ? at.InZone(_zone).Date : null;
            var state = sent is { } s ? (s <= dueDate ? "onTime" : "late") : dueDate < _today ? "overdue" : "coming";
            tally[state]++;
            (bars.TryGetValue(group, out var bar) ? bar : bars[group] = new Bar(group, [])).Add(state);
            var lateBy = Period.Between(dueDate, sent ?? _today, PeriodUnits.Days).Days;
            // How late, said once: the state beside it carries the colour.
            lines.Add((order[state], dueDate, group,
            [
                Doc(d.Id, d.Number), d.Title, sender, _catalog.Label(ValueSets.Disciplines, d.Discipline), dueDate.ToString("yyyy-MM-dd", null), sent?.ToString("yyyy-MM-dd", null) ?? "",
                state is "late" or "overdue" ? $"{lateBy} d" : "", Stage(segments, state),
            ]));
        }
        var delivered = tally["onTime"] + tally["late"];
        var onTime = Percent(tally["onTime"], delivered);
        return Make(ReportIds.Deliveries, "Deliveries against plan", "Who is delivering on time, and what is overdue?",
            "Supplier and discipline follow-up: for expediting meetings.",
            [
                new("Planned", lines.Count.ToString()),
                new("Delivered", delivered.ToString()),
                new("On time", $"{onTime}%", delivered == 0 ? null : onTime >= options.OnTimeTarget ? "good" : "warn"),
                new("Overdue now", tally["overdue"].ToString(), tally["overdue"] > 0 ? "bad" : "good"),
            ],
            new Chart(options.By == "discipline" ? "Documents by discipline" : "Documents by sender", segments, [.. bars.Values]),
            ["Document", "Title", "Sender", "Discipline", "Due", "Delivered", "Late by", "State"],
            [.. lines.OrderBy(l => l.Order).ThenBy(l => l.Due).Select(l => ((string?)l.Bar, l.Row))],
            options.Party is null ? "No document has a planned date, and no activity needs one yet." : "None of your documents is planned yet.");
    }

    // ── Reviews waiting ───────────────────────────────────────────────────────

    /// <summary>
    /// The "Reviews waiting" report: each open review step and who it waits on, with how many days it has waited, charted by reviewer and age.
    /// Also gives the average turnaround (start to decision) of reviews decided in the chosen period.
    /// </summary>
    private async Task<Report> ReviewsAsync(ReportOptions options, CancellationToken cancellationToken)
    {
        var open = await (from s in db.ReviewSteps.Include(s => s.Participants)
                          join r in db.Reviews on s.ReviewId equals r.Id
                          join d in db.Documents on r.DocumentId equals d.Id
                          join v in db.Revisions on r.RevisionId equals v.Id
                          where r.ProjectId == _project.Id && r.State == ReviewStates.InProgress && s.State == StepStates.Open
                          select new { Step = s, ReviewId = r.Id, r.Number, DocumentId = d.Id, DocumentNumber = d.Number, d.Title, v.Value })
            .AsNoTracking().ToListAsync(cancellationToken);
        var since = clock.GetCurrentInstant() - Duration.FromDays(options.TurnaroundDays);
        var decided = await db.Reviews.AsNoTracking().Where(r => r.ProjectId == _project.Id && r.DecidedAt != null && r.DecidedAt >= since)
            .Select(r => new { r.StartedAt, r.DecidedAt }).ToListAsync(cancellationToken);

        // Each wait is judged by its step's own due day, never by a fixed number of days.
        var segments = LateSegments(options);
        // The longest waits, one bar each, as long as the days waited; or one bar per reviewer, counting their waits.
        var perReviewer = options.By == "reviewer";
        var bars = new Dictionary<string, Bar>();
        var lines = new List<(int Age, string Key, string Bar, IReadOnlyList<Cell> Row)>();
        foreach (var x in open)
        {
            var opened = (x.Step.OpenedAt ?? clock.GetCurrentInstant()).InZone(_zone).Date;
            var age = Period.Between(opened, _today, PeriodUnits.Days).Days;
            // Whoever the step waits on: the people who have not answered, or the other organization.
            var waitingOn = x.Step.ByProxy
                ? [x.Step.DispatchedAt is null ? "Document Control (to send)" : x.Step.PartyName ?? "Another organization"]
                : x.Step.Participants.Where(p => p.AnsweredAt is null).Select(p => p.UserName).ToList();
            foreach (var who in waitingOn)
            {
                var name = who;
                var key = LateKey(x.Step.DueDate, _today, options);
                if (perReviewer) (bars.TryGetValue(who, out var bar) ? bar : bars[who] = new Bar(who, [])).Add(key);
                else
                {
                    name = $"{x.DocumentNumber} rev {x.Value} · {who}";
                    if (bars.ContainsKey(name)) name = $"{name} · {x.Step.Title}";
                    bars[name] = new Bar(name, new() { [key] = Math.Max(age, 0) });
                }
                lines.Add((age, key, name,
                [
                    Doc(x.DocumentId, x.DocumentNumber), x.Title, $"rev {x.Value}", new Cell(x.Number, Kind: "review", Id: x.ReviewId), x.Step.Title, who,
                    Date(x.Step.OpenedAt), x.Step.DueDate is { } due ? new Cell(due.ToString("yyyy-MM-dd", null), due < _today ? "bad" : null) : "—",
                    new Cell($"{age} d", key == "old" ? "bad" : key == "week" ? "warn" : null),
                ]));
            }
        }
        var turnaround = decided.Count == 0 ? (double?)null : decided.Average(r => (r.DecidedAt!.Value - r.StartedAt).TotalDays);
        var late = lines.Count(l => l.Key is "week" or "old");
        return Make(ReportIds.Reviews, "Reviews waiting", "What is with reviewers, and for how long?",
            "Chasing reviewers: for the weekly engineering meeting.",
            [
                new("Waiting", lines.Count.ToString(), lines.Count > 0 ? "warn" : "good"),
                new("Late", late.ToString(), late > 0 ? "bad" : "good"),
                new($"Decided ({options.TurnaroundDays} days)", decided.Count.ToString()),
                // Under a day reads as such, not "0.0 d"; none decided reads as none.
                new("Average turnaround", turnaround switch { null => "none decided", < 1 => "under a day", var t => $"{t:0.0} days" }),
            ],
            perReviewer
                ? new Chart("Waiting, by reviewer and age", segments, [.. bars.Values.OrderByDescending(b => b.Values.Values.Sum()).ThenBy(b => b.Label)])
                : new Chart("The longest waits, in days", segments, [.. bars.Values.OrderByDescending(b => b.Values.Values.Sum()).ThenBy(b => b.Label).Take(15)], Unit: "days"),
            ["Document", "Title", "Revision", "Review", "Step", "Waiting on", "Since", "Due", "Waiting"],
            [.. lines.OrderByDescending(l => l.Age).Select(l => ((string?)l.Bar, l.Row))], "No review is waiting on anyone.");
    }

    /// <summary>
    /// How late a review step is, by its own due day: not late yet (due today or later), late, late over
    /// <see cref="ReportOptions.WarnDays"/> days; a step with no due day says so. Waiting is never "good": not late
    /// yet reads as under way. Reviews waiting and Progress by week judge it the same way.
    /// </summary>
    private static Segment[] LateSegments(ReportOptions options) =>
    [
        new("fresh", "Not late yet", "info"), new("week", "Late", "warn"),
        new("old", $"Late over {options.WarnDays} days", "bad"), new("none", "No due day", "muted"),
    ];

    /// <inheritdoc cref="LateSegments"/>
    private static string LateKey(LocalDate? due, LocalDate on, ReportOptions options) =>
        due is not { } d ? "none" : d >= on ? "fresh" : Period.Between(d, on, PeriodUnits.Days).Days > options.WarnDays ? "old" : "week";

    // ── Transmittal log ───────────────────────────────────────────────────────

    /// <summary>What went out (transmittals) and what came in (other organizations' submissions), and what each still waits on.</summary>
    private async Task<Report> TransmittalsAsync(ReportOptions options, CancellationToken cancellationToken)
    {
        var firstMonth = new LocalDate(_today.Year, _today.Month, 1).PlusMonths(-(options.Months - 1));
        var from = firstMonth.AtStartOfDayInZone(_zone).ToInstant();
        var sent = await db.Transmittals.AsNoTracking().Include(t => t.Recipients).Include(t => t.Items)
            .Where(t => t.ProjectId == _project.Id && (t.IssuedAt >= from || t.Recipients.Any(r => r.UserId == null && r.DispatchedAt == null)))
            .OrderByDescending(t => t.IssuedAt).ToListAsync(cancellationToken);
        var stepIds = sent.Where(t => t.ReviewStepId != null).Select(t => t.ReviewStepId!.Value).ToList();
        var answered = await db.ReviewSteps.AsNoTracking().Where(s => stepIds.Contains(s.Id) && s.CompletedAt != null)
            .Select(s => s.Id).ToListAsync(cancellationToken);
        var received = (await (from v in db.Revisions
                               join d in db.Documents on v.DocumentId equals d.Id
                               where v.ProjectId == _project.Id && v.AuthoredByParty != null
                               select new { v.Id, v.Value, v.State, v.Submission, v.Submissions, v.AuthoredByParty, DocumentId = d.Id, d.Number })
                .AsNoTracking().ToListAsync(cancellationToken))
            .SelectMany(v => v.Submissions.Select(s => (Revision: v, s.Number, s.SubmittedAt)))
            .Where(x => x.SubmittedAt >= from || (x.Number == x.Revision.Submission && x.Revision.State == RevisionStates.Received))
            .ToList();
        var parties = await db.Parties.AsNoTracking().ToDictionaryAsync(p => p.Code, p => p.Name, cancellationToken);

        Segment[] segments = [new("out", "Sent", "info"), new("in", "Received", "good")];
        var months = Enumerable.Range(0, options.Months).Select(i => firstMonth.PlusMonths(i))
            .Select(m => new Bar(m.ToString("MMM yy", System.Globalization.CultureInfo.InvariantCulture), [])).ToList();
        string? Count(Instant at, string key)
        {
            var date = at.InZone(_zone).Date;
            var index = (date.Year - firstMonth.Year) * 12 + date.Month - firstMonth.Month;
            if (index < 0 || index >= months.Count) return null;
            months[index].Add(key);
            return months[index].Label;
        }

        var lines = new List<(Instant At, string? Bar, IReadOnlyList<Cell> Row)>();
        foreach (var t in sent)
        {
            var month = Count(t.IssuedAt, "out");
            var toSend = t.Recipients.Count(r => r.AwaitsDispatch);
            var inApp = t.Recipients.Where(r => r.UserId != null).ToList();
            var unacknowledged = inApp.Count(r => r.AcknowledgedAt is null);
            Cell waiting =
                toSend > 0 ? new Cell($"Document Control: {toSend} to send", "warn")
                : t.ReviewStepId is { } step && !answered.Contains(step) && t.ResponseDue is { } due
                    ? due < _today ? new Cell($"Their answer: overdue since {due:yyyy-MM-dd}", "bad") : new Cell($"Their answer: due {due:yyyy-MM-dd}")
                : unacknowledged > 0 ? new Cell($"{unacknowledged} to acknowledge")
                : "—";
            lines.Add((t.IssuedAt, month,
            [
                new Cell(t.Number, Kind: "transmittal", Id: t.Id), "Out", Date(t.IssuedAt), t.ToName, _catalog.Label(TransmittalSets.Reasons, t.Reason),
                t.Items.Count.ToString(), inApp.Count == 0 ? "—" : $"{inApp.Count - unacknowledged}/{inApp.Count}", waiting,
            ]));
        }
        foreach (var (revision, number, at) in received)
        {
            var month = Count(at, "in");
            var toCheck = number == revision.Submission && revision.State == RevisionStates.Received;
            lines.Add((at, month,
            [
                new Cell($"{revision.Number} rev {revision.Value}" + (number > 1 ? $" ({number})" : ""), Kind: "document", Id: revision.DocumentId), "In",
                Date(at), parties.GetValueOrDefault(revision.AuthoredByParty!, revision.AuthoredByParty!), "Submission", "1", "—",
                toCheck ? new Cell("Document Control: check and accept", "warn") : "—",
            ]));
        }
        var waitingSend = sent.Count(t => t.Recipients.Any(r => r.AwaitsDispatch));
        var toAccept = received.Count(x => x.Number == x.Revision.Submission && x.Revision.State == RevisionStates.Received);
        var overdue = sent.Count(t => t.ReviewStepId is { } s && !answered.Contains(s) && t.ResponseDue < _today);
        return Make(ReportIds.Transmittals, "Transmittal log", "What went out and came in, and what is still waiting?",
            "The transmittal log: for the client or a supplier review.",
            [
                new($"Sent ({options.Months} months)", sent.Count(t => t.IssuedAt >= from).ToString()),
                new($"Received ({options.Months} months)", received.Count(x => x.SubmittedAt >= from).ToString()),
                new("To send or check", (waitingSend + toAccept).ToString(), waitingSend + toAccept > 0 ? "warn" : "good"),
                new("Answers overdue", overdue.ToString(), overdue > 0 ? "bad" : "good"),
            ],
            new Chart("Per month", segments, months, ChartKinds.Columns),
            ["Reference", "In / out", "Date", "From / to", "Reason", "Documents", "Acknowledged", "Waiting on"],
            [.. lines.OrderByDescending(l => l.At).Select(l => (l.Bar, l.Row))], $"Nothing sent or received in the last {options.Months} months.");
    }

    // ── Activity readiness ────────────────────────────────────────────────────

    /// <summary>The activities under way or starting within the horizon, and the documents each needs.</summary>
    private async Task<Report> ReadinessAsync(ReportOptions options, CancellationToken cancellationToken)
    {
        var horizon = _today.PlusDays(options.HorizonDays);
        var activities = await db.Activities.AsNoTracking().Include(a => a.Requirements)
            .Where(a => a.ProjectId == _project.Id && a.State == ActivityStates.Active && a.Start != null && a.Start <= horizon
                && (a.Finish ?? a.Start) >= _today)
            .OrderBy(a => a.Start).ThenBy(a => a.Code).ToListAsync(cancellationToken);
        var window = await db.ScheduleSources.Where(s => s.ProjectId == _project.Id).Select(s => (int?)s.RiskWindowDays).SingleOrDefaultAsync(cancellationToken) ?? 14;
        var documentIds = activities.SelectMany(a => a.Requirements).Select(n => n.DocumentId).Distinct().ToList();
        var documents = await db.Documents.AsNoTracking().Where(d => documentIds.Contains(d.Id))
            .ToDictionaryAsync(d => d.Id, d => d.Number, cancellationToken);
        var current = await db.Revisions.AsNoTracking().Where(r => documentIds.Contains(r.DocumentId) && r.State == RevisionStates.Released)
            .ToDictionaryAsync(r => r.DocumentId, r => new { r.Value, r.StatusCode }, cancellationToken);

        Segment[] segments =
        [
            new("met", "There", "good"), new("waived", "Waived, still followed up", "info"),
            new("coming", "Not yet, not late", "warn"), new("late", "Missing and late", "bad"),
        ];
        var bars = new List<Bar>();
        var rows = new List<(string?, IReadOnlyList<Cell>)>();
        var late = 0;
        foreach (var a in activities)
        {
            // Named, not only numbered: "A00004 · Pour the foundations".
            var bar = new Bar(string.IsNullOrWhiteSpace(a.Name) ? a.Code : $"{a.Code} · {a.Name}", [],
                a.Start?.ToString("yyyy-MM-dd", null), (a.Finish ?? a.Start)?.ToString("yyyy-MM-dd", null));
            foreach (var n in a.Requirements.OrderBy(n => n.NeededBy))
            {
                var key = n.State == RequirementStates.Met ? "met" : n.State == RequirementStates.Waived ? "waived"
                    : n.NeededBy is { } by && by < _today ? "late" : "coming";
                bar.Add(key);
                if (key == "late") late++;
                var has = current.GetValueOrDefault(n.DocumentId);
                rows.Add((bar.Label,
                [
                    new Cell(a.Code, Kind: "activity", Id: a.Id), a.Start?.ToString("yyyy-MM-dd", null) ?? "", Doc(n.DocumentId, documents.GetValueOrDefault(n.DocumentId, "?")),
                    n.Department is null ? "—" : _catalog.Label(ValueSets.Disciplines, n.Department), _catalog.Label(TransmittalSets.Reasons, n.Purpose),
                    has is null ? "nothing released" : $"rev {has.Value} · {(has.StatusCode is null ? "—" : _catalog.Label(ReviewSets.Statuses, has.StatusCode))}",
                    n.NeededBy?.ToString("yyyy-MM-dd", null) ?? "—", Stage(segments, key),
                ]));
            }
            if (bar.Values.Count > 0) bars.Add(bar);
        }
        var ready = activities.Count(a => ReadinessLabels.Of(a, _today, window) is ReadinessLabels.Ready or ReadinessLabels.ReadyWithWaivers);
        return Make(ReportIds.Readiness, "Activity readiness", $"Are the activities of the next {options.HorizonDays} days covered by their documents?",
            "Look-ahead: for the site coordination or planning meeting.",
            [
                new("Activities", activities.Count.ToString()),
                new("Ready", ready.ToString(), "good"),
                new("Documents needed", rows.Count.ToString()),
                new("Missing and late", late.ToString(), late > 0 ? "bad" : "good"),
            ],
            new Chart("Documents needed, per activity, on the calendar", segments, bars, ChartKinds.Timeline,
                From: _today.ToString("yyyy-MM-dd", null), To: horizon.ToString("yyyy-MM-dd", null)),
            ["Activity", "Start", "Document", "Discipline", "Serves", "Has", "Needed by", "State"], rows,
            $"No activity under way or starting in the next {options.HorizonDays} days.");
    }

    // ── Register on a date ───────────────────────────────────────────────────

    /// <summary>
    /// The register as it stood at the end of a day (project time): each document that existed then, the revision that
    /// was current (the latest released by then, not void on that day), its status, and what is current now. For audits,
    /// claims and "what did we build from?". The chart says when the register moved on from that day, and how: each
    /// document counted once, in the week (or month, over 16 weeks) of its first change since: replaced by a new
    /// revision, released for the first time, or put out of use (withdrawn, cancelled, its revision voided). Before that
    /// day, up to 8 periods say what was moving then (every change counted), so the chart is never blank for a day
    /// nothing has moved since; each of them opens the register as it stood at its end.
    /// </summary>
    private async Task<Report> AsOfAsync(ReportOptions options, CancellationToken cancellationToken)
    {
        var day = options.On ?? _today;
        var end = day.PlusDays(1).AtStartOfDayInZone(_zone).ToInstant();
        var docs = await db.Documents.AsNoTracking().Where(d => d.ProjectId == _project.Id && d.CreatedAt < end).OrderBy(d => d.Number)
            .Select(d => new
            {
                d.Id, d.Number, d.Title, d.Discipline, d.EndedAt, d.ReinstatedAt,
                Revisions = d.Revisions.Where(r => r.ReleasedAt != null)
                    .Select(r => new { r.Value, r.StatusCode, r.ReleasedAt, r.VoidedAt, r.UnvoidedAt, r.State }).ToList(),
            })
            .ToListAsync(cancellationToken);
        Segment[] segments =
        [
            new("replaced", "Replaced by a new revision", "info"), new("first", "Released for the first time", "good"),
            new("out", "Put out of use", "bad"),
        ];
        Segment[] stages = [.. segments, new("same", "As it was", "muted"), new("none", "Nothing released yet", "muted"), new("before", "Already out of use", "muted")];

        // The periods from that day to today: weeks (starting Monday) up to 16 of them, else months.
        var weekly = Period.Between(day, _today, PeriodUnits.Days).Days <= 16 * 7;
        LocalDate PeriodOf(LocalDate d) => weekly
            ? (d.DayOfWeek == IsoDayOfWeek.Monday ? d : d.Previous(IsoDayOfWeek.Monday))
            : new LocalDate(d.Year, d.Month, 1);
        string Said(LocalDate start) => start.ToString(weekly ? "d MMM" : "MMM yy", System.Globalization.CultureInfo.InvariantCulture);
        var periods = new List<Bar>();
        for (var p = PeriodOf(day); p <= _today; p = weekly ? p.PlusWeeks(1) : p.PlusMonths(1))
            periods.Add(new Bar(Said(p), [], p.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture)));
        var periodIndex = periods.Select((bar, i) => (bar.Label, i)).ToDictionary(x => x.Label, x => x.i);
        LocalDate Next(LocalDate p) => weekly ? p.PlusWeeks(1) : p.PlusMonths(1);
        string Iso(LocalDate d) => d.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

        // Before that day, for context: what moved in each of the 8 periods leading up to it (each release, first or
        // new revision, and each document put out of use), every change counted. Each period opens the register as it
        // stood at its end. Empty periods before the first change are left out.
        var dayPeriod = PeriodOf(day);
        var earlier = new List<Bar>();
        for (var p = weekly ? dayPeriod.PlusWeeks(-8) : dayPeriod.PlusMonths(-8); p < dayPeriod; p = Next(p))
            earlier.Add(new Bar(Said(p), [], Iso(p), Iso(Next(p).PlusDays(-1))));
        var startOfEarlier = (weekly ? dayPeriod.PlusWeeks(-8) : dayPeriod.PlusMonths(-8)).AtStartOfDayInZone(_zone).ToInstant();
        var startOfDayPeriod = dayPeriod.AtStartOfDayInZone(_zone).ToInstant();
        void Before(Instant? at, string key)
        {
            if (at is not { } a || a < startOfEarlier || a >= startOfDayPeriod) return;
            var start = PeriodOf(a.InZone(_zone).Date);
            earlier.FirstOrDefault(b => b.From == Iso(start))?.Add(key);
        }
        foreach (var d in docs)
        {
            var firstRelease = d.Revisions.Min(r => r.ReleasedAt);
            foreach (var r in d.Revisions)
            {
                Before(r.ReleasedAt, r.ReleasedAt == firstRelease ? "first" : "replaced");
                Before(r.VoidedAt, "out");
            }
            Before(d.EndedAt, "out");
        }
        while (earlier.Count > 0 && earlier[0].Values.Count == 0) earlier.RemoveAt(0);

        // Void on that day: voided by then and not taken back by then.
        bool VoidOn(Instant? voided, Instant? unvoided) => voided < end && (unvoided is null || unvoided >= end);
        var rows = new List<(Instant? Moved, string? Bar, IReadOnlyList<Cell> Row)>();
        var tally = stages.ToDictionary(s => s.Key, _ => 0);
        foreach (var d in docs)
        {
            var then = d.Revisions.Where(r => r.ReleasedAt < end && !VoidOn(r.VoidedAt, r.UnvoidedAt))
                .OrderByDescending(r => r.ReleasedAt).FirstOrDefault();
            var now = d.Revisions.Where(r => r.State != RevisionStates.Void).OrderByDescending(r => r.ReleasedAt).FirstOrDefault();
            var endedThen = d.EndedAt < end && (d.ReinstatedAt is null || d.ReinstatedAt >= end);
            // Its first change since that day, and what it was.
            var released = d.Revisions.Where(r => r.ReleasedAt >= end).Min(r => r.ReleasedAt);
            var outAt = new[] { d.EndedAt >= end ? d.EndedAt : null, then?.VoidedAt >= end ? then.VoidedAt : null }.Min();
            var (key, moved) = endedThen ? ("before", (Instant?)null)
                : outAt is { } o && (released is null || o <= released) ? ("out", outAt)
                : released is { } r ? (then is null ? "first" : "replaced", released)
                : then is null ? ("none", null) : ("same", null);
            tally[key]++;
            string? bar = null;
            if (moved is { } at && periodIndex.TryGetValue(Said(PeriodOf(at.InZone(_zone).Date)), out var index))
            {
                periods[index].Add(key);
                bar = periods[index].Label;
            }
            var discipline = _catalog.Label(ValueSets.Disciplines, d.Discipline);
            rows.Add((moved, bar,
            [
                Doc(d.Id, d.Number), d.Title, discipline,
                then is null ? "nothing released" : $"rev {then.Value}",
                then?.StatusCode is { } status ? _catalog.Label(ReviewSets.Statuses, status) : "—",
                Date(then?.ReleasedAt),
                now is null ? "nothing released" : now.Value == then?.Value ? "the same" : $"rev {now.Value}",
                Stage(stages, key), Date(moved),
            ]));
        }
        var label = day.ToString("d MMMM yyyy", System.Globalization.CultureInfo.InvariantCulture);
        var changed = tally["replaced"] + tally["first"] + tally["out"];
        return Make(ReportIds.AsOf, "Register on a date", $"Which revision was current on {label}?",
            "Audits, claims and \"what did we build from?\": the register as it stood at the end of that day, and what moved since.",
            [
                new("Documents then", docs.Count.ToString()),
                new("Released by then", docs.Count(d => d.Revisions.Any(r => r.ReleasedAt < end && !VoidOn(r.VoidedAt, r.UnvoidedAt))).ToString()),
                new("Changed since", changed.ToString(), changed > 0 ? "warn" : "good"),
                new("As it was", tally["same"].ToString()),
            ],
            // The periods before that day, then from it on (From: the day). Nothing moved at all: no chart.
            new Chart($"How the register moved around {label}, {(weekly ? "week" : "month")} by {(weekly ? "week" : "month")}", segments,
                changed == 0 && earlier.Count == 0 ? [] : [.. earlier, .. periods], ChartKinds.Columns, From: Iso(day)),
            ["Document", "Title", "Discipline", $"Current on {day:yyyy-MM-dd}", "Status then", "Released", "Current now", "Since then", "Changed on"],
            // What changed first, in the order it changed; then the rest by number.
            [.. rows.OrderBy(x => x.Moved is null).ThenBy(x => x.Moved).Select(x => (x.Bar, x.Row))], $"No document was registered by {label}.");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>The earliest day an active activity needs each document, for the documents one needs.</summary>
    private Task<Dictionary<Guid, LocalDate?>> NeededByAsync(CancellationToken cancellationToken) =>
        (from n in db.Requirements
         join a in db.Activities on n.ActivityId equals a.Id
         where n.ProjectId == _project.Id && a.State == ActivityStates.Active && n.NeededBy != null
         group n by n.DocumentId into g
         select new { DocumentId = g.Key, NeededBy = g.Min(n => n.NeededBy) }).ToDictionaryAsync(x => x.DocumentId, x => x.NeededBy, cancellationToken);

    /// <summary>When each document was first delivered: first sent in by another organization, or first sent for review.</summary>
    private async Task<Dictionary<Guid, Instant>> FirstSentAsync(CancellationToken cancellationToken)
    {
        var submissions = (await db.Revisions.AsNoTracking().Where(r => r.ProjectId == _project.Id)
                .Select(r => new { r.DocumentId, r.Submissions }).ToListAsync(cancellationToken))
            .SelectMany(r => r.Submissions.Select(s => (r.DocumentId, s.SubmittedAt)));
        var reviewStarts = await db.Reviews.AsNoTracking().Where(r => r.ProjectId == _project.Id)
            .Select(r => new { r.DocumentId, r.StartedAt }).ToListAsync(cancellationToken);
        return submissions.Concat(reviewStarts.Select(r => (r.DocumentId, SubmittedAt: r.StartedAt)))
            .GroupBy(x => x.DocumentId).ToDictionary(g => g.Key, g => g.Min(x => x.SubmittedAt));
    }

    /// <summary>Puts the parts of a report together and stamps it with the time it was counted.</summary>
    private Report Make(string id, string title, string question, string audience, IReadOnlyList<Figure> figures, Chart chart,
        IReadOnlyList<string> columns, IReadOnlyList<(string? Bar, IReadOnlyList<Cell> Row)> rows, string empty) =>
        new(id, title, question, audience, figures, chart, columns, [.. rows.Select(r => r.Row)], empty,
            clock.GetCurrentInstant().ToDateTimeOffset(), [.. rows.Select(r => r.Bar)]);

    /// <summary>A cell showing a document number that links to that document.</summary>
    private static Cell Doc(Guid id, string number) => new(number, Kind: "document", Id: id);

    /// <summary>A cell showing a segment's label, coloured when the segment's tone is good, warn or bad.</summary>
    private static Cell Stage(Segment[] segments, string key)
    {
        var segment = segments.Single(s => s.Key == key);
        return new Cell(segment.Label, segment.Tone is "good" or "warn" or "bad" ? segment.Tone : null);
    }

    /// <summary>Formats a moment as a yyyy-MM-dd date in the project's time zone; empty when there is none.</summary>
    private string Date(Instant? at) => at?.InZone(_zone).Date.ToString("yyyy-MM-dd", null) ?? "";

    /// <summary><paramref name="part"/> as a whole-number percentage of <paramref name="whole"/>; 0 when the whole is 0.</summary>
    private static int Percent(int part, int whole) => whole == 0 ? 0 : (int)Math.Round(100.0 * part / whole);

    /// <summary>The earlier of two optional dates, ignoring a missing one.</summary>
    private static LocalDate? Earliest(LocalDate? a, LocalDate? b) => a is null ? b : b is null ? a : LocalDate.Min(a.Value, b.Value);
}
