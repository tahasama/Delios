import Link from "next/link";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { libertyOrFail } from "@/lib/organization/liberty";
import { ProjectSwitches } from "../switches";
import { ORG_CARDS } from "../cards";

export const dynamic = "force-dynamic";
export const metadata = { title: "What projects may change" };

/**
 * What projects may change (owner: a page of its own, not two buttons in a card): every switch of the organization's
 * Settings in one list, by card, each Fixed (every project uses the organization's) or Free (a project may take its
 * own copy). The same switches sit on each card beside what they are about; here they are all read together.
 */
export default async function MayChangePage() {
  const scope = await requireOrgAdmin();
  const switches = await libertyOrFail();
  const areas = [...new Set(switches.map((one) => one.area))];
  const free = switches.filter((one) => one.free).length;
  const cardOf = (area: string) => ORG_CARDS.find((card) => card.area === area);

  return (
    <>
      <header className="register register-sheet register-sheet-open">
        <div className="px-5 pt-6 pb-4 sm:px-6">
          <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
            <Link href="/organization/settings" className="hover:underline">{scope.organization.name} · Settings</Link>
          </p>
          <h1 className="plate-title mt-1 text-slate-950">What projects may change</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            Every setting of the organization, one switch each. Fixed: every project uses the organization&rsquo;s as it is. Free: a
            project may take its own copy, which the organization&rsquo;s later changes never touch. Making one fixed later leaves
            what a project already changed as it is.
          </p>
        </div>
        <dl className="grid grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Fixed</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">{switches.length - free} settings</dd>
            <dd className="text-[11px] text-slate-500">every project uses ours as it is</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Free</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">{free} settings</dd>
            <dd className="text-[11px] text-slate-500">a project may take its own copy</dd>
          </div>
        </dl>
      </header>
      {areas.map((area) => {
        const card = cardOf(area);
        const href = card?.slug ? `/organization/settings/${card.slug}` : card?.elsewhere;
        return (
          <div key={area} className="space-y-1.5">
            {href ? <p className="text-right text-[11.5px]"><Link href={href} className="font-semibold text-link hover:underline">Open {card!.title}</Link></p> : null}
            <ProjectSwitches items={switches.filter((one) => one.area === area)} title={area} />
          </div>
        );
      })}
    </>
  );
}
