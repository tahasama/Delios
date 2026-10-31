import { DateFormatKeeper } from "@/components/date-format";
import { dateFormat } from "@/lib/core/date-format";
import Link from "next/link";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { organizationLinks, claims, merges } from "@/lib/organization/api";
import { acceptLinkAction, refuseLinkAction } from "@/lib/organization/forms";
import { fmtDate } from "@/lib/core/utils";
import { OrgHeader } from "./org-header";
import { Support, SupportLine, supportContact } from "@/components/support";
import { OrgTabs } from "./org-tabs";

/**
 * The organization's space (its administrators), the way Autodesk's account admin and GitHub's organization are laid
 * out (owner): the band, four tabs under it (Projects, People, Organizations, Settings), then what waits for our
 * answer, on every tab (invitations, answered here; merges and claims, one click away), then the page, full width.
 */
export default async function OrganizationLayout({ children }: { children: React.ReactNode }) {
  const scope = await requireOrgAdmin();
  const [links, claimable, mergeList, contact] = await Promise.all([organizationLinks(), claims(), merges(), supportContact()]);
  const received = links.filter((one) => one.side === "GUEST" && one.state === "INVITED");
  const mergesWaiting = mergeList.filter((m) => m.waitsOnUs).length;
  const claimsWaiting = claimable.incoming.length;

  return (
    <div className="min-h-screen bg-canvas">
      <DateFormatKeeper value={dateFormat()} />
      <OrgHeader scope={scope} support={<>
        <div className="hidden lg:block"><SupportLine contact={contact} /></div>
        <Support contact={contact} />
      </>} />
      <OrgTabs />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6">
        {received.length || mergesWaiting || claimsWaiting ? (
          <section className="rounded-md bg-amber-50 ring-1 ring-amber-200" aria-label="Waiting for our answer">
            <ul className="divide-y divide-amber-200">
              {received.map((one) => (
                <li key={one.id} className="space-y-2 px-5 py-3 sm:px-6">
                  <p className="text-[13px] text-slate-800">
                    <strong>{one.organization}</strong> invites us to work on its projects, with our own accounts. They know us as {one.partyName} ({one.partyCode}).
                    <span className="ml-2 text-[11px] text-slate-500">Sent {fmtDate(one.invitedAt)} by {one.invitedBy}</span>
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <ActionForm action={acceptLinkAction} submitLabel="Accept" size="sm" hidden={{ linkId: one.id }}>
                      <Field label="A note for them" hint="optional"><input name="note" className={inputCls} /></Field>
                    </ActionForm>
                    <ActionForm action={refuseLinkAction} submitLabel="Refuse" size="sm" variant="secondary" hidden={{ linkId: one.id }}>
                      <Field label="Why" required><input name="note" required className={inputCls} /></Field>
                    </ActionForm>
                  </div>
                </li>
              ))}
              {mergesWaiting || claimsWaiting ? (
                <li className="px-5 py-2.5 text-[13px] text-slate-800 sm:px-6">
                  {mergesWaiting ? <>{mergesWaiting} merge{mergesWaiting === 1 ? "" : "s"} of organizations to agree or refuse. </> : null}
                  {claimsWaiting ? <>{claimsWaiting} claim{claimsWaiting === 1 ? "" : "s"} on entries we made, to vouch for or refuse. </> : null}
                  <Link href="/organization/settings/identity" className="font-semibold text-link hover:underline">Answer them</Link>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}
        {children}
      </main>
    </div>
  );
}
