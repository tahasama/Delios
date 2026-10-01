"use client";

import { useState } from "react";
import Link from "next/link";
import { ActionForm } from "@/components/form";
import { SearchPick } from "@/components/search-pick";
import { createDocumentAction } from "@/lib/actions/documents";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { isEmptyTitle } from "@/lib/standard";

type Opt = { code: string; label: string; meaning?: string | null };

const PRODUCER_LABEL: Record<string, string> = {
  ENG: "Internal engineering",
  CTR: "A contractor (under contract)",
  VND: "An equipment vendor / supplier",
  TPY: "A third party (certifier, authority, consultant)",
  CLT: "The client / owner",
};

const STEPS = ["What it is", "How it is described"];
const field = "plain w-full py-1.5 text-[13px]";

/** A labelled question, in the register's vocabulary: stencil label, plain field. */
function Ask({ label, hint, required, children, className }: { label: string; hint?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="stencil text-slate-500">{label}{required ? <span className="ml-0.5 text-red-500">*</span> : null}</span>
        {hint ? <span className="text-[11px] text-slate-400">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

/**
 * Two short steps, each a sheet of its own in the register's vocabulary — the
 * same band, stencil and plain fields as a new transmittal: what the document
 * is, then how it is described. A received document is one step, because what
 * it is comes with the file.
 */
export function NewDocumentForm({
  received, fromFile, routes, numberingSets, deliverableTypes, docTypes, disciplines, currentProject, subprojects, suppliers, pos, criticalities, confidentialities, retentionClasses, defaultConfidentiality,
}: {
  received: boolean;
  /** A file that came with a received transmittal, used instead of an upload. */
  fromFile?: { id: string; name: string; transmittal: string | null };
  routes: { id: string; name: string; isDefault: boolean; path: string }[];
  numberingSets: Record<string, string[]>;
  /** The project being worked in. A document is registered here, so it is not a choice. */
  currentProject: { code: string; name: string };
  deliverableTypes: Opt[]; docTypes: Opt[]; disciplines: Opt[]; subprojects: Opt[]; suppliers: Opt[]; pos: Opt[]; criticalities: Opt[]; confidentialities: Opt[]; retentionClasses: Opt[];
  defaultConfidentiality: string | null;
}) {
  const [step, setStep] = useState(1);
  const [producer, setProducer] = useState(received ? "VND" : "");
  const [sendTo, setSendTo] = useState(received ? routes.find((r) => r.isDefault)?.id ?? routes[0]?.id ?? "" : "");
  const [hasFile, setHasFile] = useState(!!fromFile);
  const [docType, setDocType] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [title, setTitle] = useState("");
  const [criticality, setCriticality] = useState("");
  const [confidentiality, setConfidentiality] = useState(defaultConfidentiality ?? "");
  // The register refuses a title that only repeats the type, so the form says so first.
  const emptyTitle = title.trim().length > 0 && isEmptyTitle(title);
  const meaningOf = (options: Opt[], code: string) => options.find((o) => o.code === code)?.meaning ?? null;
  const needs = (setKey: string) => (numberingSets[producer] ?? []).includes(setKey);
  const external = producer === "CTR" || producer === "VND" || producer === "TPY" || producer === "CLT";
  const docTypeLabel = docTypes.find((t) => t.code === docType)?.label ?? docType;
  const disciplineLabel = disciplines.find((d) => d.code === discipline)?.label ?? discipline;
  const route = routes.find((r) => r.id === sendTo);
  const ready = Boolean(producer && docType && discipline);
  const may = (n: number) => n === 1 || ready;

  const band = (n: number, sentence: string) => (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
      <span className="stencil mr-1 text-slate-400">{received ? "The document" : `${n} · ${STEPS[n - 1]}`}</span>
      <span className="text-[11px] text-slate-400">{sentence}</span>
    </div>
  );
  // The strip that closes each sheet: back on the left, what is missing and the
  // way on at the right.
  const foot = (back: number | null, next: React.ReactNode, missing?: string | null) => (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
      {back ? (
        <button type="button" onClick={() => setStep(back)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">&larr; Back</button>
      ) : (
        <Link href="/documents" className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
      )}
      <div className="flex items-center gap-3">
        {missing ? <span className="text-[11px] text-slate-400">{missing}</span> : null}
        {next}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Where you are: the two steps as one instrument. A received document
          has one step, so there is nothing to show. */}
      {received ? null : (
        <nav aria-label="Steps" className="seg w-fit max-w-full">
          {STEPS.map((label, i) => {
            const n = i + 1;
            return (
              <button key={label} type="button" onClick={() => may(n) && setStep(n)} aria-current={step === n ? "page" : undefined} disabled={!may(n)} className="segment disabled:opacity-45">
                <span className="segment-n">{n}</span> {label}
              </button>
            );
          })}
        </nav>
      )}

      <ActionForm action={createDocumentAction} submitLabel="Create" hideSubmit className="space-y-4">
        {/* ── 1 · What it is ──────────────────────────────────────────────── */}
        <section className={cn("register register-sheet register-sheet-open", !received && step !== 1 && "hidden")}>
          {band(1, received ? "what arrived, who sent it, and whose work it is" : "whether it is revised, who produces it, and whose work it is")}
          <div className="asking space-y-5 px-5 py-5 sm:px-6">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              {received ? (
                <>
                  <input type="hidden" name="kind" value="DOCUMENT" />
                  {fromFile ? (
                    <div className="min-w-0 sm:col-span-2">
                      <span className="stencil mb-1.5 block text-slate-500">The file you received</span>
                      <input type="hidden" name="fromFileId" value={fromFile.id} />
                      <p className="py-1.5 text-[13px] text-slate-700">
                        <span className="font-medium">{fromFile.name}</span>
                        {fromFile.transmittal ? <span className="text-slate-500"> — kept with {fromFile.transmittal}, which will list this document</span> : null}
                      </p>
                    </div>
                  ) : (
                    <Ask label="The file you received" required hint="a PDF opens in the viewer; any other format is kept as the source file" className="sm:col-span-2">
                      <input type="file" name="nativeFile" required className={cn(field, "text-[12px] text-slate-500 file:mr-2 file:rounded file:border-0 file:bg-canvas-deep file:px-2 file:py-0.5 file:text-[11px] file:font-semibold file:text-slate-700")} onChange={(e) => setHasFile(!!e.target.files?.length)} />
                    </Ask>
                  )}
                </>
              ) : (
                <Ask label="Will it be revised?" required hint="a record is fixed once confirmed — minutes, a test result">
                  <select name="kind" className={field} defaultValue="DOCUMENT">
                    <option value="DOCUMENT">Yes — a document; new revisions replace old ones</option>
                    <option value="RECORD">No — a record; fixed once confirmed</option>
                  </select>
                </Ask>
              )}
              <Ask label={received ? "Who sent it?" : "Who produces it?"} required>
                <select name="deliverableType" required className={field} value={producer} onChange={(e) => setProducer(e.target.value)}>
                  <option value="" disabled>Choose…</option>
                  {deliverableTypes.filter((o) => !received || o.code !== "ENG").map((o) => (
                    <option key={o.code} value={o.code}>{PRODUCER_LABEL[o.code] ?? o.label}</option>
                  ))}
                </select>
              </Ask>
              {/* Found by typing, like a person: the type list is hundreds long. */}
              <SearchPick
                single
                name="docType"
                browse
                items={docTypes.map((o) => ({ id: o.code, name: o.label, detail: o.code }))}
                label="Type"
                required
                hint="click to see the list, or type to narrow it"
                placeholder="e.g. drawing, datasheet, DSW…"
                onChange={(ids) => setDocType(ids[0] ?? "")}
              />
              <SearchPick
                single
                name="discipline"
                browse
                items={disciplines.map((o) => ({ id: o.code, name: o.label, detail: o.code }))}
                label="Discipline"
                required
                hint="whose work it is — it also picks the reviewers"
                placeholder="e.g. civil, EL…"
                onChange={(ids) => setDiscipline(ids[0] ?? "")}
              />
            </div>

            {ready ? (
              <p className="rounded-lg bg-tint-soft px-3.5 py-2.5 text-xs text-brand-ink">
                A <strong>{docTypeLabel}</strong> owned by <strong>{disciplineLabel}</strong>, produced by <strong>{(PRODUCER_LABEL[producer] ?? "").toLowerCase()}</strong>.
                {external ? " It gets a supplier number." : " It gets an internal number."}
              </p>
            ) : null}
          </div>
          {received ? null : foot(null,
            <button type="button" onClick={() => setStep(2)} disabled={!ready} data-on={ready ? "true" : undefined} className="ask disabled:cursor-not-allowed disabled:opacity-50">Continue</button>,
            ready ? null : "Say who produces it, its type and its discipline.",
          )}
        </section>

        {/* ── 2 · How it is described ─────────────────────────────────────── */}
        <section className={cn("register register-sheet register-sheet-open", !received && step !== 2 && "hidden")}>
          {received ? null : band(2, `${docTypeLabel || "the document"} · ${disciplineLabel || "—"} — its title, where it sits, and how it is kept`)}
          <div className="asking grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-2 sm:px-6">
            <Ask label="Title" required hint="what it is about, in the words someone searching would use" className="sm:col-span-2">
              <input name="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={field} aria-invalid={emptyTitle} placeholder="e.g. Feed pump P-101 general arrangement and dimensions" />
              {emptyTitle ? (
                <span className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800 ring-1 ring-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <strong>“{title.trim()}” says nothing about the document.</strong> The type already says it is a {docTypeLabel.toLowerCase()} — the title has to say which one.{" "}
                    <Link href="/guide/codes#titles" target="_blank" className="font-semibold underline">Titles that are refused →</Link>
                  </span>
                </span>
              ) : null}
            </Ask>

            <div className="min-w-0">
              <span className="stencil mb-1.5 block text-slate-500">Project</span>
              <input type="hidden" name="projectCode" value={currentProject.code} />
              <p className="py-1.5 text-[13px] font-medium text-slate-700">{currentProject.code} — {currentProject.name}</p>
              <span className="block text-[11px] text-slate-400">Switch project in the header to register somewhere else.</span>
            </div>
            <Ask label="Sub-project" required={needs("SUBPROJECTS")} hint={subprojects.length ? undefined : "none defined for this project"}>
              <select name="subProject" required={needs("SUBPROJECTS")} className={field} defaultValue="">
                <option value="" disabled={needs("SUBPROJECTS")}>{needs("SUBPROJECTS") ? "Choose…" : "—"}</option>
                {subprojects.map((o) => <option key={o.code} value={o.code}>{o.code} — {o.label}</option>)}
              </select>
            </Ask>
            {external ? (
              <>
                <Ask label="Supplier" required={needs("SUPPLIER_CODES")}>
                  <select name="originator" required={needs("SUPPLIER_CODES")} className={field} defaultValue="">
                    <option value="" disabled={needs("SUPPLIER_CODES")}>{needs("SUPPLIER_CODES") ? "Choose…" : "—"}</option>
                    {suppliers.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </select>
                </Ask>
                <Ask label="Contract or purchase order" required={needs("PURCHASE_ORDERS")}>
                  <select name="contractRef" required={needs("PURCHASE_ORDERS")} className={field} defaultValue="">
                    <option value="" disabled={needs("PURCHASE_ORDERS")}>{needs("PURCHASE_ORDERS") ? "Choose…" : "—"}</option>
                    {pos.map((o) => <option key={o.code} value={o.code}>{o.code} — {o.label}</option>)}
                  </select>
                </Ask>
                <Ask label="Date received">
                  <input type="date" name="receivedDate" className={field} defaultValue={received ? new Date().toISOString().slice(0, 10) : undefined} />
                </Ask>
              </>
            ) : null}
            <Ask label="Criticality" required hint="how serious an error in it would be">
              <select name="criticality" required className={field} value={criticality} onChange={(e) => setCriticality(e.target.value)}>
                <option value="" disabled>Choose…</option>
                {criticalities.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
              {meaningOf(criticalities, criticality) ? <span className="mt-1 block text-[11px] text-slate-500">{meaningOf(criticalities, criticality)}</span> : null}
            </Ask>
            <Ask label="Who may see it?">
              <select name="confidentiality" className={field} value={confidentiality} onChange={(e) => setConfidentiality(e.target.value)}>
                {confidentialities.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
              {meaningOf(confidentialities, confidentiality) ? <span className="mt-1 block text-[11px] text-slate-500">{meaningOf(confidentialities, confidentiality)}</span> : null}
            </Ask>
            <Ask label="Keep it for" hint="automatic follows the criticality">
              <select name="retentionClass" className={field} defaultValue="">
                <option value="">Automatic</option>
                {retentionClasses.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
            </Ask>
            {received ? null : (
              <Ask label="File" hint="optional — you can attach it later">
                <input type="file" name="nativeFile" className={cn(field, "text-[12px] text-slate-500 file:mr-2 file:rounded file:border-0 file:bg-canvas-deep file:px-2 file:py-0.5 file:text-[11px] file:font-semibold file:text-slate-700")} onChange={(e) => setHasFile(!!e.target.files?.length)} />
              </Ask>
            )}
            <Ask
              label="After it is registered"
              className="sm:col-span-2"
              hint={routes.length ? (hasFile ? undefined : "attach the file to send it for review now") : "no review route is set up yet — ask an administrator"}
            >
              <select name="sendTemplateId" disabled={!hasFile} className={cn(field, !hasFile && "cursor-not-allowed text-slate-400")} value={hasFile ? sendTo : ""} onChange={(e) => setSendTo(e.target.value)}>
                <option value="">Register it only — I will send it for review later</option>
                {routes.map((r) => <option key={r.id} value={r.id}>Send for review — {r.name}</option>)}
              </select>
              {hasFile && route ? <span className="mt-1.5 block text-[11px] text-slate-500">It goes to {route.path}</span> : null}
              {!hasFile ? <span className="mt-1.5 block text-[11px] text-slate-500">Nothing can be reviewed until there is something to read. Register it now, and send it once the file exists.</span> : null}
            </Ask>
          </div>
          {foot(received ? null : 1,
            <button type="submit" disabled={emptyTitle || (received && !ready)} data-on="true" className="ask disabled:cursor-not-allowed disabled:opacity-50">
              {hasFile && sendTo ? "Create and send" : received ? "Register it" : "Create and get a number"}
            </button>,
            hasFile && sendTo ? "It gets its number, then goes to the route." : "It gets its number and waits in the register.",
          )}
        </section>
      </ActionForm>
    </div>
  );
}
