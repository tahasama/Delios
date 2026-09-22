"use client";

import { useState } from "react";
import { ActionForm } from "@/components/form";
import { Field, FormSection, FormActions, inputCls, btn, Card } from "@/components/ui";
import { createDocumentAction } from "@/lib/actions/documents";
import Link from "next/link";

type Opt = { code: string; label: string };

const PRODUCER_LABEL: Record<string, string> = {
  ENG: "Internal engineering",
  CTR: "A contractor (under contract)",
  VND: "An equipment vendor / supplier",
  TPY: "A third party (certifier, authority, consultant)",
  CLT: "The client / owner",
};

/**
 * The house style for every form: short sections, each saying what it is for
 * on the left and holding its fields on the right; one action bar at the
 * bottom that says what will happen when it is pressed.
 */
export function NewDocumentForm({
  received, routes, numberingSets, deliverableTypes, docTypes, disciplines, projects, subprojects, suppliers, pos, criticalities, confidentialities, retentionClasses, defaultConfidentiality,
}: {
  received: boolean;
  routes: { id: string; name: string; isDefault: boolean; path: string }[];
  numberingSets: Record<string, string[]>;
  deliverableTypes: Opt[]; docTypes: Opt[]; disciplines: Opt[]; projects: Opt[]; subprojects: Opt[]; suppliers: Opt[]; pos: Opt[]; criticalities: Opt[]; confidentialities: Opt[]; retentionClasses: Opt[];
  defaultConfidentiality: string | null;
}) {
  const [producer, setProducer] = useState(received ? "VND" : "");
  const [sendTo, setSendTo] = useState(received ? routes.find((r) => r.isDefault)?.id ?? routes[0]?.id ?? "" : "");
  const [hasFile, setHasFile] = useState(false);
  const [docType, setDocType] = useState("");
  const [discipline, setDiscipline] = useState("");
  const needs = (setKey: string) => (numberingSets[producer] ?? []).includes(setKey);
  const external = producer === "CTR" || producer === "VND" || producer === "TPY" || producer === "CLT";
  const docTypeLabel = docTypes.find((t) => t.code === docType)?.label ?? docType;
  const disciplineLabel = disciplines.find((d) => d.code === discipline)?.label ?? discipline;
  const route = routes.find((r) => r.id === sendTo);

  return (
    <Card className="max-w-4xl">
      <ActionForm action={createDocumentAction} submitLabel="Create" hideSubmit>
        <FormSection
          title={received ? "What arrived" : "What it is"}
          help={received ? "The file as it was sent to you, and who sent it." : "This decides how the document is numbered and who works on it."}
        >
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
          <Field label={received ? "Who sent it?" : "Who produces it?"} required>
            <select name="deliverableType" required className={inputCls} value={producer} onChange={(e) => setProducer(e.target.value)}>
              <option value="" disabled>Choose…</option>
              {deliverableTypes.filter((o) => !received || o.code !== "ENG").map((o) => (
                <option key={o.code} value={o.code}>{PRODUCER_LABEL[o.code] ?? o.label}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          {producer && docType && discipline ? (
            <p className="rounded-xl bg-tint px-3.5 py-2.5 text-xs text-brand-ink">
              A <strong>{docTypeLabel}</strong> owned by <strong>{disciplineLabel}</strong>, produced by <strong>{(PRODUCER_LABEL[producer] ?? "").toLowerCase()}</strong>.
              {external ? " It gets a supplier number." : " It gets an internal number."}
            </p>
          ) : null}
        </FormSection>

        <FormSection title="How it is named" help="The title is what people search for. Say what the document is about; “Drawing” on its own is refused.">
          <Field label="Title" required>
            <input name="title" required maxLength={200} className={inputCls} placeholder="e.g. Feed pump P-101 general arrangement and dimensions" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Project" required>
              <select name="projectCode" required className={inputCls} defaultValue="">
                <option value="" disabled>Choose…</option>
                {projects.map((o) => <option key={o.code} value={o.code}>{o.code} — {o.label}</option>)}
              </select>
            </Field>
            <Field label="Sub-project" required={needs("SUBPROJECTS")} hint={needs("SUBPROJECTS") ? "part of the number for this kind of document" : "optional for this kind of document"}>
              <select name="subProject" required={needs("SUBPROJECTS")} className={inputCls} defaultValue="">
                <option value="" disabled={needs("SUBPROJECTS")}>{needs("SUBPROJECTS") ? "Choose…" : "—"}</option>
                {subprojects.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
            </Field>
          </div>
        </FormSection>

        {external ? (
          <FormSection title="Where it comes from" help="Who sends it, under which order, and when it arrived.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            </div>
          </FormSection>
        ) : null}

        <FormSection title="How it is handled" help="How serious a mistake in it would be, who may open it, and how long it is kept.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <Field label="Keep for" hint="left automatic, it follows the criticality">
              <select name="retentionClass" className={inputCls} defaultValue="">
                <option value="">Automatic</option>
                {retentionClasses.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
            </Field>
          </div>
        </FormSection>

        <FormSection title="What happens next" help={received ? "The file is already attached. Choose whether it goes straight into a review." : "Attach the file now or later, and choose whether it goes straight into a review."}>
          {received ? null : (
            <Field label="File" hint="optional — you can attach it later">
              <input type="file" name="nativeFile" className="block w-full text-sm" onChange={(e) => setHasFile(!!e.target.files?.length)} />
            </Field>
          )}
          <Field label="After it is registered" hint={routes.length ? undefined : "no review route is set up yet — ask an administrator"}>
            <select name="sendTemplateId" className={inputCls} value={sendTo} onChange={(e) => setSendTo(e.target.value)}>
              <option value="">Register it only — I will send it for review later</option>
              {routes.map((r) => <option key={r.id} value={r.id}>Send for review — {r.name}</option>)}
            </select>
            {route ? <span className="mt-1.5 block text-[11px] text-slate-500">It goes to {route.path}</span> : null}
            {sendTo && !hasFile ? <span className="mt-1.5 block text-[11px] font-semibold text-amber-700">Attach the file first, or it cannot be sent.</span> : null}
          </Field>
        </FormSection>

        <FormActions note={sendTo ? "It gets its number, then goes to the first step of the route." : "It gets its number and waits in the register."}>
          <Link href="/documents" className={btn("secondary", "sm")}>Cancel</Link>
          <button type="submit" className={btn("primary", "sm")}>{sendTo ? "Create and send for review" : received ? "Register it" : "Create and get a number"}</button>
        </FormActions>
      </ActionForm>
    </Card>
  );
}
