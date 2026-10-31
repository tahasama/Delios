import { ExceptionNote } from "@/lib/settings/exception";
import Link from "next/link";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/core/scope";
import { getActiveSet } from "@/lib/settings/config";
import { projectRevisions } from "@/lib/settings/api-admin";
import { NoAccess } from "../no-access";
import { RevisionBoard } from "./board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revisions" };

/**
 * How this project's revisions are named. Two levels (owner): the organization's naming is every project's; where the
 * organization left revisions free, the control function changes it here, its first change giving the project its own
 * copy. Otherwise it is read here, and changed in the organization's Settings.
 */
export default async function RevisionsPage() {
  const ctx = await requireScope();
  if (!maySetup(ctx.user, SETUP_PAGES.find((p) => p.href === "/settings/revisions")!)) {
    return <NoAccess title="Revisions" who="control" />;
  }
  const [naming, deliverables, phaseValues] = await Promise.all([projectRevisions(), getActiveSet("DELIVERABLE_TYPES"), getActiveSet("PHASES")]);
  const project = ctx.project.code;
  const exception = naming.exception;
  const lead = naming.own
    ? naming.free
      ? exception
        ? <>{project}&rsquo;s own revision naming, changed here. <ExceptionNote project={project} what="revision naming" exception={exception} /></>
        : `${project}'s own revision naming, changed here${naming.mayChange ? "" : " by whoever acts as the control function"}. The organization's later changes do not touch it.`
      : `${project}'s own revision naming, changed here before the organization fixed it for every project: it stays as it is, and nothing more is changed here.`
    : naming.free && exception
      ? <>The organization&rsquo;s revision naming. <ExceptionNote project={project} what="revision naming" exception={exception} /> A change here gives {project} its own copy, which the organization&rsquo;s later changes never touch.{naming.mayChange ? null : " Whoever acts as the control function changes it."}</>
    : naming.free
      ? <>The organization&rsquo;s revision naming. Projects may change it: a change here gives {project} its own copy, which the organization&rsquo;s later changes never touch.{naming.mayChange ? null : " Whoever acts as the control function changes it."}</>
      : <>The organization&rsquo;s revision naming, the same on every project.{" "}
          {naming.mayChangeOrganization
            ? <>An administrator changes it in the organization&rsquo;s Settings: <Link href="/organization/settings/revisions" className="font-semibold text-link hover:underline">Revisions</Link>.</>
            : "An administrator changes it, for every project."}</>;

  return (
    <div className="space-y-4">
      <RevisionBoard level="project" editable={naming.mayChange} schemes={naming.revisionSchemes} routing={naming.revisionRouting}
        deliverables={deliverables.map((d) => ({ code: d.code, label: d.label }))} phases={phaseValues.map((p) => ({ code: p.code, label: p.label }))} lead={lead} />
    </div>
  );
}
