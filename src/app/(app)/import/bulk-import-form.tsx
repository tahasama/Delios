"use client";

import { useActionState } from "react";
import { importBulkAction } from "@/lib/actions/bulk";
import { Card, Chip, btn, inputCls } from "@/components/ui";

const KINDS = [
  {
    key: "deliverables",
    title: "Deliverable list → placeholder entries",
    blurb: "Paste a whole deliverable list: one row per document. Each row becomes a register entry (placeholder) with its number allocated.",
    columns: "Title, Producer (ENG/CTR/VND/TPY/CLT), Type, Discipline, Project, SubProject, Supplier, PO, Criticality, Confidentiality, RetentionClass, AssetCode, ReceivedDate",
    template: "/api/export/template-deliverables",
  },
  {
    key: "baseline",
    title: "Baseline → actions & required-by entries",
    blurb: "Load the agreed baseline: what each action needs, at what status, by when. Actions are created if the code is new; entries link to existing documents.",
    columns: "Action Code, Action Name, Action Date, Document Number, Required Status, Required By",
    template: "/api/export/template-baseline",
  },
  {
    key: "metadata",
    title: "Metadata update in bulk",
    blurb: "Correct many documents at once. Only the columns you fill are changed — every change is logged field-by-field.",
    columns: "Document Number + any of: Title, DocType, Discipline, Criticality, Confidentiality, RetentionClass, SubProject, ContractRef",
    template: "/api/export/template-metadata",
  },
];

export function BulkImportForm({ initialKind }: { initialKind: string }) {
  const [state, formAction, pending] = useActionState(importBulkAction, undefined);

  return (
    <Card title="Import a spreadsheet">
      <form action={formAction} className="space-y-4">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-slate-700">What are you importing?</span>
          <div className="grid gap-2">
            {KINDS.map((k) => (
              <label key={k.key} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-3 transition hover:border-[#2d5480]/40">
                <input type="radio" name="kind" value={k.key} defaultChecked={(initialKind || k.key) === k.key} className="mt-1" />
                <span>
                  <span className="block text-sm font-medium text-slate-800">{k.title}</span>
                  <span className="block text-xs text-slate-500">{k.blurb}</span>
                  <span className="mt-1 block font-mono text-[11px] text-slate-400">{k.columns}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
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
      </form>

      {state?.rows?.length ? (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="mb-2 text-sm font-medium text-slate-700">
            Line-by-line report{" "}
            <Chip className={state.failed ? "bg-red-100 text-red-800 ring-red-300" : "bg-emerald-100 text-emerald-800 ring-emerald-300"}>
              {state.rows.filter((r) => r.ok).length} ok · {state.rows.filter((r) => !r.ok).length} with problems
            </Chip>
          </p>
          <div className="scroll-thin max-h-96 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-slate-500">Line</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-slate-500">Status</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-slate-500">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {state.rows.map((r) => (
                  <tr key={r.line} className={r.ok ? "" : "bg-red-50/40"}>
                    <td className="px-3 py-1.5 text-xs text-slate-400">{r.line}</td>
                    <td className="px-3 py-1.5">
                      <Chip className={r.ok ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : "bg-red-100 text-red-800 ring-red-300"}>
                        {r.ok ? (state.dryRun ? "would import" : r.wrote === false ? "skipped" : "imported") : "problem"}
                      </Chip>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-slate-600">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.dryRun && !state.failed ? (
            <p className="mt-2 text-xs text-slate-500">Happy? Uncheck <strong>dry run</strong> and press <strong>Check file</strong> again to import for real.</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
