import Link from "next/link";
import { StagePath } from "@/app/(app)/documents/[id]/next-step";
import { headers } from "next/headers";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { ToneChip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { api } from "@/lib/client";
import { adminUsers } from "@/lib/settings/api-admin";
import { setMfaRequiredAction, resetMfaAction, setSsoAction, setPasswordSignInAction } from "@/lib/account/forms-security";
import { SwitchField } from "@/components/switch";
import { Field, inputCls } from "@/components/ui";
import { orgSettings } from "@/lib/settings/api";
import { TrackingSheet } from "../../tracking";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security & privacy" };

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
  const [security, settings] = await Promise.all([api<Security>("/api/admin/security"), orgSettings().catch(() => new Map<string, string>())]);
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
        <Field label="Email domains" hint="who may sign in this way, e.g. company.com; empty: only an email the provider says it verified"><input name="domains" autoComplete="off" defaultValue={security.sso?.allowedDomains.join(", ") ?? ""} placeholder="company.com" className={inputCls} /></Field>
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
      {/* What is kept about people's activity: privacy, on the same card (owner: it did not deserve one of its own). */}
      <TrackingSheet reading={settings.get("TRACK_READING") !== "OFF"} signIns={settings.get("TRACK_SIGN_INS") === "ON"} keepDays={settings.get("TRACK_KEEP_DAYS") ?? ""} />
    </div>
  );
}

/**
 * How the organization's own account works, step by step (owner: "explain the work with a progress diagram", in the
 * app's own look): the stage path drawn under a document's title, the step it is at filled, a line under each.
 */
function SsoSteps({ saved, inUse, slug }: { saved: boolean; inUse: boolean; slug: string }) {
  return (
    <div className="space-y-3 px-5 py-4 sm:px-6">
      <StagePath
        stages={["Register DELIOS", "Type its details", "Switch it on", "People sign in"]}
        at={inUse ? 4 : saved ? 2 : 0}
        under={[
          "your IT team, at the provider",
          "below: two codes it gives",
          "“In use”",
          "with their work account",
        ].map((line) => <span key={line} className="text-[11px] text-slate-500">{line}</span>)}
      />
      <p className="max-w-3xl text-xs leading-5 text-slate-600">
        Once on, people choose &ldquo;Sign in with your organization&rsquo;s account&rdquo; on the sign-in page, type{" "}
        <span className="font-mono font-semibold text-slate-800">{slug}</span>, sign in at the provider and come back here. Only people
        already added here get in, by their email: nobody is created by signing in.
      </p>
    </div>
  );
}
