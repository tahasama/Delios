"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Pin, PinOff, Search, X } from "lucide-react";
import { DataTable, Th, Td, Chip, Info } from "@/components/ui";
import { useCardHeight } from "@/components/card-height";

/**
 * One required document, and where its time went.
 *
 * The register's own instrument, because this is the same kind of reading: a
 * question sheet above and an answer sheet below, a row per document, a rail in
 * the colour of where it stands, columns that sort, hide, move and freeze, rows
 * that can be ticked and taken away as a file, and only the rows scrolling.
 *
 * The delay is columns rather than a sentence under the table. A document is
 * late at one step, and the steps after it inherit that delay rather than own
 * it, so the row names the step that slipped, the day it happened, the deadline
 * it was measured against and that deadline's date. The whole chain is here
 * too, in columns held back in the column menu, so nothing is lost to somebody
 * who asks for it.
 *
 * The narrowing happens in this browser rather than in the address: an action
 * asks for a few dozen documents at most, so the page is not reloaded to look
 * at a subset of what it already holds.
 */
export type Moment = {
  name: string;
  deadline: string;
  at: string | null;
  /** The day it was due, and the day it happened, as numbers that sort. */
  atSort: number | null;
  due: string | null;
  late: boolean;
  owedBy: string;
};

export type NeededRow = {
  id: string;
  documentId: string;
  docNumber: string;
  title: string;
  discipline: string;
  from: string;
  approvedBy: string;
  requiredStatus: string;
  submitBy: string;
  submitBySort: number;
  submitNote: string;
  has: string;
  ready: boolean;
  late: boolean;
  outstanding: boolean;
  /** The step that slipped first, and what it was judged against. */
  source: string | null;
  sourceAt: string | null;
  sourceAtSort: number | null;
  deadline: string | null;
  due: string | null;
  dueSort: number | null;
  owedBy: string | null;
  /** Every checkpoint, in order: the evidence the columns summarise. */
  chain: Moment[];
};

/** What a row's left edge says: ready, late, still owed, or on its way. */
function railFor(row: NeededRow): string {
  if (row.ready) return "rail-released";
  if (row.late) return "rail-void";
  if (row.outstanding) return "rail-prep";
  return "rail-review";
}

/** Where this browser keeps the order its reader dragged the columns into. */
const ORDER_KEY = "action-needed:columns";
/** Whether the reader keeps the document in view while scrolling sideways. */
const FREEZE_KEY = "action-needed:freeze";
/** How many rows at a time, as the registers offer them. */
const SIZES = [10, 25, 50, 100];

type Column = {
  key: string;
  label: string;
  /** How this column orders rows. A column with no answer does not sort. */
  by?: (row: NeededRow) => string | number | null;
  note?: string;
  cellClass?: string;
  headClass?: string;
  cell: (row: NeededRow) => React.ReactNode;
};

/** A day that never came sorts after every day that did. */
const LAST = Number.MAX_SAFE_INTEGER;

const COLUMNS: Column[] = [
  {
    key: "source",
    label: "Where it got late",
    by: (row) => row.source ?? (row.outstanding ? "zz" : "zzz"),
    note: "The first step of the document's way that ran late: sent for review (or sent in by the supplier), a review step, released, or issued. The steps after it only inherit the delay.",
    cellClass: "whitespace-nowrap text-xs",
    cell: (row) => row.source ? (
      <>
        <span className="font-semibold text-red-700">{row.source}</span>
        <span className="block text-[11px] text-slate-500">owed by {row.owedBy}</span>
      </>
    ) : row.outstanding ? (
      <>
        <span className="font-semibold text-amber-700">Still not released &amp; issued</span>
        <span className="block text-[11px] text-slate-500">owed by {row.owedBy}</span>
      </>
    ) : <span className="text-slate-400">&mdash;</span>,
  },
  {
    key: "happened",
    label: "Happened",
    by: (row) => row.sourceAtSort ?? LAST,
    cellClass: "whitespace-nowrap font-mono text-xs tabular-nums",
    cell: (row) => row.sourceAt ?? <span className="font-sans text-slate-500">not yet</span>,
  },
  {
    key: "deadline",
    label: "Deadline",
    by: (row) => row.deadline ?? "",
    note: "Which deadline that step was measured against.",
    cellClass: "whitespace-nowrap text-xs text-slate-500",
    cell: (row) => row.deadline ?? <span className="text-slate-400">&mdash;</span>,
  },
  {
    key: "due",
    label: "Due",
    by: (row) => row.dueSort ?? LAST,
    cellClass: "whitespace-nowrap font-mono text-xs tabular-nums",
    cell: (row) => row.due ?? <span className="font-sans text-slate-400">&mdash;</span>,
  },
  {
    key: "sent",
    label: "Sent for review",
    by: (row) => row.chain[0]?.atSort ?? LAST,
    cellClass: "whitespace-nowrap text-xs",
    cell: (row) => <MomentCell one={row.chain[0] ?? null} />,
  },
  {
    key: "steps",
    label: "Route steps",
    note: "Every step of the route, in order, with the day it answered and the day it was given.",
    cellClass: "text-xs",
    cell: (row) => {
      const middle = row.chain.slice(1, -1);
      if (!middle.length) return <span className="text-slate-500">no route yet</span>;
      return (
        <span className="block space-y-0.5">
          {middle.map((one, at) => (
            <span key={`${one.name}-${at}`} className={`block whitespace-nowrap ${one.late ? "text-red-700" : "text-slate-600"}`}>
              <span className="font-medium">{one.name}</span>
              <span className="ml-1.5 font-mono tabular-nums">{one.at ?? "not yet"}</span>
              {one.due ? <span className="text-slate-500"> &middot; due {one.due}</span> : null}
              <span className="text-slate-500"> &middot; {one.owedBy}</span>
            </span>
          ))}
        </span>
      );
    },
  },
  {
    key: "issued",
    label: "Released & issued",
    by: (row) => row.chain[row.chain.length - 1]?.atSort ?? LAST,
    cellClass: "whitespace-nowrap text-xs",
    cell: (row) => <MomentCell one={row.chain.length > 1 ? row.chain[row.chain.length - 1] : null} />,
  },
  { key: "discipline", label: "Discipline", by: (row) => row.discipline, cellClass: "text-xs", cell: (row) => row.discipline },
  { key: "from", label: "From", by: (row) => row.from, cellClass: "text-xs", cell: (row) => row.from },
  { key: "approved", label: "Approved by", by: (row) => row.approvedBy, cellClass: "text-xs", cell: (row) => row.approvedBy },
  { key: "needs", label: "Needed at", by: (row) => row.requiredStatus, cellClass: "text-xs", cell: (row) => row.requiredStatus },
  {
    key: "submit",
    label: "Submit by",
    by: (row) => row.submitBySort,
    cellClass: "whitespace-nowrap text-xs",
    cell: (row) => (
      <>
        <span className={row.late ? "font-semibold text-red-700" : ""}>{row.submitBy}</span>
        <span className="block text-[11px] text-slate-500">{row.submitNote}</span>
      </>
    ),
  },
  { key: "has", label: "Has", by: (row) => row.has, cellClass: "text-xs", cell: (row) => row.has },
  {
    key: "ready",
    label: "Ready",
    by: (row) => (row.ready ? 0 : row.late ? 2 : 1),
    cell: (row) => row.ready
      ? <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-300">yes</Chip>
      : <Chip className={row.late ? "bg-red-100 text-red-800 ring-red-300" : "bg-amber-100 text-amber-800 ring-amber-300"}>{row.late ? "late" : "no"}</Chip>,
  },
];

function MomentCell({ one }: { one: Moment | null }) {
  if (!one) return <span className="text-slate-400">&mdash;</span>;
  return (
    <>
      <span className={`font-mono tabular-nums ${one.late ? "font-semibold text-red-700" : ""}`}>{one.at ?? "not yet"}</span>
      {one.due ? <span className="block text-[11px] text-slate-500">{one.deadline} {one.due}</span> : null}
    </>
  );
}

export function NeededTable({ rows, chips, plate, exportHref, empty, link }: {
  rows: NeededRow[];
  /** The discipline tabs, where there is more than one discipline. */
  chips?: React.ReactNode;
  /** The activity's own name and what it asks of the reader, above the narrowing. */
  plate?: React.ReactNode;
  /** Where the file comes from; the ticked documents are added to it. */
  exportHref: string;
  /** Said instead of the table when there is nothing to list yet. */
  empty?: string;
  /** The way on to the requirements list, for whoever keeps it. */
  link?: React.ReactNode;
}) {
  // The height the schedule's plan set, so every table in the app ends on the
  // same line.
  const cardHeight = useCardHeight();
  const [order, setOrder] = useState<string[] | null>(null);
  const [frozen, setFrozen] = useState(true);
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [ready, setReady] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

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
  const move = (label: string, by: -1 | 1) => {
    const keys = columns.map((column) => column.key);
    const at = keys.indexOf(keyOf(columns, label));
    const to = at + by;
    if (at < 0 || to < 0 || to >= keys.length) return;
    [keys[at], keys[to]] = [keys[to], keys[at]];
    remember(keys);
  };
  const moveTo = (label: string, onto: string) => {
    const from = keyOf(columns, label);
    const target = keyOf(columns, onto);
    if (from === target) return;
    const keys = columns.map((column) => column.key).filter((key) => key !== from);
    const at = keys.indexOf(target);
    keys.splice(at < 0 ? keys.length : at, 0, from);
    remember(keys);
  };

  /** The narrowing choices this sheet offers, from what it is holding. */
  const disciplines = useMemo(() => [...new Set(rows.map((row) => row.discipline))].sort(), [rows]);

  const matched = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((row) => {
      if (needle && !`${row.docNumber} ${row.title}`.toLowerCase().includes(needle)) return false;
      if (discipline && row.discipline !== discipline) return false;
      // Two choices: it was late (a step slipped, or it is still owed), or it wasn't.
      if (source === "late" && !(row.source || row.outstanding)) return false;
      if (source === "ontime" && (row.source || row.outstanding)) return false;
      if (ready === "yes" && !row.ready) return false;
      if (ready === "late" && !(row.late && !row.ready)) return false;
      if (ready === "no" && (row.ready || row.late)) return false;
      return true;
    });
  }, [rows, q, discipline, source, ready]);

  const ordered = useMemo(() => {
    if (!sort) return matched;
    // The document column is the row's name rather than one of the movable
    // columns, so it carries its ordering here.
    const by = sort.key === "document"
      ? (row: NeededRow) => row.docNumber
      : COLUMNS.find((one) => one.key === sort.key)?.by;
    if (!by) return matched;
    return [...matched].sort((a, b) => {
      const x = by(a) ?? "";
      const y = by(b) ?? "";
      const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en-GB");
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [matched, sort]);

  const pages = Math.max(1, Math.ceil(ordered.length / perPage));
  const here = Math.min(page, pages);
  const shown = ordered.slice((here - 1) * perPage, here * perPage);
  const pageSelected = shown.length > 0 && shown.every((row) => selected.includes(row.id));
  const slipped = matched.filter((row) => row.source || row.outstanding).length;

  const facets = [
    q.trim() ? { key: "Search", label: q.trim(), clear: () => setQ("") } : null,
    discipline ? { key: "Discipline", label: discipline, clear: () => setDiscipline("") } : null,
    source ? { key: "Where it got late", label: source === "late" ? "reason of lateness" : "wasn't late", clear: () => setSource("") } : null,
    ready ? { key: "Ready", label: ready === "yes" ? "yes" : ready === "late" ? "late" : "not yet", clear: () => setReady("") } : null,
  ].filter((one): one is { key: string; label: string; clear: () => void } => !!one);

  const clearAll = () => { setQ(""); setDiscipline(""); setSource(""); setReady(""); };
  const sortBy = (key: string) => setSort((was) =>
    was?.key !== key ? { key, dir: "asc" } : was.dir === "asc" ? { key, dir: "desc" } : null);
  const ticked = selected.filter((id) => rows.some((row) => row.id === id));
  const href = ticked.length
    ? `${exportHref}&docs=${encodeURIComponent(rows.filter((row) => ticked.includes(row.id)).map((row) => row.docNumber).join(","))}`
    : exportHref;

  return <>
    <section className="register register-sheet register-sheet-open mb-4">
      {plate}
      <div className="asking flex flex-wrap items-center gap-3 px-5 py-3.5 sm:px-6">
        <label className="search-field relative min-w-0 flex-1">
          <span className="sr-only">Search these documents</span>
          <Search className="absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(event) => { setQ(event.target.value); setPage(1); }}
            placeholder="Document number or title"
            className="plain w-full pl-6"
          />
        </label>
        <Narrow value={source} onChange={(next) => { setSource(next); setPage(1); }} empty="Where it got late" options={[{ code: "late", label: "Reason of lateness" }, { code: "ontime", label: "Wasn't late" }]} />
        <Narrow value={discipline} onChange={(next) => { setDiscipline(next); setPage(1); }} empty="Discipline" options={disciplines.map((one) => ({ code: one, label: one }))} />
        <Narrow value={ready} onChange={(next) => { setReady(next); setPage(1); }} empty="Ready" options={[{ code: "yes", label: "Ready" }, { code: "late", label: "Late" }, { code: "no", label: "Not yet" }]} />
      </div>
    </section>

    <section
      data-dt-frame
      className={`register register-sheet ${cardHeight ? "flex flex-col" : ""}`}
      /* A ceiling, not a height: an action that asks for four documents draws
         four rows and stops there. Only a longer list is held to the line the
         schedule's plan set, and only that one scrolls. */
      style={cardHeight ? { maxHeight: cardHeight } : undefined}
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
        <span className="stencil mr-1 text-slate-500">Documents needed</span>
        {chips}
        {link ? <span className="ml-3">{link}</span> : null}
        {facets.length ? (
          <>
            {facets.map((facet) => (
              <button key={facet.key} type="button" onClick={facet.clear} className="facet" title="Remove this filter">
                <span className="facet-key">{facet.key}</span>
                <span className="font-medium">{facet.label}</span>
                <X className="h-3 w-3" />
              </button>
            ))}
            <button type="button" onClick={clearAll} className="ml-1 inline-flex items-center gap-1 rounded-sm bg-brand px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-brand-hover">
              <X className="h-3 w-3" /> Clear all {facets.length}
            </button>
          </>
        ) : null}
        <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">
          {slipped ? `${slipped} of ${matched.length} lost time` : `${matched.length} on time`}
        </span>
      </div>

      <div className={cardHeight ? "flex min-h-0 flex-1 flex-col" : undefined}>
        {shown.length ? (
          <DataTable
            id="action-needed"
            className="rounded-none border-0 shadow-none"
            defaultHidden={["Approved by", "Sent for review", "Route steps", "Released & issued"]}
            fill
            stretch={!!cardHeight}
            onMove={move}
            onReorder={moveTo}
            tools={
              <a href={href} className="dt-tool" title={ticked.length ? "The documents you have ticked, with every checkpoint, as CSV" : "Every document this action needs, with every checkpoint, as CSV"}>
                <Download className="h-3.5 w-3.5" /> Export
              </a>
            }
            head={
              <tr>
                <Th className={`rail-head ${frozen ? "sticky left-0 z-4" : ""} w-10`}>
                  <input
                    aria-label="Select every document on this page"
                    type="checkbox"
                    checked={pageSelected}
                    onChange={() => setSelected(pageSelected
                      ? selected.filter((id) => !shown.some((row) => row.id === id))
                      : [...selected, ...shown.map((row) => row.id).filter((id) => !selected.includes(id))])}
                  />
                </Th>
                <Th className={`${frozen ? "sticky left-10 z-4" : ""} min-w-55`} label="Document" sorted={sort?.key === "document" ? sort.dir : null}>
                  <span className="inline-flex items-center gap-2">
                    <SortButton label="Document" on={sort?.key === "document" ? sort.dir : null} onClick={() => sortBy("document")} />
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
                  <Th key={column.key} label={column.label} className={column.headClass} sorted={column.by && sort?.key === column.key ? sort.dir : null}>
                    <span className="inline-flex items-center gap-1">
                      {column.by
                        ? <SortButton label={column.label} on={sort?.key === column.key ? sort.dir : null} onClick={() => sortBy(column.key)} />
                        : column.label}
                      {column.note ? <Info>{column.note}</Info> : null}
                    </span>
                  </Th>
                ))}
              </tr>
            }
          >
            {shown.map((row) => {
              const on = selected.includes(row.id);
              return (
                <tr key={row.id} className={on ? "[&>td]:bg-tint" : undefined}>
                  <Td className={`rail ${railFor(row)} ${frozen ? "sticky left-0 z-1" : ""} ${on ? "bg-tint" : "bg-surface"}`}>
                    <input
                      aria-label={`Select document ${row.docNumber}`}
                      type="checkbox"
                      checked={on}
                      onChange={() => setSelected((held) => held.includes(row.id) ? held.filter((one) => one !== row.id) : [...held, row.id])}
                    />
                  </Td>
                  <Td className={`${frozen ? "sticky left-10 z-1" : ""} min-w-55 ${on ? "bg-tint" : "bg-surface"}`}>
                    <Link href={`/documents/${row.documentId}`} className="doc-number">{row.docNumber}</Link>
                    <span className="doc-title block max-w-72 truncate" title={row.title}>{row.title}</span>
                  </Td>
                  {columns.map((column) => <Td key={column.key} className={column.cellClass}>{column.cell(row)}</Td>)}
                </tr>
              );
            })}
          </DataTable>
        ) : (
          <p className="px-5 py-6 text-xs text-slate-500 sm:px-6">
            {rows.length
              ? "No document here answers to that. Clear a filter above."
              : empty ?? "No documents listed yet. Each discipline answers Document Control’s call; the answers become the approved requirements list."}
          </p>
        )}
      </div>

      <div data-dt-foot className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-line px-5 py-2.5 sm:px-6">
        <p className="font-mono text-[11px] tabular-nums text-slate-500">
          {ordered.length ? `${(here - 1) * perPage + 1}–${Math.min(here * perPage, ordered.length)}` : 0}
          <span className="ml-1.5 font-sans text-slate-500">of {ordered.length}{ticked.length ? `, ${ticked.length} ticked` : ""}</span>
        </p>
        {pages > 1 ? (
          <span className="flex items-center gap-2">
            <PageStep onClick={() => setPage(here - 1)} disabled={here === 1} label="Previous page"><ChevronLeft className="h-4 w-4" /></PageStep>
            <span className="font-mono text-[11px] tabular-nums text-slate-500">{here} of {pages}</span>
            <PageStep onClick={() => setPage(here + 1)} disabled={here === pages} label="Next page"><ChevronRight className="h-4 w-4" /></PageStep>
          </span>
        ) : <span />}
        <label className="flex items-center justify-end gap-1.5">
          <span className="stencil text-slate-500">Rows</span>
          <select className="plain" value={perPage} onChange={(event) => { setPerPage(Number(event.target.value)); setPage(1); }}>
            {SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>
    </section>
  </>;
}

/** The key behind a column's printed name, which is what the menu hands back. */
function keyOf(columns: Column[], label: string): string {
  return columns.find((column) => column.label === label)?.key ?? label;
}

/** One narrowing choice, drawn as the registers draw them. */
function Narrow({ value, onChange, empty, options }: {
  value: string;
  onChange: (next: string) => void;
  empty: string;
  options: { code: string; label: string }[];
}) {
  return (
    <label className="min-w-0 flex-1">
      <span className="sr-only">{empty}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} data-on={value ? "true" : "false"} className="plain w-full">
        {/* The filter's name shows while nothing is chosen; it is not a choice. Clear it with its chip. */}
        <option value="" disabled hidden>{empty}</option>
        {options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
      </select>
    </label>
  );
}

/** One step through the table. A step that leads nowhere is shown, and dead. */
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
