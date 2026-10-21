"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";
import { StampFields, type StampValues } from "@/components/stamp-fields";
import { setStampAction } from "@/lib/settings/forms-how-it-works";

/**
 * The stamp in the Control room: one block, saved as one, the same for every document released after its review.
 * Read only for whoever may not change it, and where the organization keeps it.
 */
export function StampForm({ initial, readOnly, fixed, stamped }: { initial: StampValues; readOnly: boolean; fixed: boolean; stamped: boolean }) {
  const [state, formAction, pending] = useActionState(setStampAction, undefined);
  const locked = readOnly || fixed;
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <p className="text-[13px] font-medium text-slate-900">The stamp</p>
      <p className="mt-1 mb-3 text-xs leading-5 text-slate-600">
        {fixed ? <span className="mr-1.5 inline-flex items-center gap-1 font-medium text-slate-500"><Lock className="h-3 w-3" aria-hidden />The organization&rsquo;s, on every project.</span> : null}
        Put on a revision released after it went for review, on every page; released without a review, there is nothing to stamp.
        {stamped ? "" : " The PDF is not stamped on this project (above): it applies once it is."}
      </p>
      <form action={formAction}>
        <StampFields initial={initial} disabled={locked} />
        {locked ? null : (
          <div className="mt-3 flex items-center gap-3">
            <button type="submit" disabled={pending} data-on="true" className="ask">{pending ? "Saving…" : "Save the stamp"}</button>
            {state?.error ? <p role="alert" className="text-xs text-red-700">{state.error}</p> : state?.ok ? <p className="text-xs text-emerald-700">{state.ok}</p> : null}
          </div>
        )}
      </form>
    </li>
  );
}
