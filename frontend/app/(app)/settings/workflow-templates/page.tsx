import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { projectRoutes } from "@/lib/settings/api-admin";
import { RoutesBoard } from "./routes-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review routes" };

/**
 * The review routes this project offers. Two levels (owner): the organization's routes are every project's; where the
 * organization left routes free (the default), the control function changes them here, its first change giving the
 * project its own copy. Otherwise they are read here, and changed in the organization's Settings.
 */
export default async function WorkflowTemplatesPage() {
  const ctx = await requireScope();
  const routes = await projectRoutes();
  const project = ctx.project.code;
  const lead = routes.own
    ? routes.free
      ? `${project}'s own review routes, changed here. The organization's later changes do not touch them.`
      : `${project}'s own review routes, changed here before the organization fixed them for every project: they stay as they are, and nothing more is changed here.`
    : routes.free
      ? <>The organization&rsquo;s review routes. Projects may change them: a change here gives {project} its own copy, which the organization&rsquo;s later changes never touch.{routes.mayChange ? null : " Whoever acts as the control function changes them."}</>
      : <>The organization&rsquo;s review routes, the same on every project.{" "}
          {routes.mayChangeOrganization
            ? <>An administrator changes them in the organization&rsquo;s Settings: <Link href="/organization/settings/routes" className="font-semibold text-link hover:underline">Review routes</Link>.</>
            : "An administrator changes them, for every project."}</>;
  return <RoutesBoard level="project" editable={routes.mayChange} lead={lead} />;
}
