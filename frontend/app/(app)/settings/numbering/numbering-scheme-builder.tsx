"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Field, inputCls, btn, Tip } from "@/components/ui";
import { saveNumberingSchemeAction } from "@/lib/settings/forms-numbering";
import { cn } from "@/lib/core/utils";

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
/** The act that sends the scheme, showing while it is sent. */
function Send({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={btn("primary", "sm")}>{pending ? "Working…" : label}</button>;
}

export function NumberingSchemeBuilder({ level, id, initialName = "", initialDelimiter = "-", initialNotes = "", initialFields, sets, fixedParts, cancelHref, targets = [], retired }: {
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
  /** Everything that can be numbered, with the scheme numbering it now (by name), to tick what this one numbers. */
  targets?: { code: string; label: string; now: string | null }[];
  /** A retired scheme numbers nothing: nothing is offered to it. */
  retired?: boolean;
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

  return <ActionForm action={saveNumberingSchemeAction} hideSubmit resetOnSuccess={!id}
    hidden={{ level, ...(id ? { id } : {}), ...(fixedParts ? { fixedParts: "1" } : {}) }} className="asking space-y-4 px-5 py-5 sm:px-6">
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,2fr)]">
      <Field label="Name" required><input name="name" required maxLength={100} defaultValue={initialName} className={inputCls} placeholder="Supplier documents" /></Field>
      <Field label="Delimiter" required hint={fixedParts ? "stays" : "one sign"}>
        <input name="delimiter" required maxLength={1} defaultValue={initialDelimiter} disabled={fixedParts} className={`${inputCls} text-center font-mono`} />
      </Field>
      <Field label="When it is used"><input name="notes" maxLength={300} defaultValue={initialNotes} className={inputCls} placeholder="In plain words: what it numbers, and why" /></Field>
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
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-slate-700">Parts, in order{fixedParts ? <span className="ml-2 font-normal text-slate-500">· fixed: it has given numbers</span> : null}</p>
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
              <input type="number" min={1} max={9} value={digitsOf(field.rule)} onChange={(event) => update(index, { rule: `COUNTER:DIGITS(${Math.min(9, Math.max(1, Number(event.target.value) || 1))})` })} disabled={fixedParts} className={cn(inputCls, "w-16 shrink-0 text-center")} aria-label={`Digits of part ${index + 1}`} />
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
    {targets.length && !retired ? (
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-slate-700">
          What it numbers<span className="ml-2 font-normal text-slate-500">· tick to number it by this scheme from now on; numbers already given stay as they are</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {targets.map((one) => {
            const mine = !!id && one.now === initialName;
            return (
              <label key={one.code} title={mine ? "To number it differently, choose another scheme for it under What is numbered." : undefined}
                className="flex cursor-pointer items-center gap-2 rounded-md bg-tint-soft px-2.5 py-1.5 text-xs text-slate-700 ring-1 ring-line has-checked:bg-emerald-50 has-checked:ring-emerald-300 has-disabled:cursor-default">
                <input type="checkbox" name={mine ? undefined : "numbers"} value={one.code} defaultChecked={mine} disabled={mine} className="accent-emerald-700" />
                <span className="font-semibold">{one.label}</span>
                <span className="text-[11px] text-slate-500">{mine ? "numbered by it" : one.now ? `now ${one.now}` : "no scheme yet"}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    ) : null}
    <div className="flex items-center justify-end gap-3 border-t border-line pt-3">
      <Link href={cancelHref} className="text-xs font-semibold text-slate-500 hover:text-slate-800 hover:underline">Cancel</Link>
      <Send label={id ? "Save" : "Add the scheme"} />
    </div>
  </ActionForm>;
}
