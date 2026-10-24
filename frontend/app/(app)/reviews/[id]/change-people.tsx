"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";
import { SearchPick } from "@/components/search-pick";
import { Select } from "@/components/select";
import { ActionForm } from "@/components/form";
import { delegateReviewAction, addReviewPeopleAction } from "@/lib/reviews/forms-delegation";
import type { StepPeopleOptions } from "@/lib/reviews/delegation";

type Candidate = { id: string; name: string; functionName: string; inMatrix: boolean };

/**
 * Who answers, changed in flow (owner: the control function and whoever holds Manage "should be able to delegate a
 * step", "or add someone forgotten or cc"): hand over the seat of somebody on the open step who has not answered, or
 * add people to a step not done yet, or copy people in. Always with why; steps already answered never change.
 */
export function ChangePeople({ cycleId, seats, candidates, throughControl, people }: {
  cycleId: string;
  seats: { id: string; name: string }[];
  candidates: Candidate[];
  throughControl: boolean;
  people: StepPeopleOptions;
}) {
  const [open, setOpen] = useState<"hand" | "add" | null>(null);
  const steps = people.open ? people.steps ?? [] : [];
  const [step, setStep] = useState(String(steps[0]?.number ?? ""));
  const onStep = new Set(steps.find((one) => String(one.number) === step)?.on ?? []);
  const copied = new Set(people.copied ?? []);
  const inWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const mayHand = seats.length > 0 && candidates.length > 0;
  const mayAdd = people.open && (people.people?.length ?? 0) > 0;
  if (!mayHand && !mayAdd) return null;

  return (
    <section className="register register-sheet">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
        <h2 className="stencil shrink-0 text-slate-500">Who answers</h2>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {mayHand ? (
            <button type="button" className="ask py-1! text-xs!" data-on={open === "hand" ? "true" : undefined} onClick={() => setOpen(open === "hand" ? null : "hand")}>
              Hand over someone&apos;s step
            </button>
          ) : null}
          {mayAdd ? (
            <button type="button" className="ask py-1! text-xs!" data-on={open === "add" ? "true" : undefined} onClick={() => setOpen(open === "add" ? null : "add")}>
              Add someone or copy in
            </button>
          ) : null}
        </div>
      </header>
      <div className="px-5 py-3 sm:px-6">
        {open === null ? (
          <p className="text-xs leading-5 text-slate-500">
            For someone away, or forgotten: hand over a seat on the open step, add people to a step not done yet, or copy people in. Steps already answered stay as they are.
          </p>
        ) : null}

        {open === "hand" ? (
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
        ) : null}

        {open === "add" ? (
          <ActionForm action={addReviewPeopleAction} submitLabel="Add them" size="sm" hidden={{ cycleId }}>
            <div className="grid gap-3 sm:grid-cols-2">
              {steps.length ? (
                <Field label="To step" hint="the open step, or one still to come">
                  <Select name="step" value={step} onChange={(e) => setStep(e.target.value)} className={inputCls}>
                    {steps.map((one) => (
                      <option key={one.number} value={one.number}>{`Step ${one.number} · ${one.title}${one.state === "OPEN" ? " (open now)" : ""}`}</option>
                    ))}
                  </Select>
                </Field>
              ) : <div />}
              {steps.length ? (
                <SearchPick key={step} name="userIds" label="Who answers it too" hint="seated at once on the open step"
                  items={(people.people ?? []).filter((one) => !onStep.has(one.id)).map((one) => ({ id: one.id, name: one.name }))} />
              ) : null}
              <SearchPick name="copyUserIds" label="Copy in" hint="told of what comes of it, never asked to answer"
                items={(people.people ?? []).filter((one) => !copied.has(one.id)).map((one) => ({ id: one.id, name: one.name }))} />
              <Field label="Why" required hint="they, and the record, read it">
                <input name="reason" required className={inputCls} />
              </Field>
            </div>
            <p className="text-[11px] leading-4 text-slate-500">
              Each is told. Where everyone on the step answers, it waits for them too. Nobody is taken off: hand their step over instead.
            </p>
          </ActionForm>
        ) : null}
      </div>
    </section>
  );
}
