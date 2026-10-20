import { liberty } from "@/lib/organization/liberty";
import { functionCopies, keptCopies } from "@/lib/settings/api-admin";
import { FunctionsBoard } from "@/app/(app)/settings/functions/board";
import { ProjectSwitches } from "../switches";
import { KeptCopies, ProjectCopies } from "../copies";

export const dynamic = "force-dynamic";
export const metadata = { title: "Functions & permissions" };

/**
 * The organization's Functions & permissions: created and changed here, for every project. Where its switch leaves it
 * free, a project changes what each function may do there (its own copy); those projects are listed, each put back only
 * here, for a mess, its copy kept.
 */
export default async function OrganizationFunctionsPage({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const { open, new: adding } = await searchParams;
  const [switches, copies, kept] = await Promise.all([liberty(), functionCopies(), keptCopies("FUNCTIONS")]);
  return (
    <>
      <FunctionsBoard level="organization" open={open} adding={adding === "1"} />
      <ProjectSwitches items={switches.filter((one) => one.area === "Functions & permissions")} title="Projects may change what each may do" />
      <ProjectCopies what="functions" copies={copies.map((one) => ({ ...one, since: one.since ?? "" }))} />
      <KeptCopies copies={kept} />
    </>
  );
}
