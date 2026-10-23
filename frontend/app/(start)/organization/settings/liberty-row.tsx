"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Switch } from "@/components/switch";
import { Select } from "@/components/select";
import { inputCls } from "@/components/ui";
import { setLibertyAction, setLibertyExceptionAction } from "@/lib/organization/forms";
import type { LibertyItem } from "@/lib/organization/liberty";
import { cn, fmtDate } from "@/lib/core/utils";

type State = { error?: string; ok?: string; fields?: string[] } | undefined;
export type ProjectChoice = { id: string; code: string; name: string };

/**
 * One switch of the organization's Settings: may projects change it? Pressing it does not save: it says plainly what
 * changes for every project and waits to be confirmed, as the Control room's answers do. A refusal is said under it.
 * Fixed, it lists the projects it leaves free all the same (owner: "Fixed, except on these projects"), each with why,
 * and makes another one an exception, or ends one, always with why.
 */
export function LibertyRow({ item, projects, children, className }: {
  item: LibertyItem; projects: ProjectChoice[]; children: React.ReactNode; className?: string;
}) {
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
              : <>every project uses the organization&rsquo;s {item.title} as it is, except the projects you name below.</>}
          </p>
          <p className="text-xs leading-5 text-slate-500">
            {freeing
              ? <>Instead of: every project uses the organization&rsquo;s as it is{item.except.length ? `, except ${item.except.map((e) => e.projectCode).join(", ")}` : ""}.</>
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
      {!item.free && !item.locked ? <Exceptions item={item} projects={projects} /> : null}
    </li>
  );
}

/** The projects a fixed switch leaves free, and making one more an exception, or ending one. */
function Exceptions({ item, projects }: { item: LibertyItem; projects: ProjectChoice[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(setLibertyExceptionAction, undefined as State);
  useEffect(() => { if (state?.ok) setOpen(null); }, [state]);
  const others = projects.filter((p) => !item.except.some((e) => e.projectId === p.id));
  const ending = open && open !== "add" ? item.except.find((e) => e.projectId === open) : null;
  const missing = (field: string) => state?.fields?.includes(field) || undefined;

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] leading-4 text-slate-600">
        {item.except.length ? <span className="font-medium text-slate-700">Except on</span> : null}
        {item.except.map((e) => (
          <span key={e.projectId} className="inline-flex items-center gap-1" title={`${e.reason} · ${e.by}, ${fmtDate(e.at)}`}>
            <span className="font-mono font-semibold text-slate-800">{e.projectCode}</span>
            <span className="text-slate-500">{e.reason}</span>
            <button type="button" onClick={() => setOpen(open === e.projectId ? null : e.projectId)}
              title={`End ${e.projectCode}'s exception`} aria-label={`End ${e.projectCode}'s exception`}
              className="grid h-4 w-4 place-items-center rounded text-slate-400 hover:bg-tint hover:text-red-700">
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
        {others.length ? (
          <button type="button" onClick={() => setOpen(open === "add" ? null : "add")} className="inline-flex items-center gap-1 font-medium text-link hover:underline">
            <Plus className="h-3 w-3" aria-hidden /> {item.except.length ? "Another project" : "Except a project"}
          </button>
        ) : null}
      </div>
      {open ? (
        <form action={formAction} className="choice-confirm mt-2 space-y-2 rounded-md px-3 py-2.5">
          <input type="hidden" name="key" value={item.key} />
          <input type="hidden" name="except" value={ending ? "0" : "1"} />
          {ending ? (
            <>
              <input type="hidden" name="projectId" value={ending.projectId} />
              <p className="text-xs leading-5 text-slate-700">
                <span className="font-semibold text-slate-900">From now on: </span>
                {ending.projectCode} takes the organization&rsquo;s {item.title}, as every other project. What it already changed stays; nothing more can be changed there.
              </p>
            </>
          ) : (
            <>
              <p className="text-xs leading-5 text-slate-700">
                <span className="font-semibold text-slate-900">From now on: </span>
                the project you choose may take its own copy of {item.title}; every other project still takes the organization&rsquo;s. Its control function is told.
              </p>
              <div data-missing={missing("projectId")} className="max-w-sm">
                <Select name="projectId" defaultValue="" aria-label="Which project" required>
                  <option value="" disabled>Which project</option>
                  {others.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </Select>
              </div>
            </>
          )}
          <input name="reason" required placeholder={ending ? "Why it ends" : "Why this project needs it"} aria-label="Why"
            data-missing={missing("reason")} className={cn(inputCls, "max-w-xl")} />
          {state?.error ? <p role="alert" className="text-xs text-red-700">{state.error}</p> : null}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={pending} data-on="true" className="ask">{pending ? "Saving…" : ending ? "End the exception" : "Make it an exception"}</button>
            <button type="button" onClick={() => setOpen(null)} className="ask">Cancel</button>
          </div>
        </form>
      ) : state?.ok ? (
        <p className="mt-1 text-xs text-emerald-700">{state.ok}</p>
      ) : null}
    </div>
  );
}
