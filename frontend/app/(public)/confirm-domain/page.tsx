"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { confirmDomainAction } from "@/lib/organization/forms";
import { btn } from "@/components/ui";
import { AuthShell } from "@/app/(public)/login/shell";

/** The link from the domain email. A button, not an automatic confirmation: mail scanners open links too. */
function ConfirmForm() {
  const [state, formAction, pending] = useActionState(confirmDomainAction, undefined);
  const token = useSearchParams().get("token") ?? "";
  return (
    <AuthShell>
      <h2 className="text-xl font-semibold text-slate-900">Confirm your organization&rsquo;s domain</h2>
      {state?.done ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-slate-600">{state.done} Its administrators can now claim what others made for it on DELIOS.</p>
          <Link href="/organization" className={`${btn("primary")} w-full`}>The organization&rsquo;s page</Link>
        </div>
      ) : (
        <form action={formAction} className="mt-6 space-y-4">
          <input type="hidden" name="token" value={token} />
          <p className="text-sm text-slate-600">This confirms that the email domain your organization gave on DELIOS is its own.</p>
          {state?.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
          <button type="submit" disabled={pending || !token} className={`${btn("primary")} w-full`}>
            {pending ? "Confirming…" : "Confirm the domain"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export default function ConfirmDomainPage() {
  // useSearchParams needs a Suspense boundary to keep this page static.
  return (
    <Suspense>
      <ConfirmForm />
    </Suspense>
  );
}
