"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";
import { SearchPick } from "@/components/search-pick";
import { Select } from "@/components/select";
import { ActionForm } from "@/components/form";
import { delegateReviewAction, addReviewPeopleAction } from "@/lib/reviews/forms-delegation";
import type { StepPeopleOptions } from "@/lib/reviews/delegation";

type Candidate = { id: string; name: string; functionName: string; inMatrix: boolean };

/*
 * Who answers, changed in flow (owner: the control function and whoever holds Manage "should be able to delegate a
 * step", "or add someone forgotten or cc"): each form opens folded under the document, from its link in the title
 * ("Delegate?", "Add someone?", "Inform?"), as Withdraw and Notify do. Always with why; steps already answered never change.
 */

/** Hand over the seat of somebody on the open step who has not answered. */
export function HandOverForm({ cycleId, seats, candidates, throughControl }: {
  cycleId: string;
  seats: { id: string; name: string }[];
  candidates: Candidate[];
  throughControl: boolean;
}) {
  const inWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return (
    <ActionForm action={delegateReviewAction} submitLabel={throughControl ? "Ask the control function" : "Hand it over"} size="sm" hidden={{ cycleId }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <SearchPick name="fromUserId" single required label="Whose step" hint="on the open step, not answered yet"
          items={seats.map((one) => ({ id: one.id, name: one.name }))} />
        <SearchPick name="toUserId" single required label="Who answers it instead" hint="the matrix's people first; anyone else is flagged"
          items={candidates.map((one) => ({ id: one.id, name: one.name, detail: one.inMatrix ? one.functionName : `${one.functionName} · not in the matrix for this` }))} />
        <Field label="Until" required>
          <input type="date" name="endDate" required defaultValue={inWeek} className={inputCls} />
        </Field>
        <Field label="Why" required hint="they, and whoever takes it, read it">
          <input name="reason" required className={inputCls} />
        </Field>
      </div>
      <p className="text-[11px] leading-4 text-slate-500">
        {throughControl ? "It starts once the control function lets it." : "It takes effect at once."} Both are told; the record says you handed it over.
      </p>
    </ActionForm>
  );
}

/** Add people to the open step, or to one still to come. */
export function AddToStepForm({ cycleId, people }: { cycleId: string; people: StepPeopleOptions }) {
  const steps = people.steps ?? [];
  const [step, setStep] = useState(String(steps[0]?.number ?? ""));
  const onStep = new Set(steps.find((one) => String(one.number) === step)?.on ?? []);
  return (
    <ActionForm action={addReviewPeopleAction} submitLabel="Add them" size="sm" hidden={{ cycleId }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="To step" hint="the open step, or one still to come">
          <Select name="step" value={step} onChange={(e) => setStep(e.target.value)} className={inputCls}>
            {steps.map((one) => (
              <option key={one.number} value={one.number}>{`Step ${one.number} · ${one.title}${one.state === "OPEN" ? " (open now)" : ""}`}</option>
            ))}
          </Select>
        </Field>
        <SearchPick key={step} name="userIds" required label="Who answers it too" hint="seated at once on the open step"
          items={(people.people ?? []).filter((one) => !onStep.has(one.id)).map((one) => ({ id: one.id, name: one.name }))} />
        <Field label="Why" required hint="they, and the record, read it">
          <input name="reason" required className={inputCls} />
        </Field>
      </div>
      <p className="text-[11px] leading-4 text-slate-500">
        Each is told. Where everyone on the step answers, it waits for them too. Nobody is taken off: delegate their step instead.
      </p>
    </ActionForm>
  );
}

/** Copy people in: told of what comes of it, never asked to answer. */
export function CopyInForm({ cycleId, people }: { cycleId: string; people: StepPeopleOptions }) {
  const copied = new Set(people.copied ?? []);
  return (
    <ActionForm action={addReviewPeopleAction} submitLabel="Copy them in" size="sm" hidden={{ cycleId }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <SearchPick name="copyUserIds" required label="Who is informed" hint="told of what comes of it, never asked to answer"
          items={(people.people ?? []).filter((one) => !copied.has(one.id)).map((one) => ({ id: one.id, name: one.name }))} />
        <Field label="Why" required hint="they, and the record, read it">
          <input name="reason" required className={inputCls} />
        </Field>
      </div>
    </ActionForm>
  );
}
