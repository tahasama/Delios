"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Field, inputCls, btn } from "@/components/ui";
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
export function NumberingSchemeBuilder({ level, id, initialName = "", initialDelimiter = "-", initialNotes = "", initialFields, sets, fixedParts }: {
  level: "organization" | "project";
  id?: string;
  initialName?: string;
  initialDelimiter?: string;
  initialNotes?: string;
  initialFields?: NumberField[];
  sets: { key: string; title: string }[];
  fixedParts?: boolean;
}) {
  const [fields, setFields] = useState<NumberField[]>(initialFields?.length ? initialFields : [
    { label: "Project code", valueSetKey: "PROJECT_CODES", rule: "" },
    { label: "Running number", valueSetKey: "", rule: "COUNTER:DIGITS(5)" },
  ]);
  function update(index: number, change: Partial<NumberField>) { setFields((current) => current.map((field, i) => i === index ? { ...field, ...change } : field)); }
  function move(index: number, offset: -1 | 1) { setFields((current) => { const target = index + offset; if (target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; }); }
  function setKind(index: number, kind: Kind) {
    const rule = kind === "COUNTER" ? "COUNTER:DIGITS(5)" : kind === "FIXED" ? "FIXED()" : kind === "LIST" ? "" : kind;
    update(index, { rule, valueSetKey: kind === "LIST" ? fields[index].valueSetKey : "" });
  }

  return <ActionForm action={saveNumberingSchemeAction} submitLabel={id ? "Save" : "Add the scheme"} resetOnSuccess={!id}
    hidden={{ level, ...(id ? { id } : {}), ...(fixedParts ? { fixedParts: "1" } : {}) }} className="asking space-y-4 px-5 py-5 sm:px-6">
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,2fr)]">
      <Field label="Name" required><input name="name" required maxLength={100} defaultValue={initialName} className={inputCls} placeholder="Supplier documents" /></Field>
      <Field label="Delimiter" required hint={fixedParts ? "has given numbers: stays" : "one character"}>
        <input name="delimiter" required maxLength={1} defaultValue={initialDelimiter} disabled={fixedParts} className={`${inputCls} text-center font-mono`} />
      </Field>
      <Field label="When it is used"><input name="notes" maxLength={300} defaultValue={initialNotes} className={inputCls} placeholder="In plain words: what it numbers, and why" /></Field>
    </div>
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-slate-700">Parts, in order{fixedParts ? <span className="ml-2 font-normal text-slate-500">· it has given numbers: its parts stay as they are</span> : null}</p>
        {fixedParts ? null : (
          <button type="button" onClick={() => setFields((current) => [...current, { label: "", valueSetKey: "", rule: "" }])} className={btn("secondary", "sm")} title="Add a part">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Part
          </button>
        )}
      </div>
      <div className="space-y-2">{fields.map((field, index) => {
        const kind = kindOf(field);
        return <div key={index} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md bg-tint-soft p-2 ring-1 ring-line sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-surface text-xs font-bold text-slate-600 ring-1 ring-line">{index + 1}</span>
          <input name={fixedParts ? undefined : "fieldLabel"} value={field.label} onChange={(event) => update(index, { label: event.target.value })} required disabled={fixedParts} className={inputCls} placeholder="Name of this part" aria-label={`Name of part ${index + 1}`} />
          <select value={kind} onChange={(event) => setKind(index, event.target.value as Kind)} disabled={fixedParts} className={`${inputCls} max-sm:col-span-2 max-sm:col-start-2`} aria-label={`What fills part ${index + 1}`}>
            {KINDS.map((one) => <option key={one.value} value={one.value}>{one.label}</option>)}
          </select>
          {kind === "LIST" ? (
            <select value={field.valueSetKey} onChange={(event) => update(index, { valueSetKey: event.target.value })} required disabled={fixedParts} className={`${inputCls} max-sm:col-span-2 max-sm:col-start-2`} aria-label={`List part ${index + 1} reads`}>
              <option value="">Choose a list</option>
              {sets.map((set) => <option key={set.key} value={set.key}>{set.title}</option>)}
            </select>
          ) : kind === "FIXED" ? (
            <input value={fixedOf(field.rule)} onChange={(event) => update(index, { rule: `FIXED(${event.target.value.replace(/[()]/g, "")})` })} required maxLength={12} disabled={fixedParts} className={`${inputCls} font-mono max-sm:col-span-2 max-sm:col-start-2`} placeholder="TAG" aria-label={`Text of part ${index + 1}`} />
          ) : kind === "COUNTER" ? (
            <label className="flex items-center gap-2 text-xs text-slate-600 max-sm:col-span-2 max-sm:col-start-2">
              <input type="number" min={1} max={9} value={digitsOf(field.rule)} onChange={(event) => update(index, { rule: `COUNTER:DIGITS(${Math.min(9, Math.max(1, Number(event.target.value) || 1))})` })} disabled={fixedParts} className={`${inputCls} w-16 text-center`} aria-label={`Digits of part ${index + 1}`} />
              digits
            </label>
          ) : <span className="text-[11.5px] text-slate-500 max-sm:col-span-2 max-sm:col-start-2">the organization&rsquo;s code</span>}
          <div className="flex items-center justify-end gap-0.5 max-sm:col-start-3 max-sm:row-start-1">
            {fixedParts ? null : <>
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move part ${index + 1} up`} title="Move up" className="rounded p-1.5 text-slate-500 hover:bg-surface disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /></button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === fields.length - 1} aria-label={`Move part ${index + 1} down`} title="Move down" className="rounded p-1.5 text-slate-500 hover:bg-surface disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /></button>
              <button type="button" onClick={() => setFields((current) => current.filter((_, i) => i !== index))} disabled={fields.length === 1} aria-label={`Remove part ${index + 1}`} title="Remove this part" className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </>}
          </div>
          {fixedParts ? null : <>
            <input type="hidden" name="fieldSetKey" value={kind === "LIST" ? field.valueSetKey : ""} />
            <input type="hidden" name="fieldRule" value={field.rule} />
          </>}
        </div>;
      })}</div>
    </div>
  </ActionForm>;
}
