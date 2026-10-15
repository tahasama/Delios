"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { resetPasswordAction } from "@/lib/account/forms-sign-in";
import { inputCls, btn } from "@/components/ui";
import { AuthShell } from "@/app/(public)/login/shell";

function ResetForm() {
  const [state, formAction, pending] = useActionState(resetPasswordAction, undefined);
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  // An invitation: the person has never had a password here.
  const first = params.get("first") === "1";
  return (
    <AuthShell>
      <h2 className="text-xl font-semibold text-slate-900">{first ? "Choose your password" : "Choose a new password"}</h2>
      {state?.done ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-slate-600">{first ? "Your password is set. Sign in with your email and this password." : "Your password is changed, and you are signed out everywhere. Sign in with the new one."}</p>
          <Link href="/login" className={`${btn("primary")} w-full`}>Sign in</Link>
        </div>
      ) : !token ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-slate-600">This page opens from the link in the email. Ask for a new link if you need one.</p>
          <Link href="/forgot-password" className={`${btn("primary")} w-full`}>Ask for a link</Link>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-500">At least 8 characters, and not one known from a data breach.</p>
          <form action={formAction} className="mt-6 space-y-4">
            <input type="hidden" name="token" value={token} />
            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-medium text-slate-700">{first ? "Password" : "New password"}</label>
              <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} autoFocus className={inputCls} />
            </div>
            <div>
              <label htmlFor="confirm" className="mb-1 block text-xs font-medium text-slate-700">The same again</label>
              <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} className={inputCls} />
            </div>
            {state?.error ? (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {state.error}{" "}
                {/expired|used/.test(state.error) ? <Link href="/forgot-password" className="font-semibold underline">Ask for a new link</Link> : null}
              </p>
            ) : null}
            <button type="submit" disabled={pending} className={`${btn("primary")} w-full`}>
              {pending ? "Saving…" : first ? "Save my password" : "Save the new password"}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary to keep this page static.
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
