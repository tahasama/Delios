"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPasswordAction } from "@/lib/forms/auth";
import { inputCls, btn } from "@/components/ui";
import { AuthShell } from "../login/shell";
import { BotCheck } from "@/components/bot-check";

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, undefined);
  return (
    <AuthShell>
      <h2 className="text-xl font-semibold text-slate-900">Forgot your password?</h2>
      {state?.done ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-slate-600">
            If an account signs in with that email, a link to choose a new password is on its way. It works once, within 30 minutes.
          </p>
          <Link href="/login" className={`${btn("primary")} w-full`}>Back to sign in</Link>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-500">Type the email you sign in with. We send a link to choose a new password.</p>
          <form action={formAction} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-medium text-slate-700">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required autoFocus className={inputCls} placeholder="you@company.com" />
            </div>
            <BotCheck renew={state} />
            {state?.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
            <button type="submit" disabled={pending} className={`${btn("primary")} w-full`}>
              {pending ? "Sending…" : "Send the link"}
            </button>
          </form>
          <p className="mt-6 text-center text-xs text-slate-500">
            <Link href="/login" className="font-semibold text-brand-ink hover:underline">Back to sign in</Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
