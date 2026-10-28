"use client";

import { useActionState } from "react";
import { consoleSignInAction } from "@/lib/console/forms";
import { btn, inputCls } from "@/components/ui";

export function SignInForm() {
  const [state, action, pending] = useActionState(consoleSignInAction, undefined);
  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block">
        <span className="stencil mb-1.5 block text-slate-500">Email</span>
        <input name="email" type="email" required autoComplete="username" className={inputCls} />
      </label>
      <label className="block">
        <span className="stencil mb-1.5 block text-slate-500">Password</span>
        <input name="password" type="password" required autoComplete="current-password" className={inputCls} />
      </label>
      <label className="block">
        <span className="stencil mb-1.5 block text-slate-500">Code from your authenticator app</span>
        <input name="code" inputMode="numeric" pattern="[0-9 ]*" required autoComplete="one-time-code" className={inputCls} />
      </label>
      {state?.error ? <p className="text-[13px] text-red-700" role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending} className={`${btn("primary")} w-full`}>{pending ? "Signing in…" : "Sign in"}</button>
      <p className="text-[11px] leading-5 text-slate-500">
        An account is made on the server with <code className="font-mono">create-operator &lt;email&gt; &lt;name&gt;</code>, which prints the key for the
        authenticator app once.
      </p>
    </form>
  );
}
