"use client";

import { useState } from "react";
import Link from "next/link";
import { ActionForm } from "@/components/form";
import { Field, inputCls, btn, Card } from "@/components/ui";
import { createDocumentAction } from "@/lib/actions/documents";
import { cn } from "@/lib/utils";
import { Check, AlertTriangle } from "lucide-react";
import { isEmptyTitle } from "@/lib/standard";

type Opt = { code: string; label: string; meaning?: string | null };

const PRODUCER_LABEL: Record<string, string> = {
  ENG: "Internal engineering",
  CTR: "A contractor (under contract)",
  VND: "An equipment vendor / supplier",
  TPY: "A third party (certifier, authority, consultant)",
  CLT: "The client / owner",
};

/**
 * Two short steps, each fitting on one screen: what the document is, then how
 * it is described. A received document is one step, because what it is comes
 * with the file. Fields sit two to a row so nothing scrolls away.
 */
export function NewDocumentForm({
  received, routes, numberingSets, deliverableTypes, docTypes, disciplines, currentProject, subprojects, suppliers, pos, criticalities, confidentialities, retentionClasses, defaultConfidentiality,
}: {
  received: boolean;
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
  const [hasFile, setHasFile] = useState(false);
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

  return (
    <Card className="max-w-3xl">
      {/* Where you are. A received document has one step, so it is hidden. */}
      <ol className={cn("mb-5 flex items-center gap-3", received && "hidden")}>
        {["What it is", "How it is described"].map((label, i) => {
          const n = i + 1;
          const done = step > n;
          return (
            <li key={label} className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => (n === 1 || ready) && setStep(n)}
                className={cn(
                  "flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs font-semibold transition",
                  step === n ? "bg-brand text-white" : done ? "text-emerald-700 hover:bg-emerald-50" : "text-slate-400",
                )}
              >
                <span className={cn("grid h-6 w-6 place-items-center rounded-full text-[11px]", step === n ? "bg-white/20" : done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400")}>
                  {done ? <Check className="h-3.5 w-3.5" /> : n}
                </span>
                {label}
              </button>
              {i === 0 ? <span className="h-px w-8 bg-slate-200" /> : null}
            </li>
          );
        })}
      </ol>

      <ActionForm action={createDocumentAction} submitLabel="Create" hideSubmit>
        {/* ── Step 1 — what it is ─────────────────────────────────────────── */}
        <div className={cn("space-y-4", !received && step !== 1 && "hidden")}>
          {received ? (
            <>
              <input type="hidden" name="kind" value="DOCUMENT" />
              <Field label="The file you received" required hint="a PDF opens in the viewer; any other format is kept as the source file">
                <input type="file" name="nativeFile" required className="block w-full text-sm" onChange={(e) => setHasFile(!!e.target.files?.length)} />
              </Field>
            </>
          ) : (
            <Field label="Will it be revised?" required hint="a record is fixed once confirmed — minutes, a test result, a certificate">
              <select name="kind" className={inputCls} defaultValue="DOCUMENT">
                <option value="DOCUMENT">Yes — a document; new revisions replace old ones</option>
                <option value="RECORD">No — a record; fixed once confirmed</option>
              </select>
            </Field>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={received ? "Who sent it?" : "Who produces it?"} required className="sm:col-span-2">
              <select name="deliverableType" required className={inputCls} value={producer} onChange={(e) => setProducer(e.target.value)}>
                <option value="" disabled>Choose…</option>
                {deliverableTypes.filter((o) => !received || o.code !== "ENG").map((o) => (
                  <option key={o.code} value={o.code}>{PRODUCER_LABEL[o.code] ?? o.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Type" required>
              <select name="docType" required className={inputCls} value={docType} onChange={(e) => setDocType(e.target.value)}>
                <option value="" disabled>Choose…</option>
                {docTypes.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Discipline" required hint="whose work it is — it also picks the reviewers">
              <select name="discipline" required className={inputCls} value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
                <option value="" disabled>Choose…</option>
                {disciplines.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
            </Field>
          </div>

          {ready ? (
            <p className="rounded-xl bg-tint px-3.5 py-2.5 text-xs text-brand-ink">
              A <strong>{docTypeLabel}</strong> owned by <strong>{disciplineLabel}</strong>, produced by <strong>{(PRODUCER_LABEL[producer] ?? "").toLowerCase()}</strong>.
              {external ? " It gets a supplier number." : " It gets an internal number."}
            </p>
          ) : null}

          {received ? null : (
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <Link href="/documents" className={btn("ghost", "sm")}>Cancel</Link>
              <button type="button" onClick={() => setStep(2)} disabled={!ready} className={btn("primary", "sm")}>Continue</button>
            </div>
          )}
        </div>

        {/* ── Step 2 — how it is described ────────────────────────────────── */}
        <div className={cn("space-y-4", !received && step !== 2 && "hidden", received && "mt-4 border-t border-slate-100 pt-4")}>
          {received ? null : (
            <p className="text-xs text-slate-500">
              <strong className="font-semibold text-slate-700">{docTypeLabel}</strong> · {disciplineLabel} · {(PRODUCER_LABEL[producer] ?? "").toLowerCase()}
            </p>
          )}

          <Field label="Title" required hint="what it is about, in the words someone searching would use">
            <input name="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} aria-invalid={emptyTitle} placeholder="e.g. Feed pump P-101 general arrangement and dimensions" />
            {emptyTitle ? (
              <span className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800 ring-1 ring-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong>“{title.trim()}” says nothing about the document.</strong> The type already says it is a {docTypeLabel.toLowerCase()} — the title has to say which one.{" "}
                  <Link href="/guide/codes#titles" target="_blank" className="font-semibold underline">Titles that are refused →</Link>
                </span>
              </span>
            ) : null}
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Project">
              <input type="hidden" name="projectCode" value={currentProject.code} />
              <p className="pt-1 text-sm font-medium text-slate-700">{currentProject.code} — {currentProject.name}</p>
              <span className="mt-0.5 block text-[11px] text-slate-500">The project you are working in. Switch project in the header to register somewhere else.</span>
            </Field>
            <Field label="Sub-project" required={needs("SUBPROJECTS")} hint={subprojects.length ? "this project’s sub-projects" : "none defined for this project"}>
              <select name="subProject" required={needs("SUBPROJECTS")} className={inputCls} defaultValue="">
                <option value="" disabled={needs("SUBPROJECTS")}>{needs("SUBPROJECTS") ? "Choose…" : "—"}</option>
                {subprojects.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
            </Field>
            {external ? (
              <>
                <Field label="Supplier" required={needs("SUPPLIER_CODES")}>
                  <select name="originator" required={needs("SUPPLIER_CODES")} className={inputCls} defaultValue="">
                    <option value="" disabled={needs("SUPPLIER_CODES")}>{needs("SUPPLIER_CODES") ? "Choose…" : "—"}</option>
                    {suppliers.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Contract or purchase order" required={needs("PURCHASE_ORDERS")}>
                  <select name="contractRef" required={needs("PURCHASE_ORDERS")} className={inputCls} defaultValue="">
                    <option value="" disabled={needs("PURCHASE_ORDERS")}>{needs("PURCHASE_ORDERS") ? "Choose…" : "—"}</option>
                    {pos.map((o) => <option key={o.code} value={o.code}>{o.code} — {o.label}</option>)}
                  </select>
                </Field>
                <Field label="Date received">
                  <input type="date" name="receivedDate" className={inputCls} defaultValue={received ? new Date().toISOString().slice(0, 10) : undefined} />
                </Field>
              </>
            ) : null}
            <Field label="Criticality" required hint="how serious an error in it would be">
              <select name="criticality" required className={inputCls} value={criticality} onChange={(e) => setCriticality(e.target.value)}>
                <option value="" disabled>Choose…</option>
                {criticalities.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
              {meaningOf(criticalities, criticality) ? <span className="mt-1 block text-[11px] text-slate-500">{meaningOf(criticalities, criticality)}</span> : null}
            </Field>
            <Field label="Who may see it?">
              <select name="confidentiality" className={inputCls} value={confidentiality} onChange={(e) => setConfidentiality(e.target.value)}>
                {confidentialities.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
              {meaningOf(confidentialities, confidentiality) ? <span className="mt-1 block text-[11px] text-slate-500">{meaningOf(confidentialities, confidentiality)}</span> : null}
            </Field>
            <Field label="Keep it for" hint="how long it stays in the archive after the project; automatic follows the criticality">
              <select name="retentionClass" className={inputCls} defaultValue="">
                <option value="">Automatic</option>
                {retentionClasses.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
            </Field>
            {received ? null : (
              <Field label="File" hint="optional — you can attach it later">
                <input type="file" name="nativeFile" className="block w-full text-sm" onChange={(e) => setHasFile(!!e.target.files?.length)} />
              </Field>
            )}
            <Field
              label="After it is registered"
              className="sm:col-span-2"
              hint={routes.length ? (hasFile ? undefined : "attach the file above to send it for review now") : "no review route is set up yet — ask an administrator"}
            >
              <select name="sendTemplateId" disabled={!hasFile} className={cn(inputCls, !hasFile && "cursor-not-allowed bg-slate-50 text-slate-400")} value={hasFile ? sendTo : ""} onChange={(e) => setSendTo(e.target.value)}>
                <option value="">Register it only — I will send it for review later</option>
                {routes.map((r) => <option key={r.id} value={r.id}>Send for review — {r.name}</option>)}
              </select>
              {hasFile && route ? <span className="mt-1.5 block text-[11px] text-slate-500">It goes to {route.path}</span> : null}
              {!hasFile ? <span className="mt-1.5 block text-[11px] text-slate-500">Nothing can be reviewed until there is something to read. Register it now, and send it once the file exists.</span> : null}
            </Field>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            {received ? <Link href="/documents" className={btn("ghost", "sm")}>Cancel</Link> : <button type="button" onClick={() => setStep(1)} className={btn("ghost", "sm")}>Back</button>}
            <div className="flex items-center gap-3">
              <span className="hidden text-[11px] text-slate-500 sm:block">{hasFile && sendTo ? "It gets its number, then goes to the route" : "It gets its number and waits in the register"}</span>
              <button type="submit" disabled={emptyTitle} className={btn("primary", "sm")}>{hasFile && sendTo ? "Create and send" : received ? "Register it" : "Create and get a number"}</button>
            </div>
          </div>
        </div>
      </ActionForm>
    </Card>
  );
}
