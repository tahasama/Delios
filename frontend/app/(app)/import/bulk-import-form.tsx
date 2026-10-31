"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { ListSource } from "@/lib/actions/list-source-kinds";
import { ListSourceButton } from "@/components/list-source-card";
import { DeliverableImport } from "./deliverable-import";
import { LinesImport } from "./lines-import";

type Kind = {
  key: string;
  name: string;
  /** What it fills, under its name. */
  hint: string;
  title: string;
  blurb: string;
  columns: string;
  /** The list as it stands now, to change and bring back. */
  now: { href: string; label: string };
  /** An empty template, to start from. */
  template: { href: string; label: string };
  /** The file it takes, for the field and its hint. */
  accept: string;
  formats: string;
  /** Changes what every screen offers: an administrator's. */
  adminOnly?: boolean;
  /** Changes the project wholesale (the team, the matrix): the control function's or whoever sets the project up. */
  keepersOnly?: boolean;
};

// What each action needs is agreed through the Schedule (the requirements list) and
// The control function issues it: it is not imported here.
const KINDS: Kind[] = [
  {
    key: "deliverables",
    name: "Deliverable list",
    hint: "the register in one go",
    title: "Register documents from a list",
    blurb: "One line per document. A new line is registered and numbered; a line with a number updates that document while its revision is prepared. What the number is made of never changes.",
    columns: "A sheet per deliverable type, the document form's fields, shaded ones required. This project's file only.",
    now: { href: "/api/export/template-deliverables?filled=1", label: "The register as it stands (.xlsx)" },
    template: { href: "/api/export/template-deliverables", label: "An empty template (.xlsx)" },
    accept: ".xlsx,.csv,text/csv",
    formats: "the workbook (.xlsx) or a CSV, headings kept",
  },
  {
    key: "people",
    name: "Team list",
    hint: "people on this project",
    title: "Put a team on this project",
    blurb: "One row per person, put on this project in the function named; someone new is emailed to choose a password. Where joining is confirmed, they wait under People to confirm.",
    columns: "Name, Email, Company (empty for ours), Function, Department.",
    now: { href: "/api/export/people", label: "The team as it stands (.csv)" },
    template: { href: "/api/export/template-people", label: "An empty template, with an example (.csv)" },
    accept: ".csv,text/csv",
    formats: "a CSV, headings kept",
    keepersOnly: true,
  },
  {
    key: "matrix",
    name: "Distribution matrix",
    hint: "who does what",
    title: "Change the distribution matrix",
    blurb: "Take the matrix as it stands, change the letters, bring it back. Only the cells that differ from today change; an empty cell changes nothing.",
    columns: "A approves, R reviews, C controls, T issues, I receives, · may read, - not sent.",
    now: { href: "/api/export/matrix", label: "The matrix as it stands (.csv)" },
    template: { href: "/api/export/matrix?blank=1", label: "An empty template (.csv)" },
    accept: ".csv,text/csv",
    formats: "the matrix as downloaded (.csv)",
    adminOnly: true,
  },
  {
    key: "sets",
    name: "Settings lists",
    hint: "disciplines, types, statuses…",
    title: "Update this project's Settings lists",
    blurb: "A sheet per list, as this project reads them. A code there is updated, a new one added; a deleted row stays. The first change to a list makes this project's own copy of it.",
    columns: "Code, Label, Status, then what the list carries.",
    now: { href: "/api/export/template-sets", label: "Every list as it stands (.xlsx)" },
    template: { href: "/api/export/template-sets?blank=1", label: "An empty template (.xlsx)" },
    accept: ".xlsx",
    formats: "the workbook (.xlsx) as downloaded",
    keepersOnly: true,
  },
];

/** Which list each import is: the register document it may come from (Actions/ListSources.cs). */
const SOURCE_KIND: Record<string, string> = { deliverables: "DELIVERABLES", people: "TEAM", matrix: "MATRIX", sets: "LISTS" };

export function BulkImportForm({ initialKind, admin, keeps, sources }: { initialKind: string; admin: boolean; keeps: boolean; sources: ListSource[] }) {
  const usable = (k: Kind) => (!k.adminOnly || admin) && (!k.keepersOnly || keeps);
  const [kind, setKind] = useState(KINDS.find((k) => k.key === initialKind && usable(k))?.key ?? KINDS[0].key);
  const chosen = KINDS.find((k) => k.key === kind)!;
  const source = sources.find((one) => one.kind === SOURCE_KIND[kind]) ?? null;
  const doc = source?.document && !source.document.chosenByApp ? source.document : null;
  // Its register document's released revision, ready to be brought in (owner: a list comes from it or from a file; the latest stands).
  const fromDocument = doc?.releasedValue ? { label: `${doc.number} rev ${doc.releasedValue}` } : null;
  const last = source?.last;
  const newer = !!doc?.releasedRevisionId && last?.revisionId !== doc.releasedRevisionId && (!last?.at || !doc.releasedAt || new Date(doc.releasedAt) > new Date(last.at));

  return (
    <section className="register register-sheet register-sheet-open min-w-0" aria-labelledby="import-head">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span id="import-head" className="stencil mr-1 text-slate-500">Bring a list in</span>
        <span className="text-[11px] text-slate-500">checked first: nothing is written until you say so</span>
      </div>

      <ul className="divide-y divide-line">
        <li className="space-y-3 px-5 py-4 sm:px-6">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-slate-800">What are you importing?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {KINDS.map((k) => (
                <label
                  key={k.key}
                  className={`flex items-start gap-2.5 rounded-md px-3 py-2.5 ring-1 ring-line ${
                    usable(k) ? "cursor-pointer hover:bg-tint-soft has-checked:bg-tint-soft has-checked:ring-brand-line" : "cursor-not-allowed opacity-60"
                  }`}
                >
                  <input type="radio" name="kind" value={k.key} checked={kind === k.key} disabled={!usable(k)} onChange={() => setKind(k.key)} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-slate-800">{k.name}</span>
                    <span className="block text-xs text-slate-600">{usable(k) ? k.hint : k.adminOnly ? "an administrator imports it" : "the control function imports it"}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* What it does and the file it starts from, together, across the whole width. Every kind's box is laid in the
              same place, the others kept invisible, so the box stands the same height whichever kind is chosen (owner). */}
          <div className="grid">
            {KINDS.map((k) => {
              const on = k.key === kind;
              const its = sources.find((one) => one.kind === SOURCE_KIND[k.key]) ?? null;
              return (
                <div key={k.key} aria-hidden={!on} className={`col-start-1 row-start-1 grid gap-x-8 gap-y-2 rounded-md bg-tint-soft px-4 py-3 text-xs leading-5 ring-1 ring-line md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] ${on ? "" : "invisible"}`}>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">{k.title}</p>
                    <p className="mt-1 text-slate-600">{k.blurb}</p>
                    <p className="mt-1 text-slate-500">Checked first: you see every line; then you edit freely.</p>
                    {/* Where the list comes from (owner): its register document, the box's call to act, on the left. */}
                    {its ? <div className="mt-2.5"><ListSourceButton source={its} inert={!on} newer={on && newer && fromDocument ? `${fromDocument.label} was released since it was last brought in: bring it in below.` : null} /></div> : null}
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-slate-600"><span className="font-semibold text-slate-700">The file: </span>{k.columns}</p>
                    <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      {[k.now, k.template].map((one) => (
                        <a key={one.href} href={one.href} tabIndex={on ? undefined : -1} className="inline-flex items-center gap-1.5 font-semibold text-link hover:underline">
                          <Download className="h-3.5 w-3.5" aria-hidden="true" /> {one.label}
                        </a>
                      ))}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </li>

        <li>{kind === "deliverables" ? <DeliverableImport key={kind} fromDocument={fromDocument} /> : <LinesImport key={kind} kind={kind as "people" | "matrix" | "sets"} fromDocument={fromDocument} />}</li>
      </ul>
    </section>
  );
}
