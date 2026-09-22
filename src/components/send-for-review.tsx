"use client";

import { useState } from "react";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { sendForReviewAction } from "@/lib/actions/workflow";
import { ArrowRight, X } from "lucide-react";

export type SendPerson = { id: string; name: string; functionName: string };
export type SendStep = { title: string; act: "REVIEW" | "APPROVAL"; mode: string; proposed: { id: string; why: string }[]; fromFunctions: string[] };
export type SendRoute = { id: string; name: string; description: string | null; isDefault: boolean; steps: SendStep[]; verdicts: { title: string; values: { code: string; label: string; effectLabel: string }[] } | null };

const MODE: Record<string, string> = {
  ALL: "all give input, any order",
  ANY_OF: "any one decides",
  SERIAL: "one after another",
  ALL_CONSOLIDATOR: "all respond, last decides",
};

/**
 * The one "Send for review" form. Used for a single document, a selection
 * from the register and the documents of an accepted transmittal alike.
 *
 * The chosen route is drawn as it will run: one card per step, left to right.
 * Each card starts with the people the route or the distribution matrix
 * assigns (by the documents' discipline when the route names nobody); the
 * sender removes or adds anyone the matrix allows.
 */
export function SendForReviewForm({ revisionIds, routes, reviewers, approvers }: {
  revisionIds: string[];
  routes: SendRoute[];
  reviewers: SendPerson[];
  approvers: SendPerson[];
}) {
  const [routeId, setRouteId] = useState(routes.find((r) => r.isDefault)?.id ?? routes[0]?.id ?? "");
  const route = routes.find((r) => r.id === routeId);
  if (!routes.length) return <p className="text-sm text-amber-800">No review route applies to {revisionIds.length > 1 ? "all of these documents" : "this document"}. Review routes are set up in Settings → Review routes.</p>;

  return (
    <ActionForm action={sendForReviewAction} submitLabel={revisionIds.length > 1 ? `Send ${revisionIds.length} documents` : "Send"} size="sm" hidden={{}}>
      {revisionIds.map((id) => <input key={id} type="hidden" name="revisionIds" value={id} />)}
      <Field label="Route" required>
        <select name="templateId" required className={inputCls} value={routeId} onChange={(e) => setRouteId(e.target.value)}>
          {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      {route?.description ? <p className="-mt-1 text-xs text-slate-500">{route.description}</p> : null}
      {route?.verdicts ? (
        <p className="text-[11px] text-slate-500">
          Reviewers answer with <strong className="text-slate-700">{route.verdicts.title}</strong>:{" "}
          {route.verdicts.values.map((v, i) => <span key={v.code} title={v.label}>{i ? " · " : ""}<span className="font-mono font-semibold">{v.code}</span> {v.effectLabel}</span>)}
        </p>
      ) : null}

      <div key={routeId} className="scroll-thin -mx-1 flex items-stretch gap-1 overflow-x-auto px-1 pb-1">
        {route?.steps.map((step, i) => (
          <div key={i} className="flex items-stretch gap-1">
            {i > 0 ? <ArrowRight className="h-4 w-4 shrink-0 self-center text-slate-300" aria-hidden /> : null}
            <StepCard index={i} step={step} pool={step.act === "APPROVAL" ? approvers : reviewers} many={revisionIds.length > 1} />
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">Only people the distribution matrix allows for {revisionIds.length > 1 ? "every selected document" : "this document"} can be added.</p>
    </ActionForm>
  );
}

function StepCard({ index, step, pool, many }: { index: number; step: SendStep; pool: SendPerson[]; many: boolean }) {
  const [chosen, setChosen] = useState<string[]>(step.proposed.map((p) => p.id).filter((id) => pool.some((p) => p.id === id)));
  const why = new Map(step.proposed.map((p) => [p.id, p.why]));
  const addable = pool.filter((p) => !chosen.includes(p.id));
  const approval = step.act === "APPROVAL";

  return (
    <fieldset className={`flex w-60 shrink-0 flex-col rounded-xl border p-2.5 ${approval ? "border-brand-line/30 bg-tint-soft" : "border-slate-200 bg-surface"}`}>
      <legend className="sr-only">Step {index + 1}</legend>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400" title={approval ? "This step's verdict binds; a verdict that proceeds is the release approval" : "Advice for the decider"}>Step {index + 1} · {approval ? "Decides" : "Advises"}</p>
      <p className="text-sm font-semibold text-slate-800">{step.title}</p>
      <p className="mb-2 text-[11px] text-slate-500">{MODE[step.mode] ?? step.mode}</p>

      <ul className={`flex-1 space-y-1 ${step.mode === "SERIAL" ? "list-decimal pl-4" : ""}`}>
        {chosen.map((id) => {
          const p = pool.find((x) => x.id === id);
          if (!p) return null;
          return (
            <li key={id} className="text-xs">
              <input type="hidden" name={`participants_${index}`} value={id} />
              <span className="inline-flex w-full items-start justify-between gap-1 rounded-md bg-surface px-2 py-1 ring-1 ring-slate-200">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{p.name}</span>
                  <span className="block truncate text-[10px] text-slate-400">{why.get(id) ?? p.functionName}</span>
                </span>
                <button type="button" onClick={() => setChosen(chosen.filter((x) => x !== id))} className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${p.name}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            </li>
          );
        })}
        {!chosen.length ? <li className="text-[11px] text-amber-700">{pool.length ? "Nobody yet — add someone." : `Nobody may ${approval ? "approve" : "review"} ${many ? "all of these" : "this"} under the matrix.`}</li> : null}
      </ul>

      {addable.length ? (
        <select
          aria-label={`Add to step ${index + 1}`}
          className="mt-2 w-full rounded-md border border-dashed border-slate-300 bg-surface px-2 py-1 text-xs text-slate-600"
          value=""
          onChange={(e) => e.target.value && setChosen([...chosen, e.target.value])}
        >
          <option value="">+ add…</option>
          {addable.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.functionName}</option>)}
        </select>
      ) : null}
    </fieldset>
  );
}
