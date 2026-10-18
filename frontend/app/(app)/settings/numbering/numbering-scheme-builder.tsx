"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Field, Tip } from "@/components/ui";
import { saveNumberingSchemeAction } from "@/lib/settings/forms-numbering";

type NumberField = { label: string; valueSetKey: string; rule: string };
type Kind = "LIST" | "FIXED" | "COUNTER" | "SENDER" | "RECEIVER";

/** What fills a part, in words: one of the lists, a fixed text, the running number, or who sends and receives. */
const KINDS: { value: Kind; label: string }[] = [
  { value: "LIST", label: "From a list" },
  { value: "FIXED", label: "Fixed text" },
  { value: "COUNTER", label: "The running number" },
  { value: "SENDER", label: "Who sends it (transmittals)" },
  { value: "RECEIVER", label: "Who receives it (transmittals)" },
];

function kindOf(field: NumberField): Kind {
  const rule = field.rule.toUpperCase();
  if (rule.startsWith("COUNTER")) return "COUNTER";
  if (rule.startsWith("FIXED")) return "FIXED";
  if (rule === "SENDER" || rule === "RECEIVER") return rule;
  return "LIST";
}
const digitsOf = (rule: string) => Number(rule.match(/DIGITS\((\d+)\)/i)?.[1] ?? 4);
const fixedOf = (rule: string) => rule.match(/^FIXED\(([^)]*)\)$/i)?.[1] ?? "";

/**
 * A numbering scheme, new or changed: its name, delimiter, when it is used, and its parts in order. Each part reads a
 * list, holds a fixed text, is the running number (with its digits), or is who sends or receives it. A scheme that gave
 * numbers (`fixedParts`) keeps its parts and delimiter: only its name and note change.
 */
/** The app's lists, as the schemes below them show them. */
const SAMPLE: Record<string, string> = {
  PROJECT_CODES: "PRJ", SUBPROJECTS: "SUB", DISCIPLINES: "DIS", DOCUMENT_TYPES: "TYP", SUPPLIER_CODES: "SUP", PURCHASE_ORDERS: "PO",
};

/** What a part prints in the example: a stand-in, never a real code. */
function sample(field: NumberField, sets: { key: string; title: string }[]): string {
  const kind = kindOf(field);
  if (kind === "COUNTER") return "0".repeat(Math.max(0, digitsOf(field.rule) - 1)) + "1";
  if (kind === "FIXED") return fixedOf(field.rule) || "…";
  if (kind === "SENDER") return "SNDR";
  if (kind === "RECEIVER") return "RCVR";
  if (SAMPLE[field.valueSetKey]) return SAMPLE[field.valueSetKey];
  const title = sets.find((one) => one.key === field.valueSetKey)?.title ?? "";
  return title ? title.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() : "…";
}

const field = "plain w-full";
const icon = "rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * A numbering scheme, new or changed, as a sheet's own form (the New project sheet's way): a band saying what it is,
 * grey fields, the parts in order as rows with the number they make shown live, then the strip with Cancel and the act
 * (and, for a scheme already there, `aside`: retire or delete). Each part reads a list, holds a fixed text, is the
 * running number (with its digits), or is who sends or receives it. A scheme that gave numbers (`fixedParts`) keeps
 * its parts and delimiter: only its name and note change.
 */
export function NumberingSchemeBuilder({ level, id, initialName = "", initialDelimiter = "-", initialNotes = "", initialFields, sets, fixedParts, cancelHref, aside }: {
  level: "organization" | "project";
  id?: string;
  initialName?: string;
  initialDelimiter?: string;
  initialNotes?: string;
  initialFields?: NumberField[];
  sets: { key: string; title: string }[];
  fixedParts?: boolean;
  /** Where Cancel leads: the page as it was, nothing opened. */
  cancelHref: string;
  /** What else can be done to a scheme already there, in the strip beside Cancel. */
  aside?: React.ReactNode;
}) {
  const [fields, setFields] = useState<NumberField[]>(initialFields?.length ? initialFields : [
    { label: "Project code", valueSetKey: "PROJECT_CODES", rule: "" },
    { label: "Running number", valueSetKey: "", rule: "COUNTER:DIGITS(5)" },
  ]);
  const [delimiter, setDelimiter] = useState(initialDelimiter);
  function update(index: number, change: Partial<NumberField>) { setFields((current) => current.map((one, i) => i === index ? { ...one, ...change } : one)); }
  function move(index: number, offset: -1 | 1) { setFields((current) => { const target = index + offset; if (target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; }); }
  function setKind(index: number, kind: Kind) {
    const rule = kind === "COUNTER" ? "COUNTER:DIGITS(5)" : kind === "FIXED" ? "FIXED()" : kind === "LIST" ? "" : kind;
    update(index, { rule, valueSetKey: kind === "LIST" ? fields[index].valueSetKey : "" });
  }
  const formId = `scheme-form-${id ?? "new"}`;
  const example = fields.map((one) => sample(one, sets)).join(delimiter || "-");

  return (
    <div className="bg-surface">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil mr-1 text-slate-500">{id ? `Change ${initialName}` : "New scheme"}</span>
        <span className="text-[11px] text-slate-500">{fixedParts ? "it has given numbers: its name and note change, its parts stay" : "its parts in order make every number it gives"}</span>
      </div>
      <ActionForm id={formId} action={saveNumberingSchemeAction} hideSubmit resetOnSuccess={!id}
        hidden={{ level, ...(id ? { id } : {}), ...(fixedParts ? { fixedParts: "1" } : {}) }} className="asking space-y-5 px-5 py-5 sm:px-6">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,1fr)_9.5rem_minmax(0,2fr)]">
          <Field label="Name" required><input name="name" required maxLength={100} defaultValue={initialName} className={field} placeholder="Supplier documents" /></Field>
          <Field label="Between parts" required hint={fixedParts ? "stays" : "one sign"}>
            <input name="delimiter" required maxLength={1} value={delimiter} onChange={(event) => setDelimiter(event.target.value)} disabled={fixedParts} className={`${field} text-center font-mono`} />
          </Field>
          <Field label="When it is used" hint="optional"><input name="notes" maxLength={300} defaultValue={initialNotes} className={field} placeholder="In plain words: what it numbers, and why" /></Field>
        </div>

        {fixedParts ? (
          <Tip lead="Its parts can't change: documents carry its numbers." steps={[
            { label: "Make a new scheme with the parts you want", href: `${cancelHref}?new=1#new-scheme` },
            { label: "Under What is numbered, choose the new one for what it should number", href: cancelHref },
            { label: "Retire this one, once it numbers nothing" },
          ]}>
            To number differently, in this order. Numbers already given stay as they are.
          </Tip>
        ) : null}

        <div>
          <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="stencil text-slate-500">Parts, in order</span>
            <span className="text-[11px] text-slate-500">looks like <span className="font-mono text-[12px] font-semibold text-slate-800">{example}</span></span>
          </div>
          <ol className="divide-y divide-line border-y border-line">
            {fields.map((one, index) => {
              const kind = kindOf(one);
              return (
                <li key={index} className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-2 sm:grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <span className="text-center font-mono text-xs font-semibold text-slate-400">{index + 1}</span>
                  <input name={fixedParts ? undefined : "fieldLabel"} value={one.label} onChange={(event) => update(index, { label: event.target.value })} required disabled={fixedParts}
                    className={field} placeholder="Name of this part" aria-label={`Name of part ${index + 1}`} />
                  <select value={kind} onChange={(event) => setKind(index, event.target.value as Kind)} disabled={fixedParts}
                    className={`${field} max-sm:col-span-2 max-sm:col-start-2`} aria-label={`What fills part ${index + 1}`}>
                    {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                  {kind === "LIST" ? (
                    <select value={one.valueSetKey} onChange={(event) => update(index, { valueSetKey: event.target.value })} required disabled={fixedParts}
                      className={`${field} max-sm:col-span-2 max-sm:col-start-2`} aria-label={`List part ${index + 1} reads`}>
                      <option value="">Choose a list</option>
                      {sets.map((set) => <option key={set.key} value={set.key}>{set.title}</option>)}
                    </select>
                  ) : kind === "FIXED" ? (
                    <input value={fixedOf(one.rule)} onChange={(event) => update(index, { rule: `FIXED(${event.target.value.replace(/[()]/g, "")})` })} required maxLength={12} disabled={fixedParts}
                      className={`${field} font-mono uppercase max-sm:col-span-2 max-sm:col-start-2`} placeholder="TAG" aria-label={`Text of part ${index + 1}`} />
                  ) : kind === "COUNTER" ? (
                    <label className="flex items-center gap-2 text-xs text-slate-600 max-sm:col-span-2 max-sm:col-start-2">
                      <input type="number" min={1} max={9} value={digitsOf(one.rule)} onChange={(event) => update(index, { rule: `COUNTER:DIGITS(${Math.min(9, Math.max(1, Number(event.target.value) || 1))})` })}
                        disabled={fixedParts} className="plain w-14 shrink-0 text-center" aria-label={`Digits of part ${index + 1}`} />
                      digits
                    </label>
                  ) : <span className="text-[11.5px] text-slate-500 max-sm:col-span-2 max-sm:col-start-2">the organization&rsquo;s code</span>}
                  <div className="flex items-center justify-end gap-0.5 max-sm:col-start-3 max-sm:row-start-1">
                    {fixedParts ? null : <>
                      <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move part ${index + 1} up`} title="Move up" className={icon}><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /></button>
                      <button type="button" onClick={() => move(index, 1)} disabled={index === fields.length - 1} aria-label={`Move part ${index + 1} down`} title="Move down" className={icon}><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /></button>
                      <button type="button" onClick={() => setFields((current) => current.filter((_, i) => i !== index))} disabled={fields.length === 1} aria-label={`Remove part ${index + 1}`} title="Remove this part" className={`${icon} hover:bg-red-50 hover:text-red-600`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
                    </>}
                  </div>
                  {fixedParts ? null : <>
                    <input type="hidden" name="fieldSetKey" value={kind === "LIST" ? one.valueSetKey : ""} />
                    <input type="hidden" name="fieldRule" value={one.rule} />
                  </>}
                </li>
              );
            })}
          </ol>
          {fixedParts ? null : (
            <button type="button" onClick={() => setFields((current) => [...current, { label: "", valueSetKey: "", rule: "" }])}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-link hover:underline">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add a part
            </button>
          )}
        </div>
      </ActionForm>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={cancelHref} scroll={false} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
          {aside}
        </div>
        <button type="submit" form={formId} data-on="true" className="ask">{id ? "Save" : "Add the scheme"}</button>
      </div>
    </div>
  );
}
