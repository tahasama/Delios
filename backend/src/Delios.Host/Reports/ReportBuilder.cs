using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Schedules;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Reports;

/// <summary>
/// Builds each report for one project from the register as it stands. Labels come
/// from the organization's own lists (disciplines, statuses, reasons); only the
/// stages the system itself works out (in review, released, late…) are named here.
/// </summary>
public sealed class ReportBuilder(IClock clock)
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
        var rows = new List<IReadOnlyList<Cell>>();
        var tally = segments.ToDictionary(s => s.Key, _ => 0);
        foreach (var d in docs)
        {
            var stage = StageOf(d.State, d.Revisions.Select(r => r.State).ToList());
            tally[stage]++;
            var discipline = _catalog.Label(ValueSets.Disciplines, d.Discipline);
            (bars.TryGetValue(discipline, out var bar) ? bar : bars[discipline] = new Bar(discipline, [])).Add(stage);
            var released = d.Revisions.FirstOrDefault(r => r.State == RevisionStates.Released);
            var current = released ?? d.Revisions.FirstOrDefault();
            rows.Add(
            [
                Doc(d.Id, d.Number), d.Title, discipline, Stage(segments, stage), current?.Value ?? "—",
                current?.StatusCode is { } status ? _catalog.Label(ReviewSets.Statuses, status) : "—", Date(released?.ReleasedAt),
            ]);
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
            .Select(d => new { d.Id, d.Number, d.Title, d.Originator, d.Discipline, d.PlannedDate }).ToListAsync(cancellationToken);
        var needed = await (from n in db.Requirements
                            join a in db.Activities on n.ActivityId equals a.Id
                            where n.ProjectId == _project.Id && a.State == ActivityStates.Active && n.NeededBy != null
                            group n by n.DocumentId into g
                            select new { DocumentId = g.Key, NeededBy = g.Min(n => n.NeededBy) }).ToDictionaryAsync(x => x.DocumentId, x => x.NeededBy, cancellationToken);
        var submissions = (await db.Revisions.AsNoTracking().Where(r => r.ProjectId == _project.Id)
                .Select(r => new { r.DocumentId, r.Submissions }).ToListAsync(cancellationToken))
            .SelectMany(r => r.Submissions.Select(s => (r.DocumentId, s.SubmittedAt)));
        var reviewStarts = await db.Reviews.AsNoTracking().Where(r => r.ProjectId == _project.Id)
            .Select(r => new { r.DocumentId, r.StartedAt }).ToListAsync(cancellationToken);
        var firstSent = submissions.Concat(reviewStarts.Select(r => (r.DocumentId, SubmittedAt: r.StartedAt)))
            .GroupBy(x => x.DocumentId).ToDictionary(g => g.Key, g => g.Min(x => x.SubmittedAt));
        var parties = await db.Parties.AsNoTracking().ToDictionaryAsync(p => p.Code, p => p.Name, cancellationToken);

        Segment[] segments =
        [
            new("onTime", "Delivered on time", "good"), new("late", "Delivered late", "warn"),
            new("overdue", "Overdue", "bad"), new("coming", "Not due yet", "muted"),
        ];
        var order = new Dictionary<string, int> { ["overdue"] = 0, ["late"] = 1, ["coming"] = 2, ["onTime"] = 3 };
        var bars = new SortedDictionary<string, Bar>(StringComparer.Ordinal);
        var tally = segments.ToDictionary(s => s.Key, _ => 0);
        var lines = new List<(int Order, LocalDate Due, IReadOnlyList<Cell> Row)>();
        foreach (var d in docs)
        {
            var due = Earliest(d.PlannedDate, needed.GetValueOrDefault(d.Id));
            if (due is not { } dueDate) continue;
            var sender = d.Originator is null ? $"Us: {_catalog.Label(ValueSets.Disciplines, d.Discipline)}" : parties.GetValueOrDefault(d.Originator, d.Originator);
            LocalDate? sent = firstSent.TryGetValue(d.Id, out var at) ? at.InZone(_zone).Date : null;
            var state = sent is { } s ? (s <= dueDate ? "onTime" : "late") : dueDate < _today ? "overdue" : "coming";
            tally[state]++;
            (bars.TryGetValue(sender, out var bar) ? bar : bars[sender] = new Bar(sender, [])).Add(state);
            var lateBy = Period.Between(dueDate, sent ?? _today, PeriodUnits.Days).Days;
            lines.Add((order[state], dueDate,
            [
                Doc(d.Id, d.Number), d.Title, sender, dueDate.ToString("yyyy-MM-dd", null), sent?.ToString("yyyy-MM-dd", null) ?? "",
                state is "late" or "overdue" ? new Cell($"{lateBy} d", state == "overdue" ? "bad" : "warn") : "—", Stage(segments, state),
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
            new Chart("Documents by sender", segments, [.. bars.Values]),
            ["Document", "Title", "Sender", "Due", "Delivered", "Late by", "State"],
            [.. lines.OrderBy(l => l.Order).ThenBy(l => l.Due).Select(l => l.Row)],
            "No document has a planned date, and no activity needs one yet.");
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

        Segment[] segments =
        [
            new("fresh", $"Under {options.WarnDays} days", "good"),
            new("week", $"{options.WarnDays} to {options.LateDays} days", "warn"),
            new("old", $"Over {options.LateDays} days", "bad"),
        ];
        string AgeKey(int age) => age < options.WarnDays ? "fresh" : age <= options.LateDays ? "week" : "old";
        var bars = new Dictionary<string, Bar>();
        var lines = new List<(int Age, IReadOnlyList<Cell> Row)>();
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
                (bars.TryGetValue(who, out var bar) ? bar : bars[who] = new Bar(who, [])).Add(AgeKey(age));
                lines.Add((age,
                [
                    Doc(x.DocumentId, x.DocumentNumber), x.Title, $"rev {x.Value}", new Cell(x.Number, Kind: "review", Id: x.ReviewId), x.Step.Title, who,
                    Date(x.Step.OpenedAt), x.Step.DueDate is { } due ? new Cell(due.ToString("yyyy-MM-dd", null), due < _today ? "bad" : null) : "—",
                    new Cell($"{age} d", age > options.LateDays ? "bad" : age >= options.WarnDays ? "warn" : null),
                ]));
            }
        }
        var turnaround = decided.Count == 0 ? 0 : decided.Average(r => (r.DecidedAt!.Value - r.StartedAt).TotalDays);
        var old = lines.Count(l => l.Age > options.LateDays);
        return Make(ReportIds.Reviews, "Reviews waiting", "What is with reviewers, and for how long?",
            "Chasing reviewers: for the weekly engineering meeting.",
            [
                new("Waiting", lines.Count.ToString(), lines.Count > 0 ? "warn" : "good"),
                new($"Over {options.LateDays} days", old.ToString(), old > 0 ? "bad" : "good"),
                new($"Decided ({options.TurnaroundDays} days)", decided.Count.ToString()),
                new("Average turnaround", $"{turnaround:0.0} d"),
            ],
            new Chart("Waiting, by reviewer and age", segments, [.. bars.Values.OrderByDescending(b => b.Values.Values.Sum()).ThenBy(b => b.Label)]),
            ["Document", "Title", "Revision", "Review", "Step", "Waiting on", "Since", "Due", "Waiting"],
            [.. lines.OrderByDescending(l => l.Age).Select(l => l.Row)], "No review is waiting on anyone.");
    }

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
        void Count(Instant at, string key)
        {
            var date = at.InZone(_zone).Date;
            var index = (date.Year - firstMonth.Year) * 12 + date.Month - firstMonth.Month;
            if (index >= 0 && index < months.Count) months[index].Add(key);
        }

        var lines = new List<(Instant At, IReadOnlyList<Cell> Row)>();
        foreach (var t in sent)
        {
            Count(t.IssuedAt, "out");
            var toSend = t.Recipients.Count(r => r.AwaitsDispatch);
            var inApp = t.Recipients.Where(r => r.UserId != null).ToList();
            var unacknowledged = inApp.Count(r => r.AcknowledgedAt is null);
            Cell waiting =
                toSend > 0 ? new Cell($"Document Control: {toSend} to send", "warn")
                : t.ReviewStepId is { } step && !answered.Contains(step) && t.ResponseDue is { } due
                    ? due < _today ? new Cell($"Their answer: overdue since {due:yyyy-MM-dd}", "bad") : new Cell($"Their answer: due {due:yyyy-MM-dd}")
                : unacknowledged > 0 ? new Cell($"{unacknowledged} to acknowledge")
                : "—";
            lines.Add((t.IssuedAt,
            [
                new Cell(t.Number, Kind: "transmittal", Id: t.Id), "Out", Date(t.IssuedAt), t.ToName, _catalog.Label(TransmittalSets.Reasons, t.Reason),
                t.Items.Count.ToString(), inApp.Count == 0 ? "—" : $"{inApp.Count - unacknowledged}/{inApp.Count}", waiting,
            ]));
        }
        foreach (var (revision, number, at) in received)
        {
            Count(at, "in");
            var toCheck = number == revision.Submission && revision.State == RevisionStates.Received;
            lines.Add((at,
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
            new Chart("Per month", segments, months),
            ["Reference", "In / out", "Date", "From / to", "Reason", "Documents", "Acknowledged", "Waiting on"],
            [.. lines.OrderByDescending(l => l.At).Select(l => l.Row)], $"Nothing sent or received in the last {options.Months} months.");
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
        var rows = new List<IReadOnlyList<Cell>>();
        foreach (var a in activities)
        {
            var bar = new Bar(a.Code, []);
            foreach (var n in a.Requirements.OrderBy(n => n.NeededBy))
            {
                var key = n.State == RequirementStates.Met ? "met" : n.State == RequirementStates.Waived ? "waived"
                    : n.NeededBy is { } by && by < _today ? "late" : "coming";
                bar.Add(key);
                var has = current.GetValueOrDefault(n.DocumentId);
                rows.Add(
                [
                    new Cell(a.Code, Kind: "activity", Id: a.Id), a.Start?.ToString("yyyy-MM-dd", null) ?? "", Doc(n.DocumentId, documents.GetValueOrDefault(n.DocumentId, "?")),
                    n.Department is null ? "—" : _catalog.Label(ValueSets.Disciplines, n.Department), _catalog.Label(TransmittalSets.Reasons, n.Purpose),
                    has is null ? "nothing released" : $"rev {has.Value} · {(has.StatusCode is null ? "—" : _catalog.Label(ReviewSets.Statuses, has.StatusCode))}",
                    n.NeededBy?.ToString("yyyy-MM-dd", null) ?? "—", Stage(segments, key),
                ]);
            }
            if (bar.Values.Count > 0) bars.Add(bar);
        }
        var ready = activities.Count(a => ReadinessLabels.Of(a, _today, window) is ReadinessLabels.Ready or ReadinessLabels.ReadyWithWaivers);
        var late = rows.Count(r => r[^1].Text == "Missing and late");
        return Make(ReportIds.Readiness, "Activity readiness", $"Are the activities of the next {options.HorizonDays} days covered by their documents?",
            "Look-ahead: for the site coordination or planning meeting.",
            [
                new("Activities", activities.Count.ToString()),
                new("Ready", ready.ToString(), "good"),
                new("Documents needed", rows.Count.ToString()),
                new("Missing and late", late.ToString(), late > 0 ? "bad" : "good"),
            ],
            new Chart("Documents needed, per activity", segments, bars),
            ["Activity", "Start", "Document", "Department", "Serves", "Has", "Needed by", "State"], rows,
            $"No activity under way or starting in the next {options.HorizonDays} days.");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>Puts the parts of a report together and stamps it with the time it was counted.</summary>
    private Report Make(string id, string title, string question, string audience, IReadOnlyList<Figure> figures, Chart chart,
        IReadOnlyList<string> columns, IReadOnlyList<IReadOnlyList<Cell>> rows, string empty) =>
        new(id, title, question, audience, figures, chart, columns, rows, empty, clock.GetCurrentInstant().ToDateTimeOffset());

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
