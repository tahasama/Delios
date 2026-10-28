"use client";

import { useActionState } from "react";
import { ArrowUpLeft, Trash2 } from "lucide-react";
import { cn } from "@/lib/core/utils";

type State = { error?: string; message?: string } | undefined;

/**
 * An act an icon says plainly (owner: "proper separate icons like a normal sane organisation does"): one press, asked
 * first when it changes much (`confirm`), its words on hover and for screen readers, a refusal said beside it.
 */
/** The icons it draws, named: a server page may not hand a component itself to the browser. */
const ICONS = { "move-out": ArrowUpLeft, remove: Trash2 } as const;

export function IconAct({ action, icon, label, confirm, hidden, danger }: {
  action: (prev: State, formData: FormData) => Promise<State>;
  icon: keyof typeof ICONS;
  label: string;
  confirm?: string;
  hidden: Record<string, string>;
  danger?: boolean;
}) {
  const [state, act, pending] = useActionState(action, undefined);
  const Icon = ICONS[icon];
  return (
    <form action={act} onSubmit={(event) => { if (confirm && !window.confirm(confirm)) event.preventDefault(); }} className="inline-flex items-center gap-1.5">
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <button type="submit" disabled={pending} title={label} aria-label={label}
        className={cn("ask inline-flex items-center px-2!", danger && "text-red-700 hover:text-red-800")}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </button>
      {state?.error ? <span role="alert" className="text-[11px] text-red-700">{state.error}</span> : null}
    </form>
  );
}

/**
 * The same one-press act with its words, drawn as the buttons beside it (`.ask`, left-aligned) in a red outline: Delete
 * in a package's Next step (owner: "should look like the others, not centered, outline red").
 */
export function DangerAct({ action, label, confirm, hidden }: {
  action: (prev: State, formData: FormData) => Promise<State>;
  label: string;
  confirm: string;
  hidden: Record<string, string>;
}) {
  const [state, act, pending] = useActionState(action, undefined);
  return (
    <form action={act} onSubmit={(event) => { if (!window.confirm(confirm)) event.preventDefault(); }} className="w-full">
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <button type="submit" disabled={pending}
        className="ask w-full justify-between whitespace-nowrap text-left border-red-300! text-red-700! hover:bg-red-50! dark:border-red-800! dark:text-red-300!">
        <span className="truncate">{label}</span>
        <Trash2 className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
      </button>
      {state?.error ? <p role="alert" className="mt-1 text-[11px] text-red-700">{state.error}</p> : null}
    </form>
  );
}
