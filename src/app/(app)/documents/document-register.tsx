"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeftRight, Download, GitPullRequestArrow, Search, X } from "lucide-react";

type RegisterRow = {
  id: string; docNumber: string; title: string; deliverableType: string; docType: string; discipline: string;
  originator: string | null; subProject: string | null; contractRef: string | null; criticality: string | null;
  confidentiality: string | null; retentionClass: string | null; state: string; placeholder: boolean;
  createdDate: string; receivedDate: string | null; updatedAt: string; currentRevision: string | null;
  docTypeLabel: string; disciplineLabel: string;
  currentStatus: string | null; currentStatusLabel: string | null; latestRevision: string | null;
  latestRevisionState: string | null; plannedSubmissionDate: string | null; issueDate: string | null;
  releasedAt: string | null; workflowStage: string; workflowOwner: string; blockingComments: number;
  reviewRevisionId: string | null; baselineCount: number; packageCount: number; approval: string | null;
};
type Opt = { code: string; label: string };

export function DocumentRegister({ rows, total, userCanAct, filters, filterOptions, exportHref }: {
  rows: RegisterRow[]; total: number; userCanAct: boolean;
  filters: { q: string; state: string; discipline: string; docType: string; view: string };
  filterOptions: { states: Opt[]; disciplines: Opt[]; types: Opt[] };
  exportHref: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const selectedRows = useMemo(() => rows.filter((row) => selected.includes(row.id)), [rows, selected]);
  const selectedRevisionIds = selectedRows.map((row) => row.reviewRevisionId).filter((id): id is string => Boolean(id));
  const transmittableRows = selectedRows.filter((row) => row.currentRevision);
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const transmittalHref = `/transmittals/new?docs=${encodeURIComponent(transmittableRows.map((row) => row.id).join(","))}`;
  const selectedExportHref = selected.length ? `/api/register/export?ids=${encodeURIComponent(selected.join(","))}` : exportHref;
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }

  return <>
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
        <form action="/documents" className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
          <label className="relative min-w-60 flex-1"><span className="sr-only">Search</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input name="q" defaultValue={filters.q} placeholder="Search number, title, supplier, PO or tag" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-[#315f83] focus:bg-white" /></label>
          <Filter name="state" value={filters.state} empty="Any state" options={filterOptions.states} />
          <Filter name="discipline" value={filters.discipline} empty="Any discipline" options={filterOptions.disciplines} />
          <Filter name="docType" value={filters.docType} empty="Any type" options={filterOptions.types} />
          <input type="hidden" name="view" value={filters.view} />
          <button className="h-10 rounded-xl bg-[#17324d] px-4 text-sm font-semibold text-white">Apply</button>
          {(filters.q || filters.state || filters.discipline || filters.docType) ? <Link href="/documents" className="px-2 py-2 text-xs font-semibold text-slate-500">Clear</Link> : null}
        </form>
        <a href={exportHref} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download className="h-4 w-4" /> Export</a>
      </div>

      <p className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">{total} document{total === 1 ? "" : "s"}{total > rows.length ? ` · showing ${rows.length}` : ""}</p>

      {rows.length ? <div className="scroll-thin overflow-x-auto"><table className="min-w-full divide-y divide-slate-100"><thead className="bg-slate-50"><tr>
        <Head className="sticky left-0 z-10 w-10 bg-slate-50"><input aria-label="Select all visible documents" type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : rows.map((row) => row.id))} /></Head>
        <Head className="sticky left-10 z-10 min-w-[270px] bg-slate-50">Document</Head>
        <Head>Rev</Head><Head>Status</Head><Head>Discipline</Head><Head>Type</Head><Head>Where it is</Head><Head>Updated</Head>
      </tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id} className={selected.includes(row.id) ? "bg-sky-50/60" : "hover:bg-slate-50/70"}>
        <Cell className="sticky left-0 z-10 bg-inherit"><input aria-label={`Select ${row.docNumber}`} type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} /></Cell>
        <Cell className="sticky left-10 z-10 min-w-[270px] bg-inherit"><Link href={`/documents/${row.id}`} className="font-mono text-xs font-bold text-[#315f83] hover:underline">{row.docNumber}</Link><p className="mt-1 max-w-[310px] truncate text-sm font-medium text-slate-800">{row.title}</p>{row.placeholder || row.state !== "ACTIVE" ? <div className="mt-1 flex gap-1.5">{row.placeholder ? <Tag tone="blue">number reserved</Tag> : row.state !== "PLANNED" ? <Tag>{row.state.toLowerCase()}</Tag> : null}</div> : null}</Cell>
        <Cell className="font-mono text-xs font-semibold text-slate-800">{row.currentRevision ?? row.latestRevision ?? "—"}</Cell>
        <Cell className="text-xs text-slate-600">{row.currentStatus ? `${row.currentStatus} · ${row.currentStatusLabel ?? ""}` : "—"}</Cell>
        <Cell className="text-xs text-slate-600">{row.disciplineLabel}</Cell>
        <Cell className="max-w-44 truncate text-xs text-slate-600">{row.docTypeLabel}</Cell>
        <Cell><Tag tone={row.workflowStage === "Released" ? "green" : row.workflowStage === "Draft" ? "amber" : "blue"}>{row.workflowStage}</Tag>{row.workflowOwner !== "—" ? <p className="mt-1 max-w-44 truncate text-[11px] text-slate-500">with {row.workflowOwner}</p> : null}{row.blockingComments ? <p className="mt-1 text-[11px] font-semibold text-red-600">{row.blockingComments} blocking comment{row.blockingComments === 1 ? "" : "s"}</p> : null}</Cell>
        <Cell className="text-xs text-slate-500">{date(row.updatedAt)}</Cell>
      </tr>)}</tbody></table></div> : <div className="px-6 py-16 text-center"><p className="text-sm font-semibold text-slate-700">No documents match these filters</p><p className="mt-1 text-xs text-slate-400">Clear a filter or create a new controlled entry.</p></div>}
    </section>

    {selected.length ? <div className="sticky bottom-5 z-30 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl border border-[#315f83]/20 bg-[#17324d] p-3 text-white shadow-xl">
      <span className="px-2 text-sm font-semibold">{selected.length} selected</span>
      {userCanAct ? (selectedRevisionIds.length ? <Link href={`/reviews/send?revisions=${encodeURIComponent(selectedRevisionIds.join(","))}`} className="inline-flex items-center gap-1.5 rounded-xl bg-[#d9a441] px-3 py-2 text-xs font-bold text-[#17324d]"><GitPullRequestArrow className="h-4 w-4" /> Send for review ({selectedRevisionIds.length})</Link> : <span className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-slate-400" title="Only documents with a revision being prepared can be sent"><GitPullRequestArrow className="h-4 w-4" /> Nothing ready to send</span>) : null}
      {transmittableRows.length ? <Link href={transmittalHref} className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"><ArrowLeftRight className="h-4 w-4" /> Create transmittal ({transmittableRows.length})</Link> : <span className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-slate-400" title="Only current released revisions may be sent on an outgoing transmittal"><ArrowLeftRight className="h-4 w-4" /> No released revision to transmit</span>}
      <a href={selectedExportHref} className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"><Download className="h-4 w-4" /> Export selected</a>
      <button onClick={() => setSelected([])} className="ml-auto rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Clear selection"><X className="h-4 w-4" /></button>
    </div> : null}

  </>;
}

function Filter({ name, value, empty, options }: { name: string; value: string; empty: string; options: Opt[] }) { return <select name={name} defaultValue={value} className="h-10 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700"><option value="">{empty}</option>{options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select>; }
function Head({ children, className = "" }: { children?: React.ReactNode; className?: string }) { return <th className={`whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500 ${className}`}>{children}</th>; }
function Cell({ children, className = "" }: { children?: React.ReactNode; className?: string }) { return <td className={`whitespace-nowrap px-4 py-3 text-xs text-slate-600 ${className}`}>{children}</td>; }
function Tag({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "blue" | "green" | "amber" }) { const cls = { slate: "bg-slate-100 text-slate-600", blue: "bg-sky-100 text-sky-700", green: "bg-emerald-100 text-emerald-700", amber: "bg-amber-100 text-amber-700" }[tone]; return <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>{children}</span>; }
function date(value: string | null) { return value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—"; }
