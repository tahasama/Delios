"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { saveNumberingSchemeAction } from "@/lib/actions/admin";

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
      <Field label="Delimiter" required hint="one character"><input name="delimiter" required maxLength={1} defaultValue={initialDelimiter} className={`${inputCls} text-center font-mono text-lg`} /></Field>
      <Field label="When this scheme is used" className="sm:col-span-2"><input name="notes" defaultValue={initialNotes} className={inputCls} placeholder="Explain the number pattern in plain language" /></Field>
    </div>
    <div>
      <div className="mb-2 flex items-center justify-between"><div><p className="text-xs font-semibold text-slate-700">Fields, in number order</p><p className="text-[11px] text-slate-400">Each segment comes from a published set or from the unique sequence counter.</p></div><button type="button" onClick={() => setFields((current) => [...current, { label: "", valueSetKey: "", rule: "" }])} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /> Add field</button></div>
      <div className="space-y-2">{fields.map((field, index) => <div key={index} className="grid grid-cols-[34px_minmax(180px,1fr)_minmax(210px,1fr)_88px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-xs font-bold text-slate-500 shadow-sm">{index + 1}</span>
        <input name="fieldLabel" value={field.label} onChange={(event) => update(index, { label: event.target.value })} required className={inputCls} placeholder="Field label" />
        <select name="fieldSetKey" value={field.valueSetKey} onChange={(event) => update(index, { valueSetKey: event.target.value, rule: event.target.value ? "" : field.rule })} className={inputCls} disabled={field.rule.startsWith("COUNTER:")}><option value="">No value set</option>{sets.map((set) => <option key={set.key} value={set.key}>{set.title}</option>)}</select>
        <div className="flex items-center justify-end gap-0.5"><button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="rounded p-1.5 text-slate-400 hover:bg-white disabled:opacity-20"><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" onClick={() => move(index, 1)} disabled={index === fields.length - 1} className="rounded p-1.5 text-slate-400 hover:bg-white disabled:opacity-20"><ArrowDown className="h-3.5 w-3.5" /></button><button type="button" onClick={() => setFields((current) => current.filter((_, i) => i !== index))} disabled={fields.length === 1} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-20"><Trash2 className="h-3.5 w-3.5" /></button></div>
        <input type="hidden" name="fieldRule" value={field.rule} />
        <label className="col-start-3 flex items-center gap-2 px-1 text-[11px] text-slate-500"><input type="checkbox" checked={field.rule.startsWith("COUNTER:")} onChange={(event) => update(index, { rule: event.target.checked ? "COUNTER:DIGITS(5)" : "", valueSetKey: event.target.checked ? "" : field.valueSetKey })} /> This is the sequence counter</label>
      </div>)}</div>
    </div>
  </ActionForm>;
}
