"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2, UserRoundCheck } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Field, Chip, inputCls } from "@/components/ui";
import { saveTemplateAction } from "@/lib/actions/workflow";

export type WorkflowBuilderStep = {
  act: "REVIEW" | "APPROVAL";
  mode: "ANY_OF" | "ALL_CONSOLIDATOR" | "SERIAL" | "ALL";
  participantIds: string[];
  functionIds?: string[];
  title?: string;
};

type Person = { id: string; name: string; role: string; party: { name: string; isInternal: boolean } | null };
type ClassOption = { code: string; label: string };
type ClassOptions = { documentTypes: ClassOption[]; disciplines: ClassOption[]; criticalities: ClassOption[] };

export function WorkflowTemplateBuilder({ id, name = "", description = "", classes = "*", outcomeSetKey = "REVIEW_OUTCOMES", isDefault = false, initialSteps, users, functions = [], outcomeSets, classOptions }: {
  id?: string;
  name?: string;
  description?: string;
  classes?: string;
  outcomeSetKey?: string;
  isDefault?: boolean;
  initialSteps?: WorkflowBuilderStep[];
  users: Person[];
  functions?: { id: string; name: string }[];
  outcomeSets: string[];
  classOptions: ClassOptions;
}) {
  const [steps, setSteps] = useState<WorkflowBuilderStep[]>(initialSteps?.length ? initialSteps : [{ act: "REVIEW", mode: "ANY_OF", participantIds: [], title: "Technical review" }]);
  const initialScope = parseScope(classes);
  const [allClasses, setAllClasses] = useState(classes === "*");
  const [scope, setScope] = useState(initialScope);
  const parties = useMemo(() => {
    const groups = new Map<string, Person[]>();
    for (const user of users) {
      const label = user.party ? `${user.party.isInternal ? "Our organization" : user.party.name}` : "Unassigned organization";
      groups.set(label, [...(groups.get(label) ?? []), user]);
    }
    return [...groups.entries()];
  }, [users]);

  function update(index: number, change: Partial<WorkflowBuilderStep>) {
    setSteps((current) => current.map((step, i) => i === index ? { ...step, ...change } : step));
  }
  function togglePerson(index: number, personId: string) {
    const selected = new Set(steps[index].participantIds);
    if (selected.has(personId)) selected.delete(personId); else selected.add(personId);
    update(index, { participantIds: [...selected] });
  }
  function toggleFunction(index: number, functionId: string) {
    const selected = new Set(steps[index].functionIds ?? []);
    if (selected.has(functionId)) selected.delete(functionId); else selected.add(functionId);
    update(index, { functionIds: [...selected] });
  }
  function move(index: number, offset: -1 | 1) {
    setSteps((current) => {
      const next = [...current];
      const target = index + offset;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <ActionForm action={saveTemplateAction} submitLabel={id ? "Save workflow schema" : "Publish workflow schema"} hidden={id ? { id } : {}}>
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />
      <input type="hidden" name="classes" value={allClasses ? "*" : JSON.stringify([scope])} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Schema name" required><input name="name" required defaultValue={name} className={inputCls} placeholder="e.g. Engineering review then approval" /></Field>
        <Field label="What this schema is for" className="sm:col-span-2"><input name="description" defaultValue={description} className={inputCls} placeholder="Explain when authors should choose this route" /></Field>
        <Field label="Review outcome set" hint="The codes reviewers will choose"><select name="outcomeSetKey" defaultValue={outcomeSetKey} className={inputCls}>{(outcomeSets.length ? outcomeSets : ["REVIEW_OUTCOMES"]).map((key) => <option key={key} value={key}>{key.replaceAll("_", " ").toLowerCase()}</option>)}</select></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-slate-700"><input type="checkbox" name="isDefault" defaultChecked={isDefault} /> Default schema for this document class</label>
      </div>

      <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-slate-800">Which documents use this schema?</p><p className="mt-0.5 text-xs text-slate-500">Choose all documents or narrow it using your published organization sets.</p></div><label className="flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={allClasses} onChange={(event) => setAllClasses(event.target.checked)} /> All documents</label></div>
        {!allClasses ? <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Document type"><select className={inputCls} value={scope.docType ?? ""} onChange={(event) => setScope((value) => ({ ...value, docType: event.target.value || undefined }))}><option value="">Any type</option>{classOptions.documentTypes.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.label}</option>)}</select></Field>
          <Field label="Discipline"><select className={inputCls} value={scope.discipline ?? ""} onChange={(event) => setScope((value) => ({ ...value, discipline: event.target.value || undefined }))}><option value="">Any discipline</option>{classOptions.disciplines.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.label}</option>)}</select></Field>
          <Field label="Criticality"><select className={inputCls} value={scope.criticality ?? ""} onChange={(event) => setScope((value) => ({ ...value, criticality: event.target.value || undefined }))}><option value="">Any criticality</option>{classOptions.criticalities.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.label}</option>)}</select></Field>
        </div> : <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs text-slate-600">This schema appears for every document class. Mark it as default when it is the organization-wide fallback.</p>}
      </section>

      <div className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div><p className="text-sm font-semibold text-slate-800">Route steps</p><p className="mt-0.5 text-xs text-slate-500">People see these steps in order. No codes or JSON are required.</p></div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSteps((value) => [...value, { act: "REVIEW", mode: "ANY_OF", participantIds: [], title: "Review" }])} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /> Review</button>
            <button type="button" onClick={() => setSteps((value) => [...value, { act: "APPROVAL", mode: "ANY_OF", participantIds: [], title: "Approval" }])} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /> Approval</button>
          </div>
        </div>

        {steps.map((step, index) => (
          <section key={`${index}-${step.act}`} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#17324d] text-xs font-bold text-white">{index + 1}</span>
              <input value={step.title ?? ""} onChange={(event) => update(index, { title: event.target.value })} className={`${inputCls} max-w-sm bg-white font-semibold`} aria-label={`Step ${index + 1} title`} placeholder="Name this step" />
              <Chip className={step.act === "APPROVAL" ? "bg-emerald-100 text-emerald-800 ring-emerald-200" : "bg-sky-100 text-sky-800 ring-sky-200"}>{step.act === "APPROVAL" ? "Approval act" : "Review"}</Chip>
              <div className="ml-auto flex gap-1">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-20" title="Move earlier"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === steps.length - 1} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-20" title="Move later"><ArrowDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => setSteps((value) => value.filter((_, i) => i !== index))} disabled={steps.length === 1} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-20" title="Remove step"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[280px_1fr]">
              <Field label="How participants decide" hint={step.act === "APPROVAL" ? "Usually first authorized approver" : undefined}>
                <select value={step.mode} onChange={(event) => update(index, { mode: event.target.value as WorkflowBuilderStep["mode"] })} className={inputCls}>
                  <option value="ALL">All give input, any order — then the next step</option>
                  <option value="ANY_OF">Any one — first decision closes</option>
                  <option value="SERIAL">Serial — decide in listed order</option>
                  <option value="ALL_CONSOLIDATOR">All review, final person consolidates</option>
                </select>
              </Field>
              <div>
                <p className="text-xs font-medium text-slate-700">Functions <span className="font-normal text-slate-400">— whoever holds these on the project, and is allowed by the distribution matrix, is proposed when sending</span></p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {functions.map((f) => {
                    const on = (step.functionIds ?? []).includes(f.id);
                    return <button key={f.id} type="button" onClick={() => toggleFunction(index, f.id)} className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-[#315f83] bg-[#e9f1f7] font-semibold text-[#17324d]" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>{on ? "✓ " : ""}{f.name}</button>;
                  })}
                </div>
                <div className="mt-3 flex items-center justify-between"><p className="text-xs font-medium text-slate-700">…and/or specific people</p><span className="text-[11px] text-slate-400">{step.participantIds.length} selected</span></div>
                <div className="mt-1.5 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                  {parties.map(([party, people]) => <div key={party} className="mb-2 last:mb-0"><p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{party}</p><div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{people.map((person) => { const selected = step.participantIds.includes(person.id); return <button key={person.id} type="button" onClick={() => togglePerson(index, person.id)} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition ${selected ? "border-[#315f83] bg-[#e9f1f7] text-[#17324d]" : "border-transparent text-slate-600 hover:bg-slate-50"}`}><span className={`grid h-5 w-5 place-items-center rounded-md ${selected ? "bg-[#315f83] text-white" : "border border-slate-300"}`}>{selected ? <Check className="h-3 w-3" /> : null}</span><span className="min-w-0"><span className="block truncate font-semibold">{person.name}</span><span className="block text-[10px] text-slate-400">{person.role.toLowerCase()}</span></span></button>; })}</div></div>)}
                </div>
                {step.mode === "ALL_CONSOLIDATOR" && step.participantIds.length ? <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-700"><UserRoundCheck className="h-3.5 w-3.5" /> The last selected participant records the consolidated outcome.</p> : null}
              </div>
            </div>
          </section>
        ))}
      </div>
    </ActionForm>
  );
}

function parseScope(classes: string): { docType?: string; discipline?: string; criticality?: string } {
  if (classes === "*") return {};
  try {
    const value = JSON.parse(classes);
    return Array.isArray(value) && value[0] && typeof value[0] === "object" ? value[0] : {};
  } catch {
    return {};
  }
}
