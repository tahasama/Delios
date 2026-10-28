"use client";

import { useActionState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/core/utils";

type State = { error?: string; message?: string } | undefined;

/**
 * An act an icon says plainly (owner: "proper separate icons like a normal sane organisation does"): one press, asked
 * first when it changes much (`confirm`), its words on hover and for screen readers, a refusal said beside it.
 */
export function IconAct({ action, icon: Icon, label, confirm, hidden, danger }: {
  action: (prev: State, formData: FormData) => Promise<State>;
  icon: LucideIcon;
  label: string;
  confirm?: string;
  hidden: Record<string, string>;
  danger?: boolean;
}) {
  const [state, act, pending] = useActionState(action, undefined);
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
