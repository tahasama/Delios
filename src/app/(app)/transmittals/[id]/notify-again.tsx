"use client";

import { useEffect, useState } from "react";
import { ActionForm } from "@/components/form";

type State = { error?: string; ok?: string };

/**
 * Notifying again whoever it was addressed to and who has not opened it. The
 * boxes sit on their own rows in the list above, and belong to this form
 * through their `form` attribute; this strip holds the box that ticks all of
 * them, how many are ticked, and the button.
 */
export function NotifyAgain({ action, transmittalId, waiting }: {
  action: (prev: State | undefined, formData: FormData) => Promise<State>;
  transmittalId: string;
  /** How many addressed people have not opened it. */
  waiting: number;
}) {
  const formId = `notify-again-${transmittalId}`;
  const [ticked, setTicked] = useState(0);
  const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[form="${formId}"][name="recipientIds"]`)];

  useEffect(() => {
    const count = () => setTicked(boxes().filter((one) => one.checked).length);
    document.addEventListener("change", count);
    count();
    return () => document.removeEventListener("change", count);
  });

  const all = ticked > 0 && ticked === waiting;
  return (
    <ActionForm action={action} hideSubmit hidden={{ transmittalId }} id={formId} className="space-y-0">
      <div className="asking flex flex-wrap items-center gap-3 border-t border-line px-5 py-3 sm:px-6">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
          <input
            type="checkbox"
            checked={all}
            ref={(el) => { if (el) el.indeterminate = ticked > 0 && !all; }}
            onChange={(event) => {
              for (const one of boxes()) one.checked = event.target.checked;
              setTicked(event.target.checked ? waiting : 0);
            }}
          />
          All who have not opened it
        </label>
        <span className="text-[11px] text-slate-500">
          {waiting === 1 ? "1 person has" : `${waiting} people have`} not opened it
          {ticked ? <> &middot; <span className="font-medium text-slate-700">{ticked} ticked</span></> : null}. Notifying them again is recorded.
        </span>
        <button className="ask ml-auto disabled:cursor-not-allowed disabled:opacity-50" disabled={!ticked} data-on={ticked ? "true" : undefined}>
          Notify again
        </button>
      </div>
    </ActionForm>
  );
}
