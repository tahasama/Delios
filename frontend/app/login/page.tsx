"use client";

import Link from "next/link";
import { Suspense, useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loginAction, resendConfirmationAction } from "@/lib/actions/auth";
import { AuthShell } from "./shell";
import { BotCheck } from "@/components/bot-check";
import { inputCls, btn } from "@/components/ui";
import { MissingSummary } from "@/components/form";
import { collectInvalid, type MissingField } from "@/components/form-validation";

function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);
  const [missing, setMissing] = useState<MissingField[]>([]);
  const params = useSearchParams();
  // Only same-site paths, or ?next becomes an open redirect.
  const raw = params.get("next") ?? "/";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  return (
    <AuthShell>
          <h2 className="text-xl font-semibold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use the account your administrator created for you.</p>
          <form
            action={formAction}
            className="mt-6 space-y-4"
            noValidate
            onSubmit={(e) => {
              const found = collectInvalid(e.currentTarget);
              if (found.length) {
                e.preventDefault();
                setMissing(found);
                return;
              }
              setMissing([]);
            }}
          >
            <input type="hidden" name="next" value={next} />
            {state?.recoveryCodes ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-700">Two-step sign-in is on. Keep these recovery codes somewhere safe: each signs you in once without the app. They are shown only now.</p>
                <ul className="grid grid-cols-2 gap-1.5 rounded-lg border border-line bg-surface p-3 font-mono text-xs text-slate-700">
                  {state.recoveryCodes.map((one) => <li key={one}>{one}</li>)}
                </ul>
                <Link href={state.next ?? "/"} className={`${btn("primary")} w-full`}>Continue</Link>
              </div>
            ) : state?.mfa ? (
              <>
                <input type="hidden" name="challenge" value={state.mfa.challenge} />
                <input type="hidden" name="step" value={state.mfa.step} />
                <input type="hidden" name="email" value={state.email ?? ""} />
                {state.mfa.secret ? <input type="hidden" name="secret" value={state.mfa.secret} /> : null}
                {state.mfa.uri ? <input type="hidden" name="uri" value={state.mfa.uri} /> : null}
                {state.mfa.step === "MFA_SETUP" ? (
                  <div className="space-y-2 text-sm text-slate-600">
                    <p>Your organization asks for two-step sign-in. Add this key to an authenticator app, then type the code it shows.</p>
                    <p className="break-all rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-slate-800">{state.mfa.secret}</p>
                    {state.mfa.uri ? <a href={state.mfa.uri} className="text-xs font-semibold text-brand-ink hover:underline">Open in an authenticator app on this device</a> : null}
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">Type the code from your authenticator app, or one of your recovery codes.</p>
                )}
                <div>
                  <label htmlFor="code" className="mb-1 block text-xs font-medium text-slate-700">
                    Code
                  </label>
                  <input id="code" name="code" type="text" autoComplete="one-time-code" required autoFocus className={inputCls} placeholder="123456" />
                </div>
              </>
            ) : (
              <>
              <div>
                <label htmlFor="email" className="mb-1 block text-xs font-medium text-slate-700">
                  Email
                </label>
                <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} className={inputCls} placeholder="you@company.com" />
              </div>
              <div>
                <label htmlFor="password" className="mb-1 block text-xs font-medium text-slate-700">
                  Password
                </label>
                <input id="password" name="password" type="password" autoComplete="current-password" required className={inputCls} placeholder="••••••••" />
              </div>
              {state?.chooseOrg?.length ? (
                <div>
                  <label htmlFor="org" className="mb-1 block text-xs font-medium text-slate-700">Organization</label>
                  <select id="org" name="org" required className={inputCls} defaultValue="">
                    <option value="" disabled>Choose your organization…</option>
                    {state.chooseOrg.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
                  </select>
                </div>
              ) : null}
              </>
            )}
            {state?.mfa || state?.recoveryCodes ? null : <BotCheck renew={state} />}
            <MissingSummary missing={missing} />
            {state?.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
            {state?.mfa || state?.recoveryCodes ? null : (
              <p className="text-right text-xs">
                <Link href="/forgot-password" className="font-semibold text-brand-ink hover:underline">Forgot your password?</Link>
              </p>
            )}
            {state?.recoveryCodes ? null : (
              <button type="submit" disabled={pending} className={`${btn("primary")} w-full`}>
                {pending ? "Signing in…" : state?.mfa ? "Verify" : "Sign in"}
              </button>
            )}
          </form>
          {state?.unconfirmed ? <ResendLink email={state.email ?? ""} /> : null}
          <p className="mt-6 text-center text-xs text-slate-500">
            Setting up a new organization?{" "}
            <Link href="/signup" className="font-semibold text-brand-ink hover:underline">Register one</Link>
          </p>

          {/* Demo accounts, on a developer's machine only: a server never advertises passwords. */}
          {process.env.NODE_ENV !== "production" ? (
            <div className="mt-8 rounded-xl border border-line bg-surface p-4 text-xs text-slate-500 shadow-sm">
              <p className="font-medium text-slate-700">Demo accounts (seed-demo)</p>
              <p className="mt-1 font-mono text-[11px]">admin@demo.local · demo1234</p>
              <p className="mt-1 text-[11px]">controller@ · engineer@ · approver@ · viewer@demo.local, supplier@acme.local — all demo1234</p>
            </div>
          ) : null}
    </AuthShell>
  );
}

/** The password was right but the email is not confirmed: the link can be sent again. */
function ResendLink({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(resendConfirmationAction, undefined);
  if (state?.done) return <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Sent again to {email}. It works within two days.</p>;
  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="email" value={email} />
      <BotCheck renew={state} />
      {state?.error ? <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p> : null}
      <button type="submit" disabled={pending} className={`${btn("secondary")} w-full`}>{pending ? "Sending…" : "Send the link again"}</button>
    </form>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary to keep this page static.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
