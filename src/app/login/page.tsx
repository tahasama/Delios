"use client";

import Link from "next/link";
import { Suspense, useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loginAction } from "@/lib/actions/auth";
import { APP_NAME } from "@/lib/standard";
import { inputCls } from "@/components/ui";
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
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden flex-1 flex-col justify-between bg-brand p-10 text-white lg:flex">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold tracking-wide">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 font-bold">D</span>
            DELIOS
          </div>
          <p className="mt-2 text-sm text-white/60">Controlled Project Information</p>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">Electronic Document Management System</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            One controlled register: identity, description, revisions, states, approval, review, issue, obsolescence and retention — each one checked against the records it leaves.
          </p>
          <div className="mt-6 flex gap-2 text-[11px] font-medium uppercase tracking-widest text-white/50">
            <span className="rounded-full bg-white/10 px-3 py-1">Layer I · Rules</span>
            <span className="rounded-full bg-emerald-400/20 px-3 py-1 text-emerald-200">Layer II · Routes</span>
            <span className="rounded-full bg-orange-400/20 px-3 py-1 text-orange-200">Layer III · Checks</span>
          </div>
        </div>
        <p className="text-xs text-white/40">{APP_NAME} — internal use only</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2 text-lg font-semibold text-brand-ink">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand font-bold text-white">D</span>
              DELIOS · EDMS
            </div>
          </div>
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
                <Link href={state.next ?? "/"} className="block w-full rounded-lg bg-brand px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-brand-hover">Continue</Link>
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
            <MissingSummary missing={missing} />
            {state?.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
            {state?.recoveryCodes ? null : (
              <button type="submit" disabled={pending} className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-50">
                {pending ? "Signing in…" : state?.mfa ? "Verify" : "Sign in"}
              </button>
            )}
          </form>
          <p className="mt-6 text-center text-xs text-slate-500">
            Setting up a new organization?{" "}
            <Link href="/signup" className="font-semibold text-brand-ink hover:underline">Register one</Link>
          </p>

          <div className="mt-8 rounded-xl border border-line bg-surface p-4 text-xs text-slate-500 shadow-sm">
            <p className="font-medium text-slate-700">Seeded organizations</p>
            <p className="mt-1 text-[11px] leading-relaxed">
              The same address exists in all three — the password decides which one you enter.
            </p>
            <ul className="mt-2 space-y-2">
              <li>
                <p className="font-medium text-slate-600">Our organization · P1, P2 · 20 documents</p>
                <p className="font-mono text-[11px]">admin@delios.local · demo1234</p>
                <p className="text-[11px]">controller@ · approver@ · reviewer@ · author@ · viewer@delios.local — all demo1234</p>
              </li>
              <li>
                <p className="font-medium text-slate-600">Northwind Engineering · NW-1, NW-2 · empty</p>
                <p className="font-mono text-[11px]">admin@delios.local · northwind1234</p>
              </li>
              <li>
                <p className="font-medium text-slate-600">Acme Refining · CR1 · empty</p>
                <p className="font-mono text-[11px]">admin@delios.local · acme12345</p>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
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
