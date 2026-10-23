import { keptCopies } from "@/lib/settings/api-admin";
import Link from "next/link";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { organizationSets, getActiveSet, SET_KEY } from "@/lib/settings/config";
import { orgSettings } from "@/lib/settings/api";
import { numberingForEditor, numberingCopies, NUMBERING_SETS } from "@/lib/settings/api-admin";
import { libertyOrFail } from "@/lib/organization/liberty";
import { NumberingBoard } from "@/app/(app)/settings/numbering/board";
import { ProjectCopies, KeptCopies } from "../copies";
import { ProjectSwitches } from "../switches";

export const dynamic = "force-dynamic";
export const metadata = { title: "Numbering" };

/**
 * The organization's Numbering card (owner): how every number is built and which scheme numbers what, the numbering of
 * every project, changed here by an administrator. Its switch says whether projects may change it; the projects that
 * did are listed, and one may be put back to the organization's for a mess, with why.
 */
export default async function OrganizationNumberingPage({ searchParams }: { searchParams: Promise<{ edit?: string; new?: string }> }) {
  const scope = await requireOrgAdmin();
  const params = await searchParams;
  const [numbering, all, settings, deliverables, switches, copies] = await Promise.all([
    numberingForEditor("organization"), organizationSets(), orgSettings(), getActiveSet("DELIVERABLE_TYPES"), libertyOrFail(), numberingCopies(),
  ]);
  // A part reads one of the app's numbering lists, or one of the organization's own lists in Numbering & identity:
  // a list one project made alone cannot build every project's numbers.
  const ownOfOrganization = (key: string) => {
    try {
      const meta = JSON.parse(settings.get(SET_KEY + key) ?? "null") as { group?: string } | null;
      return !!meta && (meta.group === "NUMBERING" || meta.group === "Numbering & identity");
    } catch {
      return false;
    }
  };
  const sets = all.filter((one) => NUMBERING_SETS.includes(one.key) || ownOfOrganization(one.key));
  const mine = switches.filter((one) => one.area === "Numbering");

  return (
    <>
        <section className="register register-sheet register-sheet-open">
          <div className="px-5 pt-6 pb-4 sm:px-6">
            <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
              <Link href="/organization/settings" className="hover:underline">{scope.organization.name} · Settings</Link>
            </p>
            <h1 className="plate-name mt-1">Numbering</h1>
            <p className="plate-meta mt-2">
              {numbering.schemes.filter((s) => s.active).length} schemes in use · {copies.length ? `${copies.length} project${copies.length === 1 ? "" : "s"} with their own` : "every project numbers by these"}
            </p>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
              How every number is built, and which scheme numbers what: the numbering of every project. Changed here, it changes for every
              project reading it; numbers already given never change.
            </p>
          </div>
        </section>
        <ProjectSwitches items={mine} />
        <NumberingBoard level="organization" editable schemes={numbering.schemes} routing={numbering.routing}
          deliverables={deliverables.map((d) => ({ code: d.code, label: d.label }))} sets={sets.map((s) => ({ key: s.key, title: s.title }))}
          editId={params.edit} adding={params.new === "1"} here="/organization/settings/numbering" />
        <ProjectCopies what="numbering" copies={copies} />
        <KeptCopies copies={await keptCopies("NUMBERING")} />
      </>
  );
}
