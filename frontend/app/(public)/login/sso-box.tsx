"use client";

import { useActionState } from "react";
import { ssoLookupAction } from "@/lib/account/forms-sign-in";
import { inputCls, btn } from "@/components/ui";

/** What a refused single sign-on says, in plain words (the backend's codes, from /api/auth/sso/callback). */
const SSO_ERRORS: Record<string, string> = {
  SSO_STATE_INVALID: "The sign-in took too long, or was started in another browser. Try again.",
  SSO_PROVIDER_REFUSED: "Your organization's account did not let you in. Try again, or ask your administrator.",
  SSO_TOKEN_INVALID: "Your organization's answer could not be checked. Ask your administrator.",
  SSO_EMAIL_NOT_VERIFIED: "Your organization has not confirmed your email address yet.",
  SSO_NO_EMAIL: "Your organization's account gave no email address.",
  SSO_DOMAIN_NOT_ALLOWED: "Your email address is not one your organization signs in with here.",
  SSO_NO_ACCOUNT: "Nobody here has that email address yet: your administrator adds you first.",
  SSO_NOT_CONFIGURED: "Your organization does not sign in through its own account here.",
};

/**
 * Sign in with the organization's own account (single sign-on): its short name, then the button that goes to it.
 * Folded under the password form: most people sign in with their email.
 */
export function SsoBox({ next, error }: { next: string; error: string | null }) {
  const [state, formAction, pending] = useActionState(ssoLookupAction, undefined);
  return (
    <details open={!!error || !!state} className="mt-6 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
      <summary className="cursor-pointer text-xs font-semibold text-slate-700">Sign in with your organization&rsquo;s account</summary>
      {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{SSO_ERRORS[error] ?? "That sign-in did not go through. Try again."}</p> : null}
      {state?.name && state.slug ? (
        <a href={`/api/auth/sso/start?tenant=${encodeURIComponent(state.slug)}&returnUrl=${encodeURIComponent(next)}`} className={`${btn("primary")} mt-3 w-full`}>
          Sign in with {state.name}
        </a>
      ) : (
        <form action={formAction} className="mt-3 space-y-2">
          <label htmlFor="organization" className="block text-xs font-medium text-slate-700">Your organization&rsquo;s short name</label>
          <input id="organization" name="organization" required className={inputCls} placeholder="as your administrator gave it" />
          {state?.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p> : null}
          <button type="submit" disabled={pending} className={`${btn("secondary")} w-full`}>{pending ? "Looking…" : "Continue"}</button>
        </form>
      )}
    </details>
  );
}
