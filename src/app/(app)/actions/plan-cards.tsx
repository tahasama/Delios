import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { planLists } from "@/lib/plan-lists";
import { planProgress, PLAN_STAGES } from "@/lib/plan-progress";
import { StagePath } from "../documents/[id]/next-step";
import { PlanListPanel } from "./plan-list-panel";
import { UploadSwitch } from "./upload-switch";

/**
 * How far the schedule has come — the stages in a row, then one line of counts —
 * and, for whoever plans the project, its three uploads in the order they are
 * done: the schedule, the disciplines each action concerns, the documents each
 * discipline needs.
 */
export async function PlanCards() {
  const ctx = await requireScope();
  const plans = ctx.can("PLAN") || ctx.can("CONTROL") || ctx.can("CONFIGURE");
  const [progress, lists] = await Promise.all([planProgress(ctx), plans ? planLists(ctx) : Promise.resolve([])]);
  const dot = <span aria-hidden className="text-slate-300">·</span>;

  const summary = (
    <div className="min-w-0 flex-1 basis-[30rem] space-y-1.5">
      <StagePath stages={PLAN_STAGES} at={progress.at} />
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-slate-500">
        {progress.schedule ? (
          <span>
            Dates from{" "}
            <Link href={`/documents/${progress.schedule.documentId}`} className="font-semibold text-link hover:underline">
              the schedule{progress.schedule.revision ? `, rev ${progress.schedule.revision}` : ""}
            </Link>
          </span>
        ) : <span>No schedule yet</span>}
        {progress.actions ? (
          <>
            {dot}
            <span>
              {progress.tagged} of {progress.actions} actions tagged
              {progress.untagged.length ? (
                <span className="text-amber-800"> (missing: {progress.untagged.slice(0, 6).map((code, i) => <span key={code}>{i ? ", " : ""}<Link href={`/actions/${code}`} className="font-mono hover:underline">{code}</Link></span>)}{progress.untagged.length > 6 ? "…" : ""})</span>
              ) : null}
            </span>
            {dot}
            <span>{progress.answered} of {progress.asked} discipline lists</span>
            {dot}
            <span>{progress.complete} of {progress.listed} actions have every document</span>
          </>
        ) : null}
      </p>
    </div>
  );
  if (!plans) return summary;

  const LABEL: Record<string, string> = { SCHEDULE: "Schedule", DEPARTMENTS: "Disciplines", REQUIREMENTS: "Requirements" };
  return <UploadSwitch line={summary} panels={lists.map((list) => ({ kind: list.kind, label: LABEL[list.kind], panel: <PlanListPanel list={list} control={ctx.can("CONTROL") || ctx.can("PLAN")} /> }))} />;
}
