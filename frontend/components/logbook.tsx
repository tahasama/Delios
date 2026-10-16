import Link from "next/link";
import { fmtDate, fmtDateTime } from "@/lib/core/utils";
import { DateWindow } from "@/components/date-window";
import { activityLink, activityWords, readableDetail } from "@/lib/settings/activity-words";
import { AUDIT_KINDS, AUDIT_RAIL } from "@/lib/core/rails";

/** One act as the logbook files it. */
export type LogAct = {
  id: number; at: string; action: string; kind: string; actorId?: string | null; actorName?: string;
  entityType: string | null; entityId: string | null; entityLabel: string | null; detail: string | null; project: string | null;
  /** The document of a revision or a file, worked out by the backend: its title opens the document. */
  documentId?: string | null;
};

type Counts = { action: string; count: number; kind: string }[];
type Chosen = { kind?: string; action?: string };
type Href = (q: { kind?: string; action?: string; page?: number }) => string;
type Find = { q?: string; from?: string; to?: string; hidden: Record<string, string | undefined>; clear: string; extra?: React.ReactNode };
type Paging = { page: number; pages: number; total: number };

/**
 * The audit trail's logbook, the same on the Audit trail and on a person's activity: the day as a rule across the
 * page, each act a slip with its kind's side colour (the key, `AUDIT_RAIL`), and beside it the kinds of act, each
 * with every act it holds and their counts, then Find (words and dates). What is shown is narrowed by the backend;
 * the pager goes further back. Who did it opens their activity; what it was done to opens its page.
 */
export function Logbook({
  title, lede, reading, acts, counts, chosen, href, find, paging, showWho = true,
}: {
  title: React.ReactNode;
  lede: React.ReactNode;
  /** A line under the lede saying what is being read (dates, kind, words), when narrowed. */
  reading?: string | null;
  acts: LogAct[];
  /** Every act kept (in what is narrowed so far, but the kind), with its count and kind. */
  counts: Counts;
  chosen: Chosen;
  /** The address for a kind or one act (none: the whole log), keeping the rest of the narrowing. */
  href: Href;
  /** The Find form: words and dates, and what it keeps hidden (the kind, a project…). */
  find: Find;
  paging: Paging;
  showWho?: boolean;
}) {
  return (
    <div className="dispatch logbook space-y-5">
      <header className="dispatch-head px-6 py-5">
        {title}
        <div className="dispatch-lede mt-1.5 max-w-2xl">{lede}</div>
        {reading ? <p className="slip-note mt-2.5">{reading}</p> : null}
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[248px_minmax(0,1fr)] lg:items-start">
        <aside className="lg:sticky lg:top-22">
          <LogbookSide counts={counts} chosen={chosen} href={href} find={find} />
        </aside>
        <main className="min-w-0 space-y-5">
          <LogbookDays acts={acts} chosen={chosen} href={href} paging={paging} showWho={showWho} />
        </main>
      </div>
    </div>
  );
}

/** Beside the log: the whole log, each kind of act with its count and every act it holds, then Find (words, dates). */
export function LogbookSide({ counts, chosen, href, find }: { counts: Counts; chosen: Chosen; href: Href; find: Find }) {
  const total = counts.reduce((n, c) => n + c.count, 0);
  const kinds = AUDIT_KINDS.map((k) => ({ ...k, acts: counts.filter((c) => c.kind === k.key), count: counts.filter((c) => c.kind === k.key).reduce((n, c) => n + c.count, 0) }))
    .filter((k) => k.count > 0 || chosen.kind === k.key);
  return (
    <>
    <nav aria-label="Kinds of act">
      <Link
        href={href({})}
        aria-current={!chosen.kind && !chosen.action ? "page" : undefined}
        className={`flex items-baseline gap-3 rounded px-3 py-2 text-[13px] ${!chosen.kind && !chosen.action ? "bg-canvas-deep font-semibold text-slate-900" : "text-slate-600 hover:text-slate-900"}`}
      >
        <span>The whole log</span>
        <span className="ml-auto font-mono text-[11.5px] text-slate-500">{total.toLocaleString("en-GB")}</span>
      </Link>
      {kinds.map((k) => {
        const on = chosen.kind === k.key && !chosen.action;
        return (
          <div key={k.key} className="mt-1 border-t border-line pt-1">
            <Link
              href={href({ kind: k.key })}
              aria-current={on ? "page" : undefined}
              className={`flex items-baseline gap-2.5 rounded px-3 py-1.5 text-[13px] ${on ? "bg-canvas-deep font-semibold text-slate-900" : "text-slate-700 hover:text-slate-900"}`}
            >
              <span aria-hidden className={`${AUDIT_RAIL[k.key] ?? "rail-none"} h-3 w-1 shrink-0 self-center rounded-full bg-(--rail)`} />
              <span className="min-w-0 truncate">{k.label}</span>
              <span className="ml-auto font-mono text-[11.5px] text-slate-500">{k.count.toLocaleString("en-GB")}</span>
            </Link>
            {/* Every act of that kind, so nothing done in the app is hidden behind a heading. */}
            <ul>
              {k.acts.map((a) => {
                const mine = chosen.action === a.action;
                return (
                  <li key={a.action}>
                    <Link
                      href={href({ kind: k.key, action: a.action })}
                      aria-current={mine ? "page" : undefined}
                      className={`flex items-baseline gap-3 rounded py-1 pr-3 pl-6.5 text-[12px] ${mine ? "bg-canvas-deep font-semibold text-slate-900" : "text-slate-500 hover:text-slate-900"}`}
                    >
                      <span className="min-w-0 truncate">{activityWords(a.action)}</span>
                      <span className="ml-auto font-mono text-[11px] text-slate-400">{a.count.toLocaleString("en-GB")}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>

    <form className="asking mt-5 px-3">
      {Object.entries(find.hidden).map(([name, value]) => (value ? <input key={name} type="hidden" name={name} value={value} /> : null))}
      <p className="slip-label">Find</p>
      <input name="q" defaultValue={find.q ?? ""} placeholder="number, person, detail" className="plain mt-2 w-full" />
      {find.extra}
      <p className="slip-label mt-4">When</p>
      <span className="register mt-2 block">
        <DateWindow fields={[{ code: "ts", label: "The day it happened" }]} on={find.from ? "ts" : ""} from={find.from ?? ""} to={find.to ?? ""} />
      </span>
      <div className="mt-2.5 flex items-center gap-3">
        <button className="ask" data-on={find.q || find.from || find.to ? "true" : "false"}>Show</button>
        {find.q || find.from || find.to ? <Link href={find.clear} className="text-[12px] font-semibold text-link hover:underline">Clear</Link> : null}
      </div>
    </form>
    </>
  );
}

/** The log itself: the day as a rule, each act a slip in its kind's side colour, and the pager further back. */
export function LogbookDays({ acts, chosen, href, paging, showWho = true }: { acts: LogAct[]; chosen: Chosen; href: Href; paging: Paging; showWho?: boolean }) {
  // Filed by the day it happened: correspondence is remembered by its day, and a day with nothing in it is not a heading.
  const days: { day: string; when: Date; acts: LogAct[] }[] = [];
  for (const e of acts) {
    const when = new Date(e.at);
    const day = when.toDateString();
    const last = days[days.length - 1];
    if (last?.day === day) last.acts.push(e);
    else days.push({ day, when, acts: [e] });
  }
  return (
    <>
    {days.map(({ day, when, acts: those }) => (
      <section key={day}>
        <div className="day-rule mb-2.5">
          <span className="font-mono text-[12.5px]">{when.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</span>
          <span className="day-name">{when.toLocaleDateString("en-GB", { weekday: "long" })}</span>
        </div>
        <ul className="space-y-2">
          {those.map((e) => {
            const link = activityLink(e.entityType, e.entityId, e.entityLabel, e.documentId);
            const detail = readableDetail(e.detail);
            const kind = AUDIT_KINDS.find((k) => k.key === e.kind);
            return (
              <li key={e.id} className={`slip ${AUDIT_RAIL[e.kind] ?? "rail-none"}`}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="slip-number">
                    {link ? <Link href={link} className="hover:text-link hover:underline">{e.entityLabel ?? e.entityType ?? "—"}</Link> : e.entityLabel ?? e.entityType ?? "—"}
                  </span>
                  <span className="postmark">{activityWords(e.action)}</span>
                  <span className="slip-note ml-auto whitespace-nowrap">{fmtDateTime(e.at)}</span>
                </div>
                {detail ? <p className="slip-subject mt-1.5 whitespace-pre-line">{detail}</p> : null}
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="route">
                    {showWho ? (
                      <span className="route-party">
                        {e.actorId ? <Link href={`/settings/users/${e.actorId}`} className="hover:underline">{e.actorName}</Link> : e.actorName}
                      </span>
                    ) : null}
                    {showWho ? <span className="route-line" aria-hidden="true" /> : null}
                    <span className="min-w-0 truncate">{e.project ?? "the organization"}</span>
                  </span>
                  {kind ? <span className="slip-note ml-auto">{kind.label}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    ))}

    {!days.length ? (
      <p className="slip px-4 py-6 text-[13px] text-(--ink-soft)">Nothing in the log answers that. Acts appear here as they happen.</p>
    ) : null}

    {paging.pages > 1 ? (
      <div className="flex items-center justify-between gap-3 px-1">
        {paging.page > 1 ? <Link href={href({ ...chosen, page: paging.page - 1 })} className="text-[12.5px] font-semibold text-link hover:underline">&larr; Newer acts</Link> : <span />}
        <span className="slip-note">page {paging.page} of {paging.pages} · {paging.total.toLocaleString("en-GB")} acts</span>
        {paging.page < paging.pages ? <Link href={href({ ...chosen, page: paging.page + 1 })} className="text-[12.5px] font-semibold text-link hover:underline">Earlier acts &rarr;</Link> : <span />}
      </div>
    ) : null}
    </>
  );
}

/** "Reading 3 March to now · releases · “P1001”": what the log is narrowed to, in words. */
export function readingLine({ from, to, kindLabel, q }: { from?: string; to?: string; kindLabel?: string; q?: string }): string | null {
  if (!from && !to && !kindLabel && !q) return null;
  return `Reading ${from ? fmtDate(from) : "the beginning"} to ${to ? fmtDate(to) : "now"}${kindLabel ? ` · ${kindLabel.toLowerCase()}` : ""}${q ? ` · “${q}”` : ""}`;
}
