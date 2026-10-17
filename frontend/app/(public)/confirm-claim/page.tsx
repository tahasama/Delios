"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { confirmClaimAction } from "@/lib/organization/forms";
import { btn } from "@/components/ui";
import { AuthShell } from "@/app/(public)/login/shell";

/** The link sent to the guest who stood for an organization. A button, not an automatic confirmation: mail scanners open links too. */
function ConfirmForm() {
  const [state, formAction, pending] = useActionState(confirmClaimAction, undefined);
  const token = useSearchParams().get("token") ?? "";
  return (
    <AuthShell>
      <h2 className="text-xl font-semibold text-slate-900">Is it the organization you stood for?</h2>
      {state?.done ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-slate-600">{state.done}</p>
          <Link href="/login" className={`${btn("primary")} w-full`}>Sign in</Link>
        </div>
      ) : (
        <form action={formAction} className="mt-6 space-y-4">
          <input type="hidden" name="token" value={token} />
          <p className="text-sm text-slate-600">An organization on DELIOS says it is the one you stood for as a guest. Confirm only if it is.</p>
          {state?.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
          <button type="submit" disabled={pending || !token} className={`${btn("primary")} w-full`}>
            {pending ? "Confirming…" : "Yes, it is us"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export default function ConfirmClaimPage() {
  // useSearchParams needs a Suspense boundary to keep this page static.
  return (
    <Suspense>
      <ConfirmForm />
    </Suspense>
  );
}
