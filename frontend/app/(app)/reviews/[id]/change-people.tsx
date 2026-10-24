"use client";

import { Field, inputCls } from "@/components/ui";
import { SearchPick } from "@/components/search-pick";
import { ActionForm } from "@/components/form";
import { informReviewAction } from "@/lib/reviews/forms-delegation";
import type { StepPeopleOptions } from "@/lib/reviews/delegation";

/*
 * Cc on a review in flow (owner: "people need to understand they are not delegating, just adding as cc"): the control
 * function and whoever holds Manage cc people, from "Cc?" in the review's title, as Withdraw and Notify; why optional
 * ("mostly it is someone forgotten"). Delegating is the answer card's Delegate.
 */

/** Cc people: told of what comes of it, never asked to answer. */
export function CopyInForm({ cycleId, people }: { cycleId: string; people: StepPeopleOptions }) {
  const copied = new Set(people.copied ?? []);
  return (
    <ActionForm action={informReviewAction} submitLabel="Cc them" size="sm" hidden={{ cycleId }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <SearchPick name="copyUserIds" required label="Cc" hint="kept informed of what comes of it, never asked to review"
          items={(people.people ?? []).filter((one) => !copied.has(one.id)).map((one) => ({ id: one.id, name: one.name }))} />
        <Field label="Why" hint="optional">
          <input name="reason" className={inputCls} />
        </Field>
      </div>
    </ActionForm>
  );
}
