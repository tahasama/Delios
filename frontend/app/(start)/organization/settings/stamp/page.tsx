import Link from "next/link";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { orgSettings } from "@/lib/settings/api";
import { liberty } from "@/lib/organization/liberty";
import { stampAnswers } from "@/lib/settings/stamp";
import { StampCard } from "@/components/stamp-card";
import { ProjectSwitches } from "../switches";

export const dynamic = "force-dynamic";
export const metadata = { title: "The stamp" };

/**
 * The organization's stamp (owner: a card of its own, at both levels): every project's default, changed here by an
 * administrator; its switch says whether a project may change its own.
 */
export default async function OrganizationStampPage() {
  const scope = await requireOrgAdmin();
  const [organization, switches] = await Promise.all([orgSettings(), liberty()]);
  return (
    <>
      <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
        <Link href="/organization/settings" className="hover:underline">{scope.organization.name} · Settings</Link>
      </p>
      <StampCard initial={stampAnswers(organization)} level="organization" editable
        lead="Every project's stamp. Changed here, it changes for every project reading it; a project that took its own keeps it." />
      <ProjectSwitches items={switches.filter((one) => one.area === "The stamp")} />
    </>
  );
}
