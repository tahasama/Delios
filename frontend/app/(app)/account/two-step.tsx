"use client";

import { useActionState } from "react";
import { myMfaAction } from "@/lib/actions/security";
import { btn, inputCls } from "@/components/ui";

/** Turning your own two-step sign-in on (key, then a code, then the recovery codes once) or off (with a code). */
export function TwoStep({ on, required }: { on: boolean; required: boolean }) {
  const [state, act, pending] = useActionState(myMfaAction, undefined);
  const error = state?.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p> : null;

  if (state?.recoveryCodes) {
    return (
      <div className="space-y-2">
        <p className="text-xs leading-5 text-slate-600">Two-step sign-in is on. Keep these recovery codes somewhere safe: each signs you in once without the app. They are shown only now.</p>
        <ul className="grid max-w-sm grid-cols-2 gap-1.5 rounded-md bg-tint-soft p-3 font-mono text-xs text-slate-700 ring-1 ring-line">
          {state.recoveryCodes.map((one) => <li key={one}>{one}</li>)}
        </ul>
      </div>
    );
  }
  if (state?.done) return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{state.ok}</p>;

  if (state?.secret) {
    return (
      <form action={act} className="max-w-md space-y-3">
        <input type="hidden" name="step" value="confirm" />
        <input type="hidden" name="secret" value={state.secret} />
        <input type="hidden" name="uri" value={state.uri ?? ""} />
        <p className="text-xs leading-5 text-slate-600">Add this key to an authenticator app, then type the code it shows.</p>
        <p className="break-all rounded-md bg-tint-soft px-3 py-2 font-mono text-xs text-slate-800 ring-1 ring-line">{state.secret}</p>
        {state.uri ? <a href={state.uri} className="text-xs font-semibold text-link hover:underline">Open in an authenticator app on this device</a> : null}
        <input name="code" required autoComplete="one-time-code" placeholder="123456" className={inputCls} aria-label="Code" />
        {error}
        <button type="submit" disabled={pending} className={btn("primary", "sm")}>{pending ? "Working…" : "Turn it on"}</button>
      </form>
    );
  }

  if (on) {
    if (required) return <p className="text-xs leading-5 text-slate-600">Your organization requires it, so it stays on. Lost your phone? Use a recovery code, or ask an administrator to turn it off.</p>;
    return (
      <div className="flex flex-wrap items-start gap-2">
        <details className="open:basis-full">
          <summary className="ask">Turn it off</summary>
          <form action={act} className="mt-3 max-w-md space-y-3">
            <input type="hidden" name="step" value="disable" />
            <p className="text-xs leading-5 text-slate-600">Type a code from your authenticator app, or a recovery code, to turn it off.</p>
            <input name="code" required autoComplete="one-time-code" placeholder="123456" className={inputCls} aria-label="Code" />
            {error}
            <button type="submit" disabled={pending} className={btn("danger", "sm")}>{pending ? "Working…" : "Turn it off"}</button>
          </form>
        </details>
      </div>
    );
  }

  return (
    <form action={act} className="space-y-3">
      <input type="hidden" name="step" value="start" />
      <p className="text-xs leading-5 text-slate-600">With it on, signing in also needs a code from an app on your phone, so a stolen password is not enough.</p>
      {error}
      <button type="submit" disabled={pending} className={btn("primary", "sm")}>{pending ? "Working…" : "Set it up"}</button>
    </form>
  );
}
