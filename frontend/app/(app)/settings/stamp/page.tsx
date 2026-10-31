import { ExceptionNote } from "@/lib/settings/exception";
import { cookies } from "next/headers";
import { PREF, paneWidth } from "@/lib/core/preferences";
import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { isAdmin } from "@/lib/core/auth";
import { projectSettings, orgSettings } from "@/lib/settings/api";
import { projectLiberty } from "@/lib/organization/liberty";
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
  const [own, organization, switches, jar] = await Promise.all([projectSettings(ctx.projectId), orgSettings(), projectLiberty(ctx.projectId), cookies()]);
  const item = switches.find((one) => one.key === "POLICY_PDF_STAMP");
  const free = item?.free ?? true;
  const exception = item?.exceptHere ? item.except.find((e) => e.projectId === ctx.projectId) : undefined;
  const mine = stampOwn(own);
  const project = ctx.project.code;
  const changes = mayChangeControlRoom(ctx.user);
  const lead = mine
    ? free
      ? exception
        ? <>{project}&rsquo;s own stamp, changed here; what it leaves as the organization&rsquo;s goes on following it. <ExceptionNote project={project} what="the stamp" exception={exception} /></>
        : `${project}'s own stamp, changed here; what it leaves as the organization's goes on following it.`
      : `${project}'s own stamp, changed here before the organization fixed it for every project: it stays as it is, and nothing more is changed here.`
    : free && exception
      ? <>The organization&rsquo;s stamp. <ExceptionNote project={project} what="the stamp" exception={exception} /> A change here is {project}&rsquo;s own, which the organization&rsquo;s later changes never touch.{changes ? null : " Whoever acts as the control function changes it."}</>
    : free
      ? <>The organization&rsquo;s stamp. Projects may change it: a change here is {project}&rsquo;s own, which the organization&rsquo;s later changes never touch.{changes ? null : " Whoever acts as the control function changes it."}</>
      : <>The organization&rsquo;s stamp, the same on every project.{" "}
          {isAdmin(ctx.user)
            ? <>An administrator changes it in the organization&rsquo;s Settings: <Link href="/organization/settings/stamp" className="font-semibold text-link hover:underline">The stamp</Link>.</>
            : "An administrator changes it, for every project."}</>;
  return <StampCard initial={stampAnswers(organization, own)} level="project" editable={changes && free} lead={lead} pane={paneWidth(jar.get(PREF.stampPane)?.value)} />;
}
