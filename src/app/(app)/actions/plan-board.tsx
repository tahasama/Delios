import Link from "next/link";
import { fmtDate } from "@/lib/utils";
import type { PlanRow } from "./plan-timeline";
import { StateTag, stateClass } from "./state-tag";

/**
 * The schedule as a site office's planning board: one column per week, each
 * action a card in the week of its day, the card's colour its state. A week
 * reads at a glance — how many cards, and how many of them are red or amber —
 * before a single name is read. The current week is lit.
 */
export function PlanBoard({ rows, window }: {
  rows: PlanRow[];
  /** The days the board covers; without it, the weeks of the actions shown. */
  window?: { from: Date; to: Date };
}) {
  const dated = rows.filter((row): row is PlanRow & { scheduledDate: Date } => !!row.scheduledDate);
  const first = window?.from ?? (dated.length ? new Date(Math.min(...dated.map((row) => row.scheduledDate.getTime()))) : new Date());
  const last = window?.to ?? (dated.length ? new Date(Math.max(...dated.map((row) => row.scheduledDate.getTime()))) : new Date());

  // Weeks start on Monday, as a site's week does.
  const monday = (day: Date) => {
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    at.setDate(at.getDate() - ((at.getDay() + 6) % 7));
    return at;
  };
  const weeks: Date[] = [];
  for (let at = monday(first); at <= last && weeks.length < 160; at = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 7)) weeks.push(at);
  const thisWeek = monday(new Date()).getTime();
  const byWeek = new Map<number, (PlanRow & { scheduledDate: Date })[]>();
  for (const row of dated) {
    const key = monday(row.scheduledDate).getTime();
    byWeek.set(key, [...(byWeek.get(key) ?? []), row]);
  }
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short" });

  return (
    <div className="board scroll-thin min-h-0 flex-1 overflow-auto px-5 pt-3 pb-4 sm:px-6">
      <ol className="flex min-h-full gap-3" aria-label="Actions by week">
        {weeks.map((week) => {
          const cards = (byWeek.get(week.getTime()) ?? []).sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());
          const end = new Date(week.getFullYear(), week.getMonth(), week.getDate() + 6);
          const now = week.getTime() === thisWeek;
          const late = cards.filter((card) => card.readiness === "NOT_READY" || card.readiness === "AT_RISK").length;
          return (
            <li key={week.getTime()} className={`board-week ${now ? "board-week-now" : ""}`} aria-current={now ? "date" : undefined}>
              <div className="board-week-head">
                <span className="text-xs font-semibold text-slate-800">{fmtDate(week)} – {fmtDate(end)}</span>
                <span className="text-[11px] text-slate-500">
                  {now ? <span className="font-semibold text-brand-ink">this week · </span> : null}
                  {cards.length ? `${cards.length} action${cards.length === 1 ? "" : "s"}` : "nothing planned"}
                  {late ? <span className="font-semibold text-red-700"> · {late} need{late === 1 ? "s" : ""} attention</span> : null}
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {cards.map((card) => (
                  <li key={card.code}>
                    <Link href={`/actions/${card.code}`} className={`t-card state-${stateClass(card.readiness)}`}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-semibold text-slate-600">{card.code}</span>
                        <StateTag state={card.readiness} />
                      </span>
                      <span className="t-card-name">{card.name}</span>
                      <span className="flex items-center justify-between gap-2 text-[11.5px] text-slate-600">
                        <span>{weekday.format(card.scheduledDate)} {fmtDate(card.scheduledDate)}</span>
                        <span className="tabular-nums">{card.total ? `${card.ready} of ${card.total} ready` : "nothing listed"}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
