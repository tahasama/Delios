"use client";

import Link from "next/link";
import { saveRegisterView, deleteRegisterView } from "@/lib/actions/register-views";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, GitPullRequestArrow, Minus, PackagePlus, Pin, PinOff, Plus, Search, Send, X } from "lucide-react";
import { sendSupplierFromRegisterAction as sendFromRegister } from "@/lib/actions/supplier";
import { DataTable } from "@/components/data-table";
import { DateWindow } from "@/components/date-window";
import { Th, Td, Info } from "@/components/ui";
import { useCardHeight } from "@/components/card-height";
import { isMigrated } from "@/lib/migrated";

/** Available from the Columns menu; off until someone wants them. */
const OPTIONAL = ["Received from", "Document state", "Review verdict", "Originator", "Sub-project", "Contract", "Criticality", "Confidentiality", "Planned submission", "Issued", "Released", "Decided by", "In packages", "Kept for", "Produced by", "Revision started", "File added"];

/** Which column each date filter talks about, so filtering by it shows it. */
const DATE_COLUMN: Record<string, string> = {
  created: "Created", revStarted: "Revision started", fileAdded: "File added",
  planned: "Planned submission", issued: "Issued", released: "Released", updated: "Updated",
};

type RegisterRow = {
  id: string; docNumber: string; title: string; deliverableType: string; docType: string; discipline: string;
  originator: string | null; subProject: string | null;
  /** For an outside organization: who asked it of them. Their sendable revision, once a file is on it. */
  receivedFrom?: string | null; sendRevisionId?: string | null; contractRef: string | null; criticality: string | null;
  confidentiality: string | null; retentionClass: string | null; retentionLabel: string | null; placeholder: boolean;
  docTypeLabel: string; disciplineLabel: string; deliverableLabel: string;
  /** What the newest revision serves, and the activities that list this document. */
  phase: string | null; phaseLabel: string | null;
  actions: { code: string; name: string }[];
  docState: string; docStateLabel: string;
  revision: string | null; revState: string | null; revStateLabel: string;
  verdict: string | null; verdictLabel: string | null;
  releasedFor: string | null; releasedForLabel: string | null; releasedForUse: string | null; proposedFor: string | null;
  /** Released, then put on hold for an outside approval: not for use. */
  onHold: string | null;
  createdDate: string; updatedAt: string; plannedSubmissionDate: string | null; issueDate: string | null; releasedAt: string | null;
  decidedBy: string | null; packageCount: number; hasReleased: boolean; reviewRevisionId: string | null;
  fileAdded: string | null; revStarted: string | null; decidedByDelegated: boolean;
};
type Opt = { code: string; label: string };

export type Paging = {
  page: number;
  pages: number;
  perPage: number;
  sizes: number[];
  from: number;
  to: number;
  /** The filters as a query string, without page or per: the register builds the rest. */
  query: string;
};

type Filters = { q: string; terms: string[]; state: string; rev: string; status: string; verdict: string; supplier: string; po: string; discipline: string; docType: string; criticality: string; confidentiality: string; deliverable: string; phase: string; action: string; view: string; on: string; from: string; to: string };

/** Where the guide explains each kind of code. */
const GUIDE: Record<string, string> = {
  DOC_STATE: "/guide/codes#document",
  REV_STATE: "/guide/codes#revision",
  VERDICT: "/guide/codes#outcome",
  STATUS: "/guide/codes#status",
  CRITICALITY: "/guide/codes#criticality",
  CONFIDENTIALITY: "/guide/codes#confidentiality",
};

/** The rail colour per revision state: the row's state, read before any word. */
const RAIL: Record<string, string> = {
  NONE: "rail-none", IN_PREPARATION: "rail-prep", IN_REVIEW: "rail-review",
  RELEASED: "rail-released", SUPERSEDED: "rail-superseded", VOID: "rail-void",
};
const REV_INK: Record<string, string> = {
  IN_PREPARATION: "text-amber-700", IN_REVIEW: "text-sky-700", RELEASED: "text-emerald-700",
  SUPERSEDED: "text-violet-700", VOID: "text-red-700",
};

const ORDER_KEY = "register:columns";
const FREEZE_KEY = "register:frozen";

/**
 * A column of the register, as data. Holding the columns in a list rather than
 * in markup is what lets someone drag them into the order they work in — and it
 * makes a header and its cells impossible to get out of step.
 */
type Column = {
  key: string;
  label: string;
  note?: string;
  headClass?: string;
  cellClass?: string;
  /** The sort this column offers, if the register can order by it. */
  sort?: string;
  cell: (row: RegisterRow, codes: Record<string, string>) => React.ReactNode;
};

export function DocumentRegister({ rows, total, userCanAct, filters, filterOptions, exportHref, plate, paging, codes, sort, views, supplier }: {
  /** The reader is an outside organization: what they owe can be sent from here. */
  supplier?: { to: string; readOnly?: boolean } | null;
  rows: RegisterRow[]; total: number; userCanAct: boolean;
  /** The questions this reader keeps, and the address each one asks. */
  views: { id: string; name: string; query: string }[];
  paging?: Paging;
  /** The column the register is ordered by, and which way. */
  sort?: { key: string; dir: "asc" | "desc" };
  /** What each published code means, keyed "SET|CODE", for the hover notes. */
  codes: Record<string, string>;
  /** The masthead, rendered on the server so it can read the project. */
  plate?: React.ReactNode;
  filters: Filters;
  filterOptions: { states: Opt[]; revStates: Opt[]; statuses: Opt[]; verdicts: Opt[]; suppliers: Opt[]; pos: Opt[]; disciplines: Opt[]; types: Opt[]; criticalities: Opt[]; confidentialities: Opt[]; deliverables: Opt[]; phases: Opt[]; actions: Opt[]; dateFields: Opt[] };
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
  // The filters asked least often are folded away until somebody asks for them,
  // and unfold themselves whenever one of them is doing something.
  const [extra, setExtra] = useState(!!filters.criticality || !!filters.confidentiality || !!filters.deliverable || !!filters.phase || !!filters.action);
  useEffect(() => {
    if (filters.criticality || filters.confidentiality || filters.deliverable || filters.phase || filters.action) setExtra(true);
  }, [filters.criticality, filters.confidentiality, filters.deliverable, filters.phase, filters.action]);

  // The order someone dragged their columns into, and whether they keep the
  // first column in view. Both are this browser's business, not the register's.
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
  /** Drop one column where another sits, by name — the menu's drag. */
  const moveTo = (label: string, before: string) => {
    const keys = columns.map((column) => column.key);
    const from = columns.findIndex((column) => column.label === label);
    const at = columns.findIndex((column) => column.label === before);
    if (from < 0 || at < 0 || from === at) return;
    const next = keys.filter((_, i) => i !== from);
    next.splice(at, 0, keys[from]);
    setOrder(next);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)); } catch {}
  };

  /** Move a column one place, by its name as the Columns menu prints it. */
  const move = (label: string, by: -1 | 1) => {
    const keys = columns.map((column) => column.key);
    const from = columns.findIndex((column) => column.label === label);
    const to = from + by;
    if (from < 0 || to < 0 || to >= keys.length) return;
    const next = [...keys];
    [next[from], next[to]] = [next[to], next[from]];
    setOrder(next);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)); } catch {}
  };

  // A filter whose column is hidden leaves the reader staring at rows with no
  // sign of why they match. Filtering by supplier shows the supplier column.
  const forced = [
    supplier && "Received from",
    filters.state && "Document state",
    filters.verdict && "Review verdict",
    filters.status && "Released for",
    filters.supplier && "Originator",
    filters.po && "Contract",
    filters.discipline && "Discipline",
    filters.docType && "Type",
    filters.criticality && "Criticality",
    filters.confidentiality && "Confidentiality",
    filters.deliverable && "Produced by",
    filters.on && DATE_COLUMN[filters.on],
  ].filter((label): label is string => !!label);

  const selectedRows = useMemo(() => rows.filter((row) => selected.includes(row.id)), [rows, selected]);
  const selectedRevisionIds = selectedRows.map((row) => row.reviewRevisionId).filter((id): id is string => Boolean(id));
  const transmittableRows = selectedRows.filter((row) => row.hasReleased);
  const pageSelected = rows.length > 0 && selected.length === rows.length;
  const transmittalHref = `/transmittals/new?docs=${encodeURIComponent(transmittableRows.map((row) => row.id).join(","))}`;
  // Exporting every match needs no list of ids: the filters are the list.
  /**
   * The columns this reader is looking at, as the table's own preferences hold
   * them. An export that ignored them would be a second register.
   */
  const shownColumns = () => {
    const hidden = new Set<string>();
    try {
      const raw = localStorage.getItem("table:register");
      if (raw) for (const label of (JSON.parse(raw) as { hidden?: string[] }).hidden ?? []) hidden.add(label);
      else for (const label of OPTIONAL) hidden.add(label);
    } catch {
      for (const label of OPTIONAL) hidden.add(label);
    }
    return COLUMNS.map((column) => column.label).filter((label) => !hidden.has(label));
  };
  const exportWith = (href: string) => {
    const url = new URL(href, window.location.origin);
    url.searchParams.set("cols", shownColumns().join("|"));
    return url.pathname + url.search;
  };
  const selectedExportHref = allMatching ? exportHref : selected.length ? `/api/register/export?ids=${encodeURIComponent(selected.join(","))}` : exportHref;
  function toggle(id: string) {
    setAllMatching(false);
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  // A page of the register, or the same page at another size.
  const pageHref = (next: { page?: number; per?: number }) => {
    if (!paging) return "/documents";
    const params = new URLSearchParams(paging.query);
    const per = next.per ?? paging.perPage;
    const page = next.page ?? paging.page;
    if (per !== 50) params.set("per", String(per));
    if (page > 1) params.set("page", String(page));
    return `/documents${params.size ? `?${params}` : ""}`;
  };
  // Narrowing the register is a navigation, because the register can hold more
  // rows than a browser should ever be handed. It keeps the scroll and marks
  // the table busy rather than blanking it, so nobody loses their place.
  const go = (href: string) => startTransition(() => router.replace(href, { scroll: false }));

  // Ordering by a column: the same column again reverses it, a third click
  // returns the register to its own order — most recently touched first.
  const sortHref = (key: string) => {
    const params = new URLSearchParams(paging?.query ?? "");
    params.delete("sort");
    params.delete("dir");
    if (sort?.key !== key) { params.set("sort", key); params.set("dir", "asc"); }
    else if (sort.dir === "asc") { params.set("sort", key); params.set("dir", "desc"); }
    if (paging && paging.perPage !== 50) params.set("per", String(paging.perPage));
    return `/documents${params.size ? `?${params}` : ""}`;
  };

  // Which filters are on, so they can be read back as facts and removed one by one.
  const facets: { key: string; label: string; without: string }[] = [];
  const drop = (name: string, value?: string) => {
    const next = new URLSearchParams();
    for (const [key, held] of Object.entries(filters)) {
      if (key === "terms" || key === "view" || !held) continue;
      if (key === name && value === undefined) continue;
      next.set(key, String(held));
    }
    // A search of several terms loses one term at a time, not all of them.
    if (name === "on") { next.delete("from"); next.delete("to"); }
    if (name === "q" && value !== undefined) {
      const rest = filters.terms.filter((term) => term !== value);
      if (rest.length) next.set("q", rest.map((term) => (term.includes(" ") ? `"${term}"` : term)).join(" "));
    }
    return `/documents${next.size ? `?${next}` : ""}`;
  };
  const labelIn = (options: Opt[], code: string) => options.find((option) => option.code === code)?.label ?? code;
  if (filters.on && (filters.from || filters.to)) {
    const window = filters.from && filters.to ? `${day(filters.from)} to ${day(filters.to)}`
      : filters.from ? `from ${day(filters.from)}` : `up to ${day(filters.to)}`;
    facets.push({ key: labelIn(filterOptions.dateFields, filters.on).toLowerCase(), label: window, without: drop("on") });
  }
  for (const term of filters.terms) facets.push({ key: "search", label: term, without: drop("q", term) });
  if (filters.state) facets.push({ key: "document state", label: labelIn(filterOptions.states, filters.state), without: drop("state") });
  if (filters.rev) facets.push({ key: "revision state", label: labelIn(filterOptions.revStates, filters.rev), without: drop("rev") });
  if (filters.status) facets.push({ key: "released for", label: labelIn(filterOptions.statuses, filters.status), without: drop("status") });
  if (filters.verdict) facets.push({ key: "verdict", label: labelIn(filterOptions.verdicts, filters.verdict), without: drop("verdict") });
  if (filters.supplier) facets.push({ key: "supplier", label: labelIn(filterOptions.suppliers, filters.supplier), without: drop("supplier") });
  if (filters.po) facets.push({ key: "contract", label: labelIn(filterOptions.pos, filters.po), without: drop("po") });
  if (filters.discipline) facets.push({ key: "discipline", label: labelIn(filterOptions.disciplines, filters.discipline), without: drop("discipline") });
  if (filters.docType) facets.push({ key: "type", label: labelIn(filterOptions.types, filters.docType), without: drop("docType") });
  if (filters.criticality) facets.push({ key: "criticality", label: labelIn(filterOptions.criticalities, filters.criticality), without: drop("criticality") });
  if (filters.confidentiality) facets.push({ key: "confidentiality", label: labelIn(filterOptions.confidentialities, filters.confidentiality), without: drop("confidentiality") });
  if (filters.deliverable) facets.push({ key: "produced by", label: labelIn(filterOptions.deliverables, filters.deliverable), without: drop("deliverable") });
  if (filters.phase) facets.push({ key: "phase", label: labelIn(filterOptions.phases, filters.phase), without: drop("phase") });
  if (filters.action) facets.push({ key: "owed by", label: labelIn(filterOptions.actions, filters.action), without: drop("action") });

  return <>
    <section className="register register-sheet register-sheet-open mb-5">
      {plate}

      {/* Search gets its own line: it is how most people arrive, and it takes
          several terms at once. The filters sit under it, on their own rule. */}
      <form
        key={paging?.query ?? ""}
        action="/documents"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const params = new URLSearchParams();
          for (const [key, value] of data.entries()) if (value && key !== "view") params.set(key, String(value));
          go(`/documents${params.size ? `?${params}` : ""}`);
        }}
        className="asking border-b border-line px-5 py-3.5 sm:px-6"
      >
        <div className="flex items-center gap-3">
          <label className="search-field relative min-w-0 flex-1">
            <span className="sr-only">Search the register</span>
            <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              name="q"
              defaultValue={filters.q}
              placeholder={'A space narrows, a comma widens: pump ME  ·  P-101, P-102  ·  "feed pump"'}
              className="plain w-full py-2! pl-6! text-[13.5px]!"
            />
          </label>
          {/* Nothing is asked of the database until this is pressed. A query
              per keystroke, or per choice, is what a register of tens of
              thousands cannot afford. */}
          {/* One button, one state: while the answer is being fetched it says so
              in place, rather than beside a word that is no longer true. */}
          <button className="ask" data-on={facets.length ? "true" : "false"} disabled={pending}>
            {pending ? "Filtering" : "Apply"}
          </button>
        </div>

        {/* Five to a row: eight plain choices, the date, and the switch that
            unfolds the two asked least often onto a row of their own. */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-3 md:grid-cols-5">
          <Filter name="state" value={filters.state} empty="Document state" options={filterOptions.states} />
          <Filter name="rev" value={filters.rev} empty="Revision state" options={filterOptions.revStates} />
          <Filter name="status" value={filters.status} empty="Released for" options={filterOptions.statuses} />
          <Filter name="verdict" value={filters.verdict} empty="Verdict" options={filterOptions.verdicts} />
          <Filter name="supplier" value={filters.supplier} empty="Supplier" options={filterOptions.suppliers} />
          <Filter name="po" value={filters.po} empty="Contract / PO" options={filterOptions.pos} />
          <Filter name="discipline" value={filters.discipline} empty="Discipline" options={filterOptions.disciplines} />
          <Filter name="docType" value={filters.docType} empty="Type" options={filterOptions.types} />
          <DateWindow fields={filterOptions.dateFields} on={filters.on} from={filters.from} to={filters.to} />
          <button
            type="button"
            onClick={() => setExtra((shown) => !shown)}
            aria-expanded={extra}
            data-caret="none"
            className="plain group inline-flex items-center gap-1.5"
            title={extra ? "Fold these filters away" : "Criticality and confidentiality"}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-slate-400 transition-colors group-hover:bg-tint group-hover:text-brand-ink">
              {extra ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            </span>
            {extra ? "Less filters" : "More filters"}
          </button>

          {/* Shown as cells of the same grid, on a row of their own, because a
              filter that looks like every other filter is one people trust. */}
          {extra ? <>
            <Filter name="criticality" value={filters.criticality} empty="Criticality" options={filterOptions.criticalities} />
            <Filter name="confidentiality" value={filters.confidentiality} empty="Confidentiality" options={filterOptions.confidentialities} />
            <Filter name="deliverable" value={filters.deliverable} empty="Produced by" options={filterOptions.deliverables} />
            <Filter name="phase" value={filters.phase} empty="Phase" options={filterOptions.phases} />
            {filterOptions.actions.length ? <Filter name="action" value={filters.action} empty="Owed by activity" options={filterOptions.actions} /> : null}
          </> : <>
            <input type="hidden" name="criticality" value={filters.criticality} />
            <input type="hidden" name="confidentiality" value={filters.confidentiality} />
            <input type="hidden" name="deliverable" value={filters.deliverable} />
          </>}
          <input type="hidden" name="view" value={filters.view} />
          <noscript><button className="stencil text-brand-ink">Apply</button></noscript>
        </div>
      </form>

      <div className="kept-views flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 pt-2 pb-5 sm:px-6">
        <span className="stencil text-slate-400">Views</span>
        {views.length ? views.map((view) => (
          <span key={view.id} className="group inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => go(`/documents${view.query ? `?${view.query}` : ""}`)}
              className="text-[12.5px] font-medium text-slate-600 transition-colors hover:text-brand-ink"
            >
              {view.name}
            </button>
            <form action={deleteRegisterView}>
              <input type="hidden" name="id" value={view.id} />
              <button
                type="submit"
                aria-label={`Forget the view ${view.name}`}
                title="Forget this view"
                className="rounded-sm p-0.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-700"
              >
                <X className="h-3 w-3" />
              </button>
            </form>
          </span>
        )) : (
          <span className="text-[12.5px] text-slate-400">
            Nothing yet, choose your filters, give them a name and save for future reuse.
          </span>
        )}

        {facets.length ? (
          <form action={saveRegisterView} className="ml-auto flex items-center gap-1.5">
            <input type="hidden" name="query" value={paging?.query ?? ""} />
            <input
              name="name"
              required
              maxLength={60}
              placeholder="Keep this view as…"
              className="plain py-1! text-[12.5px]! w-44"
            />
            <button className="stencil text-brand-ink hover:underline">Keep</button>
          </form>
        ) : null}
      </div>
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
            onClick={() => go("/documents")}
            className="ml-1 inline-flex items-center gap-1 rounded-sm bg-brand px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            <X className="h-3 w-3" /> Clear all {facets.length}
          </button>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">{total.toLocaleString("en-GB")} match{total === 1 ? "" : "es"}</span>
        </div>
      ) : null}

      {/* Selecting a page is one thing; acting on every match is another, and
          the difference is said out loud rather than assumed. */}
      {pageSelected && paging && total > rows.length ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-tint px-5 py-2.5 text-xs text-brand-ink sm:px-6">
          {allMatching ? (
            <>
              <span>All <strong className="font-mono">{total.toLocaleString("en-GB")}</strong> documents these filters match are selected. Export takes all of them; the other actions take the {rows.length} on this page.</span>
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
        {rows.length ? <DataTable id="register" className="rounded-none border-0 shadow-none" stretch={!!cardHeight} defaultHidden={OPTIONAL} onMove={move} onReorder={moveTo} forced={forced} fill tools={
          <a
            href={exportHref}
            onClick={(event) => { event.preventDefault(); window.location.href = exportWith(exportHref); }}
            className="dt-tool"
            title="The rows these filters match, in the columns you are looking at, as CSV"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </a>
        } head={<tr>
          <Th className={`rail-head ${frozen ? "sticky left-0 z-4" : ""} w-10`}>
            <input
              aria-label="Select every document on this page"
              title="Selects this page. The register offers every match above."
              type="checkbox"
              checked={pageSelected}
              onChange={() => { setAllMatching(false); setSelected(pageSelected ? [] : rows.map((row) => row.id)); }}
            />
          </Th>
          <Th
            className={`${frozen ? "sticky left-10 z-4" : ""} min-w-70`}
            label="Document"
            sorted={sort?.key === "docNumber" || sort?.key === "title" ? sort.dir : null}
          >
            <span className="inline-flex items-center gap-2">
              <SortButton label="Number" on={sort?.key === "docNumber" ? sort.dir : null} onClick={() => go(sortHref("docNumber"))} />
              <span className="text-slate-300">/</span>
              <SortButton label="Title" on={sort?.key === "title" ? sort.dir : null} onClick={() => go(sortHref("title"))} />
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
            <Th
              key={column.key}
              label={column.label}
              className={column.headClass}
              sorted={column.sort && sort?.key === column.sort ? sort.dir : null}
            >
              <span className="inline-flex items-center gap-1">
                {column.sort
                  ? <SortButton label={column.label} on={sort?.key === column.sort ? sort.dir : null} onClick={() => go(sortHref(column.sort!))} />
                  : column.label}
                {column.note ? <Info>{column.note}</Info> : null}
              </span>
            </Th>
          ))}
        </tr>}>{rows.map((row) => {
          const on = selected.includes(row.id);
          const pin = on ? "bg-tint" : "bg-surface";
          return <tr key={row.id} className={on ? "[&>td]:bg-tint" : undefined}>
            <Td className={`rail ${RAIL[row.revState ?? "NONE"] ?? "rail-none"} ${frozen ? "sticky left-0 z-1" : ""} ${pin}`}>
              <input aria-label={`Select ${row.docNumber}`} type="checkbox" checked={on} onChange={() => toggle(row.id)} />
            </Td>
            <Td className={`${frozen ? "sticky left-10 z-1" : ""} min-w-70 ${pin}`}>
              <span className="relative flex items-center gap-1.5">
                <Link href={`/documents/${row.id}`} className="doc-number relative z-1 whitespace-nowrap">{row.docNumber}</Link>
                {row.revState === "SUPERSEDED" ? <span className="stamp text-violet-700">superseded</span> : null}
                {row.revState === "VOID" ? <span className="stamp text-red-700">void</span> : null}
                {row.placeholder ? <span className="stamp text-slate-500">number reserved</span> : null}
                {row.onHold ? <span title={row.onHold} className="stamp text-red-700">not for use</span> : null}
              </span>
              <p className="doc-title mt-0.5 block truncate" title={row.title}>{row.title}</p>
            </Td>
            {columns.map((column) => <Td key={column.key} className={column.cellClass}>{column.cell(row, codes)}</Td>)}
          </tr>;
        })}</DataTable> : <div className="px-6 py-20 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-400">no entries</p>
          <p className="mt-2 text-sm text-slate-700">Nothing in the register matches these filters.</p>
          {facets.length ? <button type="button" onClick={() => go("/documents")} className="mt-3 text-xs font-semibold text-link hover:underline">Clear the {facets.length} filter{facets.length === 1 ? "" : "s"} →</button> : null}
        </div>}
      </div>

      {paging && total > 0 ? (
        <div data-dt-foot className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-line bg-surface px-5 py-2.5 sm:px-6">
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

    {selected.length ? <div className="dock sticky bottom-4 z-30 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-sm border border-white/10 bg-brand-strong p-2.5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
      <span className="px-2 font-mono text-sm tabular-nums">{allMatching ? total.toLocaleString("en-GB") : selected.length}<span className="ml-1.5 text-[10px] uppercase tracking-[0.12em] text-white/60">selected</span></span>
      {userCanAct && isMigrated("/reviews/send") ? (selectedRevisionIds.length ? <Link href={`/reviews/send?revisions=${encodeURIComponent(selectedRevisionIds.join(","))}`} className="inline-flex items-center gap-1.5 rounded-sm bg-[#d9a441] px-3 py-2 text-xs font-semibold text-brand-ink"><GitPullRequestArrow className="h-4 w-4" /> Send for review ({selectedRevisionIds.length})</Link> : <span className="inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold text-white/55" title="Only documents with a revision being prepared can be sent"><GitPullRequestArrow className="h-4 w-4" /> Nothing ready to send</span>) : null}
      {!isMigrated("/transmittals/new") ? null : transmittableRows.length ? <Link href={transmittalHref} className="inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"><ArrowLeftRight className="h-4 w-4" /> Create transmittal ({transmittableRows.length})</Link> : <span className="inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold text-white/55" title="Only current released revisions may be sent on an outgoing transmittal"><ArrowLeftRight className="h-4 w-4" /> No released revision to transmit</span>}
      {supplier && !supplier.readOnly ? (() => {
        const sendable = selectedRows.map((row) => row.sendRevisionId).filter((id): id is string => !!id);
        return sendable.length ? (
          <form action={sendFromRegister}>
            {sendable.map((id) => <input key={id} type="hidden" name="revisionId" value={id} />)}
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-sm bg-[#d9a441] px-3 py-2 text-xs font-semibold text-brand-ink"><Send className="h-4 w-4" /> Send to {supplier.to} ({sendable.length})</button>
          </form>
        ) : <span className="inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold text-white/55" title="Only documents with a file attached and not yet sent"><Send className="h-4 w-4" /> Nothing ready to send</span>;
      })() : null}
      {userCanAct && isMigrated("/packages/add") ? <Link href={`/packages/add?docs=${encodeURIComponent(selected.join(","))}`} className="inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"><PackagePlus className="h-4 w-4" /> Add to package</Link> : null}
      <a
        href={selectedExportHref}
        onClick={(event) => { event.preventDefault(); window.location.href = exportWith(selectedExportHref); }}
        className="inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"
      >
        <Download className="h-4 w-4" /> Export {allMatching ? "all matching" : "selected"}
      </a>
      <button onClick={() => { setSelected([]); setAllMatching(false); }} className="ml-auto rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Clear selection"><X className="h-4 w-4" /></button>
    </div> : null}
  </>;
}

// ── The columns, in the order they start in ─────────────────────────────────

const COLUMNS: Column[] = [
  {
    key: "docState", sort: "docState",
    label: "Document state",
    note: "Where the document itself stands: planned, active, superseded, withdrawn. It is about the document, not any one revision.",
    cellClass: "whitespace-nowrap",
    cell: (row, codes) => <CodeRef code={row.docStateLabel} note={codes[`DOC_STATE|${row.docState}`]} href={GUIDE.DOC_STATE} className="meta font-sans!" />,
  },
  {
    key: "rev", sort: "rev",
    label: "Rev",
    cellClass: "font-mono text-[13px] font-semibold tabular-nums text-slate-900",
    cell: (row) => row.revision ?? <Muted />,
  },
  {
    key: "revState", sort: "revState",
    label: "Revision state",
    note: "Where the latest revision stands: in preparation, in review, for release once decided, released, superseded, void. Who is holding a review up, and the comments on it, are on the review itself.",
    cellClass: "whitespace-nowrap",
    cell: (row, codes) => (
      <>
        <CodeRef code={row.revStateLabel} note={codes[`REV_STATE|${row.revState ?? ""}`]} href={row.revState ? GUIDE.REV_STATE : undefined} className={`meta font-sans! ${REV_INK[row.revState ?? ""] ?? ""}`} />
        {/* Released, and nobody asked for it to be sent. It is in use; nobody
            has been told, including anyone whose approval it may still need. */}
      </>
    ),
  },
  {
    key: "verdict", sort: "verdict",
    label: "Review verdict",
    note: "What the deciding step of the review route said about this revision. Advice from earlier steps is on the review itself, not here.",
    cellClass: "whitespace-nowrap text-xs",
    cell: (row) =>
      row.verdict ? <CodeRef code={row.verdict} note={row.verdictLabel ?? undefined} href={GUIDE.VERDICT} className="code-chip" />
        : row.verdictLabel ? <span className="meta">{row.verdictLabel}</span> : <Muted />,
  },
  {
    key: "releasedFor", sort: "releasedFor",
    label: "Released for",
    note: "What the revision is issued for — IFC, AFC, AB and the rest. Every step of a review route sets it or confirms it. Whether it is in force is the revision state beside it: a revision that is Not released carries its status but nobody may work from it.",
    cellClass: "whitespace-nowrap text-xs",
    cell: (row, codes) =>
      /* The status prints the same whether or not it is in force. Which it is
         is the revision state, in its own column, where it belongs. */
      !row.releasedFor && row.proposedFor ? (
        <CodeRef code={row.proposedFor} note={`${codes[`STATUS|${row.proposedFor}`] ?? row.proposedFor}

The revision is not released, so this status is not in force.`} href={GUIDE.STATUS} className="code-chip code-chip-held" />
      ) : row.releasedFor ? (
        <CodeRef code={row.releasedFor} note={codes[`STATUS|${row.releasedFor}`]} href={GUIDE.STATUS} className="code-chip code-chip-live" />
      ) : <Muted />,
  },
  { key: "created", sort: "created", label: "Created", headClass: "text-right", cellClass: "whitespace-nowrap text-right font-mono text-xs tabular-nums", cell: (row) => date(row.createdDate) },
  { key: "updated", sort: "updated", label: "Updated", headClass: "text-right", cellClass: "whitespace-nowrap text-right font-mono text-xs tabular-nums text-slate-500", cell: (row) => date(row.updatedAt) },
  { key: "discipline", sort: "discipline", label: "Discipline", cellClass: "whitespace-nowrap text-xs text-slate-600", cell: (row) => row.disciplineLabel },
  {
    key: "phase", sort: "phase", label: "Phase",
    note: "Which phase the newest revision serves. A document spans several — issued for detail design, later as-built — so the phase belongs to the revision, not to the document.",
    cellClass: "whitespace-nowrap text-xs text-slate-600",
    cell: (row) => row.phaseLabel ?? <span className="text-slate-300">—</span>,
  },
  {
    key: "owedBy", label: "Owed by",
    note: "The scheduled activities that list this document. An activity owes many documents, and a document can be owed by more than one.",
    cellClass: "text-xs text-slate-600",
    cell: (row) => row.actions.length
      ? <span className="flex flex-wrap gap-1">{row.actions.map((one) => <span key={one.code} title={one.name} className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-600">{one.code}</span>)}</span>
      : <span className="text-slate-300">—</span>,
  },
  { key: "docType", sort: "docType", label: "Type", cellClass: "max-w-48 truncate text-xs text-slate-600", cell: (row) => row.docTypeLabel },
  {
    key: "deliverable", sort: "deliverable", label: "Produced by",
    note: "Who produces this kind of deliverable — our own engineering, a contractor, a vendor, the client. It decides which numbering scheme the document is numbered under.",
    cellClass: "max-w-40 truncate text-xs text-slate-600",
    cell: (row) => row.deliverableLabel,
  },
  {
    key: "receivedFrom", label: "Received from",
    note: "Who asked this document of you. They created the placeholder; you send the file.",
    cellClass: "whitespace-nowrap text-xs text-slate-600",
    cell: (row) => row.receivedFrom ?? <Muted />,
  },
  {
    key: "originator", sort: "originator",
    label: "Originator",
    note: "The party that produced it. Empty means we did.",
    cellClass: "whitespace-nowrap font-mono text-xs text-slate-700",
    cell: (row) => row.originator ?? <Muted />,
  },
  { key: "subProject", sort: "subProject", label: "Sub-project", cellClass: "whitespace-nowrap font-mono text-xs text-slate-700", cell: (row) => row.subProject ?? <Muted /> },
  { key: "contract", sort: "contract", label: "Contract", cellClass: "whitespace-nowrap font-mono text-xs text-slate-700", cell: (row) => row.contractRef ?? <Muted /> },
  {
    key: "criticality", sort: "criticality",
    label: "Criticality",
    note: "How serious an error in it would be. It decides who must approve, how long it is kept, and the format it is kept in.",
    cellClass: "whitespace-nowrap",
    cell: (row, codes) => row.criticality
      ? <CodeRef code={codes[`CRITICALITY_SHORT|${row.criticality}`] ?? row.criticality.replaceAll("_", " ").toLowerCase()} note={codes[`CRITICALITY|${row.criticality}`]} href={GUIDE.CRITICALITY} className="meta font-sans!" />
      : <Muted />,
  },
  {
    key: "confidentiality", sort: "confidentiality",
    label: "Confidentiality",
    note: "Who may see it. Above the open levels it is read only by the people named on the document itself — to anybody else it is not in lists, counts or searches.",
    cellClass: "whitespace-nowrap",
    cell: (row, codes) => row.confidentiality
      ? <CodeRef code={codes[`CONFIDENTIALITY_SHORT|${row.confidentiality}`] ?? row.confidentiality.toLowerCase()} note={codes[`CONFIDENTIALITY|${row.confidentiality}`]} href={GUIDE.CONFIDENTIALITY} className="meta font-sans!" />
      : <Muted />,
  },
  {
    key: "retention", sort: "retention",
    label: "Kept for",
    note: "How long this document must be kept, and in what form, once the project closes. It follows from how critical it is.",
    cellClass: "max-w-40 truncate text-xs text-slate-600",
    cell: (row) => row.retentionLabel ?? <Muted />,
  },
  { key: "planned", sort: "planned", label: "Planned submission", headClass: "text-right", cellClass: "whitespace-nowrap text-right font-mono text-xs tabular-nums", cell: (row) => row.plannedSubmissionDate ? date(row.plannedSubmissionDate) : <Muted /> },
  { key: "issued", sort: "issued", label: "Issued", headClass: "text-right", cellClass: "whitespace-nowrap text-right font-mono text-xs tabular-nums", cell: (row) => row.issueDate ? date(row.issueDate) : <Muted /> },
  { key: "released", sort: "released", label: "Released", headClass: "text-right", cellClass: "whitespace-nowrap text-right font-mono text-xs tabular-nums", cell: (row) => row.releasedAt ? date(row.releasedAt) : <Muted /> },
  {
    key: "decidedBy",
    label: "Decided by",
    note: "The function whose authority released this revision. Who exactly gave the verdict is on the review, not in the register.",
    cellClass: "max-w-40 truncate text-xs text-slate-600",
    cell: (row) => row.decidedBy ? <span title={row.decidedByDelegated ? "Given by delegation" : undefined}>{row.decidedBy}{row.decidedByDelegated ? " ·" : ""}</span> : <Muted />,
  },
  { key: "packages", label: "In packages", headClass: "text-right", cellClass: "text-right font-mono text-xs tabular-nums", cell: (row) => row.packageCount || <Muted /> },
  { key: "revStarted", sort: "revStarted", label: "Revision started", headClass: "text-right", cellClass: "whitespace-nowrap text-right font-mono text-xs tabular-nums", cell: (row) => row.revStarted ? date(row.revStarted) : <Muted /> },
  { key: "fileAdded", sort: "fileAdded", label: "File added", headClass: "text-right", cellClass: "whitespace-nowrap text-right font-mono text-xs tabular-nums", cell: (row) => row.fileAdded ? date(row.fileAdded) : <Muted /> },
];

// ── Pieces ──────────────────────────────────────────────────────────────────

/** A filter on a rule: it submits its form on change, and shows when it is on. */
function Filter({ name, value, empty, options, disabled }: { name: string; value: string; empty: string; options: Opt[]; disabled?: boolean }) {
  return (
    <label className="min-w-0 flex-1">
      <span className="sr-only">{empty}</span>
      <select
        name={name}
        defaultValue={value}
        disabled={disabled}
        data-on={value ? "true" : "false"}
        className="plain w-full disabled:cursor-not-allowed disabled:opacity-40"
      >
        <option value="">{empty}</option>
        {options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
      </select>
    </label>
  );
}

/** A day, written the way the register writes every other date. */
function day(value: string) { return value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : ""; }

/**
 * A published code, shown as the code alone. What it means arrives on hover,
 * and the whole list is one click away in the guide — so the register stays a
 * register, and nobody has to memorise IFC, C2 or AB to read it.
 */
function CodeRef({ code, note, href, className }: { code: string; note?: string; href?: string; className?: string }) {
  const body = <span className={`code-ref ${className ?? ""}`}>{code}</span>;
  // A code with a note but nowhere to go still says, under the cursor, that
  // hovering it will tell you something.
  if (!href) return <span title={note} className={note ? "cursor-help" : undefined}>{body}</span>;
  return <Link href={href} title={note ? `${note}\n\nEvery code, and what it means →` : undefined} scroll={false}>{body}</Link>;
}

/** A column header that orders the register. The arrow is always there, dim. */
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

function Muted() { return <span className="text-slate-300">·</span>; }

/** One step through the register. A step that leads nowhere is shown, and dead. */
function PageStep({ onClick, disabled, label, children }: { onClick: () => void; disabled: boolean; label: string; children: React.ReactNode }) {
  if (disabled) return <span aria-disabled className="rounded-sm p-1 text-slate-300">{children}</span>;
  return <button type="button" onClick={onClick} aria-label={label} className="rounded-sm p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-ink">{children}</button>;
}

function date(value: string | null) { return value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—"; }
