"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Field, inputCls, btn } from "@/components/ui";
import { saveNumberingSchemeAction } from "@/lib/settings/forms-admin";

type NumberField = { label: string; valueSetKey: string; rule: string };

export function NumberingSchemeBuilder({ id, initialName = "", initialDelimiter = "-", initialNotes = "", initialFields, sets }: {
  id?: string;
  initialName?: string;
  initialDelimiter?: string;
  initialNotes?: string;
  initialFields?: NumberField[];
  sets: { key: string; title: string }[];
}) {
  const [fields, setFields] = useState<NumberField[]>(initialFields?.length ? initialFields : [
    { label: "Project code", valueSetKey: "PROJECT_CODES", rule: "" },
    { label: "Sequence", valueSetKey: "", rule: "COUNTER:DIGITS(5)" },
  ]);
  function update(index: number, change: Partial<NumberField>) { setFields((current) => current.map((field, i) => i === index ? { ...field, ...change } : field)); }
  function move(index: number, offset: -1 | 1) { setFields((current) => { const target = index + offset; if (target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; }); }

  return <ActionForm action={saveNumberingSchemeAction} submitLabel={id ? "Publish scheme changes" : "Create numbering scheme"} hidden={id ? { id } : {}}>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px]">
      <Field label="Scheme name" required><input name="name" required defaultValue={initialName} className={inputCls} placeholder="e.g. Supplier documents" /></Field>
      <Field label="Delimiter" required hint="one character"><input name="delimiter" required maxLength={1} defaultValue={initialDelimiter} className={`${inputCls} text-center font-mono`} /></Field>
      <Field label="When this scheme is used" className="sm:col-span-2"><input name="notes" defaultValue={initialNotes} className={inputCls} placeholder="Explain the number pattern in plain language" /></Field>
    </div>
    <div>
      <div className="mb-2 flex items-center justify-between"><div><p className="text-xs font-semibold text-slate-700">Fields, in number order</p><p className="text-[11px] text-slate-500">Each part comes from one of your lists, or is the running number.</p></div><button type="button" onClick={() => setFields((current) => [...current, { label: "", valueSetKey: "", rule: "" }])} className={btn("secondary", "sm")}><Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add a part</button></div>
      <div className="space-y-2">{fields.map((field, index) => <div key={index} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-line bg-tint-soft p-2 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-surface text-xs font-bold text-slate-600 ring-1 ring-line">{index + 1}</span>
        <input name="fieldLabel" value={field.label} onChange={(event) => update(index, { label: event.target.value })} required className={inputCls} placeholder="Name of this part" aria-label={`Name of part ${index + 1}`} />
        <select name="fieldSetKey" value={field.valueSetKey} onChange={(event) => update(index, { valueSetKey: event.target.value, rule: event.target.value ? "" : field.rule })} className={`${inputCls} max-sm:col-span-2 max-sm:col-start-2 max-sm:row-start-2`} aria-label={`List part ${index + 1} comes from`} disabled={field.rule.startsWith("COUNTER:")}><option value="">Not from a list</option>{sets.map((set) => <option key={set.key} value={set.key}>{set.title}</option>)}</select>
        <div className="flex items-center justify-end gap-0.5 max-sm:col-start-3 max-sm:row-start-1">
          <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move part ${index + 1} up`} title="Move up" className="rounded p-1.5 text-slate-500 hover:bg-surface disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /></button>
          <button type="button" onClick={() => move(index, 1)} disabled={index === fields.length - 1} aria-label={`Move part ${index + 1} down`} title="Move down" className="rounded p-1.5 text-slate-500 hover:bg-surface disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /></button>
          <button type="button" onClick={() => setFields((current) => current.filter((_, i) => i !== index))} disabled={fields.length === 1} aria-label={`Remove part ${index + 1}`} title="Remove this part" className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
        </div>
        <input type="hidden" name="fieldRule" value={field.rule} />
        <label className="col-span-2 col-start-2 flex items-center gap-2 px-1 text-[11px] text-slate-600 sm:col-span-1 sm:col-start-3"><input type="checkbox" checked={field.rule.startsWith("COUNTER:")} onChange={(event) => update(index, { rule: event.target.checked ? "COUNTER:DIGITS(5)" : "", valueSetKey: event.target.checked ? "" : field.valueSetKey })} /> This is the running number</label>
      </div>)}</div>
    </div>
  </ActionForm>;
}
