"use client";

import { useActionState, useMemo, useState } from "react";
import { registerDocumentAction } from "@/lib/actions/document-acts";
import type { ListValue } from "@/lib/api/types";
import { btn, Field, FormSection, inputCls } from "@/components/ui";

type Lists = Record<string, ListValue[]>;

/** The register form. Which optional fields a deliverable type requires comes from that type's "required" setting. */
export function RegisterForm({ lists, parties, received }: { lists: Lists; parties: { code: string; name: string }[]; received: boolean }) {
  const [state, act, pending] = useActionState(registerDocumentAction, undefined);
  const active = (set: string) => (lists[set] ?? []).filter((v) => v.status === "ACTIVE");
  const deliverables = active("DELIVERABLE_TYPES");
  const [deliverable, setDeliverable] = useState(deliverables[0]?.code ?? "");
  const required = useMemo(() => {
    const props = deliverables.find((d) => d.code === deliverable)?.props;
    return new Set(Array.isArray(props?.required) ? (props!.required as string[]) : []);
  }, [deliverable, deliverables]);
  const [formKey] = useState(() => crypto.randomUUID());
  const defaultOf = (set: string) => active(set).find((v) => v.props?.default === true)?.code ?? "";
  const mark = (field: string) => (required.has(field) ? " *" : "");
  const err = (field: string) => (state?.field === field ? "ring-2 ring-red-300" : "");

  const select = (name: string, set: string, opts: { required?: boolean; blank?: string; value?: string } = {}) => (
    <select name={name} required={opts.required} defaultValue={opts.value ?? defaultOf(set)} className={`${inputCls} ${err(name)}`}>
      {opts.blank !== undefined ? <option value="">{opts.blank}</option> : null}
      {active(set).map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
    </select>
  );

  return (
    <form action={act} className="max-w-3xl space-y-4">
      <input type="hidden" name="formKey" value={formKey} />
      <FormSection title="What it is" help="These decide its number.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Deliverable type">
            <select name="deliverableType" value={deliverable} onChange={(e) => setDeliverable(e.target.value)} className={`${inputCls} ${err("deliverableType")}`}>
              {deliverables.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Document type">{select("docType", "DOCUMENT_TYPES", { required: true })}</Field>
          <Field label="Discipline">{select("discipline", "DISCIPLINES", { required: true })}</Field>
          <Field label={`Subproject${mark("subproject")}`}>{select("subproject", "SUBPROJECTS", { blank: "—", value: "" })}</Field>
        </div>
        <Field label="Title" hint="Say what it shows, and of what.">
          <input name="title" required className={`${inputCls} ${err("title")}`} />
        </Field>
      </FormSection>
      <FormSection title="Where it comes from">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Originator${mark("originator")}`}>
            <select name="originator" defaultValue="" className={`${inputCls} ${err("originator")}`}>
              <option value="">Us</option>
              {parties.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </select>
          </Field>
          <Field label={`Contract reference${mark("contractRef")}`}><input name="contractRef" className={`${inputCls} ${err("contractRef")}`} /></Field>
          <Field label={`Received${mark("receivedDate")}`}><input type="date" name="receivedDate" defaultValue={received ? new Date().toISOString().slice(0, 10) : ""} className={`${inputCls} ${err("receivedDate")}`} /></Field>
          <Field label={`Planned submission${mark("plannedDate")}`}><input type="date" name="plannedDate" className={`${inputCls} ${err("plannedDate")}`} /></Field>
        </div>
      </FormSection>
      <FormSection title="How it is handled">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={`Criticality${mark("criticality")}`}>{select("criticality", "CRITICALITY", { blank: "—", value: "" })}</Field>
          <Field label="Confidentiality">{select("confidentiality", "CONFIDENTIALITY")}</Field>
          <Field label="Kept for" hint="Empty: decided by criticality, or the default.">{select("retentionClass", "RETENTION_CLASSES", { blank: "—", value: "" })}</Field>
        </div>
      </FormSection>
      {state?.error ? <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
      <button type="submit" disabled={pending} className={btn("primary")}>{pending ? "Registering…" : "Register and allocate the number"}</button>
    </form>
  );
}
