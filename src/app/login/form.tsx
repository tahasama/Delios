"use client";

import { useActionState } from "react";
import { signInAction, codeAction, type SignInState } from "@/lib/actions/session";
import { inputCls } from "@/components/ui";

/**
 * Sign-in, in two steps when the person uses two-step sign-in: first the
 * organization, email and password; then the six-digit code (or, the first time
 * when the organization requires it, setting up the authenticator app).
 */
export function SignInForm({ organization, next, demo }: { organization: string; next: string; demo: boolean }) {
  const [state, signIn, signingIn] = useActionState<SignInState | undefined, FormData>(signInAction, undefined);
  const [codeState, sendCode, checking] = useActionState<SignInState | undefined, FormData>(
    (prev, form) => codeAction(prev ?? state, form),
    undefined,
  );
  const current = codeState ?? state;

  if (current?.recoveryCodes) {
    return (
      <div className="mt-6 space-y-4">
        <p className="text-sm text-slate-700">Two-step sign-in is on. Keep these recovery codes somewhere safe: each one signs you in once if you lose your phone. They are shown only now.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface p-3 font-mono text-sm">
          {current.recoveryCodes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <a href={current.next ?? "/"} className="block w-full rounded-lg bg-brand px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-brand-hover">I have kept them: continue</a>
      </div>
    );
  }

  if (current?.step) {
    const settingUp = current.step.next === "MFA_SETUP";
    return (
      <form action={sendCode} className="mt-6 space-y-4">
        {settingUp && current.setup ? (
          <div className="rounded-lg border border-line bg-surface p-3 text-sm text-slate-700">
            <p>Your organization requires two-step sign-in. In your authenticator app, add an account with this key, then enter the code it shows.</p>
            <p className="mt-2 break-all font-mono text-xs">{current.setup.secret}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-700">Enter the six-digit code from your authenticator app, or one of your recovery codes.</p>
        )}
        <div>
          <label htmlFor="code" className="mb-1 block text-xs font-medium text-slate-700">Code</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus className={inputCls} />
        </div>
        {codeState?.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{codeState.error}</p> : null}
        <button type="submit" disabled={checking} className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-50">
          {checking ? "Checking…" : "Continue"}
        </button>
      </form>
    );
  }

  return (
    <>
      <form action={signIn} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next} />
        <div>
          <label htmlFor="organization" className="mb-1 block text-xs font-medium text-slate-700">Organization</label>
          <input id="organization" name="organization" required autoComplete="organization" defaultValue={state?.organization ?? organization} className={inputCls} placeholder="your-organization" />
        </div>
        <div>
          <label htmlFor="email" className="mb-1 block text-xs font-medium text-slate-700">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} className={inputCls} placeholder="you@company.com" />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-xs font-medium text-slate-700">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className={inputCls} placeholder="••••••••" />
        </div>
        {state?.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
        <button type="submit" disabled={signingIn} className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-50">
          {signingIn ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {demo ? (
        <div className="mt-8 rounded-xl border border-line bg-surface p-4 text-xs text-slate-500 shadow-sm">
          <p className="font-medium text-slate-700">Demo organization (local only)</p>
          <p className="mt-1 font-mono text-[11px]">organization: demo · password: demo1234</p>
          <p className="mt-1 text-[11px]">controller@ · engineer@ · approver@ · viewer@ · admin@demo.local · supplier@acme.local</p>
        </div>
      ) : null}
    </>
  );
}
