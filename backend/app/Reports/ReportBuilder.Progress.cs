using Delios.Host.Documents;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Reports;

public sealed partial class ReportBuilder
{
    // ── Progress by week ──────────────────────────────────────────────────────

    /// <summary>
    /// Week by week (Monday to Sunday, this week so far): documents registered and released, what was delivered on time or
    /// late, what was overdue at the end of each week, the reviews open then, what went out and came in. Each is worked
    /// out from the dates the register keeps, so the weeks before today are there from the first day; overdue and on time
    /// are read against the plan as it stood at each week's end (owner): each move of a planned day is kept as it happens
    /// (<see cref="Platform.PlannedDateChange"/>); a document whose day never moved since then is read as it stands. The
    /// figures say how each moved since last week.
    /// </summary>
    private async Task<Report> ProgressAsync(ReportOptions options, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var monday = _today.Previous(IsoDayOfWeek.Monday);
        if (_today.DayOfWeek == IsoDayOfWeek.Monday) monday = _today;
        var weeks = Enumerable.Range(0, options.Weeks).Select(i => monday.PlusWeeks(i - options.Weeks + 1)).ToList();
        // The last day each week counts to: its Sunday, or today for this week.
        LocalDate LastDay(LocalDate start) => LocalDate.Min(start.PlusDays(6), _today);
        Instant EndOf(LocalDate day) => Instant.Min(day.PlusDays(1).AtStartOfDayInZone(_zone).ToInstant(), now);
        LocalDate DayOf(Instant at) => at.InZone(_zone).Date;

        var docs = await db.Documents.AsNoTracking().Where(d => d.ProjectId == _project.Id)
            .Select(d => new { d.Id, d.CreatedAt, d.State, d.PlannedDate }).ToListAsync(cancellationToken);
        var releases = await db.Revisions.AsNoTracking().Where(r => r.ProjectId == _project.Id && r.ReleasedAt != null)
            .Select(r => new { r.DocumentId, ReleasedAt = r.ReleasedAt!.Value, r.VoidedAt, r.UnvoidedAt }).ToListAsync(cancellationToken);
        var firstRelease = releases.GroupBy(r => r.DocumentId).ToDictionary(g => g.Key, g => g.Min(r => r.ReleasedAt));
        var reviews = await db.Reviews.AsNoTracking().Where(r => r.ProjectId == _project.Id)
            .Select(r => new { r.StartedAt, r.DecidedAt, r.ClosedAt, Steps = r.Steps.Select(s => new { s.OpenedAt, s.CompletedAt, s.DueDate }).ToList() })
            .ToListAsync(cancellationToken);
        var sentOut = await db.Transmittals.AsNoTracking().Where(t => t.ProjectId == _project.Id).Select(t => t.IssuedAt).ToListAsync(cancellationToken);
        var cameIn = (await db.Revisions.AsNoTracking().Where(r => r.ProjectId == _project.Id && r.AuthoredByParty != null)
            .Select(r => r.Submissions).ToListAsync(cancellationToken)).SelectMany(s => s.Select(x => x.SubmittedAt)).ToList();
        var needed = await NeededByAsync(cancellationToken);
        var firstSent = await FirstSentAsync(cancellationToken);
        // Each move of a planned day, as it happened: a week is judged against the day as it stood at its end.
        var moves = (await db.Set<Platform.PlannedDateChange>().AsNoTracking().Where(c => c.ProjectId == _project.Id)
                .OrderBy(c => c.At).ThenBy(c => c.Id).ToListAsync(cancellationToken))
            .GroupBy(c => c.DocumentId).ToDictionary(g => g.Key, g => g.ToList());
        // Cancelled and withdrawn documents are owed by nobody.
        var due = docs.Where(d => d.State is not (DocumentStates.Cancelled or DocumentStates.Withdrawn))
            .Select(d => (d.Id, d.CreatedAt, d.PlannedDate, Needed: needed.GetValueOrDefault(d.Id),
                Sent: firstSent.TryGetValue(d.Id, out var at) ? DayOf(at) : (LocalDate?)null))
            .ToList();
        // A document's due day as the plan stood at that moment: the day its last move before then gave it, or the day
        // its first move after then replaced; never moved, the day as it stands (the earliest an action needs it).
        LocalDate? DueAt(Guid id, LocalDate? planned, LocalDate? neededNow, Instant end)
        {
            if (!moves.TryGetValue(id, out var moved)) return Earliest(planned, neededNow);
            var before = moved.LastOrDefault(c => c.At < end);
            return before is not null ? before.Became : moved[0].Was;
        }

        // One week, as the register stood at its end.
        Week Count(LocalDate start)
        {
            var last = LastDay(start);
            var from = start.AtStartOfDayInZone(_zone).ToInstant();
            var end = EndOf(last);
            bool VoidThen(Instant? voided, Instant? unvoided) => voided < end && (unvoided is null || unvoided >= end);
            // Each review open then, judged by its steps open then against their own due days (the latest of them).
            string[] rank = ["none", "intime", "risk", "late"];
            var open = reviews.Where(r => r.StartedAt < end && ((r.ClosedAt ?? r.DecidedAt) is not { } shut || shut >= end))
                .Select(r => r.Steps.Where(s => s.OpenedAt < end && (s.CompletedAt is null || s.CompletedAt >= end))
                    .Select(s => LateKey(s.DueDate, last)).OrderByDescending(k => Array.IndexOf(rank, k)).FirstOrDefault() ?? "none")
                .ToList();
            var inWeek = releases.Where(r => r.ReleasedAt >= from && r.ReleasedAt < end).ToList();
            var delivered = due.Where(x => x.Sent is { } s && s >= start && s <= last)
                .Select(x => (x.Sent, Due: DueAt(x.Id, x.PlannedDate, x.Needed, end))).Where(x => x.Due is not null).ToList();
            return new Week(
                start, last,
                Registered: docs.Count(d => d.CreatedAt < end),
                Released: releases.Where(r => r.ReleasedAt < end && !VoidThen(r.VoidedAt, r.UnvoidedAt)).Select(r => r.DocumentId).Distinct().Count(),
                FirstReleases: inWeek.Count(r => firstRelease[r.DocumentId] == r.ReleasedAt),
                NewRevisions: inWeek.Count(r => firstRelease[r.DocumentId] != r.ReleasedAt),
                OnTime: delivered.Count(x => x.Sent <= x.Due),
                Late: delivered.Count(x => x.Sent > x.Due),
                // Overdue then: registered by then, its day passed, not delivered by then.
                Overdue: due.Count(x => x.CreatedAt < end && (x.Sent is null || x.Sent > last) && DueAt(x.Id, x.PlannedDate, x.Needed, end) is { } d && d < last),
                ReviewsInTime: open.Count(k => k == "intime"),
                ReviewsAtRisk: open.Count(k => k == "risk"),
                ReviewsLate: open.Count(k => k == "late"),
                ReviewsNoDue: open.Count(k => k == "none"),
                Decided: reviews.Count(r => r.DecidedAt >= from && r.DecidedAt < end),
                Sent: sentOut.Count(at => at >= from && at < end),
                Received: cameIn.Count(at => at >= from && at < end));
        }
        var counted = weeks.Select(Count).ToList();
        static string Said(LocalDate day, string pattern) => day.ToString(pattern, System.Globalization.CultureInfo.InvariantCulture);
        var label = (Week w) => Said(w.Start, "d MMM");

        // What the weeks can show, one at a time: each measure with its colours (the first when none is chosen).
        (string Key, string Title, Segment[] Segments, Func<Week, Dictionary<string, int>> Values)[] measures =
        [
            ("released", "Released each week",
                [new("first", "Released for the first time", "good"), new("again", "A new revision released", "info")],
                w => new() { ["first"] = w.FirstReleases, ["again"] = w.NewRevisions }),
            ("delivered", "Delivered each week, on time or late",
                [new("onTime", "On time", "good"), new("late", "Late", "warn")],
                w => new() { ["onTime"] = w.OnTime, ["late"] = w.Late }),
            ("overdue", "Overdue at the end of each week (against the plan as it stood then)",
                [new("overdue", "Overdue", "bad")], w => new() { ["overdue"] = w.Overdue }),
            ("reviews", "Reviews open at the end of each week, against their steps' due days",
                LateSegments,
                w => new() { ["intime"] = w.ReviewsInTime, ["risk"] = w.ReviewsAtRisk, ["late"] = w.ReviewsLate, ["none"] = w.ReviewsNoDue }),
            ("transmittals", "Sent and received each week",
                [new("out", "Sent", "info"), new("in", "Received", "good")], w => new() { ["out"] = w.Sent, ["in"] = w.Received }),
        ];
        var chosen = measures.FirstOrDefault(m => m.Key == options.By);
        if (chosen.Key is null) chosen = measures[0];
        var (title, segments) = (chosen.Title, chosen.Segments);
        var bars = counted.Select(w => new Bar(label(w), chosen.Values(w).Where(v => v.Value > 0).ToDictionary(v => v.Key, v => v.Value))).ToList();

        var thisWeek = counted[^1];
        var lastWeek = counted[^2];
        // How a figure moved since last week; whether up is good or bad is said by the figure.
        Figure Moved(string name, int value, int before, bool upIsGood, string? tone = null)
        {
            var change = value - before;
            var said = change == 0 ? "same as last week" : $"{(change > 0 ? "+" : "−")}{Math.Abs(change)} since last week";
            return new Figure(name, value.ToString(), tone, said, change == 0 ? null : (change > 0) == upIsGood ? "good" : "bad");
        }
        var openNow = thisWeek.Open;
        var rows = counted.AsEnumerable().Reverse().Select(w => ((string?)label(w), (IReadOnlyList<Cell>)
        [
            // Kept on one line: the day it starts, with its year.
            Said(w.Start, "d MMM yyyy").Replace(' ', '\u00a0'),
            w.Registered.ToString(), w.Released.ToString(), (w.FirstReleases + w.NewRevisions).ToString(),
            w.OnTime.ToString(), new Cell(w.Late.ToString(), w.Late > 0 ? "warn" : null), new Cell(w.Overdue.ToString(), w.Overdue > 0 ? "bad" : null),
            w.Open.ToString(), w.Decided.ToString(), w.Sent.ToString(), w.Received.ToString(),
        ])).ToList();
        return Make(ReportIds.Progress, "Progress by week", "Is the project moving, week by week?",
            "The weekly progress meeting, or the monthly report to the client: what moved, and what did not.",
            [
                Moved("Documents released", thisWeek.Released, lastWeek.Released, upIsGood: true),
                Moved("Released this week", thisWeek.FirstReleases + thisWeek.NewRevisions, lastWeek.FirstReleases + lastWeek.NewRevisions, upIsGood: true),
                Moved("Overdue now", thisWeek.Overdue, lastWeek.Overdue, upIsGood: false, thisWeek.Overdue > 0 ? "bad" : "good"),
                Moved("Reviews open", openNow, lastWeek.Open, upIsGood: false),
            ],
            new Chart(title, segments, bars, ChartKinds.Columns),
            ["Week starting", "Registered", "Released (documents)", "Released that week", "Delivered on time", "Delivered late", "Overdue at its end",
                "Reviews open at its end", "Reviews decided", "Sent", "Received"],
            rows, "Nothing is registered yet.");
    }

    /// <summary>One week as the register stood at its end (<see cref="Last"/>: its Sunday, or today).</summary>
    private sealed record Week(
        LocalDate Start, LocalDate Last, int Registered, int Released, int FirstReleases, int NewRevisions, int OnTime, int Late, int Overdue,
        int ReviewsInTime, int ReviewsAtRisk, int ReviewsLate, int ReviewsNoDue, int Decided, int Sent, int Received)
    {
        /// <summary>Reviews open at the week's end, late or not.</summary>
        public int Open => ReviewsInTime + ReviewsAtRisk + ReviewsLate + ReviewsNoDue;
    }
}
