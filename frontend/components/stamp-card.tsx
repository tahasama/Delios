"use client";

import { useActionState } from "react";
import { StampFields } from "@/components/stamp-fields";
import { setStampAction } from "@/lib/settings/forms-how-it-works";
import type { StampAnswers } from "@/lib/settings/stamp";

/**
 * The stamp card, the same at both levels (owner: "the same cards"): the organization's (every project's default) or a
 * project's (where the organization leaves it free). One form, saved as one; read only for whoever may not change it.
 */
export function StampCard({ initial, level, editable, lead, pane }: {
  initial: StampAnswers;
  level: "organization" | "project";
  editable: boolean;
  lead: React.ReactNode;
  /** The preview's width, as the person left it. */
  pane: number | null;
}) {
  const [state, formAction, pending] = useActionState(setStampAction, undefined);
  return (
    <section className="register register-sheet register-sheet-open">
      <div className="px-5 pt-6 pb-4 sm:px-6">
        <h1 className="plate-name">The stamp</h1>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
          What a review&rsquo;s decision puts on the PDF people open: an engagement that holds, the same on every document.
        </p>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-600">{lead}</p>
      </div>
      <form action={formAction}>
        <input type="hidden" name="level" value={level} />
        <StampFields initial={initial} disabled={!editable} pane={pane} />
        {editable ? (
          <div className="flex items-center gap-3 border-t border-line px-5 py-3 sm:px-6">
            <button type="submit" disabled={pending} data-on="true" className="ask">{pending ? "Saving…" : "Save the stamp"}</button>
            {state?.error ? <p role="alert" className="text-xs text-red-700">{state.error}</p> : state?.ok ? <p className="text-xs text-emerald-700">{state.ok}</p> : null}
          </div>
        ) : null}
      </form>
    </section>
  );
}
