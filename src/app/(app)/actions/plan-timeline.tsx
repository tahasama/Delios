import Link from "next/link";
import { fmtDate } from "@/lib/utils";

export type PlanRow = {
  code: string;
  name: string;
  scheduledDate: Date | null;
  /** The day the work ends, when the schedule gives one: the work itself is drawn from start to finish. */
  finishDate?: Date | null;
  /** The earliest date a document is needed for this activity. */
  firstNeeded: Date | null;
  readiness: "DONE" | "LATE_RECEIPT" | "READY" | "AT_RISK" | "NOT_READY" | "UPCOMING" | "UNKNOWN";
  ready: number;
  total: number;
};

/**
 * What the colour says, and only that (the bar also says it in words, for a
 * screen reader): dark green is done, violet is done but
 * the documents came after the work, green is ready, blue is work still
 * ahead with nothing owed yet, amber is a document owed within the week, red is
 * a day that has passed with something still missing, grey is nothing listed.
 */
const TONE: Record<PlanRow["readiness"], string> = {
  DONE: "bg-emerald-700",
  LATE_RECEIPT: "bg-violet-400",
  READY: "bg-emerald-400",
  UPCOMING: "bg-sky-500",
  AT_RISK: "bg-amber-500",
  NOT_READY: "bg-red-500",
  UNKNOWN: "bg-slate-300",
};
const DAY = 86_400_000;

/** The state in words, for whoever cannot see the bar's colour. */
const STATE_WORD: Record<PlanRow["readiness"], string> = {
  DONE: "Done", LATE_RECEIPT: "Late receipt", READY: "Ready", UPCOMING: "Still ahead", AT_RISK: "At risk", NOT_READY: "Overdue", UNKNOWN: "Nothing listed",
};

/**
 * The plan as people draw it: one bar per activity, from the day its first
 * document is needed to the day the work happens. Today is the vertical line,
 * so what is late is obvious without reading a single date.
 */
export function PlanTimeline({ rows, window, fit }: {
  rows: PlanRow[];
  /**
   * The days the plan is drawn across. Given, it is the window somebody asked
   * for — a month either side of today, unless they said otherwise — so the
   * bars keep the same scale however many activities fall inside it.
   */
  window?: { from: Date; to: Date };
  /**
   * How many bars the plan opens with. The box is exactly that tall, so what
   * opens never scrolls and what is loaded afterwards scrolls inside it rather
   * than pushing the page about.
   */
  fit?: number;
}) {
  const dated = rows.filter((r) => r.scheduledDate);
  // Every action here lacks a date: there is nothing to draw, and that is said.
  if (!dated.length) {
    return rows.length ? (
      <p className="flex-1 px-6 py-16 text-center text-sm text-slate-700">
        {rows.length === 1 ? "This action has" : `These ${rows.length} actions have`} no date from the schedule, so there is no bar to draw. The table lists {rows.length === 1 ? "it" : "them"}.
      </p>
    ) : null;
  }
  const starts = dated.map((r) => (r.firstNeeded ?? r.scheduledDate!).getTime());
  const ends = dated.map((r) => r.scheduledDate!.getTime());
  const now = Date.now();
  const min = window ? window.from.getTime() : Math.min(...starts, now) - 3 * DAY;
  const max = window ? window.to.getTime() : Math.max(...ends, now) + 3 * DAY;
  const span = Math.max(max - min, DAY);
  const at = (t: number) => ((t - min) / span) * 100;

  // The day the plan starts, then the first of each month it covers. Without
  // the first of those, the leftmost line falls days inside the plan and every
  // bar that begins at the edge looks as though it began before the calendar.
  const ticks: { left: number; label: string }[] = [
    { left: 0, label: new Date(min).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) },
  ];
  const cursor = new Date(min);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= max) {
    // A month that starts within a few days of the edge would print its name on
    // top of the starting day's, so it is left to the line to say it.
    if (cursor.getTime() >= min && at(cursor.getTime()) > 6) {
      ticks.push({ left: at(cursor.getTime()), label: cursor.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col px-5 pt-1 pb-3 sm:px-6">
      {/* The dates are written once, above everything, and stay there: the bars
          scroll under them rather than taking the calendar with them.
          The band and the grid below it cover exactly the track the bars are
          drawn in — the names take 200px and the gap 8px on the left, the ready
          count 56px and its gap on the right. Any other figure and the dates
          line up with nothing. */}
      <div className="relative ml-52 mr-16 h-4">
        {ticks.map((t) => (
          <span key={t.label} className="absolute top-0 whitespace-nowrap text-[10px] leading-none text-slate-400" style={{ left: `${t.left}%`, marginLeft: "0.25rem" }}>
            {t.label}
          </span>
        ))}
        <span
          className="absolute top-0 whitespace-nowrap rounded bg-brand px-1 text-[10px] leading-4 font-semibold text-white"
          style={{ left: `${at(now)}%`, marginLeft: "0.25rem" }}
        >
          today · {fmtDate(new Date(now))}
        </span>
      </div>

      {/* A plan is as long as the project. It keeps the height it opened at and
          scrolls inside it, so loading more never pushes the page about. One
          bar is 20px and the gap between two is 10px. */}
      <div className="scroll-quiet relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {/* The lines are drawn on the bars, not on the window onto them: this
            box is as tall as every bar there is, so today's line reaches the
            last one however far down it was loaded. */}
        <div className="relative min-h-full">
          <div className="pointer-events-none absolute inset-y-0 left-52 right-16">
            {ticks.map((t) => (
              <div key={t.label} className="absolute top-0 h-full border-l border-dashed border-line" style={{ left: `${t.left}%` }} />
            ))}
            <div className="absolute top-0 h-full border-l-2 border-brand/60" style={{ left: `${at(now)}%` }} />
          </div>
          <ul className="relative space-y-2.5 pt-1">
          {dated.map((r) => {
            const start = (r.firstNeeded ?? r.scheduledDate!).getTime();
            const end = r.scheduledDate!.getTime();
            // A bar that starts before the window is drawn from its edge, not
            // off the side of it — otherwise it runs back over the names.
            const rawLeft = at(Math.min(start, end));
            const rawRight = at(Math.max(start, end));
            const left = Math.max(rawLeft, 0);
            const width = Math.max(Math.min(rawRight, 100) - left, 0.6);
            const fromBefore = rawLeft < 0;
            return (
              <li key={r.code} className="flex items-center gap-2">
                <Link href={`/actions/${r.code}`} className="w-50 shrink-0 truncate text-xs text-slate-600 hover:text-link" title={`${r.code} — ${r.name}`}>
                  <span className="font-mono font-semibold text-slate-700">{r.code}</span> {r.name}
                </Link>
                <span className="relative h-5 flex-1">
                  <span
                    className={`absolute top-1/2 h-2.5 -translate-y-1/2 ${TONE[r.readiness]} ${fromBefore ? "rounded-r-full" : "rounded-full"}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    role="img"
                    aria-label={`${STATE_WORD[r.readiness]}: documents needed from ${fmtDate(r.firstNeeded)}, work on ${fmtDate(r.scheduledDate)}, ${r.ready} of ${r.total} ready`}
                    title={`${r.code}: documents needed from ${fmtDate(r.firstNeeded)} · work on ${fmtDate(r.scheduledDate)} · ${r.ready} of ${r.total} ready`}
                  />
                  {/* The work itself, start to finish, as a dark block on the end of the bar;
                      with no finish date, a tick on its day. */}
                  {(() => {
                    const finish = r.finishDate && r.finishDate.getTime() > end ? r.finishDate.getTime() : end;
                    const from = Math.max(at(end), 0);
                    const to = Math.min(at(finish), 100);
                    if (to < 0 || from > 100) return null;
                    return (
                      <span
                        className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded bg-slate-700"
                        style={{ left: `${from}%`, width: `max(4px, ${Math.max(to - from, 0)}%)` }}
                        title={r.finishDate ? `Work from ${fmtDate(r.scheduledDate)} to ${fmtDate(r.finishDate)}` : `Work on ${fmtDate(r.scheduledDate)}`}
                      />
                    );
                  })()}
                </span>
                <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-slate-500">{r.total ? `${r.ready}/${r.total}` : "—"}</span>
              </li>
            );
          })}
          </ul>
        </div>
      </div>
    </section>
  );
}
