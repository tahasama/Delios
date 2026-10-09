import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { scheduleSource } from "@/lib/api/schedule";
import { planLists } from "@/lib/plan-lists";
import { PlanListPanel } from "./plan-list-panel";
import { UploadSwitch } from "./upload-switch";

/**
 * Where the dates come from, said in words, and the way to the requirements;
 * and, for whoever plans the project, its three uploads in the order they are
 * done: the schedule, then the disciplines each action concerns, then the
 * documents each discipline needs.
 */
export async function PlanCards() {
  const ctx = await requireScope();
  const plans = ctx.can("PLAN") || ctx.can("CONTROL") || ctx.can("CONFIGURE");
  const [{ source, imports }, lists] = await Promise.all([scheduleSource(ctx), plans ? planLists(ctx) : Promise.resolve([])]);
  const inForce = imports.find((one) => one.status === "DONE") ?? null;

  const line = (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-500">
      {source && inForce ? (
        <span>Dates from <Link href={`/documents/${source.documentId}`} className="font-semibold text-link hover:underline">the schedule, rev {inForce.revisionValue}</Link></span>
      ) : (
        <span>No schedule released yet</span>
      )}
      <span aria-hidden className="text-slate-300">·</span>
      <Link href="/actions/requirements" className="font-semibold text-link hover:underline">Requirements</Link>
    </p>
  );
  if (!plans) return line;

  const LABEL: Record<string, string> = { SCHEDULE: "Schedule", DEPARTMENTS: "Disciplines per action", REQUIREMENTS: "Document requirements" };
  return <UploadSwitch line={line} panels={lists.map((list) => ({ kind: list.kind, label: LABEL[list.kind], panel: <PlanListPanel list={list} /> }))} />;
}
