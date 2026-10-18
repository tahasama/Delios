import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { liberty } from "@/lib/organization/liberty";
import { ProjectSwitches } from "../switches";
import { orgCard } from "../cards";

export const dynamic = "force-dynamic";

/** Where a card's organization's version stands until it is moved onto this card, said plainly. */
const TODAY: Record<string, React.ReactNode> = {
  flow: <>The organization&rsquo;s version is what a project starts with: <Link href="/organization/defaults" className="font-semibold text-link hover:underline">Defaults for new projects</Link>. Each project then changes its own where it is free.</>,
};

/** One card of the organization's Settings not moved onto it yet: its switches, and where its organization's version is. */
export default async function OrganizationCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const card = orgCard(slug);
  if (!card) notFound();
  const scope = await requireOrgAdmin();
  const switches = (await liberty()).filter((one) => one.area === card.area);

  return (
    <>
        <section className="register register-sheet register-sheet-open">
          <div className="px-5 pt-6 pb-4 sm:px-6">
            <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
              <Link href="/organization/settings" className="hover:underline">{scope.organization.name} · Settings</Link>
            </p>
            <h1 className="plate-name mt-1">{card.title}</h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{card.text}</p>
            {TODAY[slug] ? <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-600">{TODAY[slug]}</p> : null}
          </div>
        </section>
        <ProjectSwitches items={switches} title={switches.length > 1 ? "Which projects may change" : "Projects may change it"} />
      </>
  );
}
