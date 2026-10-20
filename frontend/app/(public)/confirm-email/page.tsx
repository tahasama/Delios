"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { confirmEmailAction } from "@/lib/account/forms-sign-in";
import { btn } from "@/components/ui";
import { AuthShell } from "@/app/(public)/login/shell";

/**
 * The link from the sign-up email, or from a new email an administrator gave someone. A button, not an automatic
 * confirmation: mail scanners open links too.
 */
function ConfirmForm() {
  const [state, formAction, pending] = useActionState(confirmEmailAction, undefined);
  const token = useSearchParams().get("token") ?? "";
  return (
    <AuthShell>
      <h2 className="text-xl font-semibold text-slate-900">Confirm your email</h2>
      {state?.done ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-slate-600">
            {state.email ? `Your email on DELIOS is now ${state.email}. Sign in with it from now on.` : "Your email is confirmed. Sign in to start."}
          </p>
          <Link href="/login" className={`${btn("primary")} w-full`}>Sign in</Link>
        </div>
      ) : (
        <form action={formAction} className="mt-6 space-y-4">
          <input type="hidden" name="token" value={token} />
          <p className="text-sm text-slate-600">This confirms that this address is yours.</p>
          {state?.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
          <button type="submit" disabled={pending || !token} className={`${btn("primary")} w-full`}>
            {pending ? "Confirming…" : "Confirm my email"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export default function ConfirmEmailPage() {
  // useSearchParams needs a Suspense boundary to keep this page static.
  return (
    <Suspense>
      <ConfirmForm />
    </Suspense>
  );
}
