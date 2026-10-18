import Link from "next/link";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/core/scope";
import { PageHeader } from "@/components/ui";
import { getSets, getActiveSet } from "@/lib/settings/config";
import { numberingForEditor, NUMBERING_SETS } from "@/lib/settings/api-admin";
import { api, projectPath } from "@/lib/client";
import { NoAccess } from "../no-access";
import { NumberingBoard } from "./board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Numbering" };

/**
 * The numbering this project uses. Two levels (owner): the organization's numbering is every project's; where the
 * organization left numbering free (What projects may change), the control function may change it here, its first change
 * giving the project its own copy. Otherwise it is read here, and changed on the organization's page.
 */
export default async function NumberingPage({ searchParams }: { searchParams: Promise<{ edit?: string; new?: string }> }) {
  const ctx = await requireScope();
  if (!maySetup(ctx.user, SETUP_PAGES.find((p) => p.href === "/settings/numbering")!)) {
    return <NoAccess title="Numbering" who="control" />;
  }
  const params = await searchParams;
  const [numbering, sets, deliverables] = await Promise.all([
    numberingForEditor("project"),
    // A part reads one of the app's numbering lists, or a list of the project's own in Numbering & identity.
    Promise.all([getSets(), api<{ lists: { key: string; group: string; app: boolean }[] }>(projectPath(ctx, "/lists")).catch(() => ({ lists: [] }))])
      .then(([all, read]) => {
        const own = new Set(read.lists.filter((l) => !l.app && l.group === "NUMBERING").map((l) => l.key));
        return all.filter((one) => NUMBERING_SETS.includes(one.key) || own.has(one.key));
      }),
    getActiveSet("DELIVERABLE_TYPES"),
  ]);
  const project = ctx.project.code;
  const said = numbering.own
    ? numbering.free
      ? `${project}'s own numbering, changed here. The organization's later changes do not touch it.`
      : `${project}'s own numbering, changed here before the organization fixed numbering for every project: it stays as it is, and nothing more is changed here.`
    : numbering.free
      ? `The organization's numbering. Projects may change it: a change here gives ${project} its own copy, which the organization's later changes never touch.`
      : "The organization's numbering, the same on every project.";

  return (
    <div className="space-y-4">
      <PageHeader title="Numbering" subtitle="Everything the register numbers, and the scheme it is numbered by. The codes that fill a scheme's parts live in Types & sets." />
      <p className="text-xs leading-5 text-slate-600">
        {said}
        {!numbering.free && !numbering.own ? (
          numbering.mayChangeOrganization
            ? <> An administrator changes it on the organization&rsquo;s page: <Link href="/organization/numbering" className="font-semibold text-link hover:underline">Numbering</Link>.</>
            : <> An administrator changes it, for every project.</>
        ) : null}
        {numbering.free && !numbering.mayChange ? <> Whoever acts as the control function changes it.</> : null}
      </p>
      <NumberingBoard level="project" editable={numbering.mayChange} schemes={numbering.schemes} routing={numbering.routing}
        deliverables={deliverables.map((d) => ({ code: d.code, label: d.label }))} sets={sets.map((s) => ({ key: s.key, title: s.title }))}
        editId={params.edit} adding={params.new === "1"} here="/settings/numbering" />
    </div>
  );
}
