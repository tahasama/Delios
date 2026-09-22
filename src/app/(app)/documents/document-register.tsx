"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeftRight, Download, GitPullRequestArrow, PackagePlus, Search, X } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Th, Td } from "@/components/ui";

/** Available from the Columns menu; off until someone wants them. */
const OPTIONAL = ["Originator", "Sub-project", "Contract", "Criticality", "Confidentiality", "Planned submission", "Issued", "Released", "Approval", "In packages"];

type RegisterRow = {
  id: string; docNumber: string; title: string; deliverableType: string; docType: string; discipline: string;
  originator: string | null; subProject: string | null; contractRef: string | null; criticality: string | null;
  confidentiality: string | null; retentionClass: string | null; state: string; placeholder: boolean;
  createdDate: string; receivedDate: string | null; updatedAt: string; currentRevision: string | null;
  docTypeLabel: string; disciplineLabel: string;
  currentStatus: string | null; currentStatusLabel: string | null; currentStatusUse: string | null; latestRevision: string | null;
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
    <section className="rounded-2xl border border-slate-200 bg-surface shadow-sm">
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
        <form action="/documents" className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
          <label className="relative min-w-60 flex-1"><span className="sr-only">Search</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input name="q" defaultValue={filters.q} placeholder="Search number, title, supplier, PO or tag" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-brand-line focus:bg-surface" /></label>
          <Filter name="state" value={filters.state} empty="Any state" options={filterOptions.states} />
          <Filter name="discipline" value={filters.discipline} empty="Any discipline" options={filterOptions.disciplines} />
          <Filter name="docType" value={filters.docType} empty="Any type" options={filterOptions.types} />
          <input type="hidden" name="view" value={filters.view} />
          <button className="h-10 rounded-xl bg-brand-strong px-4 text-sm font-semibold text-white">Apply</button>
          {(filters.q || filters.state || filters.discipline || filters.docType) ? <Link href="/documents" className="px-2 py-2 text-xs font-semibold text-slate-500">Clear</Link> : null}
        </form>
        <a href={exportHref} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download className="h-4 w-4" /> Export</a>
      </div>

      {total > rows.length ? <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">Showing the first {rows.length} of {total} documents — narrow the search to see the rest.</p> : null}

      {rows.length ? <DataTable id="register" className="rounded-none rounded-b-2xl border-0 shadow-none" defaultHidden={OPTIONAL} head={<tr>
        <Th className="sticky left-0 z-[4] w-10"><input aria-label="Select all visible documents" type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : rows.map((row) => row.id))} /></Th>
        <Th className="sticky left-10 z-[4] min-w-[280px]">Document</Th>
        <Th>Rev</Th><Th>Status</Th><Th>Discipline</Th><Th>Type</Th>
        <Th>Originator</Th><Th>Sub-project</Th><Th>Contract</Th><Th>Criticality</Th><Th>Confidentiality</Th>
        <Th>Planned submission</Th><Th>Issued</Th><Th>Released</Th><Th>Approval</Th><Th>In packages</Th>
        <Th>Updated</Th>
      </tr>}>{rows.map((row) => {
        const on = selected.includes(row.id);
        const pin = on ? "bg-sky-50" : "bg-surface";
        return <tr key={row.id} className={on ? "[&>td]:bg-sky-50" : undefined}>
        <Td className={`sticky left-0 z-[1] ${pin}`}><input aria-label={`Select ${row.docNumber}`} type="checkbox" checked={on} onChange={() => toggle(row.id)} /></Td>
        <Td className={`sticky left-10 z-[1] min-w-[280px] ${pin}`}>
          <Link href={`/documents/${row.id}`} className="whitespace-nowrap font-mono text-xs font-bold text-link hover:underline">{row.docNumber}</Link>
          <p className="mt-0.5 max-w-[340px] truncate text-[13px] font-medium text-slate-800" title={row.title}>{row.title}</p>
          {row.placeholder ? <div className="mt-1"><Tag tone="blue">number reserved</Tag></div> : row.state !== "ACTIVE" && row.state !== "PLANNED" ? <div className="mt-1"><Tag>{row.state.toLowerCase()}</Tag></div> : null}
        </Td>
        <Td className="font-mono text-xs font-semibold text-slate-800">{row.currentRevision ?? row.latestRevision ?? "—"}</Td>
        <Td className="whitespace-nowrap"><div className="flex items-center gap-1.5"><Tag tone={row.workflowStage === "Released" ? "green" : row.workflowStage === "Draft" ? "amber" : "blue"}>{row.workflowStage}</Tag>{row.currentStatus ? <Link href="/guide/codes" className="font-mono text-[11px] font-bold text-slate-700 underline decoration-slate-300 decoration-dotted underline-offset-2 hover:text-link" title={`${row.currentStatus} — ${row.currentStatusLabel ?? ""}${row.currentStatusUse ? `
${row.currentStatusUse}` : ""}

What the codes mean →`}>{row.currentStatus}</Link> : null}</div>{row.workflowStage !== "Released" && row.currentStatus ? <p className="mt-1 text-[11px] text-slate-400">current rev {row.currentRevision} is {row.currentStatus}</p> : null}{row.workflowOwner !== "—" ? <p className="mt-1 max-w-48 truncate text-[11px] text-slate-500">with {row.workflowOwner}</p> : null}{row.blockingComments ? <p className="mt-1 text-[11px] font-semibold text-red-600">{row.blockingComments} blocking comment{row.blockingComments === 1 ? "" : "s"}</p> : null}</Td>
        <Td className="whitespace-nowrap text-xs">{row.disciplineLabel}</Td>
        <Td className="max-w-48 truncate text-xs" >{row.docTypeLabel}</Td>
        <Td className="whitespace-nowrap text-xs">{row.originator ?? <Muted />}</Td>
        <Td className="whitespace-nowrap text-xs">{row.subProject ?? <Muted />}</Td>
        <Td className="whitespace-nowrap text-xs">{row.contractRef ?? <Muted />}</Td>
        <Td className="whitespace-nowrap text-xs">{row.criticality ?? <Muted />}</Td>
        <Td className="whitespace-nowrap text-xs">{row.confidentiality ?? <Muted />}</Td>
        <Td className="whitespace-nowrap text-xs tabular-nums">{row.plannedSubmissionDate ? date(row.plannedSubmissionDate) : <Muted />}</Td>
        <Td className="whitespace-nowrap text-xs tabular-nums">{row.issueDate ? date(row.issueDate) : <Muted />}</Td>
        <Td className="whitespace-nowrap text-xs tabular-nums">{row.releasedAt ? date(row.releasedAt) : <Muted />}</Td>
        <Td className="whitespace-nowrap text-xs">{row.approval ?? <Muted />}</Td>
        <Td className="text-xs tabular-nums">{row.packageCount || <Muted />}</Td>
        <Td className="whitespace-nowrap text-xs tabular-nums text-slate-500">{date(row.updatedAt)}</Td>
      </tr>;
      })}</DataTable> : <div className="px-6 py-16 text-center"><p className="text-sm font-semibold text-slate-700">No documents match these filters</p><p className="mt-1 text-xs text-slate-400">Clear a filter or create a new controlled entry.</p></div>}
    </section>

    {selected.length ? <div className="sticky bottom-5 z-30 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl border border-brand-line/20 bg-brand-strong p-3 text-white shadow-xl">
      <span className="px-2 text-sm font-semibold">{selected.length} selected</span>
      {userCanAct ? (selectedRevisionIds.length ? <Link href={`/reviews/send?revisions=${encodeURIComponent(selectedRevisionIds.join(","))}`} className="inline-flex items-center gap-1.5 rounded-xl bg-[#d9a441] px-3 py-2 text-xs font-bold text-brand-ink"><GitPullRequestArrow className="h-4 w-4" /> Send for review ({selectedRevisionIds.length})</Link> : <span className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-slate-400" title="Only documents with a revision being prepared can be sent"><GitPullRequestArrow className="h-4 w-4" /> Nothing ready to send</span>) : null}
      {transmittableRows.length ? <Link href={transmittalHref} className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"><ArrowLeftRight className="h-4 w-4" /> Create transmittal ({transmittableRows.length})</Link> : <span className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-slate-400" title="Only current released revisions may be sent on an outgoing transmittal"><ArrowLeftRight className="h-4 w-4" /> No released revision to transmit</span>}
      {userCanAct ? <Link href={`/packages/add?docs=${encodeURIComponent(selected.join(","))}`} className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"><PackagePlus className="h-4 w-4" /> Add to package</Link> : null}
      <a href={selectedExportHref} className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"><Download className="h-4 w-4" /> Export selected</a>
      <button onClick={() => setSelected([])} className="ml-auto rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Clear selection"><X className="h-4 w-4" /></button>
    </div> : null}

  </>;
}

function Filter({ name, value, empty, options }: { name: string; value: string; empty: string; options: Opt[] }) { return <select name={name} defaultValue={value} className="h-10 rounded-xl border border-slate-200 bg-surface px-2.5 text-sm text-slate-700"><option value="">{empty}</option>{options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select>; }
function Muted() { return <span className="text-slate-300">—</span>; }
function Tag({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "blue" | "green" | "amber" }) { const cls = { slate: "bg-slate-100 text-slate-600", blue: "bg-sky-100 text-sky-700", green: "bg-emerald-100 text-emerald-700", amber: "bg-amber-100 text-amber-700" }[tone]; return <span className={`inline-flex whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>{children}</span>; }
function date(value: string | null) { return value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—"; }
