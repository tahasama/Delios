"use client";

import { useActionState, useEffect, useState } from "react";
import { setOneControlActivityAction } from "@/lib/actions/control-activities";
import { cn } from "@/lib/utils";

type Side = "CONTROL" | "SELF" | "OFF";

/**
 * One act, switched where it is shown. Choosing the other side does not save:
 * it says, in plain words, what will change, and waits to be confirmed.
 */
export function ActSwitch({ act, title, controlText, selfText, controlDoes, offText, off = false }: {
  act: string;
  title: string;
  controlText: string;
  selfText: string;
  controlDoes: boolean;
  /** What leaving the act out means — only for an act that may be left out. */
  offText?: string;
  off?: boolean;
}) {
  const current: Side = off ? "OFF" : controlDoes ? "CONTROL" : "SELF";
  const [asked, setAsked] = useState<Side | null>(null);
  const [state, formAction, pending] = useActionState(setOneControlActivityAction, undefined);

  // Once saved, the page comes back with the new answer; the question closes.
  useEffect(() => { if (state?.ok) setAsked(null); }, [state]);

  const text = (side: Side) => (side === "CONTROL" ? controlText : side === "SELF" ? selfText : offText ?? "");
  const side = (one: Side, label: string) => (
    <button
      type="button"
      onClick={() => setAsked(one === current ? null : one)}
      aria-pressed={(asked ?? current) === one}
      className={cn("act-side", one === "CONTROL" && "act-side-control", one === "OFF" && "act-side-off", (asked ?? current) === one && "act-side-on", asked === one && "act-side-asked")}
    >
      {label}
    </button>
  );

  return (
    <li>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="text-[13px] font-medium text-slate-900">{title}</span>
        <span className="act-switch" role="group" aria-label={`Who carries out: ${title}`}>
          {side("CONTROL", "Document Control")}
          {side("SELF", "The people doing the work")}
          {offText ? side("OFF", "Skip it") : null}
        </span>
      </div>
      <p className={cn("mt-1 text-xs leading-5", off ? "text-slate-500 italic" : "text-slate-600")}>{text(current)}</p>

      {asked ? (
        <form action={formAction} className="act-confirm mt-2 space-y-2 rounded-lg px-3 py-2.5">
          <input type="hidden" name="key" value={act} />
          <input type="hidden" name="mode" value={asked} />
          <p className="text-xs leading-5 text-slate-700">
            <span className="font-semibold text-slate-900">From now on: </span>{text(asked)}
          </p>
          <p className="text-[11px] leading-4 text-slate-500">
            Instead of: {text(current)} Only this act changes; the others stay as they are.
            {asked === "OFF" ? " Who would carry it out is kept for the day it is turned back on." : ""}
          </p>
          {state?.error ? <p role="alert" className="text-xs text-red-700">{state.error}</p> : null}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={pending} data-on="true" className="ask">{pending ? "Switching…" : "Switch it"}</button>
            <button type="button" onClick={() => setAsked(null)} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">Keep as is</button>
          </div>
        </form>
      ) : state?.ok ? (
        <p className="mt-1 text-[11px] text-emerald-700">{state.ok}</p>
      ) : null}
    </li>
  );
}
