"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/core/utils";
import { btn } from "./ui";
import { collectInvalid, fieldsNamed, markMissing, type MissingField } from "@/app/(public)/form-validation";
import { SESSION_ENDED } from "@/lib/core/session-words";

type State = { error?: string; ok?: string;
  /** The session ended: the refusal offers to sign in again, in a new tab, so what was written stays here. */
  expired?: boolean;
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

/** A key no other form will hold; `crypto.randomUUID` is offered only on https or this computer, so not leaned on. */
function newKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto && window.isSecureContext) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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
  // Sent with no connection: refused here, before anything leaves, what was written kept as it is.
  const [offline, setOffline] = useState(false);
  // A slow answer is said, never left as a frozen button: "Still sending…" after 3 s, and after 10 s that nothing is lost.
  const [slow, setSlow] = useState(0);
  useEffect(() => {
    if (!pending) { setSlow(0); return; }
    const first = window.setTimeout(() => setSlow(1), 3000);
    const second = window.setTimeout(() => setSlow(2), 10000);
    return () => { window.clearTimeout(first); window.clearTimeout(second); };
  }, [pending]);
  // One key per form, made when it is drawn and sent with it as `formKey` (owner, "idempotency keys"): a second press or
  // a retry of the same form gets the first answer instead of doing the act twice (`once`, lib/core/once.ts; backend
  // IdempotencyFilter). Renewed once the form went through (an answer with no refusal), so the next thing sent from it is
  // a new act; a refusal keeps it, the backend having kept nothing.
  // Made in the browser once the page is drawn (the server's drawing and the browser's must match).
  const [formKey, setFormKey] = useState("");
  useEffect(() => { setFormKey(newKey()); }, []);
  useEffect(() => { if (state && !state.error && !state.fields?.length) setFormKey(newKey()); }, [state]);
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
    // The first field the server named is where the person goes next, as for what the screen found itself.
    if (form && state?.fields?.length) requestAnimationFrame(() => {
      const first = form.querySelector<HTMLElement>("[data-missing]");
      if (!first) return;
      first.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => first.focus({ preventScroll: true }), 120);
    });
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
        if (!navigator.onLine) { e.preventDefault(); setOffline(true); return; }
        setOffline(false);
        if (confirmText && !window.confirm(confirmText)) { e.preventDefault(); return; }
        written.current = new FormData(e.currentTarget);
      }}
      key={resetOnSuccess && state?.ok ? String(state.ok) : "form"}
    >
      <input type="hidden" name="formKey" value={formKey} />
      {hidden
        ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)
        : null}
      {children}

      <Footer className={footerClassName}>
        <MissingSummary missing={missing} />

        {offline ? (
          <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            You are offline, so nothing was sent. What you wrote stays here: send it again once the connection is back.
          </p>
        ) : null}

        {state?.error ? (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2">
            <p className="text-xs text-red-700">
              {state.error}
              {state.expired || state.error === SESSION_ENDED ? (
                <> <a href={`/login?expired=1&next=${encodeURIComponent(window.location.pathname + window.location.search)}`} target="_blank" rel="noopener" className="font-semibold underline">Sign in again in a new tab</a>, then send this again: what you wrote stays here.</>
              ) : null}
            </p>
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
          <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {state.ok}
            {state.link ? <> <a href={state.link.href} className="font-semibold underline">{state.link.label}</a></> : null}
          </p>
        ) : null}

        {hideSubmit ? null : (
          <button type="submit" disabled={pending} className={cn(btn(variant, size))}>
            {pending ? (slow ? "Still sending…" : "Working…") : submitLabel}
          </button>
        )}
        {pending && slow === 2 ? (
          <p role="status" className="text-[11.5px] text-slate-500">The connection is slow. Your request is still on its way; nothing is lost.</p>
        ) : null}
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
