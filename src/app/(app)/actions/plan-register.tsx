"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Download, Pin, PinOff, Rows3, Search, X } from "lucide-react";
import { DataTable, Th, Td, Chip, Info } from "@/components/ui";
import { DateWindow } from "@/components/date-window";

/**
 * The schedule, asked about once and answered two ways.
 *
 * One sheet holds the question — the search, the narrowing choices, the window
 * of days — and under it either the plan drawn as bars or the same actions as a
 * table. They are two views of one answer, not two pages, so the filters are
 * asked for once and both obey them.
 */
export type PlanTableRow = {
  id: string;
  code: string;
  /** The planner's ID for it, when it differs from our number. */
  plannerId: string | null;
  /** The latest schedule read moved its dates: what they were and are, in one sentence. */
  moved: string | null;
  name: string;
  departments: string[];
  date: string | null;
  /** The day the work ends, when the schedule gives one, and how many days it lasts. */
  finish: string | null;
  days: number | null;
  when: string;
  late: boolean;
  readiness: "DONE" | "LATE_RECEIPT" | "READY" | "AT_RISK" | "NOT_READY" | "UPCOMING" | "UNKNOWN";
  ready: number;
  total: number;
  nextNeeded: string | null;
  nextOverdue: boolean;
  missing: { docNumber: string; status: string }[];
  confirmed: string;
  confirmedTone: "good" | "bad" | "plain";
  /** What became of the work itself, and what its documents were on the day. */
  happened: "POSTPONED" | "CARRIED" | "DONE" | "AHEAD";
  happenedNote: string;
};

type Opt = { code: string; label: string };

export function PlanRegister({
  plate, uploads, view, plan, cardHeight, more, rows, total, filters, filterOptions, facets, paging, sort, exportHref,
}: {
  plate: React.ReactNode;
  /** Where the dates come from, the pages behind the schedule, and uploading by hand for whoever plans. */
  uploads: React.ReactNode;
  /** Which of the two views is showing. */
  view: "plan" | "table";
  /** The plan, drawn by the server component, shown under the question. */
  plan: React.ReactNode;
  /**
   * How tall the card holding the answer is, in pixels. Both views are given
   * the same box and each fills it, so switching between them moves nothing.
   */
  cardHeight: number;
  /** How much of the plan is drawn, where the rest is, and the days it covers. */
  more?: {
    shown: number;
    total: number;
    /** How many more it draws at a time, and the ways to change that. */
    step: number;
    steps: { by: number; href: string }[];
    href: string | null;
    /** The days the plan is drawn across, and the address that widens or narrows it. */
    window: { label: string; href: string; wide: boolean; elsewhere: number } | null;
    /** Of those drawn, how many have no date from the schedule and so no bar. */
    undated: number;
    noNote?: { count: number; href: string };
    undatedHref?: string;
  };
  rows: PlanTableRow[];
  total: number;
  filters: { q: string; state: string; happened: string; discipline: string; docType: string; supplier: string; code: string; on: string; from: string; to: string };
  filterOptions: { states: Opt[]; happened: Opt[]; disciplines: Opt[]; types: Opt[]; suppliers: Opt[]; codes: Opt[]; dateFields: Opt[] };
  facets: { key: string; label: string; without: string }[];
  paging: { page: number; pages: number; perPage: number; sizes: number[]; from: number; to: number; query: string };
  sort?: { key: string; dir: "asc" | "desc" };
  exportHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  const [frozen, setFrozen] = useState(true);
  /**
   * One height for both views: what the window has left once the app's bar and
   * the two tabs above the card are counted, so that scrolled to the end the
   * tabs and the whole card are on screen together. The plan scrolls inside it,
   * as the table does.
   */
  const card = useRef<HTMLElement>(null);
  const tabs = useRef<HTMLElement>(null);
  const [fit, setFit] = useState<number>(cardHeight);
  useEffect(() => {
    const measure = () => {
      const bar = document.querySelector<HTMLElement>("[data-app-header]")?.offsetHeight ?? 0;
      const above = tabs.current ? tabs.current.offsetHeight + 16 : 0;
      setFit(Math.max(360, Math.floor(window.innerHeight - bar - above - 24)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // The order somebody dragged their columns into is this browser's business.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ORDER_KEY);
      if (raw) setOrder(JSON.parse(raw) as string[]);
      setFrozen(localStorage.getItem(FREEZE_KEY) !== "0");
    } catch {}
  }, []);
  const columns = useMemo(() => {
    if (!order) return COLUMNS;
    const byKey = new Map(COLUMNS.map((column) => [column.key, column]));
    const moved = order.map((key) => byKey.get(key)).filter((column): column is Column => !!column);
    return [...moved, ...COLUMNS.filter((column) => !order.includes(column.key))];
  }, [order]);
  const remember = (keys: string[]) => {
    setOrder(keys);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(keys)); } catch {}
  };
  /** Drop one column where another sits, by name — the menu's drag. */
  const moveTo = (label: string, before: string) => {
    const keys = columns.map((column) => column.key);
    const from = columns.findIndex((column) => column.label === label);
    const at = columns.findIndex((column) => column.label === before);
    if (from < 0 || at < 0 || from === at) return;
    const next = keys.filter((_, i) => i !== from);
    next.splice(at, 0, keys[from]);
    remember(next);
  };
  /** Move a column one place, by its name as the column menu prints it. */
  const move = (label: string, by: -1 | 1) => {
    const keys = columns.map((column) => column.key);
    const from = columns.findIndex((column) => column.label === label);
    const to = from + by;
    if (from < 0 || to < 0 || to >= keys.length) return;
    const next = [...keys];
    [next[from], next[to]] = [next[to], next[from]];
    remember(next);
  };

  /**
   * Where the reader was when they asked. Narrowing is a question about what
   * is already on the screen, so the page does not jump to the top to answer
   * it — neither the window, nor the plan's own list inside the card.
   */
  const kept = useRef<{ page: number; list: number } | null>(null);
  const go = (href: string) => {
    kept.current = {
      page: window.scrollY,
      list: card.current?.querySelector<HTMLElement>(".scroll-quiet")?.scrollTop ?? 0,
    };
    startTransition(() => router.replace(href, { scroll: false }));
  };
  const here = (params: URLSearchParams) => `/actions${params.size ? `?${params}` : ""}`;

  useEffect(() => {
    if (pending || !kept.current) return;
    const { page, list } = kept.current;
    kept.current = null;
    window.scrollTo({ top: page });
    const box = card.current?.querySelector<HTMLElement>(".scroll-quiet");
    if (box) box.scrollTop = list;
  }, [pending]);

  /** The same question, narrowed to one state — or widened back. */
  const stateHref = (code: string) => {
    const params = new URLSearchParams(paging.query);
    if (code) params.set("state", code); else params.delete("state");
    params.delete("page");
    return here(params);
  };

  /** The same question, ordered by another column. */
  const sortHref = (key: string) => {
    const params = new URLSearchParams(paging.query);
    if (sort?.key !== key) { params.set("sort", key); params.set("dir", "asc"); }
    else if (sort.dir === "asc") { params.set("sort", key); params.set("dir", "desc"); }
    else { params.delete("sort"); params.delete("dir"); }
    params.delete("page");
    return here(params);
  };
  const viewHref = (next: "plan" | "table") => {
    const params = new URLSearchParams(paging.query);
    if (next === "table") params.set("view", "table");
    else params.delete("view");
    params.delete("page");
    return here(params);
  };
  const step = (to: number) => {
    const params = new URLSearchParams(paging.query);
    if (to > 1) params.set("page", String(to));
    else params.delete("page");
    return here(params);
  };
  const sized = (per: number) => {
    const params = new URLSearchParams(paging.query);
    params.set("per", String(per));
    params.delete("page");
    return here(params);
  };

  // Apply is lit only while typed words or dates wait to be applied.
  const [dirty, setDirty] = useState(false);
  useEffect(() => setDirty(false), [filters.q, filters.on, filters.from, filters.to]);

  const pageSelected = rows.length > 0 && selected.length === rows.length;
  const selectedExportHref = allMatching || !selected.length ? exportHref : `/api/export/baseline?ids=${encodeURIComponent(selected.join(","))}`;

  return <>
    <section className="register register-sheet register-sheet-open mb-4">
      {plate}

      {/* How far the schedule has come, each stage with its revision in
          force, and the uploads for whoever plans it. */}
      <div className="border-b border-line px-5 py-5 sm:px-6">{uploads}</div>

      <form
        // Remounted whenever the answer changes, so Clear all empties the boxes
        // as well as the query: an uncontrolled select keeps whatever the
        // reader chose until React is given a reason to replace it.
        key={`${filters.q}|${filters.code}|${filters.state}|${filters.happened}|${filters.discipline}|${filters.docType}|${filters.supplier}|${filters.on}|${filters.from}|${filters.to}`}
        action="/actions"
        onSubmit={(event) => {
          event.preventDefault();
          setDirty(false);
          const data = new FormData(event.currentTarget);
          const params = new URLSearchParams();
          if (view === "table") params.set("view", "table");
          for (const [key, value] of data.entries()) if (value) params.set(key, String(value));
          go(here(params));
        }}
        onChange={(event) => { if (!(event.target as HTMLElement).dataset.instant) setDirty(true); }}
        className="asking px-5 py-3.5 pb-5 sm:px-6"
      >
        <div className="flex items-center gap-3">
          <label className="search-field relative min-w-0 flex-1">
            <span className="sr-only">Search the schedule</span>
            <Search className="absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="Search actions, their documents and people"
              title={'A space narrows, a comma widens. For example: pour clarifier  ·  A00005, A00012'}
              className="plain w-full pl-6!"
            />
          </label>
          <button className="ask" data-on={dirty ? "true" : "false"} disabled={pending}>
            {pending ? "Filtering" : "Apply"}
          </button>
        </div>

        {/* Every narrowing on one line at the width this page is read at. */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-4 lg:grid-cols-7">
          <Narrow name="code" value={filters.code} empty="Action" options={filterOptions.codes} />
          <Narrow name="state" value={filters.state} empty="State" options={filterOptions.states} />
          <Narrow name="happened" value={filters.happened} empty="Went ahead?" options={filterOptions.happened} />
          <Narrow name="discipline" value={filters.discipline} empty="Discipline" options={filterOptions.disciplines} />
          <Narrow name="docType" value={filters.docType} empty="Type" options={filterOptions.types} />
          <Narrow name="supplier" value={filters.supplier} empty="Supplier" options={filterOptions.suppliers} />
          <DateWindow fields={filterOptions.dateFields} on={filters.on} from={filters.from} to={filters.to} />
        </div>
      </form>
    </section>

    {/* The two views stand on their own between the question and the answer.
        One frame, split down the middle: the chosen side is the lit one, and
        the other is drawn as the control it is rather than left as plain text. */}
    <nav ref={tabs} className="mb-4 grid grid-cols-2 space overflow-hidden rounded-xl border border-line bg-surface" aria-label="How to look at the schedule">
      {([
        { id: "plan", label: "The plan", hint: "drawn on a timeline", icon: CalendarRange },
        { id: "table", label: "The table", hint: "one line per action", icon: Rows3 },
      ] as const).map((tab, at) => {
        const on = view === tab.id;
        return (
          <Link
            key={tab.id}
            href={viewHref(tab.id)}
            scroll={false}
            aria-current={on ? "page" : undefined}
            className={`group flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold transition ${
              at === 0 ? "border-r border-line" : ""
            } ${
              on
                ? "bg-surface text-brand-ink shadow-[inset_0_-3px_0_0_var(--color-brand)]"
                : "bg-slate-100 text-slate-600 hover:bg-surface hover:text-brand-ink shadow-[inset_0_-3px_0_0_var(--color-brand)]/20"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
            <span className={`hidden text-[11px] font-normal sm:inline ${on ? "text-slate-500" : "text-slate-500"}`}>· {tab.hint}</span>
            {/* The side you are not on is the one you can go to, so it is the
                one that carries the arrow. */}
            {on ? null : <ArrowRight className="h-3.5 w-3.5 text-slate-400 transition group-hover:translate-x-0.5" />}
          </Link>
        );
      })}
    </nav>

    <section
      ref={card}
      data-dt-frame
      className="register register-sheet flex flex-col"
      style={{ height: fit }}
    >
      {facets.length ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Showing</span>
          {facets.map((facet) => (
            <button key={`${facet.key}-${facet.label}`} type="button" onClick={() => go(facet.without)} className="facet" title="Remove this filter" aria-label={`Remove the filter ${facet.key}: ${facet.label}`}>
              <span className="facet-key">{facet.key}</span>
              <span className="font-medium">{facet.label}</span>
              <X className="h-3 w-3" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => go(view === "table" ? "/actions?view=table" : "/actions")}
            className="ml-1 inline-flex items-center gap-1 rounded-sm bg-brand px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            <X className="h-3 w-3" /> Clear all {facets.length}
          </button>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">{total.toLocaleString("en-GB")} action{total === 1 ? "" : "s"}</span>
        </div>
      ) : null}

      {view === "plan" ? (
        <div className={`flex min-h-0 flex-1 flex-col ${pending ? "opacity-60 transition-opacity" : "transition-opacity"}`}>
          {/* What the plan covers, and what its colours mean: the two things a
              reader needs before the bars, at the two corners above them. */}
          <div className="flex items-start justify-between gap-4 px-5 pt-2.5 sm:px-6">
            <span className="font-mono text-[11px] tracking-tight text-slate-500 tabular-nums">
              {more?.window && !more.window.wide ? more.window.label : filters.from || filters.to ? `${filters.from || "…"} → ${filters.to || "…"}` : "Every date in the schedule"}
            </span>
            <span
              className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px] text-slate-500"
              title="Each bar runs from the day the first document is needed to the day the work happens; the line is today. The colour says whether the register holds every document the action needs, released and at the status it asks for."
            >
              {([
                ["bg-emerald-700", "done", "DONE"],
                ["bg-violet-400", "late receipt", "LATE_RECEIPT"],
                ["bg-emerald-400", "ready", "READY"],
                ["bg-sky-500", "still ahead", "UPCOMING"],
                ["bg-amber-500", "at risk", "AT_RISK"],
                ["bg-red-500", "overdue", "NOT_READY"],
                ["bg-slate-300", "nothing listed", "UNKNOWN"],
              ] as const).map(([tone, word, code]) => {
                const on = filters.state === code;
                return (
                  /* The key is the filter: a reader who has just understood
                     what a colour means asks for that colour. */
                  <button
                    key={word}
                    type="button"
                    onClick={() => go(stateHref(on ? "" : code))}
                    aria-pressed={on}
                    title={on ? `Showing ${word} only. Click to show every state again.` : `Show ${word} only`}
                    className={`inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 transition-colors hover:bg-slate-100 hover:text-brand-ink ${on ? "bg-slate-100 font-semibold text-brand-ink" : ""}`}
                  >
                    <span className={`h-1.5 w-3 rounded-full ${tone}`} />
                    {word}
                  </button>
                );
              })}
            </span>
          </div>

          {more && !more.total ? (
            /* Nothing to draw is said, never left as an empty card: what was
               asked, and the way back to a plan with bars in it. */
            <div className="flex-1 px-6 py-20 text-center">
              <p className="font-mono text-xs tracking-[0.2em] text-slate-500 uppercase">no actions</p>
              <p className="mt-2 text-sm text-slate-700">
                {more.window && more.window.elsewhere
                  ? `Nothing dated in these days. ${more.window.elsewhere.toLocaleString("en-GB")} ${more.window.elsewhere === 1 ? "action falls" : "actions fall"} outside them.`
                  : facets.length ? "Nothing in the schedule matches these filters." : more.undated ? "Nothing dated in the schedule." : "The schedule has no actions yet."}
              </p>
              <div className="mt-3 flex items-center justify-center gap-4">
                {more.window && more.window.elsewhere ? (
                  <button type="button" onClick={() => go(more.window!.href)} className="text-xs font-semibold text-link hover:underline">Show every date →</button>
                ) : null}
                {more.undated ? (
                  <button type="button" onClick={() => go(more.undatedHref ?? viewHref("table"))} className="text-xs font-semibold text-amber-800 hover:underline">{more.undated.toLocaleString("en-GB")} with no date — in the table →</button>
                ) : null}
                {more.noNote?.count ? (
                  <button type="button" onClick={() => go(more.noNote!.href)} className="text-xs font-semibold text-red-700 hover:underline">{more.noNote.count.toLocaleString("en-GB")} went ahead with missing documents →</button>
                ) : null}
                {facets.length ? <button type="button" onClick={() => go("/actions")} className="text-xs font-semibold text-link hover:underline">Clear the {facets.length} filter{facets.length === 1 ? "" : "s"} →</button> : null}
              </div>
            </div>
          ) : plan}

          {more && more.total ? (
            <div data-dt-foot className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-line px-5 py-2.5 sm:px-6">
              {/* How much of the schedule is in front of you, and the way out of
                  the window — one line, on the left where counts are read. */}
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                <span className="font-mono tabular-nums">
                  {more.shown.toLocaleString("en-GB")}<span className="ml-1 font-sans text-slate-500">of {more.total.toLocaleString("en-GB")}</span>
                </span>
                {more.window && more.window.elsewhere ? (
                  <span className="text-amber-800">· {more.window.elsewhere.toLocaleString("en-GB")} outside these days</span>
                ) : null}
                {more.undated ? (
                  <button type="button" onClick={() => go(more.undatedHref ?? viewHref("table"))} className="text-amber-800 hover:underline" title="An action with no date has no bar; the table lists them">
                    · {more.undated.toLocaleString("en-GB")} with no date — in the table
                  </button>
                ) : null}
                {more.noNote?.count ? (
                  <button type="button" onClick={() => go(more.noNote!.href)} className="text-red-700 hover:underline" title="Across every date: their day passed without every document they needed">
                    · {more.noNote.count.toLocaleString("en-GB")} went ahead with missing documents
                  </button>
                ) : null}
                {more.window ? (
                  <button
                    type="button"
                    onClick={() => go(more.window!.href)}
                    className="rounded-md border border-line bg-surface px-2 py-0.5 font-semibold text-slate-700 transition hover:border-brand-line/50 hover:text-brand-ink"
                  >
                    {more.window.wide ? "Back to today" : "Show every date"}
                  </button>
                ) : null}
              </p>

              {more.href ? (
                <button
                  type="button"
                  onClick={() => go(more.href!)}
                  disabled={pending}
                  className="inline-flex min-w-48 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-brand-line/50 hover:text-brand-ink disabled:text-slate-500"
                >
                  {pending ? "Loading…" : `Load ${Math.min(more.step, more.total - more.shown)} more`}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              ) : <span className="text-[11px] text-slate-500">all of them drawn</span>}

              {/* How many more each press draws. */}
              <label className="flex items-center justify-end gap-1.5 leading-none">
                <span className="sr-only">How many actions to load at a time</span>
                <select
                  className="plain"
                  value={more.step}
                  onChange={(event) => {
                    const chosen = more.steps.find((one) => one.by === Number(event.target.value));
                    if (chosen) go(chosen.href);
                  }}
                >
                  {more.steps.map((one) => <option key={one.by} value={one.by}>{one.by}</option>)}
                </select>
                <span className="stencil text-slate-500">at a time</span>
              </label>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {pageSelected && total > rows.length ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-tint px-5 py-2.5 text-xs text-brand-ink sm:px-6">
              {allMatching ? (
                <>
                  <span>All <strong className="font-mono">{total.toLocaleString("en-GB")}</strong> actions these filters match are selected. Export takes all of them.</span>
                  <button type="button" onClick={() => setAllMatching(false)} className="font-semibold underline underline-offset-2">This page only</button>
                </>
              ) : (
                <>
                  <span>All <strong className="font-mono">{rows.length}</strong> on this page are selected.</span>
                  <button type="button" onClick={() => setAllMatching(true)} className="font-semibold underline underline-offset-2">Select all {total.toLocaleString("en-GB")} these filters match</button>
                </>
              )}
            </div>
          ) : null}

          <div className={`flex min-h-0 flex-1 flex-col ${pending ? "opacity-60 transition-opacity" : "transition-opacity"}`}>
            {rows.length ? (
              <DataTable
                id="actions"
                className="rounded-none border-0 shadow-none"
                defaultHidden={["Confirmed"]}
                fill
                stretch
                capHeight={fit}
                tools={
                  <a
                    href={selectedExportHref}
                    className="dt-tool"
                    title={selected.length && !allMatching ? "The actions you have ticked, with what each one needs, as CSV" : "Every action, with what each one needs, as CSV"}
                  >
                    <Download className="h-3.5 w-3.5" /> Export
                  </a>
                }
                onMove={move}
                onReorder={moveTo}
                head={
                  <tr>
                    <Th className={`rail-head ${frozen ? "sticky left-0 z-4" : ""} w-10`}>
                      <input
                        aria-label="Select every action on this page"
                        type="checkbox"
                        checked={pageSelected}
                        onChange={() => { setAllMatching(false); setSelected(pageSelected ? [] : rows.map((row) => row.id)); }}
                      />
                    </Th>
                    <Th className={`${frozen ? "sticky left-10 z-4" : ""} min-w-65`} label="Action">
                      <span className="inline-flex items-center gap-2">
                        <SortButton label="Action" on={sort?.key === "code" ? sort.dir : null} onClick={() => go(sortHref("code"))} />
                        <span className="text-slate-300">/</span>
                        <SortButton label="Name" on={sort?.key === "name" ? sort.dir : null} onClick={() => go(sortHref("name"))} />
                        {/* Freezing only ever affects this column, so it is switched here. */}
                        <button
                          type="button"
                          onClick={() => setFrozen((held) => { try { localStorage.setItem(FREEZE_KEY, held ? "0" : "1"); } catch {} return !held; })}
                          aria-pressed={frozen}
                          aria-label="Keep the action column in view while scrolling sideways"
                          title={frozen ? "This column stays in view while you scroll sideways. Click to let it scroll away." : "This column scrolls away with the rest. Click to keep it in view."}
                          className={`rounded-sm p-0.5 transition-colors hover:text-brand-ink ${frozen ? "text-slate-400" : "text-slate-300"}`}
                        >
                          {frozen ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
                        </button>
                      </span>
                    </Th>
                    {columns.map((column) => (
                      <Th key={column.key} label={column.label} className={column.headClass} sorted={column.sort && sort?.key === column.sort ? sort.dir : null}>
                        <span className="inline-flex items-center gap-1">
                          {column.sort
                            ? <SortButton label={column.label} on={sort?.key === column.sort ? sort.dir : null} onClick={() => go(sortHref(column.sort!))} />
                            : column.label}
                          {column.note ? <Info>{column.note}</Info> : null}
                        </span>
                      </Th>
                    ))}
                  </tr>
                }
              >
                {rows.map((row) => {
                  const on = selected.includes(row.id);
                  return (
                    <tr key={row.id} className={on ? "[&>td]:bg-tint" : undefined}>
                      <Td className={`rail ${RAIL[row.readiness]} ${frozen ? "sticky left-0 z-1" : ""} ${on ? "bg-tint" : "bg-surface"}`}>
                        <input
                          aria-label={`Select action ${row.code}`}
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            setAllMatching(false);
                            setSelected((held) => held.includes(row.id) ? held.filter((one) => one !== row.id) : [...held, row.id]);
                          }}
                        />
                      </Td>
                      <Td className={`${frozen ? "sticky left-10 z-1" : ""} min-w-65 ${on ? "bg-tint" : "bg-surface"}`}>
                        <Link href={`/actions/${row.code}`} className="doc-number">{row.code}</Link>
                        {row.plannerId ? <span className="ml-1.5 font-mono text-[11px] text-slate-500" title="The planner's ID in the schedule file">{row.plannerId}</span> : null}
                        {row.moved ? <span className="stamp ml-2 text-amber-700" title={row.moved}>moved</span> : null}
                        <span className="doc-title block max-w-80 truncate" title={row.name}>{row.name}</span>
                      </Td>
                      {columns.map((column) => <Td key={column.key} className={column.cellClass}>{column.cell(row)}</Td>)}
                    </tr>
                  );
                })}
              </DataTable>
            ) : (
              <div className="px-6 py-20 text-center">
                <p className="font-mono text-xs tracking-[0.2em] text-slate-500 uppercase">no actions</p>
                <p className="mt-2 text-sm text-slate-700">Nothing in the schedule matches these filters.</p>
                {facets.length ? <button type="button" onClick={() => go("/actions?view=table")} className="mt-3 text-xs font-semibold text-link hover:underline">Clear the {facets.length} filter{facets.length === 1 ? "" : "s"} →</button> : null}
              </div>
            )}
          </div>

          {total > 0 ? (
            <div data-dt-foot className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-line px-5 py-2.5 sm:px-6">
              <p className="font-mono text-[11px] tabular-nums text-slate-500">
                {paging.from.toLocaleString("en-GB")}–{paging.to.toLocaleString("en-GB")}
                <span className="ml-1.5 font-sans text-slate-500">of {total.toLocaleString("en-GB")}</span>
              </p>
              {paging.pages > 1 ? (
                <span className="flex items-center gap-2">
                  <PageStep onClick={() => go(step(paging.page - 1))} disabled={paging.page === 1} label="Previous page"><ChevronLeft className="h-4 w-4" /></PageStep>
                  <span className="font-mono text-[11px] tabular-nums text-slate-500">{paging.page} of {paging.pages}</span>
                  <PageStep onClick={() => go(step(paging.page + 1))} disabled={paging.page === paging.pages} label="Next page"><ChevronRight className="h-4 w-4" /></PageStep>
                </span>
              ) : <span />}
              <label className="flex items-center justify-end gap-1.5">
                <span className="stencil text-slate-500">Rows</span>
                <select className="plain" value={paging.perPage} onChange={(event) => go(sized(Number(event.target.value)))}>
                  {paging.sizes.map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      )}
    </section>
  </>;
}

/** One narrowing choice, drawn as the register draws them. */
function Narrow({ name, value, empty, options }: { name: string; value: string; empty: string; options: Opt[] }) {
  // A choice made with the pointer applies at once, like the colour key. One
  // made with the keyboard applies on leaving the box, so stepping through the
  // options with the arrow keys does not reload the page at every step.
  const pointer = useRef(false);
  const waiting = useRef(false);
  return (
    <label className="min-w-0 flex-1">
      <span className="sr-only">{empty}</span>
      <select
        name={name}
        defaultValue={value}
        data-on={value ? "true" : "false"}
        data-instant="true"
        className="plain w-full"
        onPointerDown={() => { pointer.current = true; }}
        onKeyDown={() => { pointer.current = false; }}
        onChange={(event) => {
          if (pointer.current) event.currentTarget.form?.requestSubmit();
          else waiting.current = true;
        }}
        onBlur={(event) => {
          if (!waiting.current) return;
          waiting.current = false;
          event.currentTarget.form?.requestSubmit();
        }}
      >
        <option value="">{empty}</option>
        {options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
      </select>
    </label>
  );
}

/** One step through the register. A step that leads nowhere is shown, and dead. */
function PageStep({ onClick, disabled, label, children }: { onClick: () => void; disabled: boolean; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-sm p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-ink disabled:cursor-default disabled:text-slate-300 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** Where this browser keeps the order its reader dragged the columns into. */
const ORDER_KEY = "actions:columns";


/** Whether the reader keeps the action in view while scrolling sideways. */
const FREEZE_KEY = "actions:freeze";

type Column = {
  key: string;
  label: string;
  sort?: string;
  note?: string;
  headClass?: string;
  cellClass?: string;
  cell: (row: PlanTableRow) => React.ReactNode;
};

/**
 * The rail down the left of a row, in the colour of the state that row is in —
 * the same five colours the plan draws its bars in, and the same rail the
 * register and the dispatch log carry.
 */
const RAIL: Record<PlanTableRow["readiness"], string> = {
  DONE: "rail-done",
  LATE_RECEIPT: "rail-superseded",
  READY: "rail-ready",
  UPCOMING: "rail-review",
  AT_RISK: "rail-prep",
  NOT_READY: "rail-void",
  UNKNOWN: "rail-none",
};

const READINESS: Record<PlanTableRow["readiness"], { label: string; chip: string }> = {
  DONE: { label: "Done", chip: "bg-emerald-600/10 text-emerald-900 ring-emerald-300" },
  LATE_RECEIPT: { label: "Late receipt", chip: "bg-violet-100 text-violet-800 ring-violet-300" },
  READY: { label: "Ready", chip: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  UPCOMING: { label: "Still ahead", chip: "bg-sky-100 text-sky-800 ring-sky-200" },
  AT_RISK: { label: "At risk", chip: "bg-amber-100 text-amber-800 ring-amber-200" },
  NOT_READY: { label: "Overdue", chip: "bg-red-100 text-red-800 ring-red-200" },
  UNKNOWN: { label: "Nothing listed", chip: "bg-slate-100 text-slate-600 ring-slate-200" },
};

const HAPPENED: Record<PlanTableRow["happened"], { label: string; chip: string }> = {
  POSTPONED: { label: "Postponed", chip: "bg-slate-100 text-slate-700 ring-slate-300" },
  CARRIED: { label: "Missing documents", chip: "bg-amber-100 text-amber-900 ring-amber-300" },
  DONE: { label: "With documents", chip: "bg-emerald-600/10 text-emerald-900 ring-emerald-300" },
  AHEAD: { label: "Not yet", chip: "bg-sky-50 text-sky-800 ring-sky-200" },
};

/** The columns, in the order they start in. */
const COLUMNS: Column[] = [
  {
    key: "departments", label: "Disciplines",
    note: "The disciplines this action is tagged with, from the disciplines-per-action list. They are the ones asked what it needs.",
    cell: (row) => row.departments.length
      ? <span className="block max-w-56 text-xs text-slate-700">{row.departments.join(", ")}</span>
      : <span className="text-xs font-semibold text-amber-700">needs disciplines</span>,
  },
  {
    key: "readiness", label: "State",
    note: "Every state is about one thing: does the register hold a released revision of each listed document, at the status the action needs? Done — the day has passed and it did, in time. Late receipt — everything arrived, but the last of it after the day of the work. Ready — the day is today or ahead and it does. Still ahead — the day is ahead and nothing is owed within the week. At risk — a document is owed within a week, or already. Overdue — the day has passed and something is still missing.",
    cellClass: "whitespace-nowrap",
    cell: (row) => <Chip className={READINESS[row.readiness].chip}>{READINESS[row.readiness].label}</Chip>,
  },
  {
    key: "happened", label: "Went ahead?",
    note: "Once the day has passed: With documents — it had everything it needed, in time. Missing documents — it went ahead without all of them; each discipline that confirmed going ahead said why. Postponed — Document Control wrote down that it did not happen. Before the day: not yet.",
    cellClass: "whitespace-nowrap",
    // Before the day there is nothing to say: the column stays quiet.
    cell: (row) => row.happened === "AHEAD" ? <span className="text-xs text-slate-400">—</span> : (
      <span className="inline-flex flex-col items-start gap-1">
        <Chip className={HAPPENED[row.happened].chip}>{HAPPENED[row.happened].label}</Chip>
        <span className="text-[11px] text-slate-500">{row.happenedNote}</span>
      </span>
    ),
  },
  {
    key: "date", label: "Date", sort: "date",
    headClass: "text-right", cellClass: "whitespace-nowrap text-right text-xs tabular-nums",
    cell: (row) => row.date
      ? <>
          <span className="text-xs font-medium text-slate-800">{row.date}{row.finish ? ` → ${row.finish}` : ""}</span>
          <span className={`block font-sans text-[11px] ${row.late ? "text-red-600" : "text-slate-500"}`}>
            {row.when}{row.days ? ` · ${row.days} day${row.days === 1 ? "" : "s"}` : ""}
          </span>
        </>
      : <span className="text-slate-300">—</span>,
  },
  {
    key: "ready", label: "Ready", sort: "documents",
    note: "How many of the documents this action needs are at the status it needs.",
    headClass: "text-right", cellClass: "whitespace-nowrap text-right",
    cell: (row) => row.total
      ? <span className="inline-flex flex-col items-end gap-1">
          <span className="text-xs font-semibold tabular-nums text-slate-800">{row.ready}<span className="font-normal text-slate-500"> / {row.total}</span></span>
          <span className="h-1 w-14 overflow-hidden rounded-full bg-slate-100">
            <span
              className={`block h-full rounded-full ${row.ready === row.total ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ width: row.ready ? `${Math.max(Math.round((row.ready / row.total) * 100), 4)}%` : "0%" }}
            />
          </span>
        </span>
      : <span className="text-xs text-slate-300">—</span>,
  },
  {
    key: "nextDue", label: "Next due",
    note: "The earliest day a document still missing is needed.",
    headClass: "text-right", cellClass: "whitespace-nowrap text-right text-xs tabular-nums",
    cell: (row) => row.nextNeeded
      ? <span className={row.nextOverdue ? "font-semibold text-red-600" : "text-slate-600"}>{row.nextNeeded}</span>
      : <span className="text-slate-300">—</span>,
  },
  {
    key: "missing", label: "Still missing", cellClass: "min-w-60",
    cell: (row) => row.missing.length
      ? <ul className="space-y-1">
          {row.missing.slice(0, 3).map((one) => (
            <li key={one.docNumber} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="whitespace-nowrap font-mono text-[11px] font-semibold text-slate-700">{one.docNumber}</span>
              <span className="whitespace-nowrap rounded bg-amber-100 px-1 py-px text-[10px] font-bold text-amber-800" title={`Needs status ${one.status}`}>needs {one.status}</span>
            </li>
          ))}
          {row.missing.length > 3 ? <li><Link href={`/actions/${row.code}`} className="text-[11px] font-semibold text-link hover:underline">+{row.missing.length - 3} more</Link></li> : null}
        </ul>
      : row.total === 0
        ? <span className="text-xs text-slate-500">Nothing listed yet</span>
        : <span className="text-xs font-medium text-emerald-700">Nothing missing</span>,
  },
  {
    key: "confirmed", label: "Confirmed",
    note: "Whether each discipline has confirmed it has what it needs, in the days before the action.",
    cellClass: "whitespace-nowrap text-xs",
    cell: (row) => (
      <span className={row.confirmedTone === "good" ? "font-semibold text-emerald-700" : row.confirmedTone === "bad" ? "font-semibold text-red-700" : "text-slate-500"}>
        {row.confirmed}
      </span>
    ),
  },
];

/** The arrow that says a column can be ordered. Dim until it is used. */
function SortButton({ label, on, onClick }: { label: string; on: "asc" | "desc" | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 uppercase tracking-[inherit] transition-colors hover:text-brand-ink"
      title={on ? (on === "asc" ? "Sorted first to last. Click to reverse." : "Sorted last to first. Click to clear.") : `Sort by ${label.toLowerCase()}`}
    >
      {label}
      <span className="sort-mark" data-on={on ? "true" : "false"}>
        {on === "asc" ? <ArrowUp className="h-3 w-3 text-brand-ink" /> : on === "desc" ? <ArrowDown className="h-3 w-3 text-brand-ink" /> : <ArrowUpDown className="h-3 w-3" />}
      </span>
    </button>
  );
}
