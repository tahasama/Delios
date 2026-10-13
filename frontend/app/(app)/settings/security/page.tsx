import { requireScope } from "@/lib/core/scope";
import { PageHeader, ToneChip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { api } from "@/lib/api/client";
import { adminUsers } from "@/lib/api/admin";
import { setMfaRequiredAction, resetMfaAction } from "@/lib/forms/security";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign-in & security" };

type Security = { mfaRequired: boolean; passwordSignIn: boolean; mfaEnrolled: { enrolled: number; of: number } };

/** How the organization's people sign in: two-step sign-in asked of everyone or not, and who has it on. */
export default async function SecurityPage() {
  await requireScope();
  const security = await api<Security>("/api/admin/security").catch(() => null);
  if (!security) {
    return <PageHeader title="Sign-in & security" subtitle="Only an administrator of the organization changes how its people sign in." />;
  }
  const people = (await adminUsers().catch(() => [])).filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name));
  const withMfa = people.filter((u) => u.mfa);
  const { enrolled, of } = security.mfaEnrolled;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sign-in & security"
        subtitle="How your organization's people sign in. Sessions end after 12 hours without use, and 7 days after signing in whatever happens."
      />

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
