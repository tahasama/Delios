"use client";
import { startDownload } from "@/components/downloads";
import { Select } from "@/components/select";

import { setAssetDocumentsAction } from "@/lib/records/forms";
import { setPackageMembersAction } from "@/lib/packages/forms";
import Link from "next/link";
import { saveRegisterView, deleteRegisterView } from "@/lib/documents/forms-register-views";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpDown, Download, GitPullRequestArrow, PackagePlus, Pin, PinOff, Search, Send, X } from "lucide-react";
import { FilterMenu } from "@/components/filter-menu";
import { FilterOptions } from "@/components/filter-options";
import { sendSupplierFromRegisterAction as sendFromRegister } from "@/lib/packages/forms-supplier";
import { TablePaging } from "@/components/table-paging";
import { DataTable } from "@/components/data-table";
import { DateWindow } from "@/components/date-window";
import { Th, Td, Info } from "@/components/ui";
import { stateLook, stateHref } from "@/lib/core/state-look";
import { useCardHeight } from "@/components/card-height";
import { ActionForm } from "@/components/form";
import { setActionDocumentsAction } from "@/lib/actions/forms-links";
import { chooseListSourceAction } from "@/lib/actions/forms-lists";
import { CalendarCheck } from "lucide-react";

/** Available from the Columns menu; off until someone wants them. */
const OPTIONAL = ["Received from", "Document state", "Review verdict", "Originator", "Sub-project", "Contract", "Criticality", "Confidentiality", "Planned submission", "Issued", "Released", "Decided by", "In packages", "Kept for", "Produced by", "Revision started", "File added"];

/** Which column each date filter talks about, so filtering by it shows it. */
const DATE_COLUMN: Record<string, string> = {
  created: "Created", revStarted: "Revision started", fileAdded: "File added",
  planned: "Planned submission", issued: "Issued", released: "Released", updated: "Updated",
};

type RegisterRow = {
  /** The answers to the project's own fields and lists of its own (Forms & fields). */
  extras?: Record<string, string> | null;
  id: string; docNumber: string; title: string; deliverableType: string; docType: string; discipline: string;
  originator: string | null; subProject: string | null;
  /** For an outside organization: who asked it of them. Their sendable revision, once a file is on it. */
  receivedFrom?: string | null; sendRevisionId?: string | null; contractRef: string | null; criticality: string | null;
  confidentiality: string | null; retentionClass: string | null; retentionLabel: string | null; placeholder: boolean;
  /** A supplier's placeholder asked of them on a transmittal: stamped "requested" instead of "number reserved". */
  requested?: boolean;
  /** A supplier's document: where it stands, as a stamp in the reader's words. */
  supplierStamp?: string | null;
  /** Taken as it came, under its supplier's number and revisions: stamped in red. */
  asReceived?: boolean;
  docTypeLabel: string; disciplineLabel: string; deliverableLabel: string;
  /** What the newest revision serves, and the activities that list this document. */
  phase: string | null; phaseLabel: string | null;
  actions: { code: string; name: string }[];
  docState: string; docStateLabel: string;
  revision: string | null; revState: string | null; revStateLabel: string;
  /** Asked of a supplier: the stage it reads in (`SENT`, `ACCEPTED`…), coloured as its own. */
  supplierStage?: string | null;
  verdict: string | null; verdictLabel: string | null;
  releasedFor: string | null; releasedForLabel: string | null; releasedForUse: string | null; proposedFor: string | null;
  /** Released, then put on hold for an outside approval: not for use. */
  onHold: string | null;
  createdDate: string; updatedAt: string; plannedSubmissionDate: string | null;
  /** What the planned date says today: ready, submitted, overdue, at risk, days left. */
  plannedState?: { word: string; tone: string } | null; issueDate: string | null; releasedAt: string | null;
  decidedBy: string | null; packageCount: number; hasReleased: boolean; reviewRevisionId: string | null;
  fileAdded: string | null; revStarted: string | null; decidedByDelegated: boolean;
};
/** A choice of a filter; `group` names the set of its list it is in, when the list has several (owner: every set's values, said whose). */
type Opt = { code: string; label: string; group?: string };

/** The filters a person may show or hide (the "Filters" menu), in the order they stand. */
const REGISTER_FILTERS = [
  { key: "state", label: "Document state" }, { key: "rev", label: "Revision state" }, { key: "status", label: "Released for" },
  { key: "verdict", label: "Verdict" }, { key: "supplier", label: "Supplier" }, { key: "po", label: "Contract / PO" },
  { key: "discipline", label: "Discipline" }, { key: "docType", label: "Type" }, { key: "date", label: "Dates" },
  { key: "criticality", label: "Criticality" }, { key: "confidentiality", label: "Confidentiality" },
  { key: "deliverable", label: "Deliverable type" }, { key: "phase", label: "Phase" }, { key: "action", label: "Owed by activity" },
] as const;


type Paging = {
  page: number;
  pages: number;
  perPage: number;
  sizes: number[];
  from: number;
  to: number;
  /** The filters as a query string, without page or per: the register builds the rest. */
  query: string;
};

type Filters = { pick: string; q: string; terms: string[]; state: string; rev: string; status: string; verdict: string; supplier: string; po: string; discipline: string; docType: string; criticality: string; confidentiality: string; deliverable: string; phase: string; action: string; view: string; on: string; from: string; to: string };

/** Where each kind of code is explained: the states on Help, a list's values in Types & sets (read by everyone of ours). */
const GUIDE: Record<string, string> = {
  VERDICT: "/settings/config?set=REVIEW_OUTCOMES",
  STATUS: "/settings/config?set=STATUSES",
  CRITICALITY: "/settings/config?set=CRITICALITY",
  CONFIDENTIALITY: "/settings/config?set=CONFIDENTIALITY",
};
/** A list's page in Types & sets, for a reader who opens it (`codes["@lists"]`, set for our people only). */
const listHref = (codes: Record<string, string>, key: string) => (codes["@lists"] ? GUIDE[key] : undefined);


/** The state a row reads in: a supplier's stage when it was asked of one, else its revision's (`lib/core/state-look.ts`). */
const stateOf = (row: { supplierStage?: string | null; revState: string | null }) => row.supplierStage ?? row.revState ?? "NONE";

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

/** The register opened for one action: what it needs now, ticked; its disciplines, for what is added. */
/** The register opened for something to choose documents for: an action (tick to add, untick to take off), or a supplier's package (tick to add). */
type Picking = { kind: "action" | "package" | "transmittal" | "review" | "asset" | "source"; actionId: string; packageId: string; code: string; name: string; linked: string[]; disciplines: { code: string; label: string }[];
  /** For a form being filled (a transmittal, a review): where "Continue" goes back to, with the ticks as `docs`. */
  back?: string;
  /** For a list's register document: the page the list is brought in on, gone back to once chosen. */
  returnTo?: string;
  /** In a supplier's package and already sent to the supplier: they stay, so they cannot be unticked. */
  locked?: string[] };

/** The form's address with the documents ticked, as `docs`. */
function withDocs(back: string, ids: string[]) {
  const [path, query = ""] = back.split("?");
  const params = new URLSearchParams(query);
  if (ids.length) params.set("docs", ids.join(",")); else params.delete("docs");
  return `${path}?${params.toString()}`;
}

export function DocumentRegister({ rows, total, userCanAct, filters, filterOptions, exportHref, plate, paging, codes, sort, views, supplier, picking, mayAddToAction, shownFilters, own = [] }: {
  /** Opened from an action, by the control function: tick to add, untick to take off. */
  picking?: Picking | null;
  /** the control function: the selection can be added to an action. */
  mayAddToAction?: boolean;
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
  /** The filters this person keeps shown (Filters menu); one holding a value always shows. */
  shownFilters: string[];
  /**
   * The project's own fields and lists of its own (Forms & fields): each a column when asked for in the register, and
   * one with choices a filter (`own.<key>`), with the value it holds now.
   */
  own?: { key: string; label: string; column: boolean; value: string; options: { code: string; label: string; group?: string }[] | null }[];
  filterOptions: { states: Opt[]; revStates: Opt[]; statuses: Opt[]; verdicts: Opt[]; suppliers: Opt[]; pos: Opt[]; disciplines: Opt[]; types: Opt[]; criticalities: Opt[]; confidentialities: Opt[]; deliverables: Opt[]; phases: Opt[]; actions: Opt[]; dateFields: Opt[] };
  exportHref: string;
}) {
  const router = useRouter();
  // Every register is the height the schedule's plan set.
  const cardHeight = useCardHeight();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>(() => picking?.linked ?? []);
  const [allMatching, setAllMatching] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  const [frozen, setFrozen] = useState(true);
  // Apply is lit only while typed words or dates wait to be applied; a dropdown applies by itself.
  const [dirty, setDirty] = useState(false);
  useEffect(() => setDirty(false), [filters.q, filters.on, filters.from, filters.to]);
  const held = (key: string) => key === "date" ? !!(filters.on && (filters.from || filters.to))
    : key.startsWith("own.") ? !!own.find((o) => `own.${o.key}` === key)?.value
    : !!(filters as unknown as Record<string, string>)[key];
  // The project's own columns, after the app's.
  const ownColumns: Column[] = own.filter((o) => o.column).map((o) => ({
    key: `own.${o.key}`, label: o.label, cellClass: "text-[13px] text-slate-700",
    cell: (row) => { const held = row.extras?.[o.key]; return held ? o.options?.find((x) => x.code === held)?.label ?? held : <Muted />; },
  }));
  const allColumns = [...COLUMNS, ...ownColumns];
  const visible = (key: string) => shownFilters.includes(key) || held(key);

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
    if (!order) return allColumns;
    const byKey = new Map(allColumns.map((column) => [column.key, column]));
    const moved = order.map((key) => byKey.get(key)).filter((column): column is Column => !!column);
    return [...moved, ...allColumns.filter((column) => !order.includes(column.key))];
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
  // The one exception to "only released revisions travel": a supplier's placeholder not asked yet, asked of that
  // supplier. The control function's; the new transmittal keeps one supplier's own. Its package can send them too.
  const placeholderRows = mayAddToAction ? selectedRows.filter((row) => !row.hasReleased && !!row.originator && !row.requested) : [];
  // Opened for an action, the ticks span pages: the box at the top ticks or unticks this page only.
  const pageSelected = rows.length > 0 && (picking ? rows.every((row) => selected.includes(row.id)) : selected.length === rows.length);
  const transmittalHref = `/transmittals/new?docs=${encodeURIComponent(transmittableRows.map((row) => row.id).join(","))}`
    + (placeholderRows.length ? `&placeholders=${encodeURIComponent(placeholderRows.map((row) => row.id).join(","))}` : "");
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
    return allColumns.map((column) => column.label).filter((label) => !hidden.has(label));
  };
  const exportWith = (href: string) => {
    const url = new URL(href, window.location.origin);
    url.searchParams.set("cols", shownColumns().join("|"));
    return url.pathname + url.search;
  };
  const selectedExportHref = allMatching ? exportHref : selected.length ? `/api/register/export?ids=${encodeURIComponent(selected.join(","))}` : exportHref;
  function toggle(id: string) {
    if (picking?.locked?.includes(id)) return;
    setAllMatching(false);
    // A list is read from one document: ticking one unticks the other.
    if (picking?.kind === "source") { setSelected((current) => current.includes(id) ? [] : [id]); return; }
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
  if (filters.deliverable) facets.push({ key: "deliverable type", label: labelIn(filterOptions.deliverables, filters.deliverable), without: drop("deliverable") });
  if (filters.phase) facets.push({ key: "phase", label: labelIn(filterOptions.phases, filters.phase), without: drop("phase") });
  if (filters.action) facets.push({ key: "owed by", label: labelIn(filterOptions.actions, filters.action), without: drop("action") });

  const adding = picking ? selected.filter((id) => !picking.linked.includes(id)) : [];
  const leaving = picking ? picking.linked.filter((id) => !selected.includes(id)) : [];

  return <>
    {picking ? (
      <section className="register register-sheet register-sheet-open mb-4 px-5 py-3.5 sm:px-6">
        {picking.back || picking.kind === "source" ? (
          <p className="text-sm font-semibold text-slate-800">{picking.kind === "source" ? `The register document the ${picking.name.toLowerCase()} is read from` : picking.name}</p>
        ) : (
          <p className="text-sm font-semibold text-slate-800">
            Documents for <Link href={picking.kind === "asset" ? `/assets/${picking.packageId}` : picking.kind === "package" ? `/packages/${picking.code}` : `/actions/${picking.code}`} className="font-mono text-brand-ink hover:underline">{picking.code}</Link>
            <span className="ml-2 font-normal text-slate-600">{picking.name}</span>
          </p>
        )}
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {picking.kind === "source"
            ? "Tick the one document that holds it: its released revision's file is what the list is read from, unless a file uploaded since stands. Search and filter freely, the tick stays. Then save below."
            : picking.back
            ? "Tick what goes with it; search and filter freely, the ticks stay. Then continue below."
            : picking.kind === "asset"
            ? "Ticked are the documents that describe it. Tick a document to link it, untick one to unlink it; search and filter freely, the ticks stay. Then save below."
            : picking.kind === "package"
            ? "Ticked is what the package holds. Tick a document to add it, untick one to take it out (one already sent to its supplier stays); search and filter freely, the ticks stay. Then save below."
            : "Ticked is what it needs. Tick a document to add it, untick one to take it off; search and filter freely, the ticks stay. Then save below."}
        </p>
      </section>
    ) : null}
    <section className="register register-sheet register-sheet-open mb-4">
      {plate}

      {/* Search gets its own line: it is how most people arrive, and it takes
          several terms at once. The filters sit under it, on their own rule. */}
      <form
        key={paging?.query ?? ""}
        action="/documents"
        onSubmit={(event) => {
          event.preventDefault();
          setDirty(false);
          const data = new FormData(event.currentTarget);
          const params = new URLSearchParams();
          for (const [key, value] of data.entries()) if (value && key !== "view") params.set(key, String(value));
          go(`/documents${params.size ? `?${params}` : ""}`);
        }}
        onChange={(event) => { if (!(event.target as HTMLElement).dataset.instant) setDirty(true); }}
        className="asking border-b border-line px-5 py-3.5 sm:px-6"
      >
        {/* Opened for an action: narrowing keeps it open for that action. */}
        {filters.pick ? <input type="hidden" name="pick" value={filters.pick} /> : null}
        <div className="flex items-center gap-3">
          <label className="search-field relative min-w-0 flex-1">
            <span className="sr-only">Search the register</span>
            <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              name="q"
              defaultValue={filters.q}
              placeholder={'A space narrows, a comma widens: pump ME  ·  P-101, P-102  ·  "feed pump"'}
              className="plain w-full pl-6!"
            />
          </label>
          {/* Nothing is asked of the database until this is pressed. A query
              per keystroke, or per choice, is what a register of tens of
              thousands cannot afford. */}
          {/* One button, one state: while the answer is being fetched it says so
              in place, rather than beside a word that is no longer true. */}
          <button className="ask" data-on={dirty ? "true" : "false"} disabled={pending}>
            {pending ? "Filtering" : "Apply"}
          </button>
        </div>

        {/* Five to a row: the filters this person keeps shown, each in its place, and the menu that shows or hides them. */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-3 md:grid-cols-5">
          {visible("state") ? <Filter name="state" value={filters.state} empty="Document state" options={filterOptions.states} /> : null}
          {visible("rev") ? <Filter name="rev" value={filters.rev} empty="Revision state" options={filterOptions.revStates} /> : null}
          {visible("status") ? <Filter name="status" value={filters.status} empty="Released for" options={filterOptions.statuses} /> : null}
          {visible("verdict") ? <Filter name="verdict" value={filters.verdict} empty="Verdict" options={filterOptions.verdicts} /> : null}
          {visible("supplier") ? <Filter name="supplier" value={filters.supplier} empty="Supplier" options={filterOptions.suppliers} /> : null}
          {visible("po") ? <Filter name="po" value={filters.po} empty="Contract / PO" options={filterOptions.pos} /> : null}
          {visible("discipline") ? <Filter name="discipline" value={filters.discipline} empty="Discipline" options={filterOptions.disciplines} /> : null}
          {visible("docType") ? <Filter name="docType" value={filters.docType} empty="Type" options={filterOptions.types} /> : null}
          {visible("date") ? <DateWindow fields={filterOptions.dateFields} on={filters.on} from={filters.from} to={filters.to} /> : null}
          {visible("criticality") ? <Filter name="criticality" value={filters.criticality} empty="Criticality" options={filterOptions.criticalities} /> : null}
          {visible("confidentiality") ? <Filter name="confidentiality" value={filters.confidentiality} empty="Confidentiality" options={filterOptions.confidentialities} /> : null}
          {visible("deliverable") ? <Filter name="deliverable" value={filters.deliverable} empty="Deliverable type" options={filterOptions.deliverables} /> : null}
          {visible("phase") ? <Filter name="phase" value={filters.phase} empty="Phase" options={filterOptions.phases} /> : null}
          {visible("action") && filterOptions.actions.length ? <Filter name="action" value={filters.action} empty="Owed by activity" options={filterOptions.actions} /> : null}
          {own.filter((o) => o.options && visible(`own.${o.key}`)).map((o) => <Filter key={o.key} name={`own.${o.key}`} value={o.value} empty={o.label} options={o.options!} />)}
          <FilterMenu page="register" shown={shownFilters}
            filters={[...REGISTER_FILTERS.filter((f) => f.key !== "action" || filterOptions.actions.length).map((f) => ({ key: f.key, label: f.label as string })),
              ...own.filter((o) => o.options).map((o) => ({ key: `own.${o.key}`, label: o.label }))].map((f) => ({ ...f, held: held(f.key) }))} />
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
              className="plain w-44"
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
      {!picking && pageSelected && paging && total > rows.length ? (
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
        {rows.length ? <DataTable id="register" className="rounded-none border-0 shadow-none" stretch={!!cardHeight} paging={paging && total > 0 ? <TablePaging from={paging.from} to={paging.to} total={total} page={paging.page} pages={paging.pages} onPage={(page) => go(pageHref({ page }))} perPage={paging.perPage} sizes={paging.sizes} onSize={(per) => go(pageHref({ per, page: 1 }))} /> : undefined} defaultHidden={OPTIONAL} onMove={move} onReorder={moveTo} forced={forced} fill tools={
          <a
            href={exportHref}
            onClick={(event) => { event.preventDefault(); startDownload(exportWith(exportHref), "The register"); }}
            className="dt-tool"
            title="The rows these filters match, in the columns you are looking at, as CSV"
          >
            <Download className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">Export</span>
          </a>
        } head={<tr>
          <Th className={`rail-head ${frozen ? "sticky left-0 z-4" : ""} w-10`}>
            <input
              aria-label="Select every document on this page"
              title="Selects this page. The register offers every match above."
              type="checkbox"
              checked={pageSelected}
              onChange={() => {
                setAllMatching(false);
                const page = rows.map((row) => row.id);
                if (picking?.kind === "source") return;
                if (picking) setSelected((now) => pageSelected ? now.filter((id) => !page.includes(id) || !!picking.locked?.includes(id)) : [...new Set([...now, ...page])]);
                else setSelected(pageSelected ? [] : page);
              }}
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
            <Td className={`rail ${stateLook(stateOf(row)).rail} ${frozen ? "sticky left-0 z-1" : ""} ${pin}`}>
              <input aria-label={`Select ${row.docNumber}`} type="checkbox" checked={on} onChange={() => toggle(row.id)}
                disabled={!!picking?.locked?.includes(row.id)} title={picking?.locked?.includes(row.id) ? "Sent to the supplier: it stays in the package" : undefined} />
            </Td>
            <Td className={`${frozen ? "sticky left-10 z-1" : ""} min-w-70 ${pin}`}>
              <span className="relative flex items-center gap-1.5">
                <Link href={`/documents/${row.id}`} className="doc-number relative z-1 whitespace-nowrap">{row.docNumber}</Link>
                {row.revState === "SUPERSEDED" ? <span className="stamp text-violet-700">superseded</span> : null}
                {row.revState === "VOID" ? <span className="stamp text-red-700">void</span> : null}
                {row.docState === "CANCELLED" ? <span className="stamp text-slate-500">cancelled</span> : null}
                {row.docState === "WITHDRAWN" ? <span className="stamp text-red-700">withdrawn</span> : null}
                {row.docState === "ARCHIVED" ? <span className="stamp text-slate-500">archived</span> : null}
                {row.asReceived ? <span className="stamp text-red-700" title="Its number, revisions and states are its sender's, not ours">as received</span> : null}
                {row.supplierStamp ? <span className="stamp text-sky-700">{row.supplierStamp}</span> : row.placeholder ? <span className="stamp text-slate-500">{row.originator ? "not sent to supplier" : "number reserved"}</span> : null}
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

    </section>

    {picking?.back ? (
      <div className="dock palette-light sticky bottom-4 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-sm border border-white/10 bg-brand-strong p-2.5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
        <span className="px-2 text-xs">
          <span className="font-mono text-sm tabular-nums">{selected.length}</span>
          <span className="ml-1.5 text-[10px] uppercase tracking-[0.12em] text-white/60">ticked</span>
        </span>
        <Link href={withDocs(picking.back, selected)} className="inline-flex items-center gap-1.5 rounded-sm bg-gold px-3 py-2 text-xs font-semibold text-brand-ink">Continue with {selected.length}</Link>
        <Link href={withDocs(picking.back, picking.linked)} className="ml-auto rounded-sm px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white">Back without changing</Link>
      </div>
    ) : picking?.kind === "source" ? (
      <div className="dock palette-light sticky bottom-4 z-30 mx-auto w-fit max-w-full rounded-sm border border-white/10 bg-brand-strong p-2.5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
        <ActionForm action={chooseListSourceAction} submitLabel={`Use it for the ${picking.name.toLowerCase()}`} size="sm"
          hidden={{ kind: picking.code, documentId: selected[0] ?? "", back: picking.returnTo === "/import" ? "import" : "schedule" }} className="flex flex-wrap items-center gap-2 space-y-0">
          <span className="px-2 text-xs">
            <span className="font-mono text-sm tabular-nums">{selected.length}</span>
            <span className="ml-1.5 text-[10px] uppercase tracking-[0.12em] text-white/60">ticked</span>
            {selected.length ? null : <span className="ml-2 text-white/60">tick the document that holds it</span>}
          </span>
          <Link href={picking.returnTo ?? "/schedule"} className="ml-auto rounded-sm px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white">Back without saving</Link>
        </ActionForm>
      </div>
    ) : picking?.kind === "asset" ? (
      <div className="dock palette-light sticky bottom-4 z-30 mx-auto w-fit max-w-full rounded-sm border border-white/10 bg-brand-strong p-2.5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
        <ActionForm action={setAssetDocumentsAction} submitLabel="Save" size="sm" hidden={{ assetId: picking.packageId }} className="flex flex-wrap items-center gap-2 space-y-0">
          {adding.map((id) => <input key={id} type="hidden" name="add" value={id} />)}
          {leaving.map((id) => <input key={id} type="hidden" name="remove" value={id} />)}
          <span className="px-2 text-xs">
            <span className="font-mono text-sm tabular-nums">{selected.length}</span>
            <span className="ml-1.5 text-[10px] uppercase tracking-[0.12em] text-white/60">ticked for {picking.code}</span>
            {adding.length || leaving.length ? <span className="ml-2 text-white/80">{adding.length} to link · {leaving.length} to unlink</span> : <span className="ml-2 text-white/60">nothing changed yet</span>}
          </span>
          <Link href={`/assets/${picking.packageId}`} className="ml-auto rounded-sm px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white">Back without saving</Link>
        </ActionForm>
      </div>
    ) : picking?.kind === "package" ? (
      <div className="dock palette-light sticky bottom-4 z-30 mx-auto w-fit max-w-full rounded-sm border border-white/10 bg-brand-strong p-2.5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
        <ActionForm action={setPackageMembersAction} submitLabel="Save" size="sm" hidden={{ packageId: picking.packageId }} className="flex flex-wrap items-center gap-2 space-y-0">
          {adding.map((id) => <input key={id} type="hidden" name="add" value={id} />)}
          {leaving.map((id) => <input key={id} type="hidden" name="remove" value={id} />)}
          <span className="px-2 text-xs">
            <span className="font-mono text-sm tabular-nums">{selected.length}</span>
            <span className="ml-1.5 text-[10px] uppercase tracking-[0.12em] text-white/60">ticked for {picking.code}</span>
            {adding.length || leaving.length ? <span className="ml-2 text-white/80">{adding.length} to add · {leaving.length} to take out</span> : <span className="ml-2 text-white/60">nothing changed yet</span>}
          </span>
          <Link href={`/packages/${picking.code}`} className="ml-auto rounded-sm px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white">Back without saving</Link>
        </ActionForm>
      </div>
    ) : picking ? (
      <div className="dock palette-light sticky bottom-4 z-30 mx-auto w-fit max-w-full rounded-sm border border-white/10 bg-brand-strong p-2.5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
        <ActionForm action={setActionDocumentsAction} submitLabel="Save" size="sm" hidden={{ actionId: picking.actionId }} className="flex flex-wrap items-center gap-2 space-y-0">
          {selected.map((id) => <input key={id} type="hidden" name="documentIds" value={id} />)}
          <span className="px-2 text-xs">
            <span className="font-mono text-sm tabular-nums">{selected.length}</span>
            <span className="ml-1.5 text-[10px] uppercase tracking-[0.12em] text-white/60">ticked for {picking.code}</span>
            {adding.length || leaving.length ? <span className="ml-2 text-white/80">{adding.length} to add · {leaving.length} to take off</span> : <span className="ml-2 text-white/60">nothing changed yet</span>}
          </span>
          <Link href={`/actions/${picking.code}`} className="ml-auto rounded-sm px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white">Back without saving</Link>
        </ActionForm>
      </div>
    ) : selected.length ? <div className="dock palette-light sticky bottom-4 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-sm border border-white/10 bg-brand-strong p-2.5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
      <span className="px-2 font-mono text-sm tabular-nums">{allMatching ? total.toLocaleString("en-GB") : selected.length}<span className="ml-1.5 text-[10px] uppercase tracking-[0.12em] text-white/60">selected</span></span>
      {userCanAct ? (selectedRevisionIds.length ? <Link href={`/reviews/send?revisions=${encodeURIComponent(selectedRevisionIds.join(","))}`} className="inline-flex items-center gap-1.5 rounded-sm bg-gold px-3 py-2 text-xs font-semibold text-brand-ink"><GitPullRequestArrow className="h-4 w-4" /> Send for review ({selectedRevisionIds.length})</Link> : null) : null}
      {transmittableRows.length + placeholderRows.length ? <Link href={transmittalHref} className="inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"><ArrowLeftRight className="h-4 w-4" /> Create transmittal ({transmittableRows.length + placeholderRows.length})</Link> : null}
      {supplier && !supplier.readOnly ? (() => {
        const sendable = selectedRows.map((row) => row.sendRevisionId).filter((id): id is string => !!id);
        return sendable.length ? (
          <form action={sendFromRegister}>
            {sendable.map((id) => <input key={id} type="hidden" name="revisionId" value={id} />)}
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-sm bg-gold px-3 py-2 text-xs font-semibold text-brand-ink"><Send className="h-4 w-4" /> Send to {supplier.to} ({sendable.length})</button>
          </form>
        ) : null;
      })() : null}
      {userCanAct ? <Link href={`/packages/add?docs=${encodeURIComponent(selected.join(","))}`} className="inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"><PackagePlus className="h-4 w-4" /> Add to package</Link> : null}
      {mayAddToAction ? <Link href={`/actions/add?docs=${encodeURIComponent(selected.join(","))}`} className="inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"><CalendarCheck className="h-4 w-4" /> Add to action</Link> : null}
      <a
        href={selectedExportHref}
        onClick={(event) => { event.preventDefault(); startDownload(exportWith(selectedExportHref), "The register"); }}
        className="inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"
      >
        <Download className="h-4 w-4" /> Export {allMatching ? "all matching" : "selected"}
      </a>
      <button onClick={() => { setSelected([]); setAllMatching(false); }} className="ml-auto rounded-sm p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Clear selection"><X className="h-4 w-4" /></button>
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
    cell: (row, codes) => <CodeRef code={row.docStateLabel} note={codes[`DOC_STATE|${row.docState}`]} href={stateHref(row.docState)} className="meta font-sans!" />,
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
        <CodeRef code={row.revStateLabel} note={codes[`REV_STATE|${stateOf(row)}`]} href={stateHref(stateOf(row))} className={`meta font-sans! ${stateLook(stateOf(row)).ink}`} />
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
    cell: (row, codes) =>
      row.verdict ? <CodeRef code={row.verdict} note={row.verdictLabel ?? undefined} href={listHref(codes, "VERDICT")} className="code-chip" />
        : row.verdictLabel ? <span className="meta">{row.verdictLabel}</span> : <Muted />,
  },
  {
    key: "releasedFor", sort: "releasedFor",
    label: "Released for",
    note: "What the revision is issued for — IFC, AFC, AB and the rest. Every step of a review route sets it or confirms it. Whether people work from it is the revision state beside it: a revision that is Not released carries its status but nobody may work from it.",
    cellClass: "whitespace-nowrap text-xs",
    cell: (row, codes) =>
      /* The status prints the same whether or not it is in force. Which it is
         is the revision state, in its own column, where it belongs. */
      !row.releasedFor && row.proposedFor ? (
        <CodeRef code={row.proposedFor} note={`${codes[`STATUS|${row.proposedFor}`] ?? row.proposedFor}

The revision is not released, so nobody works from this status yet.`} href={listHref(codes, "STATUS")} className="code-chip code-chip-held" />
      ) : row.releasedFor ? (
        <CodeRef code={row.releasedFor} note={codes[`STATUS|${row.releasedFor}`]} href={listHref(codes, "STATUS")} className="code-chip code-chip-live" />
      ) : <Muted />,
  },
  { key: "created", sort: "created", label: "Created", headClass: "text-right", cellClass: "whitespace-nowrap text-right font-mono text-xs tabular-nums", cell: (row) => date(row.createdDate) },
  { key: "updated", sort: "updated", label: "Updated", headClass: "text-right", cellClass: "whitespace-nowrap text-right font-mono text-xs tabular-nums text-slate-500", cell: (row) => date(row.updatedAt) },
  { key: "discipline", sort: "discipline", label: "Discipline", cellClass: "whitespace-nowrap text-xs text-slate-600", cell: (row) => row.disciplineLabel },
  {
    key: "phase", sort: "phase", label: "Phase",
    note: "The phase the document is in now. Each revision keeps the phase it was made in (its row on the document page), and is named by that phase's line (Settings, Revisions).",
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
      ? <CodeRef code={codes[`CRITICALITY_SHORT|${row.criticality}`] ?? row.criticality.replaceAll("_", " ").toLowerCase()} note={codes[`CRITICALITY|${row.criticality}`]} href={listHref(codes, "CRITICALITY")} className="meta font-sans!" />
      : <Muted />,
  },
  {
    key: "confidentiality", sort: "confidentiality",
    label: "Confidentiality",
    note: "Who may see it. Above the open levels it is read only by the people named on the document itself — to anybody else it is not in lists, counts or searches.",
    cellClass: "whitespace-nowrap",
    cell: (row, codes) => row.confidentiality
      ? <CodeRef code={codes[`CONFIDENTIALITY_SHORT|${row.confidentiality}`] ?? row.confidentiality.toLowerCase()} note={codes[`CONFIDENTIALITY|${row.confidentiality}`]} href={listHref(codes, "CONFIDENTIALITY")} className="meta font-sans!" />
      : <Muted />,
  },
  {
    key: "retention", sort: "retention",
    label: "Kept for",
    note: "How long this document must be kept, and in what form, once the project closes. It follows from how critical it is.",
    cellClass: "max-w-40 truncate text-xs text-slate-600",
    cell: (row) => row.retentionLabel ?? <Muted />,
  },
  { key: "planned", sort: "planned", label: "Planned submission", headClass: "text-right", cellClass: "whitespace-nowrap text-right font-mono text-xs tabular-nums", cell: (row) => row.plannedSubmissionDate ? <>{date(row.plannedSubmissionDate)}{row.plannedState ? <span className={`block font-sans text-[11px] ${row.plannedState.tone}`}>{row.plannedState.word}</span> : null}</> : <Muted /> },
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
  // Picked with the pointer, it applies at once; with the keyboard, on leaving the box (as on the schedule).
  const pointer = useRef(false);
  const waiting = useRef(false);
  return (
    <label className="min-w-0 flex-1">
      <span className="sr-only">{empty}</span>
      <Select
        name={name}
        defaultValue={value}
        disabled={disabled}
        data-on={value ? "true" : "false"}
        data-instant="true"
        className="plain w-full disabled:cursor-not-allowed disabled:opacity-40"
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
        <FilterOptions options={options} />
      </Select>
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
  return <Link href={href} title={note ? `${note}\n\nWhat it means, and the others →` : undefined} scroll={false}>{body}</Link>;
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


function date(value: string | null) { return value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—"; }
