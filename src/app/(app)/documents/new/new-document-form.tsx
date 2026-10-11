"use client";

import { useState } from "react";
import Link from "next/link";
import { ActionForm } from "@/components/form";
import { SearchPick } from "@/components/search-pick";
import { createDocumentAction } from "@/lib/actions/documents";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { isEmptyTitle } from "@/lib/standard";
import type { OwnField } from "@/lib/field-policy";
import { OwnFields } from "./own-fields";

type Opt = { code: string; label: string; meaning?: string | null; appliesTo?: string | null; criticality?: string | null; decides?: string | null };

const PRODUCER_LABEL: Record<string, string> = {
  ENG: "Internal engineering",
  CTR: "A contractor (under contract)",
  VND: "An equipment vendor / supplier",
  TPY: "A third party (certifier, authority, consultant)",
  CLT: "The client / owner",
};

const STEPS = ["What it is", "How it is described"];
const field = "plain w-full";

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
  received, start, fromFile, numberingSets, deliverableTypes, docTypes, disciplines, currentProject, subprojects, suppliers, pos, criticalities, confidentialities, retentionClasses, defaultConfidentiality, fields, ownFields, labels,
}: {
  received: boolean;
  /** Where another page sent the reader to register a document of a known type: our own, with its title. */
  start?: { docType: string; title: string };
  /** A file that came with a received transmittal, used instead of an upload. */
  fromFile?: { id: string; name: string; transmittal: string | null };
  numberingSets: Record<string, string[]>;
  /** The project being worked in. A document is registered here, so it is not a choice. */
  currentProject: { code: string; name: string };
  deliverableTypes: Opt[]; docTypes: Opt[]; disciplines: Opt[]; subprojects: Opt[]; suppliers: Opt[]; pos: Opt[]; criticalities: Opt[]; confidentialities: Opt[]; retentionClasses: Opt[];
  defaultConfidentiality: string | null;
  /** What this organization asks for: must be filled, may be left, or not asked. */
  fields: Record<string, "REQUIRED" | "OPTIONAL" | "OFF">;
  /** Fields the organization added for itself. */
  ownFields: OwnField[];
  /** Its own words for the application's fields. */
  labels: Record<string, string>;
}) {
  const [step, setStep] = useState(1);
  const [producer, setProducer] = useState(received ? "VND" : start ? "ENG" : "");
  const [receivedFile, setHasFile] = useState(!!fromFile);
  const [pdf, setPdf] = useState(false);
  const [native, setNative] = useState(false);
  const hasFile = receivedFile || pdf || native;
  const [docType, setDocType] = useState(start?.docType ?? "");
  const [discipline, setDiscipline] = useState("");
  const [title, setTitle] = useState(start?.title ?? "");
  const [criticality, setCriticality] = useState("");
  const [confidentiality, setConfidentiality] = useState(defaultConfidentiality ?? "");
  // The register refuses a title that only repeats the type, so the form says so first.
  const emptyTitle = title.trim().length > 0 && isEmptyTitle(title);
  const meaningOf = (options: Opt[], code: string) => options.find((o) => o.code === code)?.meaning ?? null;
  const needs = (setKey: string) => (numberingSets[producer] ?? []).includes(setKey);
  /**
   * Whether a field is asked at all, and whether it is insisted on. The number
   * wins where it draws on the field: a scheme that prints the supplier code
   * cannot be served by a blank supplier, whatever the form policy says.
   */
  const asks = (key: string) => fields[key] !== "OFF";
  const must = (key: string, byNumber = false) => byNumber || fields[key] === "REQUIRED";
  const external = producer === "CTR" || producer === "VND" || producer === "TPY" || producer === "CLT";
  const docTypeLabel = docTypes.find((t) => t.code === docType)?.label ?? docType;
  // The type recommends a criticality; it is filled in until the person chooses one themselves.
  const recommended = criticalities.find((o) => o.code === docTypes.find((t) => t.code === docType)?.criticality) ?? null;
  const [ownCriticality, setOwnCriticality] = useState(false);
  const shownCriticality = ownCriticality ? criticality : recommended?.code ?? criticality;
  const level = criticalities.find((o) => o.code === shownCriticality) ?? null;
  // Each type says who produces it. Once the producer is chosen, the list is
  // the types that belong to them — two hundred names narrows to the ones that
  // can be right. A type that says nothing is offered either way.
  const supplierDoc = producer !== "" && producer !== "ENG";
  const typesForProducer = docTypes.filter((one) => {
    if (!one.appliesTo || one.appliesTo === "Unclassified" || !producer) return true;
    return supplierDoc ? one.appliesTo === "Supplier" : one.appliesTo === "Non-supplier";
  });
  const disciplineLabel = disciplines.find((d) => d.code === discipline)?.label ?? discipline;
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
                      <input type="file" name="nativeFile" required className={cn(field, "text-slate-500")} onChange={(e) => setHasFile(!!e.target.files?.length)} />
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
                initial={start ? [start.docType] : undefined}
                items={typesForProducer.map((o) => ({ id: o.code, name: o.label, detail: o.code }))}
                label="Type"
                required
                hint={producer ? `${typesForProducer.length} types ${supplierDoc ? "a supplier produces" : "we produce"} — click to see them, or type to narrow` : "click to see the list, or type to narrow it"}
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
            <Ask label={labels["title"]} required hint="what it is about, in the words someone searching would use" className="sm:col-span-2">
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
            {asks("subProject") || needs("SUBPROJECTS") ? (
              <Ask label={labels["subProject"]} required={must("subProject", needs("SUBPROJECTS"))} hint={subprojects.length ? undefined : "none defined for this project"}>
                <select name="subProject" required={must("subProject", needs("SUBPROJECTS"))} className={field} defaultValue="">
                  <option value="" disabled={must("subProject", needs("SUBPROJECTS"))}>{must("subProject", needs("SUBPROJECTS")) ? "Choose…" : "—"}</option>
                  {subprojects.map((o) => <option key={o.code} value={o.code}>{o.code} — {o.label}</option>)}
                </select>
              </Ask>
            ) : null}
            {external ? (
              <>
                {asks("originator") || needs("SUPPLIER_CODES") ? (
                  <Ask label={labels["originator"]} required={must("originator", needs("SUPPLIER_CODES"))}>
                    <select name="originator" required={must("originator", needs("SUPPLIER_CODES"))} className={field} defaultValue="">
                      <option value="" disabled={must("originator", needs("SUPPLIER_CODES"))}>{must("originator", needs("SUPPLIER_CODES")) ? "Choose…" : "—"}</option>
                      {suppliers.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                    </select>
                  </Ask>
                ) : null}
                {asks("contractRef") || needs("PURCHASE_ORDERS") ? (
                  <Ask label={labels["contractRef"]} required={must("contractRef", needs("PURCHASE_ORDERS"))}>
                    <select name="contractRef" required={must("contractRef", needs("PURCHASE_ORDERS"))} className={field} defaultValue="">
                      <option value="" disabled={must("contractRef", needs("PURCHASE_ORDERS"))}>{must("contractRef", needs("PURCHASE_ORDERS")) ? "Choose…" : "—"}</option>
                      {pos.map((o) => <option key={o.code} value={o.code}>{o.code} — {o.label}</option>)}
                    </select>
                  </Ask>
                ) : null}
                {asks("receivedDate") ? (
                  <Ask label={labels["receivedDate"]} required={must("receivedDate")}>
                    <input type="date" name="receivedDate" required={must("receivedDate")} className={field} defaultValue={received ? new Date().toISOString().slice(0, 10) : undefined} />
                  </Ask>
                ) : null}
              </>
            ) : null}
            <Ask label={labels["criticality"]} required hint="how serious an error in it would be">
              <select name="criticality" required className={field} value={shownCriticality} onChange={(e) => { setCriticality(e.target.value); setOwnCriticality(true); }}>
                <option value="" disabled>Choose…</option>
                {criticalities.map((o) => <option key={o.code} value={o.code}>{o.label}{o.code === recommended?.code ? " (recommended)" : ""}</option>)}
              </select>
              {recommended ? (
                <span className="mt-1 block text-[11px] text-slate-500">
                  {shownCriticality === recommended.code
                    ? <>Recommended for {docTypeLabel.toLowerCase()}. Choose another if you see it differently.</>
                    : <>{docTypeLabel} is usually {recommended.label.toLowerCase()}.{" "}
                        <button type="button" className="font-semibold text-link hover:underline" onClick={() => { setCriticality(recommended.code); setOwnCriticality(false); }}>Use {recommended.label.toLowerCase()}</button></>}
                </span>
              ) : null}
              {level && (level.meaning || level.decides) ? (
                <span className="mt-1 block text-[11px] text-slate-500">
                  {[level.meaning && !level.decides?.includes(level.meaning) ? level.meaning : null, level.decides].filter(Boolean).join(" — ")}
                </span>
              ) : null}
            </Ask>
            {asks("confidentiality") ? (
            <Ask label={labels["confidentiality"]} required={must("confidentiality")}>
              <select name="confidentiality" className={field} value={confidentiality} onChange={(e) => setConfidentiality(e.target.value)}>
                {confidentialities.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
              {meaningOf(confidentialities, confidentiality) ? <span className="mt-1 block text-[11px] text-slate-500">{meaningOf(confidentialities, confidentiality)}</span> : null}
            </Ask>
            ) : null}
            {asks("retentionClass") ? (
              <Ask label={labels["retentionClass"]} required={must("retentionClass")} hint="automatic follows the criticality">
                <select name="retentionClass" required={must("retentionClass")} className={field} defaultValue="">
                  <option value="">Automatic</option>
                  {retentionClasses.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </Ask>
            ) : null}
            {received || !asks("file") ? null : (
              <>
                {/* The same two files a new revision takes: what people read, and the editable original. */}
                <Ask label="PDF" required={must("file")} hint={must("file") ? "this project registers nothing without its file — the PDF or the native file" : "optional — what people will read; needed before it is sent"}>
                  <input type="file" name="renditionFile" accept=".pdf" className={cn(field, "text-slate-500")} onChange={(e) => setPdf(!!e.target.files?.length)} />
                </Ask>
                <Ask label="Native file" hint="optional — the editable original (.docx, .dwg, .xlsx…)">
                  <input type="file" name="nativeFile" className={cn(field, "text-slate-500")} onChange={(e) => setNative(!!e.target.files?.length)} />
                </Ask>
              </>
            )}
            <OwnFields fields={ownFields} />

          </div>
          {foot(received ? null : 1,
            <button type="submit" disabled={emptyTitle || (received && !ready)} data-on="true" className="ask disabled:cursor-not-allowed disabled:opacity-50">
              {received ? "Register it" : "Create and get a number"}
            </button>,
            hasFile ? "It gets its number; send it for review from its page, choosing the route and the people." : "It gets its number and waits in the register.",
          )}
        </section>
      </ActionForm>
    </div>
  );
}
