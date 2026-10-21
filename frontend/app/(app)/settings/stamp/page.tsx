import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { isAdmin } from "@/lib/core/auth";
import { projectSettings, orgSettings } from "@/lib/settings/api";
import { liberty } from "@/lib/organization/liberty";
import { stampAnswers, stampOwn } from "@/lib/settings/stamp";
import { StampCard } from "@/components/stamp-card";
import { SETUP_PAGES, maySetup, mayChangeControlRoom } from "../setup-pages";
import { NoAccess } from "../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "The stamp" };

/**
 * The project's stamp (owner: a card of its own): the organization's is every project's; where the organization leaves
 * it free, the control function (or an administrator acting for the project) changes it here, the project keeping only
 * what differs. Fixed, it is read here and changed in the organization's Settings.
 */
export default async function StampPage() {
  const ctx = await requireScope();
  if (!maySetup(ctx.user, SETUP_PAGES.find((p) => p.href === "/settings/stamp")!)) return <NoAccess title="The stamp" who="control" />;
  const [own, organization, switches] = await Promise.all([projectSettings(ctx.projectId), orgSettings(), liberty()]);
  const free = switches.find((one) => one.key === "POLICY_PDF_STAMP")?.free ?? true;
  const mine = stampOwn(own);
  const project = ctx.project.code;
  const changes = mayChangeControlRoom(ctx.user);
  const lead = mine
    ? free
      ? `${project}'s own stamp, changed here; what it leaves as the organization's goes on following it.`
      : `${project}'s own stamp, changed here before the organization fixed it for every project: it stays as it is, and nothing more is changed here.`
    : free
      ? <>The organization&rsquo;s stamp. Projects may change it: a change here is {project}&rsquo;s own, which the organization&rsquo;s later changes never touch.{changes ? null : " Whoever acts as the control function changes it."}</>
      : <>The organization&rsquo;s stamp, the same on every project.{" "}
          {isAdmin(ctx.user)
            ? <>An administrator changes it in the organization&rsquo;s Settings: <Link href="/organization/settings/stamp" className="font-semibold text-link hover:underline">The stamp</Link>.</>
            : "An administrator changes it, for every project."}</>;
  return <StampCard initial={stampAnswers(organization, own)} level="project" editable={changes && free} lead={lead} />;
}
