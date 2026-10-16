"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { importBulkAction, type ImportResult, type ImportRow } from "@/lib/documents/forms-import";
import { ToneChip, btn } from "@/components/ui";
import { csvSafe } from "@/lib/core/csv";
import { Check, Copy, Download, FileSpreadsheet, X } from "lucide-react";

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
};

// What each action needs is agreed through the Schedule (the requirements list) and
// The control function issues it: it is not imported here.
const KINDS: Kind[] = [
  {
    key: "deliverables",
    name: "Deliverable list",
    hint: "the register in one go",
    title: "Register documents from a list",
    blurb: "One row per document. A row with no Document Number is registered and given its number; a row with a number corrects that document (taken out as the register stands, only what you change is corrected). What the number is made of (type, discipline, project, sub-project, supplier) cannot be corrected, because the number would then disagree with the document.",
    columns: "The workbook has a sheet per deliverable type, with only that type's columns and each Settings list as a dropdown. Shaded headings must be filled.",
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
    blurb: "One row per person. Each gets an account on this project in the function named, and an email asking them to choose their own password. Where whoever holds Manage confirms who joins, they wait under People to confirm.",
    columns: "Name, Email, Company (an organization's code or name; empty for our own people), Function (as in Settings → Functions & permissions), Department.",
    now: { href: "/api/export/people", label: "The team as it stands (.csv)" },
    template: { href: "/api/export/template-people", label: "An empty template, with an example (.csv)" },
    accept: ".csv,text/csv",
    formats: "a CSV, headings kept",
  },
  {
    key: "matrix",
    name: "Distribution matrix",
    hint: "who does what",
    title: "Change the distribution matrix",
    blurb: "Take the matrix as it stands, change the letters, and bring it back; or fill an empty one with only the letters to change (an empty cell changes nothing). The check lists every cell that differs from today; writing it changes those cells only.",
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
    title: "Update the Settings lists",
    blurb: "One workbook, a sheet per list. Change the sheets you need and bring it back once. A code already there is updated; a new code is added. A row you delete is left as it is: a value is retired on its list's own page.",
    columns: "Code, Label, Status, then whatever that list carries.",
    now: { href: "/api/export/template-sets", label: "Every list as it stands (.xlsx)" },
    template: { href: "/api/export/template-sets?blank=1", label: "An empty template (.xlsx)" },
    accept: ".xlsx",
    formats: "the workbook (.xlsx) as downloaded",
    adminOnly: true,
  },
];

/** Hands the person a file made here (the report, the rows to fix). */
function save(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** What became of one row, as a chip. */
function Outcome({ row, checked }: { row: ImportRow; checked: boolean }) {
  return (
    <ToneChip tone={!row.ok ? "refused" : checked ? "moving" : row.wrote === false ? "idle" : "done"}>
      {!row.ok ? (checked ? "problem" : "left out") : checked ? "ready" : row.wrote === false ? "no change" : "written"}
    </ToneChip>
  );
}

/** A link to pass on by hand: shown whole on hover, copied in one press. */
function PassOn({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="mt-1 flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate font-mono text-[11px] text-slate-600" title={link}>{link}</span>
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-link hover:underline"
        onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false))}
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

const cell = (raw: string) => {
  const value = csvSafe(raw);
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
};

export function BulkImportForm({ initialKind, admin }: { initialKind: string; admin: boolean }) {
  const [result, run, pending] = useActionState(importBulkAction, undefined);
  const usable = (k: Kind) => !k.adminOnly || admin;
  const [kind, setKind] = useState(KINDS.find((k) => k.key === initialKind && usable(k))?.key ?? KINDS[0].key);
  const chosen = KINDS.find((k) => k.key === kind)!;
  // The file is held here, not in the field: the form is emptied each time the server answers, and the same file
  // goes from the check to the writing without being chosen again.
  const [file, setFile] = useState<File | null>(null);
  // The report shown belongs to the kind and file it was made for.
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const report: ImportResult | undefined = reportFor === `${kind}|${file?.name}` ? result : undefined;

  const send = (mode: "check" | "write") => {
    if (!file) return;
    const data = new FormData();
    data.set("kind", kind);
    data.set("mode", mode);
    data.set("file", file);
    setReportFor(`${kind}|${file.name}`);
    setConfirming(false);
    startTransition(() => run(data));
  };

  // Links to choose a password, when email is off, exist only in this report: leaving asks first.
  const holding = !!report?.handOver;
  useEffect(() => {
    if (!holding) return;
    const stay = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", stay);
    return () => window.removeEventListener("beforeunload", stay);
  }, [holding]);

  const choose = (key: string) => {
    if (key === kind) return;
    setKind(key);
    // Another kind reads another file: the one held is let go.
    setFile(null);
    setConfirming(false);
  };

  const rows = report?.rows ?? [];
  const problems = report?.problems ?? 0;
  const ready = report?.ready ?? 0;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");

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
                  <input type="radio" name="kind" value={k.key} checked={kind === k.key} disabled={!usable(k)} onChange={() => choose(k.key)} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-slate-800">{k.name}</span>
                    <span className="block text-xs text-slate-600">{usable(k) ? k.hint : "an administrator imports it"}</span>
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
        </li>

        <li className="space-y-3 px-5 py-4 sm:px-6">
          <div className="max-w-xl">
            <div className="mb-1.5 flex h-4 min-w-0 items-baseline gap-2 overflow-hidden leading-4">
              <span className="text-xs font-medium text-slate-700">The filled-in file</span>
              <span className="truncate text-[11px] text-slate-500" title={`Takes ${chosen.formats}`}>takes {chosen.formats}</span>
            </div>
            {file ? (
              <div className="flex h-(--control-h) items-center gap-2 rounded-md px-2.5 text-[13px] ring-1 ring-line">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                <span className="min-w-0 truncate font-medium text-slate-800" title={file.name}>{file.name}</span>
                <span className="shrink-0 text-xs text-slate-500">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                <button type="button" onClick={() => { setFile(null); setConfirming(false); }} className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-link hover:underline" disabled={pending}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" /> Remove
                </button>
              </div>
            ) : (
              <input
                type="file"
                accept={chosen.accept}
                aria-label="The filled-in file"
                className="w-full"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={!file || pending} onClick={() => send("check")} className={btn("primary")}>
              {pending && !report?.checked ? "Checking…" : report?.checked ? "Check it again" : "Check the file"}
            </button>
            <span className="text-xs text-slate-500">{file ? "Checking writes nothing." : "Choose the file, then check it."}</span>
          </div>
          {result?.error && reportFor === `${kind}|${file?.name}` ? (
            <p role="alert" className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">{result.error}</p>
          ) : null}
        </li>

        {report && !report.error ? (
          <li className="space-y-3 px-5 py-4 sm:px-6" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold text-slate-800">{report.checked ? "What the check found" : "What was written"}</h2>
              <span className="flex flex-wrap gap-1.5">
                {report.checked
                  ? <ToneChip tone={ready ? "done" : "idle"}>{ready} ready</ToneChip>
                  : <ToneChip tone={report.done ? "done" : "idle"}>{report.done ?? 0} written</ToneChip>}
                {problems ? <ToneChip tone="refused">{problems} with problems</ToneChip> : null}
              </span>
            </div>
            <p className="text-xs leading-5 text-slate-600">{report.summary}</p>

            {rows.length ? (
              <div className="overflow-x-auto rounded-md ring-1 ring-line">
                <table className="w-full table-fixed text-left text-xs">
                  <thead className="bg-tint-soft text-[11px] text-slate-500">
                    <tr>
                      <th scope="col" className="w-24 px-3 py-2 font-semibold sm:w-40">Where in the file</th>
                      <th scope="col" className="hidden w-24 px-3 py-2 font-semibold sm:table-cell">Result</th>
                      <th scope="col" className="px-3 py-2 font-semibold">What it does</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r) => (
                      <tr key={r.line} className={r.ok ? "" : "bg-red-50/50"}>
                        <td className="px-3 py-1.5 align-top break-words text-slate-600 tabular-nums">
                          {r.at}
                          <span className="mt-1 block sm:hidden"><Outcome row={r} checked={!!report.checked} /></span>
                        </td>
                        <td className="hidden px-3 py-1.5 align-top sm:table-cell"><Outcome row={r} checked={!!report.checked} /></td>
                        <td className="max-w-0 px-3 py-1.5 align-top leading-5 break-words text-slate-700">
                          {r.link ? <a href={r.link} className="text-link hover:underline">{r.message}</a> : r.message}
                          {r.pass ? <PassOn link={r.pass} /> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {rows.length ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-left font-semibold text-link hover:underline"
                  onClick={() => save(`import-report-${stamp}.csv`, [["Where in the file", "Result", "What it does"], ...rows.map((r) => [r.at, r.ok ? (report.checked ? "ready" : "written") : "problem", r.pass ? `${r.message} ${r.pass}` : r.message])].map((line) => line.map(cell).join(",")).join("\n"))}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download the report
                </button>
              ) : null}
              {report.problemCsv ? (
                <button type="button" className="inline-flex items-center gap-1.5 text-left font-semibold text-link hover:underline" onClick={() => save(`rows-to-fix-${stamp}.csv`, report.problemCsv!)}>
                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download the {problems === 1 ? "row" : `${problems} rows`} with problems, to fix and import again
                </button>
              ) : null}
              {report.registerLink ? <a href={report.registerLink} className="font-semibold text-link hover:underline">Open the register at what was just written</a> : null}
              {!report.checked && kind === "people" && report.done ? <a href="/settings/users" className="font-semibold text-link hover:underline">Open People &amp; access</a> : null}
            </div>

            {report.handOver ? (
              <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs leading-5 text-amber-900 ring-1 ring-amber-200">
                The links to choose a password are only in this report. Download it, or pass them on, before you leave this page.
              </p>
            ) : null}

            {/* The act, named with its count; rows with problems are left out only once that is said and agreed. */}
            {report.checked && ready > 0 ? (
              <div className="space-y-2 rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 ring-1 ring-line">
                {problems ? (
                  <p className="text-slate-700">
                    <strong className="font-semibold">{problems === 1 ? "1 row has" : `${problems} rows have`} problems and will be left out:</strong> nothing of {problems === 1 ? "it" : "them"} is written. Fix {problems === 1 ? "it" : "them"} in the file and import {problems === 1 ? "it" : "them"} afterwards.
                  </p>
                ) : (
                  <p className="text-slate-700">Every row is ready. Nothing is written until you press it.</p>
                )}
                {confirming ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">Leave out {problems} and write the rest?</span>
                    <button type="button" disabled={pending} onClick={() => send("write")} className={btn("primary")}>
                      {pending ? "Writing…" : `Yes: ${report.act}`}
                    </button>
                    <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={btn("secondary")}>Not yet</button>
                  </div>
                ) : (
                  <button type="button" disabled={pending} onClick={() => (problems ? setConfirming(true) : send("write"))} className={btn("primary")}>
                    {pending ? "Writing…" : `${report.act}${problems ? `, leave out ${problems}` : ""}`}
                  </button>
                )}
              </div>
            ) : null}
          </li>
        ) : null}
      </ul>
    </section>
  );
}
