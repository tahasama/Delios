import Link from "next/link";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { getActiveSet } from "@/lib/settings/config";
import { adminNumbering, revisionCopies } from "@/lib/settings/api-admin";
import { liberty } from "@/lib/organization/liberty";
import { RevisionBoard } from "@/app/(app)/settings/revisions/board";
import { ProjectCopies } from "../copies";
import { ProjectSwitches } from "../switches";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revisions" };

/**
 * The organization's Revisions card (owner): how every project's revisions are named, changed here by an administrator.
 * Its switch says whether projects may change it; the projects that did are listed, and one may be put back for a mess.
 */
export default async function OrganizationRevisionsPage() {
  const scope = await requireOrgAdmin();
  const [{ revisionSchemes, revisionRouting }, deliverables, phaseValues, switches, copies] = await Promise.all([
    adminNumbering(), getActiveSet("DELIVERABLE_TYPES"), getActiveSet("PHASES"), liberty(), revisionCopies(),
  ]);

  return (
    <>
        <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
          <Link href="/organization/settings" className="hover:underline">{scope.organization.name} · Settings</Link>
        </p>
        <RevisionBoard level="organization" editable schemes={revisionSchemes} routing={revisionRouting}
          deliverables={deliverables.map((d) => ({ code: d.code, label: d.label }))} phases={phaseValues.map((p) => ({ code: p.code, label: p.label }))}
          lead={`How every project's revisions are named. Changed here, it changes for every project reading it; ${copies.length ? `${copies.length} project${copies.length === 1 ? " has" : "s have"} its own.` : "every project reads it."}`} />
        <ProjectSwitches items={switches.filter((one) => one.area === "Revisions")} />
        <ProjectCopies what="revisions" copies={copies} />
      </>
  );
}
