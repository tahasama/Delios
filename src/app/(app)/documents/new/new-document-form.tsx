"use client";

import { useState } from "react";
import { ActionForm } from "@/components/form";
import { Field, inputCls, Card } from "@/components/ui";
import { createDocumentAction } from "@/lib/actions/documents";
import { cn } from "@/lib/utils";

type Opt = { code: string; label: string };

const PRODUCER_LABEL: Record<string, string> = {
  ENG: "Internal engineering",
  CTR: "A contractor (under contract)",
  VND: "An equipment vendor / supplier",
  TPY: "A third party (certifier, authority, consultant)",
  CLT: "The client / owner",
};

export function NewDocumentForm({
  received, routes, numberingSets, deliverableTypes, docTypes, disciplines, projects, subprojects, suppliers, pos, criticalities, confidentialities, retentionClasses, defaultConfidentiality,
}: {
  received: boolean;
  routes: { id: string; name: string; isDefault: boolean; path: string }[];
  numberingSets: Record<string, string[]>;
  deliverableTypes: Opt[]; docTypes: Opt[]; disciplines: Opt[]; projects: Opt[]; subprojects: Opt[]; suppliers: Opt[]; pos: Opt[]; criticalities: Opt[]; confidentialities: Opt[]; retentionClasses: Opt[];
  defaultConfidentiality: string | null;
}) {
  const [step, setStep] = useState(1);
  const [producer, setProducer] = useState(received ? "VND" : "");
  const [sendTo, setSendTo] = useState(received ? routes.find((r) => r.isDefault)?.id ?? routes[0]?.id ?? "" : "");
  const [hasFile, setHasFile] = useState(false);
  const [docType, setDocType] = useState("");
  const [discipline, setDiscipline] = useState("");
  const needs = (setKey: string) => (numberingSets[producer] ?? []).includes(setKey);
  const external = producer === "CTR" || producer === "VND" || producer === "TPY" || producer === "CLT";

  const steps = ["What is it?", "Details"];
  const docTypeLabel = docTypes.find((t) => t.code === docType)?.label ?? docType;
  const disciplineLabel = disciplines.find((d) => d.code === discipline)?.label ?? discipline;

  return (
    <Card className="max-w-3xl">
        {/* Stepper — a received document is one screen, so no steps */}
        <div className={cn("mb-5 flex items-center gap-2", received && "hidden")}>
          {steps.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep(i + 1)}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition",
                  step === i + 1 ? "bg-[#1e3a5f] text-white" : step > i + 1 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
                )}
              >
                <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold", step === i + 1 ? "bg-white/20" : step > i + 1 ? "bg-emerald-500 text-white" : "bg-white")}>
                  {step > i + 1 ? "✓" : i + 1}
                </span>
                {label}
              </button>
              {i < steps.length - 1 ? <span className="h-px w-4 bg-slate-300" /> : null}
            </div>
          ))}
        </div>

        <ActionForm action={createDocumentAction} submitLabel="Allocate number & create" hideSubmit>
          {/* ── Step 1 — what is it ── */}
          <div className={cn("space-y-4", !received && step !== 1 && "hidden")}>
            {received ? (
              <>
                <input type="hidden" name="kind" value="DOCUMENT" />
                <Field label="The file you received" required hint="a PDF shows in the viewer; other formats are kept as the source file">
                  <input type="file" name="nativeFile" required className="block w-full text-sm" onChange={(e) => setHasFile(!!e.target.files?.length)} />
                </Field>
              </>
            ) : (
              <Field label="Will it be revised?" required>
                <select name="kind" className={inputCls} defaultValue="DOCUMENT">
                  <option value="DOCUMENT">Yes — a document; new revisions replace old ones</option>
                  <option value="RECORD">No — a record (minutes, test result, certificate); fixed once confirmed</option>
                </select>
              </Field>
            )}
            <Field label={received ? "Who sent it?" : "Who produces it?"} required>
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
            <Field label="Discipline" required>
              <select name="discipline" required className={inputCls} value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
                <option value="" disabled>Choose…</option>
                {disciplines.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
            </Field>
            {producer && docType && discipline ? (
              <div className="rounded-lg bg-sky-50 px-3.5 py-3 text-xs text-sky-900">
                A <strong>{docTypeLabel}</strong> owned by <strong>{disciplineLabel}</strong>, produced by <strong>{PRODUCER_LABEL[producer]?.toLowerCase()}</strong>.
                {external ? " It gets a supplier number." : " It gets an internal number."}
              </div>
            ) : null}
            <button type="button" onClick={() => setStep(2)} disabled={!producer || !docType || !discipline} hidden={received}
              className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              Continue
            </button>
          </div>

          {/* ── Step 2 — describe it ── */}
          <div className={cn("space-y-4", !received && step !== 2 && "hidden", received && "mt-4")}>
            <Field label="Title" required hint="say what it is about — “Drawing” alone is refused">
              <input name="title" required maxLength={200} className={inputCls} placeholder="e.g. Feed pump P-101 general arrangement and dimensions" />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Project" required>
                <select name="projectCode" required className={inputCls} defaultValue="">
                  <option value="" disabled>Select…</option>
                  {projects.map((o) => <option key={o.code} value={o.code}>{o.code} — {o.label}</option>)}
                </select>
              </Field>
              <Field label="Sub-project" required={needs("SUBPROJECTS")}>
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
                  <Field label="Contract / purchase order" required={needs("PURCHASE_ORDERS")}>
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
                <select name="criticality" required className={inputCls} defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {criticalities.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Who may see it?">
                <select name="confidentiality" className={inputCls} defaultValue={defaultConfidentiality ?? ""}>
                  {confidentialities.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Keep for" hint="optional — set from the criticality if left empty">
                <select name="retentionClass" className={inputCls} defaultValue="">
                  <option value="">Automatic</option>
                  {retentionClasses.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </Field>
            </div>
            {received ? null : (
              <Field label="File" hint="optional — you can attach it later">
                <input type="file" name="nativeFile" className="block w-full text-sm" onChange={(e) => setHasFile(!!e.target.files?.length)} />
              </Field>
            )}
            <Field label="Then" hint={routes.length ? undefined : "no review route is set up yet — ask an administrator"}>
              <select name="sendTemplateId" className={inputCls} value={sendTo} onChange={(e) => setSendTo(e.target.value)}>
                <option value="">Just register it — I will send it later</option>
                {routes.map((r) => <option key={r.id} value={r.id}>Send for approval — {r.name}</option>)}
              </select>
              {sendTo ? <span className="mt-1 block text-[11px] text-slate-500">Goes to {routes.find((r) => r.id === sendTo)?.path}</span> : null}
              {sendTo && !received && !hasFile ? <span className="mt-1 block text-[11px] text-amber-700">Attach the file above, or it cannot be sent yet.</span> : null}
            </Field>
            <div className="flex gap-2">
              {received ? null : <button type="button" onClick={() => setStep(1)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">Back</button>}
              <button type="submit" className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white">{sendTo ? "Register & send for approval" : received ? "Register it" : "Create & get number"}</button>
            </div>
          </div>

        </ActionForm>
    </Card>
  );
}
