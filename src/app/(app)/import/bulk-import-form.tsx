"use client";

import { useActionState, useState } from "react";
import { importBulkAction } from "@/lib/actions/bulk";
import { Card, Chip, DataTable, Th, Td, btn, inputCls } from "@/components/ui";
import { SetReplace } from "./set-replace";

// What each activity needs is agreed through Schedule & actions — the
// departments list it, and Document Control issues it. It is not imported here.
const KINDS = [
  {
    key: "deliverables",
    title: "A deliverable list → the register",
    blurb: "One row per document. A row with no document number is registered and given one; a row carrying a number corrects that document instead. What the number is built from — type, discipline, project, sub-project, supplier — cannot be corrected here, because the number would then disagree with the record.",
    columns: "Document Number (only to correct), Title, Producer (ENG/CTR/VND/TPY/CLT), Type, Discipline, Project, SubProject, Supplier, PO, Criticality, Confidentiality, RetentionClass, AssetCode, ReceivedDate, ContractRef",
    template: "/api/export/template-deliverables",
  },
  {
    key: "people",
    title: "People \u2192 accounts on this project",
    blurb: "A whole team at once: one row per person. Each becomes an account on this project, in the function named, with a first password shown in the report for you to hand over.",
    columns: "Name, Email, Company (a party code or name; leave empty for our own staff), Function (as published in Functions & permissions), Department",
    template: "/api/export/template-people",
  },
  {
    key: "matrix",
    title: "A filled-in distribution matrix → who does what",
    blurb: "Download the matrix, change the letters, upload it back. A dry run lists every cell that differs from what the matrix says today; applying it writes the rules. Administrators only.",
    columns: "Keep the header row and the first four columns. A approves · R reviews · C controls · T issues · I receives · · may read · - not distributed",
    template: "/api/export/matrix",
  },
  {
    key: "sets",
    title: "A published list → the list itself",
    blurb: "Replace a whole list from a spreadsheet — disciplines, document types, statuses, any of them. You see what would be added, changed and retired before anything happens.",
    columns: "Code, Label, Status, and whatever properties that list carries. Download it as it stands and edit that.",
    template: "",
  },
];

export function BulkImportForm({ initialKind, sets }: { initialKind: string; sets: { key: string; title: string; count: number }[] }) {
  const [state, formAction, pending] = useActionState(importBulkAction, undefined);
  const [kind, setKind] = useState(KINDS.some((k) => k.key === initialKind) ? initialKind : KINDS[0].key);
  // A published list is replaced whole, with its own preview, so it shows the
  // list chooser instead of the file box the row-by-row imports share.
  const chooseAList = kind === "sets";

  return (
    <Card title="Import a spreadsheet">
      <form action={formAction} className="space-y-4">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-slate-700">What are you importing?</span>
          <div className="grid gap-2">
            {KINDS.map((k) => (
              <label key={k.key} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition ${kind === k.key ? "border-brand-line bg-tint-soft" : "border-line hover:border-brand-line/40"}`}>
                <input type="radio" name="kind" value={k.key} checked={kind === k.key} onChange={() => setKind(k.key)} className="mt-1" />
                <span>
                  <span className="block text-sm font-medium text-slate-800">{k.title}</span>
                  <span className="block text-xs text-slate-500">{k.blurb}</span>
                  <span className="mt-1 block font-mono text-[11px] text-slate-400">{k.columns}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        {chooseAList ? null : (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">CSV file (download the template, fill it, keep the header row)</span>
              <input type="file" name="file" accept=".csv,text/csv" required className={inputCls} />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="dryRun" defaultChecked />
              Dry run — check the file without writing anything (recommended first)
            </label>
            {state?.error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p> : null}
            {state?.ok ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{state.ok}</p> : null}
            <button type="submit" disabled={pending} className={btn("primary")}>
              {pending ? "Working…" : "Check file"}
            </button>
          </>
        )}
      </form>
      {chooseAList ? <div className="mt-4 border-t border-line pt-4"><SetReplace sets={sets} /></div> : null}

      {state?.rows?.length ? (
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 text-sm font-medium text-slate-700">
            Line-by-line report{" "}
            <Chip className={state.failed ? "bg-red-100 text-red-800 ring-red-300" : "bg-emerald-100 text-emerald-800 ring-emerald-300"}>
              {state.rows.filter((r) => r.ok).length} ok · {state.rows.filter((r) => !r.ok).length} with problems
            </Chip>
          </p>
          <DataTable id="import-report" head={<tr><Th>Line</Th><Th>Status</Th><Th>Detail</Th></tr>}>
            {state.rows.map((r) => (
              <tr key={r.line} className={r.ok ? "" : "[&>td]:bg-red-50/60"}>
                <Td className="py-1.5 text-xs tabular-nums text-slate-400">{r.line}</Td>
                <Td className="whitespace-nowrap py-1.5">
                  <Chip className={r.ok ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : "bg-red-100 text-red-800 ring-red-300"}>
                    {r.ok ? (state.dryRun ? "would import" : r.wrote === false ? "skipped" : "imported") : "problem"}
                  </Chip>
                </Td>
                <Td className="py-1.5 text-xs text-slate-600">{r.message}</Td>
              </tr>
            ))}
          </DataTable>
          {state.dryRun && !state.failed ? (
            <p className="mt-2 text-xs text-slate-500">Happy? Uncheck <strong>dry run</strong> and press <strong>Check file</strong> again to import for real.</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
