"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Pin, PinOff, Search, X } from "lucide-react";
import { DataTable, Th, Td, Chip, Info } from "@/components/ui";
import { useCardHeight } from "@/components/card-height";
import { DateWindow } from "@/components/date-window";

/**
 * The reviews register.
 *
 * The same instrument as the document register and the dispatch log: a sheet
 * that holds the question — the search, the narrowing choices, what is being
 * asked — and a second sheet that holds the answer. Rows can be ticked, and
 * what is ticked is what the export writes.
 */
export type ReviewRow = {
  /** The route this review runs, and the time the whole of it was given. */
  routeName?: string | null;
  routeDays?: number | null;
  routeDueAt?: string | null;
  routeDueState?: "none" | "on time" | "at risk" | "overdue";
  /** Every comment on the revision, from any of its reviews. */
  comments?: { by: string; text: string; blocking: boolean; settled: boolean; review: string | null }[];
  id: string;
  number: string | null;
  documentId: string;
  docNumber: string;
  title: string;
  revision: string;
  kind: "decision" | "advice" | "client review";
  verdict: string | null;
  verdictLabel: string | null;
  verdictProceeds: boolean | null;
  decidedBy: string | null;
  open: boolean;
  reviewers: { name: string; done: boolean }[];
  doneCount: number;
  dueAt: string | null;
  dueState: string;
  notifyHref: string | null;
  warnedAt: string | null;
  openedAt: string;
  openedBy: string | null;
  closedAt: string | null;
  discipline: string;
  docType: string;
  producedBy: string;
  from: string | null;
  contract: string | null;
  receivedAt: string | null;
  receivedFrom: string | null;
};

type Opt = { code: string; label: string };

export function ReviewsRegister({ plate, rows, total, filters, filterOptions, facets, paging, sort, exportHref }: {
  plate: React.ReactNode;
  rows: ReviewRow[];
  total: number;
  filters: { q: string; status: string; kind: string; verdict: string; due: string; discipline: string; docType: string; supplier: string; po: string; deliverable: string; on: string; from: string; to: string };
  filterOptions: { statuses: Opt[]; kinds: Opt[]; verdicts: Opt[]; dues: Opt[]; disciplines: Opt[]; types: Opt[]; suppliers: Opt[]; pos: Opt[]; deliverables: Opt[]; dateFields: Opt[] };
  facets: { key: string; label: string; without: string }[];
  paging: { page: number; pages: number; perPage: number; sizes: number[]; from: number; to: number; query: string };
  sort?: { key: string; dir: "asc" | "desc" };
  exportHref: string;
}) {
  const router = useRouter();
  // Every register is the height the schedule's plan set.
  const cardHeight = useCardHeight();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  const [frozen, setFrozen] = useState(true);

  // The order somebody dragged their columns into is this browser's business,
  // not the register's.
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

  /** The same question, ordered by another column. */
  const sortHref = (key: string) => {
    const params = new URLSearchParams(paging.query);
    if (sort?.key !== key) { params.set("sort", key); params.set("dir", "asc"); }
    else if (sort.dir === "asc") { params.set("sort", key); params.set("dir", "desc"); }
    else { params.delete("sort"); params.delete("dir"); }
    params.delete("page");
    return `/reviews${params.size ? `?${params}` : ""}`;
  };

  const go = (href: string) => startTransition(() => router.replace(href, { scroll: false }));
  const pageSelected = rows.length > 0 && selected.length === rows.length;
  const selectedExportHref = allMatching || !selected.length ? exportHref : `/api/export/reviews?ids=${encodeURIComponent(selected.join(","))}`;

  const step = (to: number) => {
    const params = new URLSearchParams(paging.query);
    if (to > 1) params.set("page", String(to));
    else params.delete("page");
    return `/reviews${params.size ? `?${params}` : ""}`;
  };
  const sized = (per: number) => {
    const params = new URLSearchParams(paging.query);
    params.set("per", String(per));
    params.delete("page");
    return `/reviews?${params}`;
  };

  const verdicts = useMemo(() => filterOptions.verdicts, [filterOptions.verdicts]);

  return <>
    <section className="register register-sheet register-sheet-open mb-5">
      {plate}

      <form
        action="/reviews"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const params = new URLSearchParams();
          for (const [key, value] of data.entries()) if (value) params.set(key, String(value));
          go(`/reviews${params.size ? `?${params}` : ""}`);
        }}
        className="asking px-5 py-3.5 pb-5 sm:px-6"
      >
        <div className="flex items-center gap-3">
          <label className="search-field relative min-w-0 flex-1">
            <span className="sr-only">Search the reviews</span>
            <Search className="absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              name="q"
              defaultValue={filters.q}
              placeholder={'A space narrows, a comma widens: pump ME  ·  RV-0021, RV-0034  ·  "feed pump"'}
              className="plain w-full py-2! pl-6! text-[13.5px]!"
            />
          </label>
          <button className="ask" data-on={facets.length ? "true" : "false"} disabled={pending}>
            {pending ? "Filtering" : "Apply"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-3 md:grid-cols-5">
          <Narrow name="status" value={filters.status} empty="Review state" options={filterOptions.statuses} />
          <Narrow name="kind" value={filters.kind} empty="Kind" options={filterOptions.kinds} />
          <Narrow name="verdict" value={filters.verdict} empty="Verdict" options={verdicts} />
          <Narrow name="due" value={filters.due} empty="Due" options={filterOptions.dues} />
          <Narrow name="discipline" value={filters.discipline} empty="Discipline" options={filterOptions.disciplines} />
          <Narrow name="docType" value={filters.docType} empty="Type" options={filterOptions.types} />
          <Narrow name="supplier" value={filters.supplier} empty="Supplier" options={filterOptions.suppliers} />
          <Narrow name="po" value={filters.po} empty="Contract / PO" options={filterOptions.pos} />
          <Narrow name="deliverable" value={filters.deliverable} empty="Produced by" options={filterOptions.deliverables} />
          <DateWindow fields={filterOptions.dateFields} on={filters.on} from={filters.from} to={filters.to} />
        </div>
      </form>
    </section>

    <section
      data-dt-frame
      className={`register register-sheet ${cardHeight ? "flex flex-col" : ""}`}
      style={cardHeight ? { height: cardHeight } : undefined}
    >
      {facets.length ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
          <span className="stencil mr-1 text-slate-400">Showing</span>
          {facets.map((facet) => (
            <button key={`${facet.key}-${facet.label}`} type="button" onClick={() => go(facet.without)} className="facet" title="Remove this filter">
              <span className="facet-key">{facet.key}</span>
              <span className="font-medium">{facet.label}</span>
              <X className="h-3 w-3" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => go("/reviews")}
            className="ml-1 inline-flex items-center gap-1 rounded-sm bg-brand px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            <X className="h-3 w-3" /> Clear all {facets.length}
          </button>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">{total.toLocaleString("en-GB")} match{total === 1 ? "" : "es"}</span>
        </div>
      ) : null}

      {pageSelected && total > rows.length ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-tint px-5 py-2.5 text-xs text-brand-ink sm:px-6">
          {allMatching ? (
            <>
              <span>All <strong className="font-mono">{total.toLocaleString("en-GB")}</strong> reviews these filters match are selected. Export takes all of them.</span>
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

      <div className={`${cardHeight ? "flex min-h-0 flex-1 flex-col" : ""} ${pending ? "opacity-60 transition-opacity" : "transition-opacity"}`}>
        {rows.length ? (
          <DataTable
            id="reviews"
            className="rounded-none border-0 shadow-none"
            defaultHidden={["Opened by", "Closed", "Produced by", "Contract", "Type", "Comments"]}
            fill
            stretch={!!cardHeight}
            tools={
              <a
                href={selectedExportHref}
                className="dt-tool"
                title={selected.length && !allMatching ? "The reviews you have ticked, as CSV" : "Every review these filters match, as CSV"}
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
                    aria-label="Select every review on this page"
                    type="checkbox"
                    checked={pageSelected}
                    onChange={() => { setAllMatching(false); setSelected(pageSelected ? [] : rows.map((row) => row.id)); }}
                  />
                </Th>
                <Th className={`${frozen ? "sticky left-10 z-4" : ""} min-w-60`} label="Review">
                  <span className="inline-flex items-center gap-2">
                    <SortButton label="Review" on={sort?.key === "number" ? sort.dir : null} onClick={() => go(sortHref("number"))} />
                    <span className="text-slate-300">/</span>
                    <SortButton label="Document" on={sort?.key === "document" ? sort.dir : null} onClick={() => go(sortHref("document"))} />
                    {/* Freezing only ever affects this column, so it is switched here. */}
                    <button
                      type="button"
                      onClick={() => setFrozen((held) => { try { localStorage.setItem(FREEZE_KEY, held ? "0" : "1"); } catch {} return !held; })}
                      aria-pressed={frozen}
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
                  <Td className={`rail ${railFor(row)} ${frozen ? "sticky left-0 z-1" : ""} ${on ? "bg-tint" : "bg-surface"}`}>
                    <input
                      aria-label={`Select review ${row.number ?? row.docNumber}`}
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        setAllMatching(false);
                        setSelected((held) => held.includes(row.id) ? held.filter((one) => one !== row.id) : [...held, row.id]);
                      }}
                    />
                  </Td>
                  <Td className={`${frozen ? "sticky left-10 z-1" : ""} min-w-60 ${on ? "bg-tint" : "bg-surface"}`}>
                    <span className="flex items-baseline gap-2">
                      <Link href={`/reviews/${row.id}`} className="doc-number">{row.number ?? "—"}</Link>
                      <Link href={`/documents/${row.documentId}`} className="doc-number text-slate-500">{row.docNumber}</Link>
                    </span>
                    <span className="doc-title block max-w-72 truncate" title={row.title}>{row.title}</span>
                  </Td>
                  {columns.map((column) => <Td key={column.key} className={column.cellClass}>{column.cell(row)}</Td>)}
                </tr>
              );
            })}
          </DataTable>
        ) : (
          <div className="px-6 py-20 text-center">
            <p className="font-mono text-xs tracking-[0.2em] text-slate-400 uppercase">no reviews</p>
            <p className="mt-2 text-sm text-slate-700">Nothing in the reviews matches these filters.</p>
            {facets.length ? <button type="button" onClick={() => go("/reviews")} className="mt-3 text-xs font-semibold text-link hover:underline">Clear the {facets.length} filter{facets.length === 1 ? "" : "s"} →</button> : null}
          </div>
        )}
      </div>

      {total > 0 ? (
        <div data-dt-foot className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-line px-5 py-2.5 sm:px-6">
          <p className="font-mono text-[11px] tabular-nums text-slate-500">
            {paging.from.toLocaleString("en-GB")}–{paging.to.toLocaleString("en-GB")}
            <span className="ml-1.5 font-sans text-slate-400">of {total.toLocaleString("en-GB")}</span>
          </p>
          {paging.pages > 1 ? (
            <span className="flex items-center gap-2">
              <PageStep onClick={() => go(step(paging.page - 1))} disabled={paging.page === 1} label="Previous page"><ChevronLeft className="h-4 w-4" /></PageStep>
              <span className="font-mono text-[11px] tabular-nums text-slate-500">{paging.page} of {paging.pages}</span>
              <PageStep onClick={() => go(step(paging.page + 1))} disabled={paging.page === paging.pages} label="Next page"><ChevronRight className="h-4 w-4" /></PageStep>
            </span>
          ) : <span />}
          <label className="flex items-center justify-end gap-1.5">
            <span className="stencil text-slate-400">Rows</span>
            <select className="plain" value={paging.perPage} onChange={(event) => go(sized(Number(event.target.value)))}>
              {paging.sizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>
      ) : null}
    </section>
  </>;
}

/** One narrowing choice, drawn as the register draws them. */
function Narrow({ name, value, empty, options }: { name: string; value: string; empty: string; options: Opt[] }) {
  return (
    <label className="min-w-0 flex-1">
      <span className="sr-only">{empty}</span>
      <select name={name} defaultValue={value} data-on={value ? "true" : "false"} className="plain w-full">
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

/**
 * The rail down the left of a row, in the colour of where the step stands: open
 * and late, open and near, open, or answered by a verdict that proceeds or does
 * not. The register and the dispatch log carry the same rail, so a row reads
 * the same way on all three.
 */
function railFor(row: ReviewRow): string {
  if (row.open) return row.dueState === "overdue" ? "rail-void" : row.dueState === "at risk" ? "rail-prep" : "rail-review";
  if (row.verdictProceeds === false) return "rail-void";
  return "rail-released";
}

/** Where this browser keeps the order its reader dragged the columns into. */
const ORDER_KEY = "reviews:columns";

/** Whether the reader keeps the review and its document in view. */
const FREEZE_KEY = "reviews:freeze";

type Column = {
  key: string;
  label: string;
  sort?: string;
  note?: string;
  headClass?: string;
  cellClass?: string;
  cell: (row: ReviewRow) => React.ReactNode;
};

/** The columns, in the order they start in. */
const COLUMNS: Column[] = [
  { key: "revision", label: "Rev", sort: "rev", cellClass: "font-mono text-xs font-semibold text-slate-800", cell: (row) => row.revision },
  {
    key: "kind", label: "Kind", sort: "kind",
    note: "A decision is the last step of a route and releases the revision or sends it back. Advice is any earlier step. A client review happens after we released it, and is answered by a new revision.",
    cellClass: "whitespace-nowrap",
    cell: (row) => (
      <Chip className={row.kind === "client review" ? "bg-violet-100 text-violet-800 ring-violet-300" : row.kind === "decision" ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : "bg-sky-100 text-sky-800 ring-sky-300"}>
        {row.kind}
      </Chip>
    ),
  },
  {
    key: "verdict", label: "Verdict", sort: "verdict",
    note: "On a decision, the code the decider gave. On an advisory step, what that person's comments amounted to — advisers are not asked for a code.",
    cellClass: "whitespace-nowrap text-xs",
    cell: (row) =>
      row.verdict || row.verdictLabel ? (
        <span className={row.verdictProceeds === null ? "text-slate-600" : row.verdictProceeds ? "text-emerald-700" : "text-red-700"}>
          {row.verdict ? <span className="code-chip">{row.verdict}</span> : null}
          {row.verdictLabel && row.verdictLabel !== row.verdict ? <span className={row.verdict ? "ml-1.5" : ""}>{row.verdictLabel}</span> : null}
          {row.decidedBy ? <span className="block text-[11px] text-slate-400">{row.decidedBy}</span> : null}
        </span>
      ) : row.open ? <span className="text-amber-700">waiting</span> : <span className="text-slate-300">—</span>,
  },
  {
    key: "reviewers", label: "Reviewers",
    cellClass: "text-xs",
    cell: (row) => (
      <>
        {row.reviewers.length
          ? <span title={row.reviewers.map((one) => `${one.done ? "✓" : "○"} ${one.name}`).join("\n")}>{row.reviewers.map((one) => one.name).join(", ")}</span>
          : <span className="text-slate-400">unassigned</span>}
        {row.open && row.reviewers.length > 1 ? <span className="block text-[11px] text-slate-400">{row.doneCount} of {row.reviewers.length} done</span> : null}
      </>
    ),
  },
  {
    key: "due", label: "Step due", sort: "due",
    note: "When this step has to be answered. It comes from the working days the route gives this step — not the whole review.",
    headClass: "text-right", cellClass: "whitespace-nowrap text-right text-xs tabular-nums",
    cell: (row) =>
      row.dueAt ? (
        <>
          <span className={row.dueState === "overdue" ? "font-semibold text-red-700" : row.dueState === "at risk" ? "font-semibold text-amber-700" : "text-slate-500"}>{row.dueAt}</span>
          <span className={`block font-sans text-[11px] ${row.dueState === "overdue" ? "text-red-600" : row.dueState === "at risk" ? "text-amber-700" : "text-slate-400"}`}>
            {row.open ? row.dueState : "answered"}
          </span>
          {row.notifyHref ? <Link href={row.notifyHref} className="mt-0.5 block font-sans text-[11px] font-semibold text-link hover:underline">Notify</Link> : null}
          {row.warnedAt ? <span className="block font-sans text-[10px] text-slate-400">warned {row.warnedAt}</span> : null}
        </>
      ) : <span className="text-slate-300" title="The route gives this step no time limit">—</span>,
  },
  {
    key: "routeDue", label: "Review due",
    note: "When the whole route is due: every step's working days added up, counted from the day it went out. The step above is only this step.",
    headClass: "text-right", cellClass: "whitespace-nowrap text-right text-xs tabular-nums",
    cell: (row) =>
      row.routeDueAt ? (
        <>
          <span className={row.routeDueState === "overdue" ? "font-semibold text-red-700" : row.routeDueState === "at risk" ? "font-semibold text-amber-700" : "text-slate-500"}>{row.routeDueAt}</span>
          <span className="block font-sans text-[11px] text-slate-400">
            {row.routeDays} working day{row.routeDays === 1 ? "" : "s"}{row.routeName ? ` · ${row.routeName}` : ""}
          </span>
        </>
      ) : (
        <span className="text-slate-300" title={row.routeName ? `${row.routeName} gives its steps no time limits` : "No route behind this review"}>—</span>
      ),
  },
  { key: "opened", label: "Opened", sort: "opened", headClass: "text-right", cellClass: "whitespace-nowrap text-right text-xs tabular-nums text-slate-500", cell: (row) => row.openedAt },
  { key: "openedBy", label: "Opened by", cellClass: "whitespace-nowrap text-xs text-slate-500", cell: (row) => row.openedBy ?? <span className="text-slate-300">·</span> },
  { key: "closed", label: "Closed", sort: "closed", headClass: "text-right", cellClass: "whitespace-nowrap text-right text-xs tabular-nums text-slate-500", cell: (row) => row.closedAt ?? <span className="text-slate-300">·</span> },
  { key: "discipline", label: "Discipline", sort: "discipline", cellClass: "whitespace-nowrap text-xs text-slate-600", cell: (row) => row.discipline },
  { key: "docType", label: "Type", sort: "docType", cellClass: "max-w-40 truncate text-xs text-slate-600", cell: (row) => row.docType },
  { key: "producedBy", label: "Produced by", cellClass: "whitespace-nowrap text-xs text-slate-600", cell: (row) => row.producedBy },
  { key: "from", label: "From", note: "The party the document came from. Blank when our own engineering produced it.", cellClass: "whitespace-nowrap text-xs text-slate-600", cell: (row) => row.from ?? <span className="text-slate-300">·</span> },
  { key: "contract", label: "Contract", cellClass: "whitespace-nowrap font-mono text-xs text-slate-700", cell: (row) => row.contract ?? <span className="text-slate-300">·</span> },
  {
    key: "comments", label: "Comments",
    note: "Every comment made on this revision, in any of its reviews — what goes back to whoever sent the document.",
    cellClass: "min-w-72 max-w-md text-xs text-slate-600",
    cell: (row) => row.comments?.length ? (
      <ul className="space-y-1">
        {row.comments.map((one, i) => (
          <li key={i} className={one.blocking && !one.settled ? "text-red-700" : undefined}>
            <span className="font-semibold">{one.by}</span>{one.review ? <span className="text-slate-400"> · {one.review}</span> : null}{one.blocking ? <span className="text-[10px] uppercase tracking-wide"> · blocking{one.settled ? ", settled" : ""}</span> : null}: {one.text}
          </li>
        ))}
      </ul>
    ) : <span className="text-slate-300">·</span>,
  },
  {
    key: "received", label: "Received",
    note: "The day this revision reached us — the day its submission arrived, or the date recorded on the document when it came from outside.",
    headClass: "text-right", cellClass: "whitespace-nowrap text-right text-xs tabular-nums text-slate-500",
    cell: (row) => row.receivedAt
      ? <>{row.receivedAt}{row.receivedFrom ? <span className="block font-sans text-[11px] text-slate-400">{row.receivedFrom}</span> : null}</>
      : <span className="text-slate-300">·</span>,
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
