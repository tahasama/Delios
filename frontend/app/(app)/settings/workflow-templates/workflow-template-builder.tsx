"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Check, Plus, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Field, ToneChip, inputCls } from "@/components/ui";
import { SwitchControl } from "@/components/switch";
import { cn } from "@/lib/core/utils";
import { saveTemplateAction } from "@/lib/reviews/forms";

export type WorkflowBuilderStep = {
  act: "REVIEW" | "APPROVAL";
  /** An outside party answers this step instead of our own people. */
  partyId?: string;
  /** For an outside party's step: the reason for issue on the transmittal that carries it to them. */
  reason?: string;
  mode: "ANY_OF" | "ALL";
  participantIds: string[];
  functionIds?: string[];
  title?: string;
  /** Working days this step has once it opens. Empty means it has no date. */
  days?: number;
  /** On the deciding step, the statuses it may decide on. Empty means any. */
  grantsStatuses?: string[];
};

type Person = { id: string; name: string; role: string; party: { name: string; isInternal: boolean } | null };
type ClassOption = { code: string; label: string };
type ClassOptions = { documentTypes: ClassOption[]; disciplines: ClassOption[]; criticalities: ClassOption[]; deliverableTypes: ClassOption[]; originators: ClassOption[] };
type StatusChoice = { code: string; label: string };

// The two ways the backend runs a step (StepModes): everyone answers, or the first answer closes it.
const HOW: { value: WorkflowBuilderStep["mode"]; label: string; hint: string }[] = [
  { value: "ALL", label: "All of them, in any order", hint: "each answers; the step closes when everyone has" },
  { value: "ANY_OF", label: "Whoever gets to it first", hint: "the first answer closes the step" },
];

const pick = (on: boolean) => cn("rounded-[0.3rem] border px-2 py-1 text-xs", on ? "border-brand-line bg-tint font-semibold text-brand-ink" : "border-line-strong bg-surface text-slate-600 hover:bg-tint-soft");

/**
 * A route, changed or made, as the route itself (no box in a box): its name and the sets it answers from, then its
 * steps left to right, each with its working days in its own box, the last one deciding; the step chosen opens under
 * them; then which documents take it. Cancel goes back to the routes as they are.
 */
export function WorkflowTemplateBuilder({ level = "project", id, name = "", description = "", classes = "*", outcomeSetKey = "", adviceSetKey = "", isDefault = false, initialSteps, users, functions = [], outsideParties = [], outcomeSets, adviceSets, classOptions, statuses, reasons = [], cancelHref }: {
  /** The reasons for issue: an outside party's step says why it goes to them. */
  reasons?: { code: string; label: string }[];
  /** Where the route is kept: the organization's routes, or the project's (its own copy where routes are free). */
  level?: "organization" | "project";
  id?: string;
  name?: string;
  description?: string;
  classes?: string;
  outcomeSetKey?: string;
  adviceSetKey?: string;
  isDefault?: boolean;
  initialSteps?: WorkflowBuilderStep[];
  users: Person[];
  functions?: { id: string; name: string }[];
  /** Parties that can hold a step: a client, a control office, a supplier. */
  outsideParties?: { id: string; name: string; participation: string }[];
  /** The sets of the review outcomes (Types & sets): the deciding step answers from one. */
  outcomeSets: { key: string; title: string }[];
  /** The sets of the review advice (Types & sets): the advising steps answer from one. */
  adviceSets: { key: string; title: string }[];
  classOptions: ClassOptions;
  statuses: StatusChoice[];
  /** Back to the routes, the form closed. */
  cancelHref: string;
}) {
  const [draft, setDraft] = useState<WorkflowBuilderStep[]>(
    initialSteps?.length ? initialSteps : [
      { act: "REVIEW", mode: "ALL", participantIds: [], title: "Review" },
      { act: "APPROVAL", mode: "ANY_OF", participantIds: [], title: "Decision" },
    ],
  );
  const [open, setOpen] = useState<number | null>(0);
  const [allClasses, setAllClasses] = useState(classes === "*");
  const [scope, setScope] = useState(parseScope(classes));

  // The last step always decides; everything before it advises.
  const steps = useMemo(
    () => draft.map((s, i) => ({ ...s, act: (i === draft.length - 1 ? "APPROVAL" : "REVIEW") as WorkflowBuilderStep["act"] })),
    [draft],
  );
  const groups = useMemo(() => {
    const out = new Map<string, Person[]>();
    for (const user of users) {
      const label = !user.party || user.party.isInternal ? "Our people" : user.party.name;
      out.set(label, [...(out.get(label) ?? []), user]);
    }
    return [...out.entries()];
  }, [users]);
  const nameOf = (personId: string) => users.find((u) => u.id === personId)?.name ?? personId;
  const fnName = (functionId: string) => functions.find((f) => f.id === functionId)?.name ?? functionId;
  const partyOf = (step: WorkflowBuilderStep) => outsideParties.find((party) => party.id === step.partyId);

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
    if (selected.has(personId)) selected.delete(personId); else selected.add(personId);
    update(index, { participantIds: [...selected] });
  }
  const total = steps.reduce((n, x) => n + (x.days ?? 0), 0);
  const chosen = open !== null ? steps[open] : null;

  const formId = `route-${id ?? "new"}`;
  return (
    <>
    <ActionForm action={saveTemplateAction} id={formId} hideSubmit hidden={id ? { level, id } : { level }}
      className="space-y-0" footerClassName="px-5 pt-3 sm:px-6 empty:hidden">
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />
      <input type="hidden" name="classes" value={allClasses ? "*" : JSON.stringify([scope])} />

      {/* ── What it is ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 sm:px-6 md:grid-cols-3">
        <Field label="Name" required hint="what it covers — who decides it">
          <input name="name" required defaultValue={name} className={inputCls} placeholder="Engineering drawings — lead engineer decides" />
        </Field>
        <div className="md:col-span-2">
          <Field label="When to use it" hint="the sender reads it on Send for review">
            <input name="description" defaultValue={description} className={inputCls} placeholder="Tell the sender when this route is the right one" />
          </Field>
        </div>
        <Field label="Advice" hint="the set of Review advice the advising steps answer from (Types & sets)">
          <select name="adviceSetKey" defaultValue={adviceSetKey} className={inputCls}>
            <option value="">The set serving each document&rsquo;s deliverable type</option>
            {adviceSets.map((one) => <option key={one.key} value={one.key}>{one.title}</option>)}
          </select>
        </Field>
        <Field label="Verdicts" hint="the set of Review outcomes the deciding step answers from (Types & sets)">
          <select name="outcomeSetKey" defaultValue={outcomeSetKey} className={inputCls}>
            <option value="">The set serving each document&rsquo;s deliverable type</option>
            {outcomeSets.map((one) => <option key={one.key} value={one.key}>{one.title}</option>)}
          </select>
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5 self-end pb-1.5 text-[13px] text-slate-700">
          <SwitchControl name="isDefault" defaultChecked={isDefault} /> Offered first
        </label>
      </div>

      {/* ── The steps ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 border-y border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil mr-1 text-slate-500">Its steps</span>
        <span className="text-[11px] text-slate-500">
          left to right; each step before the last advises, the last decides. {total ? `${total} working days when every step uses its time.` : "No step has days yet: give each its working days, and reviews get a due date."}
        </span>
      </div>
      <div className="px-5 py-4 sm:px-6">
        <div className="scroll-thin flex items-stretch gap-1 overflow-x-auto p-1">
          <AddHere onClick={() => insert(0)} />
          {steps.map((step, index) => {
            const decides = index === steps.length - 1;
            const party = partyOf(step);
            const who = party ? [party.name] : [...(step.functionIds ?? []).map((f) => `any ${fnName(f)}`), ...step.participantIds.map(nameOf)];
            return (
              <div key={index} className="flex items-stretch gap-1">
                <div className={cn("flex w-56 shrink-0 flex-col rounded-md ring-1 transition", open === index ? "bg-surface ring-2 ring-brand-line" : "bg-surface ring-line hover:ring-line-strong")}>
                  <button type="button" onClick={() => setOpen(open === index ? null : index)} className="flex-1 px-3 pt-2.5 pb-2 text-left">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-500">Step {index + 1}</span>
                      <ToneChip tone={decides ? "done" : "moving"}>{decides ? "decides" : "advises"}</ToneChip>
                    </span>
                    <span className="mt-1 block text-[13px] font-semibold text-slate-900">{step.title || (decides ? "Decision" : `Review ${index + 1}`)}</span>
                    <span className={cn("mt-1 block text-[11px] leading-4", who.length ? "text-slate-600" : "text-amber-700")}>
                      {who.length ? who.join(", ") : "Nobody yet: name people, a function or an organization"}
                    </span>
                  </button>
                  <label className="flex items-center gap-2 whitespace-nowrap border-t border-line px-3 py-1.5 text-[11px] text-slate-500">
                    <input type="number" min={0} max={90} value={step.days ?? ""} placeholder="—"
                      onChange={(e) => update(index, { days: e.target.value ? Number(e.target.value) : undefined })}
                      className={`${inputCls} !w-14 text-center`} aria-label={`Working days for step ${index + 1}`} />
                    working days{step.days ? "" : ": no due date"}
                  </label>
                </div>
                {index < steps.length - 1 ? <ArrowRight className="h-4 w-4 shrink-0 self-center text-slate-400" aria-hidden /> : null}
                <AddHere onClick={() => insert(index + 1)} />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── The step chosen ────────────────────────────────────────────── */}
      {open !== null && chosen ? (
        <div className="space-y-4 border-t border-line px-5 py-4 sm:px-6">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
            <Field label={`Step ${open + 1}`} hint={open === steps.length - 1 ? "it decides" : "it advises the one that decides"}>
              <input value={chosen.title ?? ""} onChange={(e) => update(open, { title: e.target.value })} className={inputCls}
                aria-label={`Name of step ${open + 1}`} placeholder={open === steps.length - 1 ? "Decision" : "Review"} />
            </Field>
            {chosen.participantIds.length + (chosen.functionIds?.length ?? 0) > 1 ? (
              <Field label="How they answer" hint={HOW.find((h) => h.value === chosen.mode)?.hint}>
                <select value={chosen.mode} onChange={(e) => update(open, { mode: e.target.value as WorkflowBuilderStep["mode"] })} className={inputCls}>
                  {HOW.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                </select>
              </Field>
            ) : <span />}
            <div className="flex items-end justify-end">
              <button type="button" onClick={() => remove(open)} disabled={steps.length === 1} title="Remove this step" aria-label="Remove this step"
                className="ask inline-flex items-center gap-1.5 hover:text-red-700 disabled:opacity-40">
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
              </button>
            </div>
          </div>

          {chosen.partyId ? (
            <div className="space-y-3">
              <p className="text-xs leading-5 text-slate-600">
                <span className="font-semibold text-slate-900">{partyOf(chosen)?.name ?? "Another organization"}</span> answers this step.{" "}
                {partyOf(chosen)?.participation === "IN_APP" ? "They answer here, in their own account." : "It goes to them on a transmittal and their answer is recorded here."}
              </p>
              <div className="grid grid-cols-1 gap-x-6 md:grid-cols-3">
                <Field label="Why it goes to them" required hint="the reason for issue on the transmittal">
                  <select value={chosen.reason ?? ""} onChange={(e) => update(open, { reason: e.target.value || undefined })} className={inputCls}>
                    <option value="">Choose…</option>
                    {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                </Field>
              </div>
              <button type="button" onClick={() => update(open, { partyId: undefined, reason: undefined })} className="text-xs font-semibold text-link hover:underline">
                Our own people answer it instead
              </button>
            </div>
          ) : (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div>
                <p className="text-xs font-medium text-slate-700">Who answers it</p>
                <p className="mb-1.5 text-[11px] text-slate-500">People of ours (two or more answer side by side), or another organization.</p>
                <div className="space-y-3">
                  {outsideParties.length ? (
                    <div>
                      <p className="stencil mb-1 text-slate-500">Another organization</p>
                      <div className="flex flex-wrap gap-1.5">
                        {outsideParties.map((party) => (
                          <button key={party.id} type="button" className={pick(false)} title={party.participation === "IN_APP" ? "answers here" : "we record their answer"}
                            onClick={() => update(open, { partyId: party.id, participantIds: [], functionIds: [] })}>
                            {party.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {groups.map(([group, list]) => (
                    <div key={group}>
                      <p className="stencil mb-1 text-slate-500">{group}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {list.map((person) => {
                          const on = chosen.participantIds.includes(person.id);
                          return (
                            <button key={person.id} type="button" onClick={() => togglePerson(open, person.id)} className={pick(on)} title={person.role || undefined}>
                              {on ? <Check className="mr-1 inline h-3 w-3" aria-hidden /> : null}{person.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-700">Or whoever holds a function</p>
                <p className="mb-1.5 text-[11px] text-slate-500">One function; the matrix says who that is for each document.</p>
                <div className="flex flex-wrap gap-1.5">
                  {functions.map((f) => {
                    const on = (chosen.functionIds ?? []).includes(f.id);
                    return (
                      <button key={f.id} type="button" onClick={() => update(open, { functionIds: on ? [] : [f.id] })} className={pick(on)}>
                        {on ? <Check className="mr-1 inline h-3 w-3" aria-hidden /> : null}{f.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {open === steps.length - 1 ? (
            <div>
              <p className="text-xs font-medium text-slate-700">The statuses it may release at</p>
              <p className="mb-1.5 text-[11px] text-slate-500">None chosen: any published status.</p>
              <div className="flex flex-wrap gap-1.5">
                {statuses.map((one) => {
                  const on = (chosen.grantsStatuses ?? []).includes(one.code);
                  return (
                    <button key={one.code} type="button" title={one.label} className={pick(on)}
                      onClick={() => {
                        const picked = new Set(chosen.grantsStatuses ?? []);
                        if (picked.has(one.code)) picked.delete(one.code); else picked.add(one.code);
                        update(open, { grantsStatuses: picked.size ? [...picked] : undefined });
                      }}>
                      {on ? <Check className="mr-1 inline h-3 w-3" aria-hidden /> : null}{one.code} — {one.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Which documents take it ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 border-y border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil mr-1 text-slate-500">Which documents take it</span>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={allClasses} onChange={(e) => setAllClasses(e.target.checked)} /> All documents
        </label>
      </div>
      {!allClasses ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 sm:px-6 md:grid-cols-3">
          <Field label="Produced by" hint="ours, a supplier's, the client's"><select className={inputCls} value={scope.deliverableType ?? ""} onChange={(e) => setScope((v) => ({ ...v, deliverableType: e.target.value || undefined }))}><option value="">Anyone</option>{classOptions.deliverableTypes.map((i) => <option key={i.code} value={i.code}>{i.code} — {i.label}</option>)}</select></Field>
          <Field label="Document type"><select className={inputCls} value={scope.docType ?? ""} onChange={(e) => setScope((v) => ({ ...v, docType: e.target.value || undefined }))}><option value="">Any type</option>{classOptions.documentTypes.map((i) => <option key={i.code} value={i.code}>{i.code} — {i.label}</option>)}</select></Field>
          <Field label="Discipline"><select className={inputCls} value={scope.discipline ?? ""} onChange={(e) => setScope((v) => ({ ...v, discipline: e.target.value || undefined }))}><option value="">Any discipline</option>{classOptions.disciplines.map((i) => <option key={i.code} value={i.code}>{i.code} — {i.label}</option>)}</select></Field>
          <Field label="Criticality"><select className={inputCls} value={scope.criticality ?? ""} onChange={(e) => setScope((v) => ({ ...v, criticality: e.target.value || undefined }))}><option value="">Any criticality</option>{classOptions.criticalities.map((i) => <option key={i.code} value={i.code}>{i.code} — {i.label}</option>)}</select></Field>
          <Field label="From which organization" hint="only documents that came from it"><select className={inputCls} value={scope.originator ?? ""} onChange={(e) => setScope((v) => ({ ...v, originator: e.target.value || undefined }))}><option value="">Any organization</option>{classOptions.originators.map((i) => <option key={i.code} value={i.code}>{i.code} — {i.label}</option>)}</select></Field>
        </div>
      ) : null}
    </ActionForm>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
      <Link href={cancelHref} scroll={false} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
      <button type="submit" form={formId} data-on="true" className="ask">{id ? "Save" : "Add the route"}</button>
    </div>
    </>
  );
}

/** The thin "+" that drops a new step in at this point of the route. */
function AddHere({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Add a step here" aria-label="Add a step here"
      className="grid w-6 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-tint-soft hover:text-link">
      <Plus className="h-4 w-4" />
    </button>
  );
}

/** The five things a route can be chosen by. Any one left empty matches all. */
type Scope = { docType?: string; discipline?: string; criticality?: string; deliverableType?: string; originator?: string };

function parseScope(classes: string): Scope {
  if (!classes || classes === "*") return {};
  try {
    const parsed = JSON.parse(classes) as Scope[];
    return parsed[0] ?? {};
  } catch {
    return {};
  }
}
