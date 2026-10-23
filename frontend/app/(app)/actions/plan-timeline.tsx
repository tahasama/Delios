import Link from "next/link";
import { fmtDate } from "@/lib/core/utils";

type PlanRow = {
  code: string;
  name: string;
  /** The latest schedule read moved its dates: the sentence that says so. */
  moved?: string | null;
  start: Date | null;
  /** The day the work ends, when the schedule gives one: the work itself is drawn from start to finish. */
  finish?: Date | null;
  /** The earliest date a document is needed for this activity. */
  firstNeeded: Date | null;
  readiness: "DONE" | "LATE_RECEIPT" | "READY" | "AT_RISK" | "NOT_READY" | "UPCOMING" | "UNKNOWN";
  ready: number;
  total: number;
  /** The planner's own ID, shown beside our number when it differs. */
  plannerId?: string | null;
  /** Where it sits in the planner's WBS, top down; the plan is grouped under it when the rows come in its order. */
  wbs?: string[];
  /** The planner says its start, its finish, happened (P6's "A"): the planner's word, never our "done". */
  startAchieved?: boolean;
  finishAchieved?: boolean;
};

/**
 * What the colour says, and only that (the bar also says it in words, for a
 * screen reader): dark green is done, fuchsia is done but
 * the documents came after the work, green is ready, blue is work still
 * ahead with nothing owed yet, amber is a document owed within the week, red is
 * a day that has passed with something still missing, grey is nothing listed.
 */
// Softened so they sit with the page rather than shout: the same hues, let a
// little of the sheet through. The key above the plan reads this same map.
export const TONE: Record<PlanRow["readiness"], string> = {
  DONE: "bg-emerald-700/70",
  LATE_RECEIPT: "bg-fuchsia-400/70",
  READY: "bg-emerald-400/70",
  UPCOMING: "bg-sky-500/65",
  AT_RISK: "bg-amber-500/70",
  NOT_READY: "bg-red-500/70",
  UNKNOWN: "bg-slate-300",
};
/** The lead-in (from the day documents are needed to the day of the work): the same hue, lighter, as a planner draws it. */
const LEAD: Record<PlanRow["readiness"], string> = {
  DONE: "bg-emerald-700/30",
  LATE_RECEIPT: "bg-fuchsia-400/35",
  READY: "bg-emerald-400/35",
  UPCOMING: "bg-sky-500/30",
  AT_RISK: "bg-amber-500/35",
  NOT_READY: "bg-red-500/35",
  UNKNOWN: "bg-slate-300/60",
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
  const dated = rows.filter((r) => r.start);
  // Every action here lacks a date: there is nothing to draw, and that is said.
  if (!dated.length) {
    return rows.length ? (
      <p className="flex-1 px-6 py-16 text-center text-sm text-slate-700">
        {rows.length === 1 ? "This action has" : `These ${rows.length} actions have`} no date from the schedule, so there is no bar to draw. The table lists {rows.length === 1 ? "it" : "them"}.
      </p>
    ) : null;
  }
  const starts = dated.map((r) => (r.firstNeeded ?? r.start!).getTime());
  const ends = dated.map((r) => r.start!.getTime());
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
    <section className="flex min-h-0 flex-1 flex-col px-5 pt-4 pb-3 sm:px-6">
      {/* The dates are written once, above everything, and stay there: the bars
          scroll under them rather than taking the calendar with them.
          The band and the grid below it cover exactly the track the bars are
          drawn in — the names take 200px and the gap 8px on the left, the ready
          count 56px and its gap on the right. Any other figure and the dates
          line up with nothing. */}
      <div className="relative ml-52 mr-16 h-4">
        {ticks.map((t, index) => (
          <span key={`${index}-${t.label}`} className="absolute top-0 whitespace-nowrap text-[10px] leading-none text-slate-500" style={{ left: `${t.left}%`, marginLeft: "0.25rem" }}>
            {t.label}
          </span>
        ))}
        {at(now) >= 0 && at(now) <= 100 ? (
          <span
            className="absolute top-0 whitespace-nowrap rounded bg-brand px-1 text-[10px] leading-4 font-semibold text-white"
            style={{ left: `${at(now)}%`, marginLeft: "0.25rem" }}
          >
            today · {fmtDate(new Date(now))}
          </span>
        ) : null}
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
            {/* Each month a column, every other one lightly shaded, a plain line between them (owner: a planner's chart). */}
            {ticks.map((t, index) => {
              const next = ticks[index + 1]?.left ?? 100;
              return (
                <div key={`${index}-${t.label}`} className={`absolute top-0 h-full border-l border-line ${index % 2 ? "bg-tint-soft/70" : ""}`}
                  style={{ left: `${t.left}%`, width: `${next - t.left}%` }} />
              );
            })}
            {at(now) >= 0 && at(now) <= 100 ? <div className="absolute top-0 h-full border-l-2 border-brand/60" style={{ left: `${at(now)}%` }} /> : null}
          </div>
          <ul className="relative pt-1">
          {dated.map((r, index) => {
            // The planner's WBS, as P6 lays it out (owner: "keep the category/sub"): each level that changes from the
            // row before is written above it, indented by its depth; the bars stay as they are.
            const before = index > 0 ? dated[index - 1].wbs ?? [] : [];
            const path = r.wbs ?? [];
            const same = path.findIndex((part, depth) => before[depth] !== part);
            const heads = same < 0 ? [] : path.slice(same).map((part, i) => ({ part, depth: same + i }));
            const start = (r.firstNeeded ?? r.start!).getTime();
            const end = r.start!.getTime();
            // A bar that starts before the window is drawn from its edge, not
            // off the side of it — otherwise it runs back over the names.
            const rawLeft = at(Math.min(start, end));
            const rawRight = at(Math.max(start, end));
            const left = Math.max(rawLeft, 0);
            const width = Math.max(Math.min(rawRight, 100) - left, 0.6);
            const fromBefore = rawLeft < 0;
            return (
              <li key={r.code}>
                {heads.map((h) => (
                  <p key={`${h.depth}-${h.part}`} className="truncate border-b border-line/60 bg-tint-soft/80 py-1 pr-2 text-[11px] font-semibold text-slate-700"
                    style={{ paddingLeft: 4 + h.depth * 12 }} title={h.part}>{h.part}</p>
                ))}
                <div className="flex items-center gap-2 border-b border-line/60 py-1">
                {/* Our number, the planner's ID beside it, the action's title under them (owner). */}
                <Link href={`/actions/${r.code}`} className="w-50 shrink-0 text-xs leading-tight text-slate-600 hover:text-link"
                  style={{ paddingLeft: path.length ? Math.min(path.length, 4) * 6 : 0 }}
                  title={`${r.code}${r.plannerId ? ` · ${r.plannerId}` : ""} — ${r.name}${r.moved ? `\n${r.moved}` : ""}`}>
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="font-mono font-semibold text-slate-700">{r.code}</span>
                    {r.plannerId ? <span className="truncate font-mono text-[11px] text-slate-500">{r.plannerId}</span> : null}
                    {r.moved ? <span className="stamp text-amber-700">moved</span> : null}
                  </span>
                  <span className="block truncate">{r.name}</span>
                </Link>
                <span className="relative h-5 flex-1">
                  {/* The lead-in, lighter; the work, solid; a day of work with no finish, a diamond (as a milestone is drawn). */}
                  <span
                    className={`absolute top-1/2 h-3.5 -translate-y-1/2 ${LEAD[r.readiness]} ${fromBefore ? "rounded-r-[3px]" : "rounded-[3px]"}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    role="img"
                    aria-label={`${STATE_WORD[r.readiness]}: ${r.firstNeeded ? `documents needed from ${fmtDate(r.firstNeeded)}, ` : ""}work on ${fmtDate(r.start)}, ${r.ready} of ${r.total} ready`}
                    title={`${r.code}: documents needed from ${fmtDate(r.firstNeeded)} · work on ${fmtDate(r.start)} · ${r.ready} of ${r.total} ready`}
                  />
                  {(() => {
                    const finish = r.finish && r.finish.getTime() > end ? r.finish.getTime() : end;
                    const from = Math.max(at(end), 0);
                    const to = Math.min(at(finish), 100);
                    if (to < 0 || from > 100) return null;
                    if (finish === end) {
                      return (
                        <span
                          className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] ${TONE[r.readiness]}`}
                          style={{ left: `${from}%` }}
                          role="img"
                            aria-label={`Work on ${fmtDate(r.start)}${r.startAchieved ? ", achieved (the planner's word)" : ""}`}
                          title={`Work on ${fmtDate(r.start)}${r.startAchieved ? " A — achieved, as the planner says" : ""}`}
                        />
                      );
                    }
                    return (
                      <span
                        className={`absolute top-1/2 h-3.5 -translate-y-1/2 rounded-[3px] ${TONE[r.readiness]}`}
                        style={{ left: `${from}%`, width: `max(4px, ${Math.max(to - from, 0)}%)` }}
                        role="img"
                        aria-label={`${r.finish ? `Work from ${fmtDate(r.start)} to ${fmtDate(r.finish)}` : `Work on ${fmtDate(r.start)}`}${achievedWords(r)}`}
                        title={`${r.finish ? `Work from ${fmtDate(r.start)}${r.startAchieved ? " A" : ""} to ${fmtDate(r.finish)}${r.finishAchieved ? " A" : ""}` : `Work on ${fmtDate(r.start)}`}${achievedWords(r)}`}
                      />
                    );
                  })()}
                  {/* "A" beside the work the planner says happened, as P6 writes it. */}
                  {r.startAchieved || r.finishAchieved ? (() => {
                    const mark = at(r.finish && r.finish.getTime() > end ? r.finish.getTime() : end);
                    return mark >= 0 && mark <= 100 ? (
                      <span className="absolute top-1/2 -translate-y-1/2 pl-1.5 text-[10px] font-semibold text-slate-600" style={{ left: `${mark}%` }}
                        title={r.finishAchieved ? "Achieved, as the planner says: their word on the work, not on its documents" : "Started, as the planner says"}>
                        A
                      </span>
                    ) : null;
                  })() : null}
                </span>
                <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-slate-500">{r.total ? `${r.ready}/${r.total}` : "—"}</span>
                </div>
              </li>
            );
          })}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** What the planner says happened, in words: their word on the work, never ours on its documents. */
function achievedWords(r: PlanRow) {
  return r.finishAchieved ? " · achieved, as the planner says" : r.startAchieved ? " · started, as the planner says" : "";
}
