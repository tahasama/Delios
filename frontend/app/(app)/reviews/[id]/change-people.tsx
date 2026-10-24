"use client";

import { Field, inputCls } from "@/components/ui";
import { SearchPick } from "@/components/search-pick";
import { ActionForm } from "@/components/form";
import { delegateReviewAction, informReviewAction } from "@/lib/reviews/forms-delegation";
import type { StepPeopleOptions } from "@/lib/reviews/delegation";

type Candidate = { id: string; name: string; functionName: string; inMatrix: boolean };

/*
 * The control function and whoever holds Manage, on a review in flow (owner): "Delegate?" hands over the step of
 * somebody on the open step, to anyone on the project; "Inform?" copies people in. Each opens folded under the document,
 * from its link in the title, as Withdraw and Notify do. Why is optional (owner: "mostly it is someone forgotten").
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
        <SearchPick name="toUserId" single required label="Who answers it instead" hint="anyone on the project; the matrix's people first"
          items={candidates.map((one) => ({ id: one.id, name: one.name, detail: one.inMatrix ? one.functionName : `${one.functionName} · not in the matrix for this` }))} />
        <Field label="Until" required>
          <input type="date" name="endDate" required defaultValue={inWeek} className={inputCls} />
        </Field>
        <Field label="Why" hint="optional; they, and whoever takes it, read it">
          <input name="reason" className={inputCls} />
        </Field>
      </div>
      <p className="text-[11px] leading-4 text-slate-500">
        {throughControl ? "It starts once the control function lets it." : "It takes effect at once."} Both are told; the record says you handed it over.
      </p>
    </ActionForm>
  );
}

/** Copy people in: told of what comes of it, never asked to answer. */
export function CopyInForm({ cycleId, people }: { cycleId: string; people: StepPeopleOptions }) {
  const copied = new Set(people.copied ?? []);
  return (
    <ActionForm action={informReviewAction} submitLabel="Inform them" size="sm" hidden={{ cycleId }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <SearchPick name="copyUserIds" required label="Who is informed" hint="told of what comes of it, never asked to answer"
          items={(people.people ?? []).filter((one) => !copied.has(one.id)).map((one) => ({ id: one.id, name: one.name }))} />
        <Field label="Why" hint="optional">
          <input name="reason" className={inputCls} />
        </Field>
      </div>
    </ActionForm>
  );
}
