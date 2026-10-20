import Link from "next/link";
import { headers } from "next/headers";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { ToneChip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { api } from "@/lib/client";
import { adminUsers } from "@/lib/settings/api-admin";
import { setMfaRequiredAction, resetMfaAction, setSsoAction, setPasswordSignInAction } from "@/lib/account/forms-security";
import { SwitchField } from "@/components/switch";
import { Field, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign-in & security" };

type Security = {
  slug: string; mfaRequired: boolean; passwordSignIn: boolean; mfaEnrolled: { enrolled: number; of: number };
  sso: { name: string; authority: string; clientId: string; scopes: string; allowedDomains: string[]; enabled: boolean } | null;
};

/**
 * How the organization's people sign in, for every project (owner: the organization's, in its Settings): two-step
 * sign-in asked of everyone or not, its own account (single sign-on), whether passwords still open the door, and who
 * has two-step on.
 */
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ sso?: string }> }) {
  const { sso: opening } = await searchParams;
  await requireOrgAdmin();
  const security = await api<Security>("/api/admin/security");
  const people = (await adminUsers().catch(() => [])).filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name));
  const withMfa = people.filter((u) => u.mfa);
  const { enrolled, of } = security.mfaEnrolled;
  // Passwords may be limited to administrators only once the organization's account is in use (backend
  // SSO_NOT_CONFIGURED otherwise): until then the switch is not offered, and the line says why.
  const ssoInUse = !!security.sso?.enabled;

  // Where the provider sends people back, in full: the address of this site, as the browser reached it.
  const head = await headers();
  const origin = `${head.get("x-forwarded-proto") ?? "http"}://${head.get("x-forwarded-host") ?? head.get("host") ?? ""}`;
  // autoComplete off on every field: a browser would otherwise put the administrator's own email and password here.
  const ssoForm = (
    <ActionForm action={setSsoAction} submitLabel="Save" className="space-y-3 border-t border-line px-5 py-4 sm:px-6">
      <p className="text-xs leading-5 text-slate-600">
        For step 1, your IT team gives the provider this address, where it sends people back after they sign in:{" "}
        <span className="font-mono text-slate-800 select-all">{origin}/api/auth/sso/callback</span>
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Name on the button" hint="e.g. Microsoft, Okta, our company"><input name="name" required autoComplete="off" defaultValue={security.sso?.name ?? ""} className={inputCls} /></Field>
        <Field label="Provider's address" hint="its issuer, https://…"><input name="authority" required type="url" autoComplete="off" defaultValue={security.sso?.authority ?? ""} className={inputCls} /></Field>
        <Field label="Client id" hint="given by the provider"><input name="clientId" required autoComplete="off" defaultValue={security.sso?.clientId ?? ""} className={inputCls} /></Field>
        <Field label="Client secret" hint={security.sso ? "kept; type a new one only to change it" : "given by the provider"}>
          <input name="clientSecret" type="password" autoComplete="new-password" required={!security.sso} className={inputCls} />
        </Field>
        <Field label="Email domains" hint="who may sign in this way, e.g. company.com; empty: any"><input name="domains" autoComplete="off" defaultValue={security.sso?.allowedDomains.join(", ") ?? ""} placeholder="company.com" className={inputCls} /></Field>
      </div>
      <div className="w-full"><SwitchField name="enabled" defaultChecked={security.sso?.enabled ?? false}>In use: offered on the sign-in page</SwitchField></div>
    </ActionForm>
  );

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-5 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Sign-in &amp; security</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            How the organization&rsquo;s people sign in, on every project. Sessions end after 12 hours without use, and 7 days
            after signing in whatever happens.
          </p>
        </div>
      </section>

      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Two-step sign-in</span>
          <span className="text-[11px] text-slate-500">a code from an authenticator app after the password</span>
        </div>
        <ul className="divide-y divide-line">
          <li className="space-y-3 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-semibold text-slate-800">
                Asked of everyone<span className="ml-1.5 text-xs font-normal text-slate-500">{enrolled} of {of} people have it on</span>
              </p>
              <ToneChip tone={security.mfaRequired ? "done" : "idle"}>{security.mfaRequired ? "Required" : "Each person's choice"}</ToneChip>
            </div>
            <p className="text-xs leading-5 text-slate-600">
              {security.mfaRequired
                ? "Whoever has not set it up is asked to at their next sign-in, and cannot go further without it."
                : "Anyone may turn it on for themselves under Your sign-in. Requiring it asks everyone else at their next sign-in."}
            </p>
            <ActionForm
              action={setMfaRequiredAction}
              hidden={{ required: security.mfaRequired ? "" : "on" }}
              submitLabel={security.mfaRequired ? "Stop requiring it" : "Require it for everyone"}
              variant={security.mfaRequired ? "secondary" : "primary"}
              size="sm"
            />
          </li>
        </ul>
      </section>

      {/* The organization's own sign-in (single sign-on), and whether passwords still open the door. */}
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">The organization&rsquo;s own account</span>
          <span className="text-[11px] text-slate-500">only if your people already sign in to work with Microsoft, Google, Okta or the like</span>
          <span className="ml-auto"><ToneChip tone={security.sso?.enabled ? "done" : "idle"}>{security.sso?.enabled ? "In use" : security.sso ? "Set up, not in use" : "Not set up"}</ToneChip></span>
        </div>
        <SsoSteps saved={!!security.sso} inUse={ssoInUse} slug={security.slug} />
        {security.sso || opening === "1" ? ssoForm : (
          <p className="border-t border-line px-5 py-3 text-xs text-slate-500 sm:px-6">
            Not needed otherwise: everyone signs in with their email and password.{" "}
            <Link href="/organization/settings/security?sso=1" scroll={false} className="font-semibold text-link hover:underline">Set it up</Link>
          </p>
        )}
        <div className="space-y-2 border-t border-line px-5 py-4 sm:px-6">
          <p className="text-sm font-semibold text-slate-800">Password sign-in</p>
          <p className="text-xs leading-5 text-slate-600">
            {security.passwordSignIn
              ? "Everyone may sign in with their email and password."
              : "Only administrators sign in with a password (to reach the organization if the provider is down); everyone else through the organization's account."}
            {ssoInUse
              ? " Turning the organization's account off opens passwords to everyone again."
              : " It can be limited to administrators once the organization's account above is set up and in use."}
          </p>
          {ssoInUse ? (
            <ActionForm action={setPasswordSignInAction} submitLabel="Save" size="sm">
              <div className="w-full"><SwitchField name="passwordSignIn" defaultChecked={security.passwordSignIn}>Everyone may sign in with a password</SwitchField></div>
            </ActionForm>
          ) : null}
        </div>
      </section>

      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">People with two-step sign-in</span>
          <span className="text-[11px] text-slate-500">turn it off for someone who lost their phone and their recovery codes</span>
        </div>
        {withMfa.length ? (
          <ul className="divide-y divide-line">
            {withMfa.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
                <p className="text-sm font-semibold text-slate-800">
                  {u.name}<span className="ml-1.5 text-xs font-normal text-slate-500">{u.email}{u.partyName ? ` · ${u.partyName}` : ""}</span>
                </p>
                <ActionForm
                  action={resetMfaAction}
                  hidden={{ userId: u.id }}
                  submitLabel="Turn it off"
                  variant="secondary"
                  size="sm"
                  confirmText={`Turn two-step sign-in off for ${u.name}? They sign in with their password alone${security.mfaRequired ? ", then set it up again" : ""}.`}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-xs text-slate-500 sm:px-6">Nobody has it on yet.</p>
        )}
        <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">
          Turning it off is written in the log. A locked account (too many wrong passwords) opens again by itself after 15 minutes, or when the person resets their password.
        </p>
      </section>
    </div>
  );
}

/**
 * How the organization's own account works, step by step, each step lit as it stands (owner: "explain the work with a
 * progress diagram"): done, the next one to do, or still to come.
 */
function SsoSteps({ saved, inUse, slug }: { saved: boolean; inUse: boolean; slug: string }) {
  const steps = [
    { title: "Register DELIOS with your provider", text: "Your IT team does it at Microsoft, Google, Okta…; it gives back a client id and a secret.", done: saved },
    { title: "Type its details here", text: "The name on the button, the provider's address, the client id and the secret.", done: saved },
    { title: "Switch it on", text: "\u201CIn use\u201D: from then on it is offered on the sign-in page.", done: inUse },
    { title: "People sign in with it", text: `They choose \u201CSign in with your organization\u2019s account\u201D, type ${slug}, sign in at the provider and come back here. Only people already added here get in, by their email.`, done: inUse },
  ];
  const next = steps.findIndex((step) => !step.done);
  return (
    <ol className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
      {steps.map((step, i) => {
        const state = step.done ? "done" : i === next ? "next" : "later";
        return (
          <li key={step.title} className={`rounded-md px-3 py-2.5 ring-1 ${state === "done" ? "bg-emerald-50 ring-emerald-200" : state === "next" ? "bg-amber-50 ring-amber-200" : "bg-tint-soft ring-line"}`}>
            <p className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${state === "done" ? "bg-emerald-600 text-white" : state === "next" ? "bg-amber-500 text-white" : "bg-slate-200 text-slate-600"}`}>{i + 1}</span>
              {step.title}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-slate-600">{step.text}</p>
            <p className={`mt-1.5 text-[11px] font-semibold ${state === "done" ? "text-emerald-800" : state === "next" ? "text-amber-900" : "text-slate-500"}`}>
              {state === "done" ? "Done" : state === "next" ? "Next" : "To come"}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
