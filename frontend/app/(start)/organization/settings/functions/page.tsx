import { liberty } from "@/lib/organization/liberty";
import { FunctionsBoard } from "@/app/(app)/settings/functions/board";
import { ProjectSwitches } from "../switches";

export const dynamic = "force-dynamic";
export const metadata = { title: "Functions & permissions" };

/** The organization's Functions & permissions: created and changed here, for every project; its switch is held fixed. */
export default async function OrganizationFunctionsPage() {
  const switches = await liberty();
  return (
    <>
      <FunctionsBoard level="organization" />
      <ProjectSwitches items={switches.filter((one) => one.area === "Functions & permissions")} title="Projects may change it" />
    </>
  );
}
