"use client";

import { useActionState, useRef, useState } from "react";
import { importBulkAction } from "@/lib/actions/bulk";
import { Card, Chip, DataTable, Th, Td, btn, inputCls } from "@/components/ui";
import { Download } from "lucide-react";

// What each activity needs is agreed through Schedule & actions — the
// departments list it, and Document Control issues it. It is not imported here.
const KINDS = [
  {
    key: "deliverables",
    short: "Deliverable list",
    title: "A deliverable list → the register",
    blurb: "One row per document. A row with no document number is registered and given one; a row carrying a number corrects that document instead. What the number is built from — type, discipline, project, sub-project, supplier — cannot be corrected here, because the number would then disagree with the record.",
    columns: "Download the workbook: one sheet per deliverable type, each carrying only the columns that type has, with every published list as a dropdown.",
    template: "/api/export/template-deliverables",
    templateLabel: "Download the workbook (.xlsx)",
  },
  {
    key: "people",
    short: "Team list",
    title: "People \u2192 accounts on this project",
    blurb: "A whole team at once: one row per person. Each becomes an account on this project, in the function named, with a first password shown in the report for you to hand over.",
    columns: "Name, Email, Company (a party code or name; leave empty for our own staff), Function (as published in Functions & permissions), Department",
    template: "/api/export/template-people",
  },
  {
    key: "matrix",
    short: "Distribution matrix",
    title: "A filled-in distribution matrix → who does what",
    blurb: "Download the matrix, change the letters, upload it back. A dry run lists every cell that differs from what the matrix says today; applying it writes the rules. Administrators only.",
    columns: "Keep the header row and the first four columns. A approves · R reviews · C controls · T issues · I receives · · may read · - not distributed",
    template: "/api/export/matrix",
    templateLabel: "Download the matrix as it stands",
  },
  {
    key: "sets",
    short: "A published list",
    title: "A published list → the list itself",
    blurb: "One workbook, a tab per list — disciplines, document types, statuses, all of them. Edit whichever tabs you care about and upload it once. A code that exists is updated; a new code is published. A row you delete is left alone, because retiring is a deliberate act on the list's own page.",
    columns: "Code, Label, Status, and whatever properties that list carries.",
    template: "/api/export/template-sets",
    templateLabel: "Download every list (.xlsx)",
  },
];

export function BulkImportForm({ initialKind }: { initialKind: string }) {
  const [state, formAction, pending] = useActionState(importBulkAction, undefined);
  const form = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState(KINDS.some((k) => k.key === initialKind) ? initialKind : KINDS[0].key);
  const chosen = KINDS.find((k) => k.key === kind)!;
  // React empties the form once a server action returns, so the file somebody
  // chose is gone by the time they want to run it for real. It is kept here and
  // put back on the way out.
  const [file, setFile] = useState<File | null>(null);
  const send = (data: FormData, options?: { dryRun: boolean }) => {
    const picked = data.get("file");
    if ((!(picked instanceof File) || picked.size === 0) && file) data.set("file", file);
    data.set("kind", kind);
    if (options) {
      data.delete("dryRun");
      if (options.dryRun) data.set("dryRun", "on");
    }
    formAction(data);
  };

  return (
    <Card title="Import a spreadsheet">
      <form ref={form} action={(data) => send(data)} className="space-y-4">
        <div>
          <span className="mb-2 block text-xs font-medium text-slate-700">What are you importing?</span>
          {/* Four short tiles rather than four paragraphs: only the one you
              have chosen needs to explain itself, and the others stay readable
              as a set of choices instead of a wall. */}
          <div className="grid gap-2 sm:grid-cols-2">
            {KINDS.map((k) => (
              <label
                key={k.key}
                className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition ${
                  kind === k.key ? "border-brand-line bg-tint-soft shadow-sm" : "border-line hover:border-brand-line/40 hover:bg-slate-50"
                }`}
              >
                <input type="radio" name="kind" value={k.key} checked={kind === k.key} onChange={() => setKind(k.key)} className="shrink-0" />
                <span className="min-w-0 text-sm font-medium text-slate-800">{k.short}</span>
              </label>
            ))}
          </div>

          {/* What it does, and the file it starts from, together — they were
              paired all along and the page never said so. */}
          <div className="mt-3 rounded-xl bg-slate-50 px-3.5 py-3">
            <p className="text-sm font-medium text-slate-800">{chosen.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{chosen.blurb}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{chosen.columns}</p>
            {chosen.template ? (
              <a href={chosen.template} className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-link hover:underline">
                <Download className="h-3.5 w-3.5" /> {chosen.templateLabel ?? "Download the template"}
              </a>
            ) : null}
          </div>
        </div>
        <>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">The filled-in file — a workbook (.xlsx) or a single-sheet CSV. Keep the heading row.</span>
              <input
                type="file"
                name="file"
                accept=".xlsx,.csv,text/csv"
                required={!file}
                className={inputCls}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              {file ? <span className="mt-1 block text-[11px] text-slate-500">Holding <strong className="text-slate-700">{file.name}</strong> — you do not need to choose it again.</span> : null}
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
      </form>

      {state?.rows?.length ? (
        <div className="-mx-5 -mb-5 mt-5 border-t border-line bg-slate-50/70 px-5 py-4">
          {/* The outcome is the point of the page, so it reads as its own
              thing rather than as more of the form. */}
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold text-slate-900">{state.dryRun ? "What would happen" : "What happened"}</h3>
            <span className="text-xs text-slate-500">
              <strong className="text-emerald-700">{state.rows.filter((r) => r.ok).length}</strong> ok
              {state.rows.some((r) => !r.ok) ? <> · <strong className="text-red-700">{state.rows.filter((r) => !r.ok).length}</strong> with problems</> : null}
              {" "}of {state.rows.length} line{state.rows.length === 1 ? "" : "s"}
            </span>
          </div>
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
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-emerald-50 px-3 py-2.5">
              <p className="text-xs text-emerald-800">Nothing has changed yet.</p>
              {/* The same file, the same choice, without the dry run — so the
                  second pass is one press rather than choosing it all again. */}
              <button
                type="button"
                disabled={pending}
                onClick={() => send(new FormData(form.current ?? undefined), { dryRun: false })}
                className={btn("primary", "sm")}
              >
                {pending ? "Importing…" : "Import it for real"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
