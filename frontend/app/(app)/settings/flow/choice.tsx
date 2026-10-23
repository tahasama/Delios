"use client";

import { useActionState, useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { inputCls } from "@/components/ui";
import { cn } from "@/lib/core/utils";

type State = { error?: string; ok?: string } | undefined;
export type ChoiceOption = { value: string; label: string; text: string };

/**
 * One answer of the Control room, changed where it is read: its title, its answers side by side, and what the one in
 * force means. Choosing another does not save: it says plainly what will change and waits to be confirmed. A number (of
 * days) is typed in its field on the same line and saved beside it, Save lit only once it differs.
 */
export function Choice({ title, options, value, action, hidden, field = "value", unit, min, max, readOnly = false, fixed = false, exception, mark }: {
  title: string;
  /** The answers to choose among; none for a number of days. */
  options?: ChoiceOption[];
  value: string;
  action: (prev: State, data: FormData) => Promise<State>;
  /** What the action needs besides the answer (its key, another answer it saves with). */
  hidden: Record<string, string>;
  /** The field the answer is sent as. */
  field?: string;
  /** For a number: what it counts ("days"), and its bounds. */
  unit?: string;
  min?: number;
  max?: number;
  readOnly?: boolean;
  /** The organization keeps it the same on every project. */
  fixed?: boolean;
  /** The organization keeps it the same on every other project, and leaves this one free: why. */
  exception?: string;
  /** Said beside the title: where the answer comes from ("ours", the app's own…). */
  mark?: React.ReactNode;
}) {
  const [asked, setAsked] = useState<string | null>(null);
  const [typed, setTyped] = useState(value);
  const [state, formAction, pending] = useActionState(action, undefined);
  useEffect(() => { if (state?.ok) setAsked(null); }, [state]);
  useEffect(() => { setTyped(value); }, [value]);
  const locked = readOnly || fixed;
  const current = options?.find((one) => one.value === value);
  const shown = options?.find((one) => one.value === asked);

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 text-[13px] font-medium text-slate-900">{title}{mark ? <> {mark}</> : null}</p>
        {options ? (
          <span className="choice" role="group" aria-label={title}>
            {options.map((one) => (
              <button
                key={one.value}
                type="button"
                disabled={locked && one.value !== value}
                aria-pressed={(asked ?? value) === one.value}
                onClick={() => { if (!locked) setAsked(one.value === value ? null : one.value); }}
                className={cn("choice-side", (asked ?? value) === one.value && "choice-on", asked === one.value && "choice-asked")}
              >
                {one.label}
              </button>
            ))}
          </span>
        ) : locked ? (
          <span className="text-[13px] font-semibold text-slate-900">{value} {unit}</span>
        ) : (
          // A number is typed where it is read and saved beside it (owner: no form of its own for a number of days).
          <form action={formAction} className="flex items-center gap-2 text-[13px] text-slate-700">
            {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input name={field} type="number" min={min} max={max} required value={typed} onChange={(e) => setTyped(e.target.value)}
              aria-label={`${title} (${unit})`} className={cn(inputCls, "w-20")} />
            <span>{unit}</span>
            <button type="submit" disabled={pending || typed === value} data-on={typed !== value ? "true" : undefined} className="ask disabled:opacity-50">
              {pending ? "Saving…" : "Save"}
            </button>
          </form>
        )}
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-600">
        {fixed ? <span className="mr-1.5 inline-flex items-center gap-1 font-medium text-slate-500"><Lock className="h-3 w-3" aria-hidden />The organization&rsquo;s, on every project.</span> : null}
        {exception && !fixed ? <span className="mr-1.5 font-medium text-slate-500" title={exception}>Free here by an exception: every other project takes the organization&rsquo;s (&ldquo;{exception}&rdquo;).</span> : null}
        {current?.text}
      </p>

      {asked !== null && options && !locked ? (
        <form action={formAction} className="choice-confirm mt-2 space-y-2 rounded-md px-3 py-2.5">
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name={field} value={asked} />
          <p className="text-xs leading-5 text-slate-700"><span className="font-semibold text-slate-900">From now on: </span>{shown?.label}. {shown?.text}</p>
          <p className="text-xs leading-5 text-slate-500">Instead of: {current?.label}. Only this answer changes.</p>
          {state?.error ? <p role="alert" className="text-xs text-red-700">{state.error}</p> : null}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={pending} data-on="true" className="ask">{pending ? "Saving…" : "Switch it"}</button>
            <button type="button" onClick={() => setAsked(null)} className="ask">Keep as is</button>
          </div>
        </form>
      ) : state?.error && !options ? (
        <p role="alert" className="mt-1 text-xs text-red-700">{state.error}</p>
      ) : state?.ok ? (
        <p role="status" className="mt-1 text-xs text-emerald-700">{state.ok}</p>
      ) : null}
    </li>
  );
}
