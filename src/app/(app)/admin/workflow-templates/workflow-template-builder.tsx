"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, Plus, Trash2, Users2, X } from "lucide-react";
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

/** How the people on one step work, in the words a project uses. */
const HOW: { value: WorkflowBuilderStep["mode"]; label: string; hint: string }[] = [
  { value: "ALL", label: "All of them, in any order", hint: "each gives a verdict; the step closes when everyone has" },
  { value: "ANY_OF", label: "Whoever gets to it first", hint: "the first verdict closes the step" },
  { value: "SERIAL", label: "One after another", hint: "each sees the one before; the last one's verdict counts" },
  { value: "ALL_CONSOLIDATOR", label: "All of them, last one sums up", hint: "everyone gives input; the last person records the verdict" },
];

/**
 * A route drawn as it runs: boxes left to right, joined by arrows, the last
 * one deciding. Two names in a box means they work in parallel. Add a box
 * between any two, or at the end, and give it whoever should be on it.
 */
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
  const [draft, setDraft] = useState<WorkflowBuilderStep[]>(
    initialSteps?.length ? initialSteps : [
      { act: "REVIEW", mode: "ALL", participantIds: [], title: "Review" },
      { act: "APPROVAL", mode: "ANY_OF", participantIds: [], title: "Decision" },
    ],
  );
  const [open, setOpen] = useState<number | null>(0);
  const initialScope = parseScope(classes);
  const [allClasses, setAllClasses] = useState(classes === "*");
  const [scope, setScope] = useState(initialScope);

  // The last box always decides; everything before it advises.
  const steps = useMemo(
    () => draft.map((s, i) => ({ ...s, act: (i === draft.length - 1 ? "APPROVAL" : "REVIEW") as WorkflowBuilderStep["act"] })),
    [draft],
  );
  const parties = useMemo(() => {
    const groups = new Map<string, Person[]>();
    for (const user of users) {
      const label = user.party ? `${user.party.isInternal ? "Our organization" : user.party.name}` : "Unassigned organization";
      groups.set(label, [...(groups.get(label) ?? []), user]);
    }
    return [...groups.entries()];
  }, [users]);
  const nameOf = (personId: string) => users.find((u) => u.id === personId)?.name ?? personId;
  const fnName = (functionId: string) => functions.find((f) => f.id === functionId)?.name ?? functionId;

  function update(index: number, change: Partial<WorkflowBuilderStep>) {
    setDraft((current) => current.map((step, i) => (i === index ? { ...step, ...change } : step)));
  }
  function insert(at: number) {
    setDraft((current) => [...current.slice(0, at), { act: "REVIEW", mode: "ALL", participantIds: [], title: "Review" }, ...current.slice(at)]);
    setOpen(at);
  }
  function remove(index: number) {
    setDraft((current) => (current.length === 1 ? current : current.filter((_, i) => i !== index)));
    setOpen(null);
  }
  function togglePerson(index: number, personId: string) {
    const selected = new Set(steps[index].participantIds);
    selected.has(personId) ? selected.delete(personId) : selected.add(personId);
    update(index, { participantIds: [...selected] });
  }
  function toggleFunction(index: number, functionId: string) {
    const selected = new Set(steps[index].functionIds ?? []);
    selected.has(functionId) ? selected.delete(functionId) : selected.add(functionId);
    update(index, { functionIds: [...selected] });
  }

  return (
    <ActionForm action={saveTemplateAction} submitLabel={id ? "Save route" : "Publish route"} hidden={id ? { id } : {}}>
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />
      <input type="hidden" name="classes" value={allClasses ? "*" : JSON.stringify([scope])} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Route name" required><input name="name" required defaultValue={name} className={inputCls} placeholder="e.g. Engineering review, then the lead decides" /></Field>
        <Field label="When to use it"><input name="description" defaultValue={description} className={inputCls} placeholder="Tell the sender when this route is the right one" /></Field>
        <Field label="Verdict set" hint="the codes everyone on this route answers with">
          <select name="outcomeSetKey" defaultValue={outcomeSetKey} className={inputCls}>
            {(outcomeSets.length ? outcomeSets : ["REVIEW_OUTCOMES"]).map((key) => <option key={key} value={key}>{key.replaceAll("_", " ").toLowerCase()}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-slate-700"><input type="checkbox" name="isDefault" defaultChecked={isDefault} /> Offer this route first</label>
      </div>

      {/* ── The route, drawn ─────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="mb-3">
          <p className="text-sm font-semibold text-slate-800">The route</p>
          <p className="mt-0.5 text-xs text-slate-500">
            It runs left to right. Every box before the last one gives advice; the last box gives the binding verdict, which is also the release approval.
            Two or more names in one box work in parallel.
          </p>
        </div>

        <div className="scroll-thin flex items-stretch gap-1 overflow-x-auto pb-2">
          <AddHere onClick={() => insert(0)} />
          {steps.map((step, index) => {
            const decides = index === steps.length - 1;
            const people = step.participantIds.map(nameOf);
            const fns = (step.functionIds ?? []).map(fnName);
            const empty = !people.length && !fns.length;
            return (
              <div key={index} className="flex items-stretch gap-1">
                <button
                  type="button"
                  onClick={() => setOpen(open === index ? null : index)}
                  className={`w-56 shrink-0 rounded-xl border p-3 text-left transition ${open === index ? "border-brand-line bg-surface shadow-sm" : decides ? "border-emerald-300 bg-emerald-50/60 hover:bg-emerald-50" : "border-slate-200 bg-surface hover:border-slate-300"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Step {index + 1}</span>
                    <Chip className={decides ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : "bg-sky-100 text-sky-800 ring-sky-300"}>{decides ? "decides" : "advises"}</Chip>
                  </span>
                  <span className="mt-1 block text-sm font-semibold text-slate-900">{step.title || (decides ? "Decision" : `Review ${index + 1}`)}</span>
                  <span className="mt-1.5 block text-[11px] leading-4 text-slate-600">
                    {empty ? <span className="text-amber-700">Nobody yet — the discipline decides who</span> : [...people, ...fns.map((f) => `${f} (function)`)].join(", ")}
                  </span>
                  {people.length + fns.length > 1 ? (
                    <span className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400"><Users2 className="h-3 w-3" /> {HOW.find((h) => h.value === step.mode)?.label}</span>
                  ) : null}
                </button>
                {index < steps.length - 1 ? <ArrowRight className="h-4 w-4 shrink-0 self-center text-slate-300" aria-hidden /> : null}
                <AddHere onClick={() => insert(index + 1)} />
              </div>
            );
          })}
        </div>

        {/* ── The open box ───────────────────────────────────────────────── */}
        {open !== null && steps[open] ? (
          <div className="mt-3 rounded-xl border border-brand-line/40 bg-surface p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={steps[open].title ?? ""}
                onChange={(e) => update(open, { title: e.target.value })}
                className={`${inputCls} max-w-xs font-semibold`}
                aria-label={`Name of step ${open + 1}`}
                placeholder={open === steps.length - 1 ? "Decision" : "Review"}
              />
              <span className="text-xs text-slate-500">{open === steps.length - 1 ? "This box decides. Only people who may approve the document can be on it." : "This box advises the one that decides."}</span>
              <button type="button" onClick={() => remove(open)} disabled={steps.length === 1} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
                <Trash2 className="h-3.5 w-3.5" /> Remove this box
              </button>
              <button type="button" onClick={() => setOpen(null)} className="rounded-lg p-1 text-slate-400 hover:text-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_280px]">
              <div>
                <p className="text-xs font-medium text-slate-700">People</p>
                <p className="mb-1.5 text-[11px] text-slate-400">Two or more work in parallel. Leave the box empty to assign by the document&apos;s discipline when it is sent.</p>
                <div className="scroll-thin max-h-56 overflow-y-auto rounded-xl border border-slate-200 p-2">
                  {parties.map(([party, list]) => (
                    <div key={party} className="mb-2 last:mb-0">
                      <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{party}</p>
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {list.map((person) => {
                          const selected = steps[open].participantIds.includes(person.id);
                          return (
                            <button key={person.id} type="button" onClick={() => togglePerson(open, person.id)}
                              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition ${selected ? "border-brand-line bg-tint text-brand-ink" : "border-transparent text-slate-600 hover:bg-slate-50"}`}>
                              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md ${selected ? "bg-brand text-white" : "border border-slate-300"}`}>{selected ? <Check className="h-3 w-3" /> : null}</span>
                              <span className="min-w-0"><span className="block truncate font-semibold">{person.name}</span><span className="block text-[10px] text-slate-400">{person.role.toLowerCase()}</span></span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-slate-700">Or whoever holds a function</p>
                  <p className="mb-1.5 text-[11px] text-slate-400">The matrix decides who that is for each document.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {functions.map((f) => {
                      const on = (steps[open].functionIds ?? []).includes(f.id);
                      return (
                        <button key={f.id} type="button" onClick={() => toggleFunction(open, f.id)}
                          className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-brand-line bg-tint font-semibold text-brand-ink" : "border-slate-300 bg-surface text-slate-600 hover:bg-slate-50"}`}>
                          {on ? "✓ " : ""}{f.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {steps[open].participantIds.length + (steps[open].functionIds?.length ?? 0) > 1 ? (
                  <Field label="How they work" hint={HOW.find((h) => h.value === steps[open]!.mode)?.hint}>
                    <select value={steps[open].mode} onChange={(e) => update(open, { mode: e.target.value as WorkflowBuilderStep["mode"] })} className={inputCls}>
                      {HOW.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                    </select>
                  </Field>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── Which documents use it ───────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-800">Which documents use this route?</p>
            <p className="mt-0.5 text-xs text-slate-500">All of them, or narrow it by type, discipline or criticality.</p>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={allClasses} onChange={(e) => setAllClasses(e.target.checked)} /> All documents</label>
        </div>
        {!allClasses ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Document type"><select className={inputCls} value={scope.docType ?? ""} onChange={(e) => setScope((v) => ({ ...v, docType: e.target.value || undefined }))}><option value="">Any type</option>{classOptions.documentTypes.map((i) => <option key={i.code} value={i.code}>{i.code} — {i.label}</option>)}</select></Field>
            <Field label="Discipline"><select className={inputCls} value={scope.discipline ?? ""} onChange={(e) => setScope((v) => ({ ...v, discipline: e.target.value || undefined }))}><option value="">Any discipline</option>{classOptions.disciplines.map((i) => <option key={i.code} value={i.code}>{i.code} — {i.label}</option>)}</select></Field>
            <Field label="Criticality"><select className={inputCls} value={scope.criticality ?? ""} onChange={(e) => setScope((v) => ({ ...v, criticality: e.target.value || undefined }))}><option value="">Any criticality</option>{classOptions.criticalities.map((i) => <option key={i.code} value={i.code}>{i.code} — {i.label}</option>)}</select></Field>
          </div>
        ) : null}
      </section>
    </ActionForm>
  );
}

/** The thin "+" that drops a new box in at this point of the chain. */
function AddHere({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Add a step here" aria-label="Add a step here"
      className="group grid w-6 shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-slate-100 hover:text-link">
      <Plus className="h-4 w-4" />
    </button>
  );
}

function parseScope(classes: string): { docType?: string; discipline?: string; criticality?: string } {
  if (!classes || classes === "*") return {};
  try {
    const parsed = JSON.parse(classes) as { docType?: string; discipline?: string; criticality?: string }[];
    return parsed[0] ?? {};
  } catch {
    return {};
  }
}
