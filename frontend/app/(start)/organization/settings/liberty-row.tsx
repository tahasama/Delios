"use client";

import { useActionState, useEffect, useState } from "react";
import { Switch } from "@/components/switch";
import { setLibertyAction } from "@/lib/organization/forms";
import type { LibertyItem } from "@/lib/organization/liberty";

type State = { error?: string; ok?: string } | undefined;

/**
 * One switch of the organization's Settings: may projects change it? Pressing it does not save: it says plainly what
 * changes for every project and waits to be confirmed, as the Control room's answers do. A refusal is said under it.
 */
export function LibertyRow({ item, children, className }: { item: LibertyItem; children: React.ReactNode; className?: string }) {
  const [asked, setAsked] = useState(false);
  const [state, formAction, pending] = useActionState(setLibertyAction, undefined as State);
  useEffect(() => { if (state?.ok) setAsked(false); }, [state]);
  const freeing = !item.free;

  return (
    <li className={className}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">{children}</div>
        <Switch on={item.free} words={["Free", "Fixed"]} disabled={!!item.locked} label={`Projects may change ${item.title}`}
          onToggle={() => setAsked(!asked)} />
      </div>
      {asked ? (
        <form action={formAction} className="choice-confirm mt-2 space-y-2 rounded-md px-3 py-2.5">
          <input type="hidden" name="key" value={item.key} />
          <input type="hidden" name="free" value={freeing ? "1" : "0"} />
          <p className="text-xs leading-5 text-slate-700">
            <span className="font-semibold text-slate-900">From now on: </span>
            {freeing
              ? <>a project may take its own copy of {item.title}. Its first change makes the copy; what the organization changes later no longer reaches it.</>
              : <>every project uses the organization&rsquo;s {item.title} as it is.</>}
          </p>
          <p className="text-xs leading-5 text-slate-500">
            {freeing
              ? <>Instead of: every project uses the organization&rsquo;s as it is.</>
              : <>Instead of: a project may take its own copy. A project that already has one keeps it; only putting it back, on this card, changes that.</>}
          </p>
          {state?.error ? <p role="alert" className="text-xs text-red-700">{state.error}</p> : null}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={pending} data-on="true" className="ask">{pending ? "Saving…" : freeing ? "Free it" : "Fix it"}</button>
            <button type="button" onClick={() => setAsked(false)} className="ask">Keep as is</button>
          </div>
        </form>
      ) : state?.ok ? (
        <p className="mt-1 text-xs text-emerald-700">{state.ok}</p>
      ) : null}
    </li>
  );
}
