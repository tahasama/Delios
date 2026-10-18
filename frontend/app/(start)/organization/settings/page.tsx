import Link from "next/link";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { liberty } from "@/lib/organization/liberty";
import { OrgHeader } from "../org-header";
import { ORG_CARDS } from "./cards";

export const dynamic = "force-dynamic";
export const metadata = { title: "The organization's Settings" };

/**
 * The organization's Settings (owner): the same cards as a project's Settings, opened on the organization's version,
 * the default of every project. Each card carries its switch, may projects change it (Fixed or Free), and lists the
 * projects that changed it. An administrator changes the organization's here only; in a project's Settings they act as
 * that project's admin.
 */
export default async function OrganizationSettingsPage() {
  const scope = await requireOrgAdmin();
  const switches = await liberty();
  const said = (area?: string) => {
    if (!area) return "the organization's only";
    const items = switches.filter((one) => one.area === area);
    const free = items.filter((one) => one.free).length;
    if (!items.length) return "";
    if (items.length === 1) return items[0].free ? "projects may change it" : "the same on every project";
    return free === 0 ? "the same on every project" : free === items.length ? "projects may change it" : `projects may change ${free} of ${items.length}`;
  };

  return (
    <div className="min-h-screen bg-canvas">
      <OrgHeader scope={scope} back={{ href: "/organization", label: "Organization" }} />
      <main className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        <section className="register register-sheet register-sheet-open">
          <div className="px-5 pt-6 pb-4 sm:px-6">
            <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{scope.organization.name}</p>
            <h1 className="plate-name mt-1">Settings</h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
              How {scope.organization.name} works, the default of every project. The same cards as a project&rsquo;s Settings: here they hold the
              organization&rsquo;s version, and say whether projects may change it. Fixed: every project uses it as it is. Free: a project may
              take its own copy, which changes here never touch. A project&rsquo;s Settings never change what is here.
            </p>
          </div>
        </section>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ORG_CARDS.map((card) => {
            const href = card.slug ? `/organization/settings/${card.slug}` : card.elsewhere!;
            return (
              <Link key={card.project} href={href} className="block rounded-md bg-surface p-4 ring-1 ring-line transition-colors hover:bg-tint-soft">
                <p className="text-[13px] font-semibold text-slate-800">{card.title}</p>
                <p className="mt-1 text-[11.5px] leading-4 text-slate-500">{card.text}</p>
                <p className="mt-2 text-[11px] font-semibold text-slate-600">{said(card.area)}</p>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
