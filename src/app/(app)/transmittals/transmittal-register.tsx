"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowDownLeft, ArrowUp, ArrowUpDown, ArrowUpRight, ChevronLeft, ChevronRight, Download, Pin, PinOff, Search, X } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { DateWindow } from "@/components/date-window";
import { Th, Td, Info } from "@/components/ui";
import { useCardHeight } from "@/components/card-height";

/**
 * The transmittal register, set in the same language as the document register:
 * one search line, a grid of filters, the filters read back as facts you can
 * remove one at a time, a table that fills the window, and paging underneath.
 * What is different is what it records — a handover between parties — so the
 * row leads with the direction it travelled.
 */
type Row = {
  id: string; number: string; subject: string | null; outgoing: boolean;
  from: string; to: string; reason: string; reasonLabel: string;
  issuedAt: string; documents: number; status: string; statusLabel: string;
  recipients: { id: string; name: string; seen: boolean }[];
  /** How many were copied in. They are told, not asked, so they are not "seen". */
  copies: number;
  dueAt: string | null; dueIn: number | null;
  receivedAt: string | null; checkedBy: string | null;
  replyNeeded: boolean; replyDays: number | null;
};
type Opt = { code: string; label: string };
type Filters = { q: string; terms: string[]; way: string; status: string; reason: string; party: string; on: string; from: string; to: string };

export type Paging = {
  page: number; pages: number; perPage: number; sizes: number[];
  from: number; to: number;
  /** The filters as a query string, without page or per. */
  query: string;
};

/** Available from the Columns menu; off until somebody wants them. */
const OPTIONAL = ["Reply due", "Why", "Received", "Checked by", "Reply needed"];

const ORDER_KEY = "transmittals:columns";
const FREEZE_KEY = "transmittals:frozen";

const RAIL: Record<string, string> = {
  DRAFT: "rail-none", ISSUED: "rail-review", ACCEPTED: "rail-released", REJECTED: "rail-void", CLOSED: "rail-superseded",
};
const STATUS_INK: Record<string, string> = {
  DRAFT: "text-slate-500", ISSUED: "text-sky-700", ACCEPTED: "text-emerald-700", REJECTED: "text-red-700", CLOSED: "text-violet-700",
};

type Column = {
  key: string; label: string; note?: string; sort?: string;
  headClass?: string; cellClass?: string;
  cell: (row: Row, notes: Record<string, string>) => React.ReactNode;
};

export function TransmittalRegister({ rows, total, filters, filterOptions, exportHref, plate, paging, sort, reasonNotes }: {
  rows: Row[]; total: number;
  /** What each reason for issue means, as the organization published it. */
  reasonNotes: Record<string, string>;
  plate?: React.ReactNode;
  paging?: Paging;
  sort?: { key: string; dir: "asc" | "desc" };
  filters: Filters;
  filterOptions: { ways: Opt[]; statuses: Opt[]; reasons: Opt[]; parties: Opt[]; dateFields: Opt[] };
  exportHref: string;
}) {
  const router = useRouter();
  // Every register is the height the schedule's plan set.
  const cardHeight = useCardHeight();
  const [pending, startTransition] = useTransition();
  const [order, setOrder] = useState<string[] | null>(null);
  const [frozen, setFrozen] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const pageSelected = rows.length > 0 && selected.length === rows.length;
  const go = (href: string) => startTransition(() => router.replace(href, { scroll: false }));

  // The order somebody dragged their columns into, and whether the number stays
  // in view. Both are this browser's business, not the log's.
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
    const next = keys.filter((_, index) => index !== from);
    next.splice(at, 0, keys[from]);
    remember(next);
  };
  /** Move a column one place, by its name as the Columns menu prints it. */
  const move = (label: string, by: -1 | 1) => {
    const keys = columns.map((column) => column.key);
    const from = columns.findIndex((column) => column.label === label);
    const to = from + by;
    if (from < 0 || to < 0 || to >= keys.length) return;
    const next = [...keys];
    [next[from], next[to]] = [next[to], next[from]];
    remember(next);
  };

  // A filter whose column is hidden leaves the reader staring at rows with no
  // sign of why they match.
  const forced = [
    filters.reason && "Why",
    filters.status && "Status",
    filters.on === "due" && "Reply due",
    filters.on === "received" && "Received",
  ].filter((label): label is string => !!label);

  const pageHref = (next: { page?: number; per?: number }) => {
    if (!paging) return "/transmittals";
    const params = new URLSearchParams(paging.query);
    const per = next.per ?? paging.perPage;
    const page = next.page ?? paging.page;
    if (per !== 50) params.set("per", String(per));
    if (page > 1) params.set("page", String(page));
    return `/transmittals${params.size ? `?${params}` : ""}`;
  };

  const sortHref = (key: string) => {
    const params = new URLSearchParams(paging?.query ?? "");
    params.delete("sort");
    params.delete("order");
    if (sort?.key !== key) { params.set("sort", key); params.set("order", "asc"); }
    else if (sort.dir === "asc") { params.set("sort", key); params.set("order", "desc"); }
    if (paging && paging.perPage !== 50) params.set("per", String(paging.perPage));
    return `/transmittals${params.size ? `?${params}` : ""}`;
  };

  // Which filters are on, so they can be read back and removed one by one.
  const facets: { key: string; label: string; without: string }[] = [];
  const drop = (name: string, value?: string) => {
    const next = new URLSearchParams();
    for (const [key, held] of Object.entries(filters)) {
      if (key === "terms" || !held) continue;
      if (key === name && value === undefined) continue;
      next.set(key, String(held));
    }
    if (name === "on") { next.delete("from"); next.delete("to"); }
    if (name === "q" && value !== undefined) {
      const rest = filters.terms.filter((term) => term !== value);
      if (rest.length) next.set("q", rest.map((term) => (term.includes(" ") ? `"${term}"` : term)).join(" "));
    }
    return `/transmittals${next.size ? `?${next}` : ""}`;
  };
  const labelIn = (options: Opt[], code: string) => options.find((option) => option.code === code)?.label ?? code;
  for (const term of filters.terms) facets.push({ key: "search", label: term, without: drop("q", term) });
  if (filters.way) facets.push({ key: "direction", label: labelIn(filterOptions.ways, filters.way), without: drop("way") });
  if (filters.status) facets.push({ key: "status", label: labelIn(filterOptions.statuses, filters.status), without: drop("status") });
  if (filters.reason) facets.push({ key: "why", label: labelIn(filterOptions.reasons, filters.reason), without: drop("reason") });
  if (filters.party) facets.push({ key: "party", label: filters.party, without: drop("party") });
  if (filters.on && filters.from) {
    const window = filters.to && filters.to !== filters.from ? `${day(filters.from)} to ${day(filters.to)}` : day(filters.from);
    facets.push({ key: labelIn(filterOptions.dateFields, filters.on).toLowerCase(), label: window, without: drop("on") });
  }


  return <>
    <section className="register register-sheet register-sheet-open mb-5">
      {plate}

      <form
        action="/transmittals"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const params = new URLSearchParams();
          for (const [key, value] of data.entries()) if (value) params.set(key, String(value));
          go(`/transmittals${params.size ? `?${params}` : ""}`);
        }}
        className="asking px-5 py-3.5 pb-5 sm:px-6"
      >
        <div className="flex items-end gap-4">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search the log</span>
            <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              name="q"
              defaultValue={filters.q}
              placeholder={'A space narrows, a comma widens: TR pumps  ·  TRN-001, TRN-002  ·  "for approval"'}
              className="plain w-full py-1.5! pl-6! text-[13px]!"
            />
          </label>
          {/* Nothing is asked of the database until this is pressed: one query
              per question, not one per keystroke or per choice. */}
          <button className="ask" data-on={facets.length ? "true" : "false"} disabled={pending}>
            {pending ? "Filtering" : "Apply"}
          </button>
        </div>

        {/* Five to a row, one row: a handover has fewer questions than a document. */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-3 md:grid-cols-5">
          <Filter name="way" value={filters.way} empty="Direction" options={filterOptions.ways} />
          <Filter name="status" value={filters.status} empty="Status" options={filterOptions.statuses} />
          <Filter name="reason" value={filters.reason} empty="Why" options={filterOptions.reasons} />
          <Filter name="party" value={filters.party} empty="Party" options={filterOptions.parties} />
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
            onClick={() => go("/transmittals")}
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
              <span>All <strong className="font-mono">{total.toLocaleString("en-GB")}</strong> transmittals these filters match are selected. Export takes all of them.</span>
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
            id="transmittals"
            className="rounded-none border-0 shadow-none"
            defaultHidden={OPTIONAL}
            onMove={move}
            onReorder={moveTo}
            forced={forced}
            fill
            stretch={!!cardHeight}
            tools={
              <a
                href={allMatching || !selected.length ? exportHref : `/api/export/transmittals?ids=${encodeURIComponent(selected.join(","))}`}
                className="dt-tool"
                title={selected.length && !allMatching ? "The transmittals you have ticked, as CSV" : "Every transmittal these filters match, as CSV"}
              >
                <Download className="h-3.5 w-3.5" /> Export
              </a>
            }
            head={<tr>
              <Th className={`rail-head ${frozen ? "sticky left-0 z-4" : ""} w-10`}>
                <input
                  aria-label="Select every transmittal on this page"
                  type="checkbox"
                  checked={pageSelected}
                  onChange={() => { setAllMatching(false); setSelected(pageSelected ? [] : rows.map((row) => row.id)); }}
                />
              </Th>
              <Th className={`${frozen ? "sticky left-10 z-4" : ""} min-w-70`} label="Transmittal">
                <span className="inline-flex items-center gap-2">
                  <SortButton label="Number" on={sort?.key === "number" ? sort.dir : null} onClick={() => go(sortHref("number"))} />
                  <span className="text-slate-300">/</span>
                  <SortButton label="Subject" on={sort?.key === "subject" ? sort.dir : null} onClick={() => go(sortHref("subject"))} />
                  {/* Freezing only ever affects this column, so it is switched here. */}
                  <button
                    type="button"
                    onClick={() => setFrozen((keptPin) => { try { localStorage.setItem(FREEZE_KEY, keptPin ? "0" : "1"); } catch {} return !keptPin; })}
                    aria-pressed={frozen}
                    title={frozen ? "This column stays in view while you scroll sideways. Click to let it scroll away." : "This column scrolls away with the rest. Click to keep it in view."}
                    className={`rounded-sm p-0.5 transition-colors hover:text-brand-ink ${frozen ? "text-slate-400" : "text-slate-300"}`}
                  >
                    {frozen ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
                  </button>
                </span>
              </Th>
              {columns.map((column) => (
                <Th key={column.key} label={column.label} className={column.headClass}>
                  <span className="inline-flex items-center gap-1">
                    {column.sort
                      ? <SortButton label={column.label} on={sort?.key === column.sort ? sort.dir : null} onClick={() => go(sortHref(column.sort!))} />
                      : column.label}
                    {column.note ? <Info>{column.note}</Info> : null}
                  </span>
                </Th>
              ))}
            </tr>}
          >
            {rows.map((row) => {
              const on = selected.includes(row.id);
              return (
              <tr key={row.id} className={on ? "[&>td]:bg-tint" : undefined}>
                <Td className={`rail ${RAIL[row.status] ?? "rail-none"} ${frozen ? "sticky left-0 z-1" : ""} ${on ? "bg-tint" : "bg-surface"}`}>
                  <input
                    aria-label={`Select ${row.number}`}
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      setAllMatching(false);
                      setSelected((held) => held.includes(row.id) ? held.filter((one) => one !== row.id) : [...held, row.id]);
                    }}
                  />
                </Td>
                <Td className={`${frozen ? "sticky left-10 z-1" : ""} min-w-70 bg-surface`}>
                  {/* The direction is read before any word in the row, so it sits
                      with the number rather than in a column of its own. */}
                  <span className="flex items-baseline gap-2">
                    {row.outgoing
                      ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0 self-center text-brand-line" aria-label="Sent" />
                      : <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 self-center text-amber-600" aria-label="Received" />}
                    <Link href={`/transmittals/${row.id}`} className="whitespace-nowrap font-mono text-xs font-semibold tracking-tight text-link hover:underline">{row.number}</Link>
                  </span>
                  {row.subject ? <p className="mt-0.5 block truncate text-[13px] text-slate-800" title={row.subject}>{row.subject}</p> : null}
                </Td>
                {columns.map((column) => <Td key={column.key} className={column.cellClass}>{column.cell(row, reasonNotes)}</Td>)}
              </tr>
              );
            })}
          </DataTable>
        ) : (
          <div className="px-6 py-20 text-center">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-400">no entries</p>
            <p className="mt-2 text-sm text-slate-700">Nothing in the log matches these filters.</p>
            {facets.length ? <button type="button" onClick={() => go("/transmittals")} className="mt-3 text-xs font-semibold text-link hover:underline">Clear the {facets.length} filter{facets.length === 1 ? "" : "s"} →</button> : null}
          </div>
        )}
      </div>

      {paging && total > 0 ? (
        <div data-dt-foot className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-line px-5 py-2.5 sm:px-6">
          <p className="font-mono text-[11px] tabular-nums text-slate-500">
            {paging.from.toLocaleString("en-GB")}–{paging.to.toLocaleString("en-GB")}
            <span className="ml-1.5 font-sans text-slate-400">of {total.toLocaleString("en-GB")}</span>
          </p>
          {paging.pages > 1 ? (
            <span className="flex items-center justify-center gap-1">
              <PageStep onClick={() => go(pageHref({ page: paging.page - 1 }))} disabled={paging.page === 1} label="Previous page"><ChevronLeft className="h-4 w-4" /></PageStep>
              <span className="px-2 font-mono text-[11px] tabular-nums text-slate-600">{paging.page} <span className="text-slate-400">/ {paging.pages}</span></span>
              <PageStep onClick={() => go(pageHref({ page: paging.page + 1 }))} disabled={paging.page === paging.pages} label="Next page"><ChevronRight className="h-4 w-4" /></PageStep>
            </span>
          ) : <span />}
          <label className="flex items-center justify-end gap-1.5">
            <span className="stencil text-slate-400">Rows</span>
            <select className="plain" value={paging.perPage} onChange={(event) => go(pageHref({ per: Number(event.target.value), page: 1 }))}>
              {paging.sizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>
      ) : null}
    </section>
  </>;
}

// ── The columns, in the order they start in ─────────────────────────────────

const COLUMNS: Column[] = [
  { key: "from", sort: "from", label: "From", cellClass: "max-w-44 truncate text-xs text-slate-700", cell: (row) => row.from },
  { key: "to", sort: "to", label: "To", cellClass: "max-w-52 truncate text-xs text-slate-700", cell: (row) => row.to },
  {
    key: "reason", sort: "reason", label: "Why",
    note: "The reason for issue: what the recipient is expected to do with it. It also decides whether a reply is due, and by when.",
    cellClass: "whitespace-nowrap text-xs text-slate-600",
    cell: (row, notes) => <span className={notes[row.reason] ? "cursor-help" : undefined} title={notes[row.reason]}>{row.reasonLabel}</span>,
  },
  { key: "issued", sort: "issued", label: "Issued", headClass: "text-right", cellClass: "whitespace-nowrap text-right font-mono text-xs tabular-nums", cell: (row) => date(row.issuedAt) },
  { key: "documents", sort: "documents", label: "Documents", headClass: "text-right", cellClass: "text-right font-mono text-xs tabular-nums", cell: (row) => row.documents || <Muted /> },
  {
    key: "status", sort: "status", label: "Status",
    note: "Draft means nothing has been sent. Issued means the recipients were told. On what arrives: to check, then accepted or rejected, then closed.",
    cellClass: "whitespace-nowrap",
    cell: (row) => <span className={`meta font-sans! ${STATUS_INK[row.status] ?? ""}`}>{row.statusLabel}</span>,
  },
  {
    key: "seen", label: "Seen by",
    note: "A recipient who opened it while signed in. That is the receipt — there is nothing for them to confirm.",
    cellClass: "whitespace-nowrap text-xs text-slate-600",
    cell: (row) => {
      if (row.status === "DRAFT" || !row.recipients.length) return <Muted />;
      const seen = row.recipients.filter((person) => person.seen).length;
      return (
        <span className="inline-flex items-center gap-1.5" title={row.recipients.map((person) => `${person.seen ? "seen" : "not yet"} · ${person.name}`).join(" | ")}>
          <span className="flex items-center gap-1">
            {row.recipients.slice(0, 8).map((person) => <span key={person.id} className={`seen-dot ${person.seen ? "seen-on" : ""}`} />)}
          </span>
          <span className="font-mono tabular-nums">{seen}/{row.recipients.length}</span>
          {row.copies ? <span className="text-[10px] text-slate-400">+{row.copies} copied</span> : null}
        </span>
      );
    },
  },
  {
    key: "received", sort: "received", label: "Received",
    note: "The day an incoming transmittal reached us, as recorded on it.",
    headClass: "text-right", cellClass: "whitespace-nowrap text-right font-mono text-xs tabular-nums",
    cell: (row) => row.receivedAt ? date(row.receivedAt) : <Muted />,
  },
  {
    key: "checkedBy", label: "Checked by",
    note: "Who ran the acceptance check on what arrived, and so who accepted or rejected it.",
    cellClass: "max-w-40 truncate text-xs text-slate-600",
    cell: (row) => row.checkedBy ?? <Muted />,
  },
  {
    key: "replyNeeded", label: "Reply needed",
    note: "Whether an answer was asked for at all, and within how many days.",
    cellClass: "whitespace-nowrap text-xs text-slate-600",
    cell: (row) => row.replyNeeded ? <span>yes{row.replyDays ? <span className="ml-1 font-mono text-[11px] text-slate-400">{row.replyDays}d</span> : null}</span> : <Muted />,
  },
  {
    key: "due", sort: "due", label: "Reply due",
    note: "Where the reason for issue requires an answer. On what arrives, the period runs from the day we accept it, not the day it arrived.",
    headClass: "text-right",
    cellClass: "whitespace-nowrap text-right text-xs",
    cell: (row) => {
      if (!row.dueAt) return <Muted />;
      const near = row.dueIn !== null && row.dueIn <= 3;
      const late = row.dueIn !== null && row.dueIn < 0;
      return (
        <span className={late ? "font-semibold text-red-700" : near ? "text-amber-700" : "font-mono tabular-nums text-slate-600"} title={date(row.dueAt)}>
          {late ? `${Math.abs(row.dueIn!)} day${Math.abs(row.dueIn!) === 1 ? "" : "s"} late` : row.dueIn === 0 ? "today" : near ? `in ${row.dueIn} day${row.dueIn === 1 ? "" : "s"}` : date(row.dueAt)}
        </span>
      );
    },
  },
];

// ── Pieces ──────────────────────────────────────────────────────────────────

function Filter({ name, value, empty, options }: { name: string; value: string; empty: string; options: Opt[] }) {
  return (
    <label className="min-w-0 flex-1">
      <span className="sr-only">{empty}</span>
      <select
        name={name}
        defaultValue={value}
        data-on={value ? "true" : "false"}
        className="plain w-full"
      >
        <option value="">{empty}</option>
        {options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
      </select>
    </label>
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

function PageStep({ onClick, disabled, label, children }: { onClick: () => void; disabled: boolean; label: string; children: React.ReactNode }) {
  if (disabled) return <span aria-disabled className="rounded-sm p-1 text-slate-300">{children}</span>;
  return <button type="button" onClick={onClick} aria-label={label} className="rounded-sm p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-ink">{children}</button>;
}

function Muted() { return <span className="text-slate-300">·</span>; }
function date(value: string | null) { return value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—"; }
function day(value: string) { return value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : ""; }
