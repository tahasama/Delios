"use client";

import { useState } from "react";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { sendForReviewAction } from "@/lib/actions/workflow";
import { ArrowRight } from "lucide-react";
import { SearchPick } from "@/components/search-pick";

export type SendPerson = { id: string; name: string; functionName: string; inMatrix?: boolean };
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
export function SendForReviewForm({ revisionIds, routes, reviewers, approvers, everyone = [], strict = true }: {
  revisionIds: string[];
  routes: SendRoute[];
  reviewers: SendPerson[];
  approvers: SendPerson[];
  /** Everyone on the project, who may be copied in. */
  everyone?: SendPerson[];
  /** The matrix is the only rule; otherwise anyone may be added, flagged. */
  strict?: boolean;
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
      <p className="text-[11px] text-slate-400">
        {strict
          ? `Only people the distribution matrix allows for ${revisionIds.length > 1 ? "every selected document" : "this document"} can be added to a step.`
          : "The matrix proposes the people. Anyone else on the project can be added — they are flagged, and the record says you chose them."}
      </p>

      {/* Copied in: told it went out for review and able to follow it, never
          asked to answer — so the route never waits on them. */}
      {everyone.length ? (
        <SearchPick
          name="copyUsers"
          items={everyone.map((p) => ({ id: p.id, name: p.name, detail: p.functionName }))}
          label="Copy to (cc)"
          hint="kept informed, never asked to review — optional"
          placeholder="Nobody copied in"
        />
      ) : null}
    </ActionForm>
  );
}

function StepCard({ index, step, pool, many }: { index: number; step: SendStep; pool: SendPerson[]; many: boolean }) {
  const why = new Map(step.proposed.map((p) => [p.id, p.why]));
  const approval = step.act === "APPROVAL";

  return (
    <fieldset className={`flex w-64 shrink-0 flex-col rounded-xl border p-2.5 ${approval ? "border-brand-line/30 bg-tint-soft" : "border-line bg-surface"}`}>
      <legend className="sr-only">Step {index + 1}</legend>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400" title={approval ? "This step's verdict binds; a verdict that proceeds is the release approval" : "Advice for the decider"}>Step {index + 1} · {approval ? "Decides" : "Advises"}</p>
      <p className="text-sm font-semibold text-slate-800">{step.title}</p>
      <p className="mb-2 text-[11px] text-slate-500">{MODE[step.mode] ?? step.mode}{step.mode === "SERIAL" ? " — in the order listed" : ""}</p>
      <SearchPick
        compact
        name={`participants_${index}`}
        items={pool.map((p) => ({
          id: p.id,
          name: p.name,
          detail: p.inMatrix === false ? `${p.functionName} · not in the matrix` : why.get(p.id) ?? p.functionName,
          note: p.inMatrix === false ? `Not named in the matrix to ${approval ? "approve" : "review"} this — flagged.` : null,
        }))}
        initial={step.proposed.map((p) => p.id).filter((id) => pool.some((p) => p.id === id))}
        placeholder={pool.length ? "Type a name, then Enter" : "Nobody allowed"}
        empty={pool.length ? "Nobody yet — add someone." : `Nobody may ${approval ? "approve" : "review"} ${many ? "all of these" : "this"} under the matrix.`}
      />
    </fieldset>
  );
}
