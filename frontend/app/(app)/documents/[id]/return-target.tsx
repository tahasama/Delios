"use client";
import { Select } from "@/components/select";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";

type ReturnStep = { number: number; title: string };
type ReturnReason = { code: string; label: string; meaning?: string | null };

/**
 * Where a revision goes back to, and why.
 *
 * Two different acts wearing one button, so the form keeps them apart.
 *
 * **Back to its author** is the ordinary end of a rejected revision: it is kept
 * as what was submitted and what was said about it, and the next revision
 * replaces it. Nobody corrects it in place — that would erase the thing the
 * record exists for.
 *
 * **Back to a step** is for a fault in the *route*, not in the document: the
 * wrong file was attached, a step was seated with the wrong people, an answer
 * was recorded against the wrong step. The same revision goes round again,
 * which is only honest when the revision was never the problem. So it asks for
 * a reason from the published list, and the list is the organization's to keep.
 */
export function ReturnTarget({ steps, reasons, verdict }: {
  steps: ReturnStep[];
  reasons: ReturnReason[];
  /** The verdict that asked for changes: it already says why, with the comments written under it. */
  verdict?: string | null;
}) {
  const [toStep, setToStep] = useState("");
  const [code, setCode] = useState("");
  const rewinding = toStep !== "";
  // Back to its author after a verdict that asked for changes: the verdict and its comments are the reason.
  const said = !rewinding && !!verdict;
  const chosen = reasons.find((one) => one.code === code);

  return (
    <>
      <Field label="Back to" required hint={rewinding ? "the same revision goes round again from that step" : "the revision is kept as it stands; the next one replaces it"}>
        <Select name="toStep" value={toStep} onChange={(event) => setToStep(event.target.value)} className={inputCls}>
          <option value="">Its author — they prepare the next revision</option>
          {steps.map((step) => <option key={step.number} value={step.number}>{step.number}. {step.title}</option>)}
        </Select>
      </Field>

      {rewinding ? (
        <Field label="What went wrong with the route" required hint="only a fault in the route sends the same revision round again — a document that is wrong is replaced by the next revision">
          <Select name="returnReason" required value={code} onChange={(event) => setCode(event.target.value)} className={inputCls}>
            <option value="" disabled>Choose…</option>
            {reasons.map((one) => <option key={one.code} value={one.code}>{one.label}</option>)}
          </Select>
          {chosen?.meaning ? <span className="mt-1.5 block text-[11px] text-slate-500">{chosen.meaning}</span> : null}
        </Field>
      ) : null}

      <Field
        label={rewinding || said ? "Anything to add" : "Why"}
        required={!rewinding && !said}
        hint={said ? `verdict ${verdict} and the comments written with it go with it; whoever gets it is told, and so is everyone on the route` : "whoever gets it is told, and so is everyone else who was on the route"}
      >
        <textarea name="reason" rows={3} required={!rewinding && !said} className={inputCls} placeholder={rewinding || said ? "optional — the detail, if the reason above does not say it all" : "what is wrong, so the next revision answers it"} />
      </Field>
    </>
  );
}
