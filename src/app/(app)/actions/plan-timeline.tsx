import Link from "next/link";
import { fmtDate } from "@/lib/utils";

export type PlanRow = {
  code: string;
  name: string;
  scheduledDate: Date | null;
  /** The earliest date a document is needed for this activity. */
  firstNeeded: Date | null;
  readiness: "READY" | "AT_RISK" | "NOT_READY" | "UNKNOWN";
  ready: number;
  total: number;
};

const TONE: Record<PlanRow["readiness"], string> = {
  READY: "bg-emerald-500",
  AT_RISK: "bg-amber-500",
  NOT_READY: "bg-red-500",
  UNKNOWN: "bg-slate-300",
};
const DAY = 86_400_000;

/**
 * The plan as people draw it: one bar per activity, from the day its first
 * document is needed to the day the work happens. Today is the vertical line,
 * so what is late is obvious without reading a single date.
 */
export function PlanTimeline({ rows }: { rows: PlanRow[] }) {
  const dated = rows.filter((r) => r.scheduledDate);
  if (!dated.length) return null;
  const starts = dated.map((r) => (r.firstNeeded ?? r.scheduledDate!).getTime());
  const ends = dated.map((r) => r.scheduledDate!.getTime());
  const now = Date.now();
  const min = Math.min(...starts, now) - 3 * DAY;
  const max = Math.max(...ends, now) + 3 * DAY;
  const span = Math.max(max - min, DAY);
  const at = (t: number) => ((t - min) / span) * 100;

  // A tick on the first of each month the plan covers.
  const ticks: { left: number; label: string }[] = [];
  const cursor = new Date(min);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= max) {
    if (cursor.getTime() >= min) ticks.push({ left: at(cursor.getTime()), label: cursor.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">The plan</h2>
        <p className="text-[11px] text-slate-400">Each bar runs from the day the first document is needed to the day the work happens. The line is today.</p>
      </div>
      <div className="relative">
        {/* month grid */}
        <div className="pointer-events-none absolute inset-0 ml-[210px]">
          {ticks.map((t) => (
            <div key={t.label} className="absolute top-0 h-full border-l border-dashed border-slate-200" style={{ left: `${t.left}%` }}>
              <span className="absolute -top-0.5 left-1 text-[10px] text-slate-400">{t.label}</span>
            </div>
          ))}
          <div className="absolute top-0 h-full border-l-2 border-red-400/70" style={{ left: `${at(now)}%` }} />
        </div>
        <ul className="relative space-y-1.5 pt-4">
          {dated.map((r) => {
            const start = (r.firstNeeded ?? r.scheduledDate!).getTime();
            const end = r.scheduledDate!.getTime();
            const left = at(Math.min(start, end));
            const width = Math.max(at(Math.max(start, end)) - left, 0.6);
            return (
              <li key={r.code} className="flex items-center gap-2">
                <Link href={`/actions/${r.code}`} className="w-[200px] shrink-0 truncate text-xs text-slate-600 hover:text-link" title={`${r.code} — ${r.name}`}>
                  <span className="font-mono font-semibold text-slate-700">{r.code}</span> {r.name}
                </Link>
                <span className="relative h-5 flex-1">
                  <span
                    className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full ${TONE[r.readiness]}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${r.code}: documents needed from ${fmtDate(r.firstNeeded)} · work on ${fmtDate(r.scheduledDate)} · ${r.ready} of ${r.total} ready`}
                  />
                  <span className="absolute top-1/2 h-3.5 w-1 -translate-y-1/2 rounded bg-slate-700" style={{ left: `${at(end)}%` }} />
                </span>
                <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-slate-500">{r.total ? `${r.ready}/${r.total}` : "—"}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
