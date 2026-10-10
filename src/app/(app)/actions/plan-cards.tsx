import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { planLists } from "@/lib/plan-lists";
import { planProgress, PLAN_STAGES } from "@/lib/plan-progress";
import { StagePath } from "../documents/[id]/next-step";
import { PlanListPanel } from "./plan-list-panel";
import { UploadSwitch } from "./upload-switch";

/**
 * How far the schedule has come — the stages in a row, each with its own count
 * under it — and, for whoever plans the project, its three uploads in the order they are
 * done: the schedule, the disciplines each action concerns, the documents each
 * discipline needs.
 */
export async function PlanCards({ from = null, to = null }: { from?: Date | null; to?: Date | null } = {}) {
  const ctx = await requireScope();
  const plans = ctx.can("PLAN") || ctx.can("CONTROL") || ctx.can("CONFIGURE");
  const [progress, lists] = await Promise.all([planProgress(ctx, { from, to }), plans ? planLists(ctx) : Promise.resolve([])]);
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  // Each stage carries its own count, so the row reads as one thing.
  const under: React.ReactNode[] = [
    progress.schedule ? (
      <>
        <Link href={`/documents/${progress.schedule.documentId}`} className="font-semibold text-link hover:underline">
          {progress.schedule.revision ? `Rev ${progress.schedule.revision}` : "Its document"}
        </Link>
        {" · "}<Link href="/actions/schedules" className="text-link hover:underline">versions</Link>
      </>
    ) : "None yet",
    progress.actions ? (
      <>
        {progress.tagged} of {progress.actions} tagged
        {progress.untagged.length ? <>{" · "}<Link href="/actions?view=table&untagged=1" className="font-semibold text-amber-800 hover:underline">{progress.untagged.length} untagged</Link></> : null}
      </>
    ) : null,
    progress.actions ? <>{progress.answered} of {progress.asked} lists</> : null,
    progress.actions ? (
      <span title={progress.window.chosen ? "Actions within the dates chosen" : "Actions within a month either side of today"}>
        {progress.complete} of {progress.listed} · {day(progress.window.from)} – {day(progress.window.to)}
      </span>
    ) : null,
  ];

  const summary = (
    <div className="min-w-0 flex-1 basis-[30rem]">
      <StagePath stages={PLAN_STAGES} at={progress.at} under={under} />
    </div>
  );
  if (!plans) return summary;

  const LABEL: Record<string, string> = { SCHEDULE: "Schedule", DEPARTMENTS: "Disciplines", REQUIREMENTS: "Requirements" };
  return <UploadSwitch line={summary} panels={lists.map((list) => ({ kind: list.kind, label: LABEL[list.kind], panel: <PlanListPanel list={list} control={ctx.can("CONTROL") || ctx.can("PLAN")} /> }))} />;
}
