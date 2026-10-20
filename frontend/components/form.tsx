"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/core/utils";
import { btn } from "./ui";
import { collectInvalid, fieldsNamed, markMissing, type MissingField } from "@/app/(public)/form-validation";

type State = { error?: string; ok?: string;
  /** Fields the server found missing or refused, by name: outlined on the form. */
  fields?: string[]; issues?: { line: number; message: string }[]; link?: { href: string; label: string } };

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

/** Puts what was written back into a form's fields, after React emptied it. */
function restore(form: HTMLFormElement, data: FormData) {
  for (const field of Array.from(form.elements)) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) || !field.name) continue;
    if (field instanceof HTMLInputElement && (field.type === "hidden" || field.type === "file" || field.type === "submit")) continue;
    const values = data.getAll(field.name).map(String);
    if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) field.checked = values.includes(field.value);
    else if (field instanceof HTMLSelectElement && field.multiple) for (const option of Array.from(field.options)) option.selected = values.includes(option.value);
    else if (values.length) field.value = values[0];
    // A dropdown drawn by the app (`Select`) shows what its hidden select holds once told.
    if (field instanceof HTMLSelectElement) field.dispatchEvent(new Event("delios:sync"));
  }
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
  footerClassName,
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
  /** Where the answer and the button sit, when the fields above them carry their own padding (a sheet's rows). */
  footerClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [missing, setMissing] = useState<MissingField[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  /** What was written when it was sent: React empties a form once its action answers, a refusal included. */
  const written = useRef<FormData | null>(null);
  // What the server named as missing is outlined, as what the screen found is.
  useEffect(() => {
    if (formRef.current && state?.fields?.length) markMissing(formRef.current, fieldsNamed(formRef.current, state.fields));
    // A refusal gives back everything written, to put right and send again (files, which cannot be set, aside).
    // React empties the form as the answer lands; given back just after, so it stays given back.
    const form = formRef.current;
    const data = written.current;
    if (form && data && (state?.error || state?.fields?.length)) requestAnimationFrame(() => restore(form, data));
  }, [state]);

  return (
    <form
      ref={formRef}
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
        if (confirmText && !window.confirm(confirmText)) { e.preventDefault(); return; }
        written.current = new FormData(e.currentTarget);
      }}
      key={resetOnSuccess && state?.ok ? String(state.ok) : "form"}
    >
      {hidden
        ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)
        : null}
      {children}

      <Footer className={footerClassName}>
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

        {state?.ok ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {state.ok}
            {state.link ? <> <a href={state.link.href} className="font-semibold underline">{state.link.label}</a></> : null}
          </p>
        ) : null}

        {hideSubmit ? null : (
          <button type="submit" disabled={pending} className={cn(btn(variant, size))}>
            {pending ? "Working…" : submitLabel}
          </button>
        )}
      </Footer>
    </form>
  );
}

/**
 * A submit button that asks first, for a plain server form whose act cannot be taken back in one click (removing a
 * route, retiring several values): the question says what happens, and Cancel leaves everything as it was.
 */
export function ConfirmButton({ confirm, children, ...rest }: { confirm: string; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="submit" {...rest} onClick={(e) => { if (!window.confirm(confirm)) e.preventDefault(); }}>
      {children}
    </button>
  );
}

/** The answer and the button of a form: as they are, or in a strip of their own. */
function Footer({ className, children }: { className?: string; children: React.ReactNode }) {
  return className ? <div className={cn("space-y-3", className)}>{children}</div> : <>{children}</>;
}
