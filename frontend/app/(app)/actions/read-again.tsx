"use client";

import { useActionState } from "react";
import { btn } from "@/components/ui";
import { readScheduleAgainAction } from "@/lib/actions/forms-lists";

/** "Read rev X again": the schedule's released revision read again, as the app reads it now (its WBS, what happened). */
export function ReadAgain({ revision }: { revision: string }) {
  const [state, action, pending] = useActionState(readScheduleAgainAction, undefined);
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-2 font-sans text-[11px] font-normal">
      <form action={action}>
        <button type="submit" disabled={pending} className={btn("secondary", "sm")}>{pending ? "Reading…" : `Read rev ${revision} again`}</button>
      </form>
      {state?.error ? <span className="text-rose-700">{state.error}</span> : state?.ok ? <span className="text-emerald-700">{state.ok}</span> : null}
    </span>
  );
}
