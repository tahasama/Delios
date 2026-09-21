"use client";

import { useState } from "react";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { sendForReviewAction } from "@/lib/actions/workflow";

export type SendPerson = { id: string; name: string; functionName: string };
export type SendStep = { title: string; act: "REVIEW" | "APPROVAL"; mode: string; proposedIds: string[]; fromFunctions: string[] };
export type SendRoute = { id: string; name: string; description: string | null; isDefault: boolean; steps: SendStep[] };

const MODE: Record<string, string> = {
  ALL: "all give input, any order",
  ANY_OF: "any one decides",
  SERIAL: "one after another, in this order",
  ALL_CONSOLIDATOR: "all respond, last one decides",
};

/**
 * The one "Send for review" form. Used for a single document, a selection
 * from the register and the documents of an accepted transmittal alike.
 * Each step proposes people from the route and the distribution matrix; only
 * people the matrix allows for every document are offered at all.
 */
export function SendForReviewForm({ revisionIds, routes, reviewers, approvers }: {
  revisionIds: string[];
  routes: SendRoute[];
  reviewers: SendPerson[];
  approvers: SendPerson[];
}) {
  const [routeId, setRouteId] = useState(routes.find((r) => r.isDefault)?.id ?? routes[0]?.id ?? "");
  const route = routes.find((r) => r.id === routeId);
  if (!routes.length) return <p className="text-sm text-amber-800">No review route applies to {revisionIds.length > 1 ? "all of these documents" : "this document"}. An administrator sets them up in Settings → Review routes.</p>;

  return (
    <ActionForm action={sendForReviewAction} submitLabel={revisionIds.length > 1 ? `Send ${revisionIds.length} documents` : "Send"} size="sm" hidden={{}}>
      {revisionIds.map((id) => <input key={id} type="hidden" name="revisionIds" value={id} />)}
      <Field label="Route" required>
        <select name="templateId" required className={inputCls} value={routeId} onChange={(e) => setRouteId(e.target.value)}>
          {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      {route?.description ? <p className="-mt-1 text-xs text-slate-500">{route.description}</p> : null}

      <div className="space-y-3" key={routeId}>
        {route?.steps.map((step, i) => {
          const pool = step.act === "APPROVAL" ? approvers : reviewers;
          return (
            <fieldset key={i} className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-700">
                Step {i + 1} · {step.title} <span className="font-normal text-slate-500">— {step.act === "APPROVAL" ? "approve" : "review"}, {MODE[step.mode] ?? step.mode}</span>
              </legend>
              {step.fromFunctions.length ? <p className="mb-2 text-[11px] text-slate-500">Proposed from: {step.fromFunctions.join(", ")}</p> : null}
              {pool.length ? (
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {pool.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-slate-50">
                      <input type="checkbox" name={`participants_${i}`} value={p.id} defaultChecked={step.proposedIds.includes(p.id)} />
                      <span className="font-medium text-slate-800">{p.name}</span>
                      <span className="text-slate-400">{p.functionName}</span>
                    </label>
                  ))}
                </div>
              ) : <p className="text-xs text-amber-800">Nobody on this project may {step.act === "APPROVAL" ? "approve" : "review"} {revisionIds.length > 1 ? "all of these documents" : "this document"} under the distribution matrix.</p>}
            </fieldset>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-400">Only people the distribution matrix names for {revisionIds.length > 1 ? "every selected document" : "this document"} are listed.</p>
    </ActionForm>
  );
}
