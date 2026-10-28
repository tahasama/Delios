"use client";

import Link from "next/link";
import { useActionState } from "react";
import { consoleSignInAction } from "@/lib/console/forms";
import { btn, inputCls } from "@/components/ui";

const label = "stencil mb-1.5 block text-slate-500";

/**
 * The console's sign-in in its steps: email and password; the first time, the QR code to scan and its first code; then
 * the recovery codes, once. Every later time: email, password and the code the app shows.
 */
export function SignInForm() {
  const [state, action, pending] = useActionState(consoleSignInAction, undefined);
  if (state?.recoveryCodes) {
    return (
      <div className="mt-6 space-y-4">
        <p className="text-sm text-slate-700">
          The authenticator is set up. Keep these recovery codes somewhere safe (a password manager, or printed and locked away): each one signs you in
          once if you lose your phone. They are shown only now.
        </p>
        <ul className="grid grid-cols-2 gap-1.5 rounded-lg border border-line bg-surface p-3 font-mono text-xs text-slate-800">
          {state.recoveryCodes.map((one) => <li key={one}>{one}</li>)}
        </ul>
        <Link href="/console" className={`${btn("primary")} w-full`}>I kept them: open the console</Link>
      </div>
    );
  }
  if (state?.setup) {
    return (
      <form action={action} className="mt-6 space-y-4">
        <input type="hidden" name="challenge" value={state.setup.challenge} />
        <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-5 text-slate-700">
          <li>On your phone, install <strong>Google Authenticator</strong> or <strong>Microsoft Authenticator</strong> (free).</li>
          <li>In the app, press <strong>+</strong>, then <strong>Scan a QR code</strong>, and scan this one.</li>
          <li>Type the 6 digits the app shows for &ldquo;DELIOS console&rdquo;.</li>
        </ol>
        {/* A picture made on the server from the key: nothing in it runs. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={state.setup.qr} alt="QR code to scan with your authenticator app" width={220} height={220} className="mx-auto rounded-lg border border-line bg-white p-2" />
        <p className="text-center text-[11px] text-slate-500">
          No camera? Choose &ldquo;Enter a setup key&rdquo; in the app and type: <span className="select-all font-mono text-slate-800">{state.setup.secret}</span>
        </p>
        <label className="block">
          <span className={label}>The 6 digits the app shows</span>
          <input name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus className={inputCls} />
        </label>
        {state.error ? <p className="text-[13px] text-red-700" role="alert">{state.error}</p> : null}
        <button type="submit" disabled={pending} className={`${btn("primary")} w-full`}>{pending ? "Checking…" : "Confirm and sign in"}</button>
      </form>
    );
  }
  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block">
        <span className={label}>Email</span>
        <input name="email" type="email" required autoComplete="username" className={inputCls} />
      </label>
      <label className="block">
        <span className={label}>Password</span>
        <input name="password" type="password" required autoComplete="current-password" className={inputCls} />
      </label>
      <label className="block">
        <span className={label}>Code from your authenticator app</span>
        <input name="code" autoComplete="one-time-code" className={inputCls} placeholder="the first time, leave it empty" />
        <span className="mt-1 block text-[11px] text-slate-500">Lost your phone? Type one of your recovery codes instead.</span>
      </label>
      {state?.error ? <p className="text-[13px] text-red-700" role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending} className={`${btn("primary")} w-full`}>{pending ? "Signing in…" : "Sign in"}</button>
      <p className="text-[11px] leading-5 text-slate-500">
        An account is made on the server with <code className="font-mono">create-operator &lt;email&gt; &lt;name&gt;</code>. The first sign-in sets up the
        authenticator app with a QR code.
      </p>
    </form>
  );
}
