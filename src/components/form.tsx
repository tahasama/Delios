"use client";

import { useActionState, useState } from "react";
import { cn } from "@/lib/utils";
import { btn } from "./ui";
import { collectInvalid, type MissingField } from "./form-validation";

type State = { error?: string; ok?: string; issues?: { line: number; message: string }[] };

/** What is missing, said out loud rather than left to a tooltip off-screen. */
export function MissingSummary({ missing }: { missing: MissingField[] }) {
  if (!missing.length) return null;
  return (
    <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
      <p className="text-xs font-semibold text-amber-900">
        {missing.length === 1 ? "One thing is missing" : `${missing.length} things are missing`} before this can be sent
      </p>
      <ul className="mt-1 space-y-0.5">
        {missing.map((m, i) => (
          <li key={`${m.label}-${i}`} className="text-[11px] text-amber-800">
            <span className="font-medium">{m.label}</span> — {m.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  variant = "primary",
  size = "md",
  className,
  resetOnSuccess,
  confirmText,
  hidden,
  hideSubmit,
  id,
}: {
  action: (prev: State | undefined, formData: FormData) => Promise<State>;
  children?: React.ReactNode;
  submitLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md";
  className?: string;
  resetOnSuccess?: boolean;
  confirmText?: string;
  hidden?: Record<string, string>;
  /**
   * For multi-step forms that render their own Back/Continue/Finish footer.
   * Without this the form shows a second submit button on every step, which on
   * a wizard means a button labelled "Continue" that actually submits.
   */
  hideSubmit?: boolean;
  /** Lets fields elsewhere on the page belong to this form, through their `form` attribute. */
  id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [missing, setMissing] = useState<MissingField[]>([]);

  return (
    <form
      id={id}
      action={formAction}
      className={cn("space-y-3", className)}
      noValidate
      onSubmit={(e) => {
        // `noValidate` above turns off the browser's own tooltip so this is the
        // only report, which means it cannot be hidden below the fold.
        const found = collectInvalid(e.currentTarget);
        if (found.length) {
          e.preventDefault();
          setMissing(found);
          return;
        }
        setMissing([]);
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
      key={resetOnSuccess && state?.ok ? String(state.ok) : "form"}
    >
      {hidden
        ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)
        : null}
      {children}

      <MissingSummary missing={missing} />

      {state?.error ? (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2">
          <p className="text-xs text-red-700">{state.error}</p>
          {state.issues?.length ? (
            <ul className="scroll-thin mt-1.5 max-h-40 space-y-0.5 overflow-y-auto">
              {state.issues.map((issue, i) => (
                <li key={i} className="text-[11px] text-red-600">
                  {issue.line > 0 ? <span className="font-mono font-medium">line {issue.line}: </span> : null}
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {state?.ok ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{state.ok}</p> : null}

      {hideSubmit ? null : (
        <button type="submit" disabled={pending} className={cn(btn(variant, size))}>
          {pending ? "Working…" : submitLabel}
        </button>
      )}
    </form>
  );
}
