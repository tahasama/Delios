"use client";

import Link from "next/link";
import { useState } from "react";
import { Download } from "lucide-react";
import type { ListSource } from "@/lib/actions/list-sources";
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
    blurb: "One line per document. A new document has no number: it is given one when it is registered. To update documents, download the register as it stands: each line carries its number, and only what you change is updated, while its revision is being prepared (once it is out of preparation, a change takes a new revision). What the number is made of (type, discipline, sub-project, supplier) never changes. The file is this project's: a list made for another project is refused.",
    columns: "A sheet per deliverable type, with the fields the document form asks and only the values offered for that type as dropdowns. Shaded headings must be filled. You see every line, and may take some off the list or correct them, before anything is written; then the whole list is written, or nothing.",
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
    blurb: "One row per person. Each gets an account on this project in the function named, and an email asking them to choose their own password. Someone who has an account already is put on the project, or their function and department changed. Where whoever holds Manage confirms who joins, they wait under People to confirm. You see every line first; then the whole list is written, or nothing.",
    columns: "Name, Email, Company (an organization's code or name; empty for our own people), Function (as in Settings → Functions & permissions), Department.",
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
    blurb: "Take the matrix as it stands, change the letters, and bring it back; or fill an empty one with only the letters to change (an empty cell changes nothing). Every row is listed with the cells that differ from today; writing it changes those cells only, every function at once, or nothing.",
    columns: "Keep the headings and the first four columns. Letters: A approves, R reviews, C controls, T issues, I receives, · may read, - not sent.",
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
    blurb: "One workbook, a sheet per list, as this project reads them. Change the sheets you need and bring it back once. A code already there is updated; a new code is added. A row you delete is left as it is: a value is retired on its list's own page. Each list is the organization's until this project changes it: the first change makes this project's own copy of that list, and a value of a list the organization keeps the same on every project reads as a problem. You see every value first; then the whole workbook is written, or nothing.",
    columns: "Code, Label, Status, then whatever that list carries.",
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

          {/* What it does and the file it starts from, together. */}
          <div className="rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 ring-1 ring-line">
            <p className="text-[13px] font-semibold text-slate-800">{chosen.title}</p>
            <p className="mt-1 max-w-[70ch] text-slate-600">{chosen.blurb}</p>
            <p className="mt-1.5 max-w-[70ch] text-slate-600">{chosen.columns}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-slate-600">Download:</span>
              {[chosen.now, chosen.template].map((one) => (
                <a key={one.href} href={one.href} className="inline-flex items-center gap-1.5 font-semibold text-link hover:underline">
                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> {one.label}
                </a>
              ))}
            </p>
          </div>

          {/* Where the list comes from (owner): its register document, chosen in the register by the control function, or a file. */}
          {source ? (
            <div className="space-y-1 rounded-md px-3 py-2.5 text-xs leading-5 text-slate-700 ring-1 ring-line">
              <p>
                <span className="font-semibold">Its register document: </span>
                {doc ? <Link href={`/documents/${doc.id}`} className="font-mono font-semibold text-brand-ink hover:underline">{doc.number}</Link> : <span className="text-slate-500">none chosen</span>}
                {doc ? <span className="text-slate-500">{doc.releasedValue ? ` · released: rev ${doc.releasedValue}` : " · nothing released yet"}</span> : null}
                {source.mayChoose ? <> · <Link href={`/documents?pick=${encodeURIComponent(`src:${source.kind}`)}`} className="font-semibold text-link hover:underline">{doc ? "Choose another in the register" : "Choose it in the register"}</Link></> : null}
              </p>
              {last ? (
                <p><span className="font-semibold">Brought in last from: </span>{last.from === "DOCUMENT" ? last.label ?? "its register document" : "a file uploaded"}{last.at ? `, ${new Date(last.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}{last.byName ? ` by ${last.byName}` : ""}. The latest stands.</p>
              ) : null}
              {newer && fromDocument ? <p className="text-amber-800">{fromDocument.label} was released since: bring it in below.</p> : null}
            </div>
          ) : null}
        </li>

        <li>{kind === "deliverables" ? <DeliverableImport key={kind} fromDocument={fromDocument} /> : <LinesImport key={kind} kind={kind as "people" | "matrix" | "sets"} fromDocument={fromDocument} />}</li>
      </ul>
    </section>
  );
}
