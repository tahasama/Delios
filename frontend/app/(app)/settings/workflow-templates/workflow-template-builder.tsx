"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Check, Plus, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Field, ToneChip, inputCls } from "@/components/ui";
import { SwitchControl } from "@/components/switch";
import { SearchPick } from "@/components/search-pick";
import { cn } from "@/lib/core/utils";
import { saveTemplateAction } from "@/lib/reviews/forms";

export type WorkflowBuilderStep = {
  act: "REVIEW" | "APPROVAL";
  /** An organization answers this step: its own people (named, or holding the function), or itself, recorded by one of ours. */
  partyId?: string;
  /** For another organization's step: the reason for issue on the transmittal that carries it to them. */
  reason?: string;
  mode: "ANY_OF" | "ALL";
  participantIds: string[];
  functionIds?: string[];
  title?: string;
  /** Working days this step has once it opens. Empty means it has no date. */
  days?: number;
  /** On the last deciding step, the statuses it may release at. Empty means any. */
  grantsStatuses?: string[];
  /** The step decides (owner: several may); the last always does. */
  decides?: boolean;
  /** Whoever the distribution matrix gives for each document's discipline answers it, narrowed by the rest. */
  fromMatrix?: boolean;
};

/** Someone who may be put on a step: their organization (none: ours), the functions they hold and their disciplines. */
export type RoutePerson = { id: string; name: string; partyId: string | null; functions: string[]; departments: string[] };
type ClassOption = { code: string; label: string };
type ClassOptions = { documentTypes: ClassOption[]; disciplines: ClassOption[]; criticalities: ClassOption[]; deliverableTypes: ClassOption[]; originators: ClassOption[] };
type StatusChoice = { code: string; label: string };

// The two ways the backend runs a step (StepModes): everyone answers, or the first answer closes it.
const HOW: { value: WorkflowBuilderStep["mode"]; label: string; hint: string }[] = [
  { value: "ALL", label: "All of them, in any order", hint: "each answers; the step closes when everyone has" },
  { value: "ANY_OF", label: "Whoever gets to it first", hint: "the first answer closes the step" },
];

/** A route's working days, by default: five in all (owner), each decider given more than each adviser (2 + 3). */
const DEFAULT_TOTAL = 5;
function defaultDays(steps: WorkflowBuilderStep[]): WorkflowBuilderStep[] {
  const n = steps.length;
  const base = Math.max(1, Math.floor(DEFAULT_TOTAL / n));
  let left = Math.max(0, DEFAULT_TOTAL - base * n);
  const days = steps.map(() => base);
  const decides = (i: number) => !!steps[i].decides || i === n - 1;
  for (let i = n - 1; i >= 0 && left > 0; i--) if (decides(i)) { days[i]++; left--; }
  for (let i = n - 1; i >= 0 && left > 0; i--) if (!decides(i)) { days[i]++; left--; }
  return steps.map((s, i) => ({ ...s, days: days[i] }));
}

const pick = (on: boolean) => cn("rounded-[0.3rem] border px-2 py-1 text-xs", on ? "border-brand-line bg-tint font-semibold text-brand-ink" : "border-line-strong bg-surface text-slate-600 hover:bg-tint-soft");

/**
 * A route, changed or made, as the route itself (no box in a box): its name and the sets it answers from, then its
 * steps left to right, each advising or deciding (the last always decides) with its working days in its own box; the
 * step chosen opens under them, who answers it said by three choices side by side (organization, function, people)
 * that narrow one another, or "recommended for each document"; then which documents take it. Cancel goes back.
 */
export function WorkflowTemplateBuilder({ level = "project", id, name = "", description = "", classes = "*", outcomeSetKey = "", adviceSetKey = "", isDefault = false, initialSteps, users, functions = [], outsideParties = [], outcomeSets, adviceSets, classOptions, statuses, reasons = [], cancelHref }: {
  /** The reasons for issue: another organization's step says why it goes to them. */
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
  users: RoutePerson[];
  functions?: { id: string; name: string }[];
  /** The organizations that can answer a step: a client, a control office, a supplier. */
  outsideParties?: { id: string; name: string; participation: string }[];
  /** The sets of the review outcomes (Types & sets): the deciding steps answer from one. */
  outcomeSets: { key: string; title: string }[];
  /** The sets of the review advice (Types & sets): the advising steps answer from one. */
  adviceSets: { key: string; title: string }[];
  classOptions: ClassOptions;
  statuses: StatusChoice[];
  /** Back to the routes, the form closed. */
  cancelHref: string;
}) {
  const [draft, setDraft] = useState<WorkflowBuilderStep[]>(
    initialSteps?.length ? initialSteps : defaultDays([
      { act: "REVIEW", mode: "ALL", participantIds: [], title: "Review" },
      { act: "APPROVAL", mode: "ANY_OF", participantIds: [], title: "Decision", decides: true },
    ]),
  );
  // Days typed by hand are kept; until then they follow the defaults as steps come and go.
  const [daysTyped, setDaysTyped] = useState(() => !!initialSteps?.some((s) => s.days));
  const [open, setOpen] = useState<number | null>(0);
  const [allClasses, setAllClasses] = useState(classes === "*");
  const [scope, setScope] = useState(parseScope(classes));

  // The last step always decides; the others decide where chosen, else advise.
  const steps = useMemo(
    () => draft.map((s, i) => {
      const decides = !!s.decides || i === draft.length - 1;
      return { ...s, decides, act: (decides ? "APPROVAL" : "REVIEW") as WorkflowBuilderStep["act"] };
    }),
    [draft],
  );
  const nameOf = (personId: string) => users.find((u) => u.id === personId)?.name ?? "someone no longer here";
  const fnName = (functionId: string) => functions.find((f) => f.id === functionId)?.name ?? functionId;
  const partyOf = (step: WorkflowBuilderStep) => outsideParties.find((party) => party.id === step.partyId);

  function change(next: (current: WorkflowBuilderStep[]) => WorkflowBuilderStep[]) {
    setDraft((current) => {
      const changed = next(current);
      return daysTyped ? changed : defaultDays(changed);
    });
  }
  function update(index: number, patch: Partial<WorkflowBuilderStep>) {
    change((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }
  function insert(at: number) {
    change((current) => [...current.slice(0, at), { act: "REVIEW", mode: "ALL", participantIds: [], title: "Review" }, ...current.slice(at)]);
    setOpen(at);
  }
  function remove(index: number) {
    change((current) => (current.length === 1 ? current : current.filter((_, i) => i !== index)));
    setOpen(null);
  }
  const total = steps.reduce((n, x) => n + (x.days ?? 0), 0);
  const chosen = open !== null ? steps[open] : null;
  const lastDecider = steps.length - 1;

  // People a step may name, narrowed by its organization (none: ours), its function and the discipline the route takes.
  const peopleFor = (step: WorkflowBuilderStep) => users.filter((u) =>
    step.participantIds.includes(u.id) || (
      (step.partyId ? u.partyId === step.partyId : u.partyId === null)
      && (!step.functionIds?.length || step.functionIds.some((f) => u.functions.includes(f)))
      && (allClasses || !scope.discipline || u.departments.includes(scope.discipline))));
  const asItself = (step: WorkflowBuilderStep) => partyOf(step)?.participation === "BY_PROXY";
  const whoOf = (step: WorkflowBuilderStep) => {
    const party = partyOf(step);
    const named = step.participantIds.map(nameOf);
    const fn = (step.functionIds ?? []).map((f) => `any ${fnName(f)}`);
    const parts = [...named, ...fn, ...(step.fromMatrix ? ["recommended for each document"] : [])];
    return party ? (parts.length ? `${party.name}: ${parts.join(", ")}` : party.name) : parts.join(", ");
  };

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
        <Field label="Verdicts" hint="the set of Review outcomes the deciding steps answer from (Types & sets)">
          <select name="outcomeSetKey" defaultValue={outcomeSetKey} className={inputCls}>
            <option value="">The set serving each document&rsquo;s deliverable type</option>
            {outcomeSets.map((one) => <option key={one.key} value={one.key}>{one.title}</option>)}
          </select>
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5 self-end pb-1.5 text-[13px] text-slate-700">
          <SwitchControl name="isDefault" defaultChecked={isDefault} /> Offered first
        </label>
      </div>

      {/* ── Which documents take it: it narrows who answers, and what may be sent on it ─── */}
      <div className="flex flex-wrap items-center gap-1.5 border-y border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil mr-1 text-slate-500">Which documents take it</span>
        <span className="text-[11px] text-slate-500">no other document can be sent on it; its discipline narrows the people of its steps</span>
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

      {/* ── The steps ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 border-y border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil mr-1 text-slate-500">Its steps</span>
        <span className="text-[11px] text-slate-500">
          left to right; each advises or decides, the last always decides; the most severe verdict stands. {total ? `${total} working days when every step uses its time.` : ""}
        </span>
      </div>
      <div className="px-5 py-4 sm:px-6">
        <div className="scroll-thin flex items-stretch gap-1 overflow-x-auto p-1">
          <AddHere onClick={() => insert(0)} />
          {steps.map((step, index) => {
            const who = whoOf(step);
            return (
              <div key={index} className="flex items-stretch gap-1">
                <div className={cn("flex w-56 shrink-0 flex-col rounded-md ring-1 transition", open === index ? "bg-surface ring-2 ring-brand-line" : "bg-surface ring-line hover:ring-line-strong")}>
                  <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
                    <span className="text-[11px] font-semibold text-slate-500">Step {index + 1}</span>
                    {index === lastDecider ? <ToneChip tone="done">decides</ToneChip> : (
                      <button type="button" onClick={() => update(index, { decides: !step.decides })} title={step.decides ? "Make it advise" : "Make it decide"}>
                        <ToneChip tone={step.decides ? "done" : "moving"}>{step.decides ? "decides" : "advises"}</ToneChip>
                      </button>
                    )}
                  </div>
                  <button type="button" onClick={() => setOpen(open === index ? null : index)} className="flex-1 px-3 pt-1 pb-2 text-left">
                    <span className="block text-[13px] font-semibold text-slate-900">{step.title || (step.decides ? "Decision" : `Review ${index + 1}`)}</span>
                    <span className={cn("mt-1 block text-[11px] leading-4", who ? "text-slate-600" : "text-amber-700")}>
                      {who || "Nobody yet: choose who answers it"}
                    </span>
                  </button>
                  <label className="flex items-center gap-2 whitespace-nowrap border-t border-line px-3 py-1.5 text-[11px] text-slate-500">
                    <input type="number" min={0} max={90} value={step.days ?? ""} placeholder="—"
                      onChange={(e) => { setDaysTyped(true); setDraft((current) => current.map((one, i) => (i === index ? { ...one, days: e.target.value ? Number(e.target.value) : undefined } : one))); }}
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
            <Field label={`Step ${open + 1}`} hint={chosen.decides ? "it decides" : "it advises"}>
              <input value={chosen.title ?? ""} onChange={(e) => update(open, { title: e.target.value })} className={inputCls}
                aria-label={`Name of step ${open + 1}`} placeholder={chosen.decides ? "Decision" : "Review"} />
            </Field>
            <Field label="How they answer" hint={HOW.find((h) => h.value === chosen.mode)?.hint}>
              <select value={chosen.mode} onChange={(e) => update(open, { mode: e.target.value as WorkflowBuilderStep["mode"] })} className={inputCls}>
                {HOW.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
            </Field>
            <div className="flex items-end justify-end">
              <button type="button" onClick={() => remove(open)} disabled={steps.length === 1} title="Remove this step" aria-label="Remove this step"
                className="ask inline-flex items-center gap-1.5 hover:text-red-700 disabled:opacity-40">
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
              </button>
            </div>
          </div>

          {/* Who answers it: three choices that narrow one another; at least one, or the matrix. */}
          <div>
            <p className="text-xs font-medium text-slate-700">Who answers it</p>
            <p className="mb-2 text-[11px] text-slate-500">Any of the three, at least one: an organization, a function, people. Each narrows the others.</p>
            <div key={open} className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
              <Field label="Organization" hint="none chosen: ours">
                <select value={chosen.partyId ?? ""} className={inputCls}
                  onChange={(e) => update(open, { partyId: e.target.value || undefined, participantIds: [], reason: e.target.value ? chosen.reason : undefined,
                    ...(outsideParties.find((p) => p.id === e.target.value)?.participation === "BY_PROXY" ? { functionIds: [], fromMatrix: false } : {}) })}>
                  <option value="">Ours</option>
                  {outsideParties.map((p) => <option key={p.id} value={p.id}>{p.name}{p.participation === "BY_PROXY" ? " (answers as itself)" : ""}</option>)}
                </select>
              </Field>
              <Field label="Function" hint={asItself(chosen) ? "it answers as itself" : "whoever holds it"}>
                <select value={(chosen.functionIds ?? [])[0] ?? ""} disabled={asItself(chosen)} className={inputCls}
                  onChange={(e) => update(open, { functionIds: e.target.value ? [e.target.value] : [] })}>
                  <option value="">Any function</option>
                  {functions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </Field>
              {asItself(chosen) ? (
                <Field label="People" hint="nobody of theirs signs in">
                  <p className="flex h-[var(--control-h)] items-center text-xs text-slate-500">One of ours sends it and records their answer.</p>
                </Field>
              ) : (
                <div>
                  <SearchPick key={`${open}-${chosen.partyId ?? "ours"}-${(chosen.functionIds ?? []).join()}-${scope.discipline ?? ""}-${allClasses}`}
                    name={`people_${open}`} label="People" hint="found by name"
                    items={peopleFor(chosen).map((u) => ({ id: u.id, name: u.name, detail: [u.functions.map(fnName).join(", "), u.departments.join(", ")].filter(Boolean).join(" · ") }))}
                    initial={chosen.participantIds} placeholder="Type a name" empty="Nobody named"
                    onChange={(ids) => { if (ids.join() !== chosen.participantIds.join()) update(open, { participantIds: ids }); }} />
                </div>
              )}
            </div>
            {!asItself(chosen) ? (
              <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-[13px] text-slate-700">
                <SwitchControl checked={!!chosen.fromMatrix} onChange={(on) => update(open, { fromMatrix: on })} />
                Recommended for each document
                <span className="text-[11px] text-slate-500">the distribution matrix proposes whoever answers for its discipline, narrowed by the choices above; the sender confirms</span>
              </label>
            ) : null}
          </div>

          {chosen.partyId ? (
            <div className="grid grid-cols-1 gap-x-6 md:grid-cols-3">
              <Field label="Why it goes to them" required hint="the reason for issue on the transmittal">
                <select value={chosen.reason ?? ""} onChange={(e) => update(open, { reason: e.target.value || undefined })} className={inputCls}>
                  <option value="">Choose…</option>
                  {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                </select>
              </Field>
            </div>
          ) : null}

          {open === lastDecider ? (
            <div>
              <p className="text-xs font-medium text-slate-700">The status it releases at</p>
              <p className="mb-1.5 text-[11px] text-slate-500">
                One chosen: every document this route accepts is released at it. Several: the decider chooses among them. None: any published status.
              </p>
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
          ) : chosen.decides ? (
            <p className="text-[11px] text-slate-500">It gives a verdict; the status is the last deciding step&rsquo;s.</p>
          ) : null}
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
