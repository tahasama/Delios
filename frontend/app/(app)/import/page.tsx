import { requireScope } from "@/lib/core/scope";
import { Tip } from "@/components/ui";
import { isAdmin } from "@/lib/core/auth";
import { Download } from "lucide-react";
import { BulkImportForm } from "./bulk-import-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import & export" };

/** What can be taken out, grouped by what it is a copy of. */
const EXPORTS: { group: string; items: { kind: string; label: string; note?: string }[] }[] = [
  {
    group: "The register",
    items: [
      { kind: "documents", label: "Documents, in every state" },
      { kind: "packages", label: "Packages and what is in them" },
      { kind: "transmittals", label: "Transmittals" },
      { kind: "baseline", label: "Actions and the documents they need" },
    ],
  },
  {
    group: "Assurance",
    items: [
      { kind: "defects", label: "Findings" },
      { kind: "checks", label: "Latest check results" },
    ],
  },
  {
    group: "The record",
    items: [{ kind: "audit", label: "Who did what", note: "the latest 5000 events" }],
  },
];

/** Setting up a project: the lists in the order each one needs the one before. */
const SETUP = [
  { kind: "sets", label: "Settings lists", hint: "disciplines, types, statuses: what everything else is chosen from" },
  { kind: "people", label: "The team", hint: "who is on the project, in which function" },
  { kind: "matrix", label: "The distribution matrix", hint: "who does what, by function" },
  { kind: "deliverables", label: "The deliverable list", hint: "the register, numbered as it is registered" },
];

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const ctx = await requireScope();
  const sp = await searchParams;

  // Everything on this page changes the project wholesale (a register, a team, the matrix, the lists) or copies it
  // out whole: Document Control's, or whoever sets the project up.
  const allowed = ctx.can("CONTROL") || ctx.can("CONFIGURE");
  const chosen = sp.kind ?? "deliverables";

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col gap-4 px-5 pt-5 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="plate-title text-slate-950">Import &amp; export</h1>
            {allowed ? (
              <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
                Bring a spreadsheet in, or take a copy out. A file is always checked first: you see what it would do, row by row,
                before anything is written.
              </p>
            ) : (
              <p className="mt-2 max-w-2xl rounded-md bg-tint-soft px-2.5 py-1.5 text-xs leading-5 text-slate-700 ring-1 ring-line">
                Importing and exporting whole lists is for Document Control and administrators. Ask Document Control for a copy of a
                register, or to bring a list in.
              </p>
            )}
          </div>
          {/* The order that works, each step opening its import below. */}
          {allowed ? (
            <Tip lead="Setting up a project?" className="lg:w-80 lg:shrink-0" steps={SETUP.map((step) => ({ ...step, href: `/import?kind=${step.kind}`, current: chosen === step.kind }))}>
              Import in this order:
            </Tip>
          ) : null}
        </div>
      </section>

      {allowed ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          {/* A step chosen above opens its import: the form starts again on that kind. */}
          <BulkImportForm key={chosen} initialKind={chosen} admin={isAdmin(ctx.user)} />

          <aside className="min-w-0">
            <section className="register register-sheet register-sheet-open" aria-labelledby="export-head">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5">
                <span id="export-head" className="stencil mr-1 text-slate-500">Take a copy out</span>
                <span className="text-[11px] text-slate-500">as it stands now (CSV)</span>
              </div>
              <ul className="divide-y divide-line">
                {EXPORTS.map((group) => (
                  <li key={group.group} className="px-5 py-3">
                    <p className="mb-1 text-xs font-semibold text-slate-800">{group.group}</p>
                    <ul>
                      {group.items.map((item) => (
                        <li key={item.kind}>
                          <a
                            href={`/api/export/${item.kind}`}
                            className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[13px] text-slate-700 hover:bg-tint-soft hover:text-brand-ink"
                          >
                            <span className="min-w-0">
                              {item.label}
                              {item.note ? <span className="ml-1.5 text-xs text-slate-500">{item.note}</span> : null}
                            </span>
                            <Download className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500">Each file is named with the day and time it was made.</p>
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
