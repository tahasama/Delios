"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { AuthShell } from "@/app/(public)/login/shell";
import { BotCheck } from "@/app/(public)/bot-check";
import { signupAction } from "@/lib/account/forms-signup";
import { APP_NAME } from "@/lib/core/standard";
import { inputCls, btn } from "@/components/ui";
import { MissingSummary } from "@/components/form";
import { collectInvalid, type MissingField } from "@/app/(public)/form-validation";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signupAction, undefined);
  const [missing, setMissing] = useState<MissingField[]>([]);
  const v = state?.values ?? {};

  const guest = state?.guest;

  if (state?.ready) {
    return (
      <AuthShell>
        <h2 className="text-xl font-semibold text-slate-900">{state.ready.organization} is on DELIOS</h2>
        <p className="mt-2 text-sm text-slate-600">
          Your account came with you: sign in as usual, with the same email and password. You land in {state.ready.organization}&rsquo;s DELIOS,
          and switch into {state.ready.host}&rsquo;s projects from there, as before. {state.ready.host} is told; nothing is asked of them.
        </p>
        <Link href="/login" className={`${btn("primary")} mt-6 w-full`}>Go to sign in</Link>
      </AuthShell>
    );
  }

  if (state?.confirmEmail) {
    return (
      <AuthShell>
        <h2 className="text-xl font-semibold text-slate-900">Confirm your email</h2>
        <p className="mt-2 text-sm text-slate-600">
          Your organization is registered. We sent a link to <strong className="text-slate-800">{state.confirmEmail}</strong>: open it within two days, then sign in.
        </p>
        <Link href="/login" className={`${btn("primary")} mt-6 w-full`}>Go to sign in</Link>
      </AuthShell>
    );
  }

  return (
    <div className="flex min-h-screen">
      <div className="relative hidden flex-1 flex-col justify-between bg-brand p-10 text-white lg:flex">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold tracking-wide">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 font-bold">D</span>
            DELIOS
          </div>
          <p className="mt-2 text-sm text-white/60">Controlled Project Information</p>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">Register your organization</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            You will be its administrator. We publish a starter configuration you can change before use —
            document types, disciplines, statuses, review outcomes, numbering schemes — which you then replace with
            your own.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            Everyone else is added by you, from inside. There is no public registration and no email to confirm.
          </p>
        </div>
        <p className="text-xs text-white/40">{APP_NAME} — internal use only</p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-slate-50 px-6 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2 text-lg font-semibold text-brand-ink">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand font-bold text-white">D</span>
              DELIOS · EDMS
            </div>
          </div>

          <h2 className="text-xl font-semibold text-slate-900">Create an organization</h2>
          <p className="mt-1 text-sm text-slate-500">Two things: what your organization is called, and who you are. Projects come next, from inside.</p>

          <form
            action={formAction}
            className="mt-6 space-y-5"
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
            <fieldset className="space-y-3">
              <legend className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Organization</legend>
              <div>
                <label htmlFor="organizationName" className="mb-1 block text-xs font-medium text-slate-700">Organization name</label>
                <input id="organizationName" name="organizationName" required defaultValue={v.organizationName} className={inputCls} placeholder="Northwind Engineering" />
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400">You</legend>
              <div>
                <label htmlFor="name" className="mb-1 block text-xs font-medium text-slate-700">Full name</label>
                <input id="name" name="name" required defaultValue={v.name} className={inputCls} placeholder="Your name" />
              </div>
              <div>
                <label htmlFor="email" className="mb-1 block text-xs font-medium text-slate-700">Email</label>
                <input id="email" name="email" type="email" autoComplete="email" required defaultValue={v.email} className={inputCls} placeholder="you@company.com" />
              </div>
              {guest ? (
                <div>
                  <input type="hidden" name="takeGuestAccount" value="1" />
                  <input type="hidden" name="guestHost" value={guest.host} />
                  <input type="hidden" name="guestOrganization" value={guest.organization} />
                  <label htmlFor="password" className="mb-1 block text-xs font-medium text-slate-700">Password of your account at {guest.host}</label>
                  <input id="password" name="password" type="password" autoComplete="current-password" required className={inputCls} />
                </div>
              ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="password" className="mb-1 block text-xs font-medium text-slate-700">Password</label>
                  <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} className={inputCls} placeholder="at least 8 characters" />
                </div>
                <div>
                  <label htmlFor="confirm" className="mb-1 block text-xs font-medium text-slate-700">Confirm</label>
                  <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} className={inputCls} placeholder="repeat it" />
                </div>
              </div>
              )}
            </fieldset>

            {guest ? (
              <p role="status" className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm leading-6 text-amber-900 ring-1 ring-amber-200">
                This email is the account {guest.host} made for you, for {guest.organization}. Create {guest.organization}&rsquo;s own DELIOS and take
                it with you: give that account&rsquo;s password. You keep every project you are on at {guest.host}, as a collaborator from now on.
              </p>
            ) : null}
            {/* The terms and the data processing agreement are accepted for the organization; kept with their version and the day. */}
            <label className="flex items-start gap-2 text-xs leading-5 text-slate-600">
              <input type="checkbox" name="acceptTerms" required className="mt-0.5" />
              <span>
                For my organization, I accept the{" "}
                <Link href="/legal/terms" target="_blank" className="font-semibold text-link hover:underline">terms of service</Link> and the{" "}
                <Link href="/legal/dpa" target="_blank" className="font-semibold text-link hover:underline">data processing agreement</Link>, and I have read the{" "}
                <Link href="/legal/privacy" target="_blank" className="font-semibold text-link hover:underline">privacy notice</Link>. DELIOS is for businesses, not consumers.
              </span>
            </label>
            <MissingSummary missing={missing} />
            <BotCheck renew={state} />
            {state?.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}

            <button type="submit" disabled={pending} className={`${btn("primary")} w-full`}>
              {pending ? "Creating your organization…" : guest ? `Create ${guest.organization}'s DELIOS and take my account` : "Create organization"}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-500">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-brand-ink hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
