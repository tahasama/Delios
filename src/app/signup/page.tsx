"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signupAction } from "@/lib/actions/signup";
import { APP_NAME } from "@/lib/standard";
import { inputCls } from "@/components/ui";
import { MissingSummary } from "@/components/form";
import { collectInvalid, type MissingField } from "@/components/form-validation";
import { PROJECT_KINDS } from "@/lib/profiles/kinds";

const KINDS = PROJECT_KINDS;

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signupAction, undefined);
  const [missing, setMissing] = useState<MissingField[]>([]);
  const v = state?.values ?? {};

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
            You will be its administrator. We publish the reference configuration the Standard requires before use —
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
          <p className="mt-1 text-sm text-slate-500">Three things: who you are, what you call yourselves, and the first project.</p>

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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="password" className="mb-1 block text-xs font-medium text-slate-700">Password</label>
                  <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} className={inputCls} placeholder="min 8 characters" />
                </div>
                <div>
                  <label htmlFor="confirm" className="mb-1 block text-xs font-medium text-slate-700">Confirm</label>
                  <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} className={inputCls} placeholder="repeat it" />
                </div>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                First project <span className="font-normal normal-case tracking-normal text-slate-400">— optional</span>
              </legend>
              <p className="-mt-1 text-[11px] text-slate-400">
                Leave this blank to decide later. You can add people first and open the project when you know what it is.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_130px]">
                <div>
                  <label htmlFor="projectName" className="mb-1 block text-xs font-medium text-slate-700">Project name</label>
                  <input id="projectName" name="projectName" defaultValue={v.projectName} className={inputCls} placeholder="North plant upgrade" />
                </div>
                <div>
                  <label htmlFor="projectCode" className="mb-1 block text-xs font-medium text-slate-700">Code</label>
                  <input id="projectCode" name="projectCode" defaultValue={v.projectCode ?? ""} className={`${inputCls} uppercase`} placeholder="P1" />
                </div>
              </div>
              <div>
                <label htmlFor="projectKind" className="mb-1 block text-xs font-medium text-slate-700">Type</label>
                <select id="projectKind" name="projectKind" defaultValue={v.projectKind ?? "GENERIC"} className={inputCls}>
                  {KINDS.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">Used for defaults only — it never changes how the rules behave.</p>
              </div>
            </fieldset>

            <MissingSummary missing={missing} />
            {state?.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}

            <button type="submit" disabled={pending} className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-50">
              {pending ? "Creating your organization…" : "Create organization"}
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
