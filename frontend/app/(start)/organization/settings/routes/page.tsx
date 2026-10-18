import Link from "next/link";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { routeCopies } from "@/lib/settings/api-admin";
import { liberty } from "@/lib/organization/liberty";
import { RoutesBoard } from "@/app/(app)/settings/workflow-templates/routes-board";
import { ProjectCopies } from "../copies";
import { ProjectSwitches } from "../switches";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review routes" };

/**
 * The organization's Review routes card (owner): the routes every project starts with, changed here by an
 * administrator. Its switch says whether projects may change them (free by default); the projects that did are listed,
 * and one may be put back for a mess.
 */
export default async function OrganizationRoutesPage() {
  const scope = await requireOrgAdmin();
  const [switches, copies] = await Promise.all([liberty(), routeCopies()]);
  return (
    <>
        <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
          <Link href="/organization/settings" className="hover:underline">{scope.organization.name} · Settings</Link>
        </p>
        <ProjectSwitches items={switches.filter((one) => one.area === "Review routes")} />
        <RoutesBoard level="organization" editable
          lead={`The organization's routes: every project offers them until it changes its own. ${copies.length ? `${copies.length} project${copies.length === 1 ? " has" : "s have"} its own.` : "No project has its own yet."}`} />
        <ProjectCopies what="routes" copies={copies} />
      </>
  );
}
