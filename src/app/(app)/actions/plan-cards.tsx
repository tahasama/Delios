import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { planLists } from "@/lib/plan-lists";
import { planProgress, PLAN_STAGES } from "@/lib/plan-progress";
import { StagePath } from "../documents/[id]/next-step";
import { PlanListPanel } from "./plan-list-panel";
import { UploadSwitch } from "./upload-switch";

/**
 * How far the schedule has come — the stages in a row, each with the revision
 * in force under it — and, for whoever plans the project, its three uploads in the order they are
 * done: the schedule, the disciplines each action concerns, the documents each
 * discipline needs.
 */
export async function PlanCards({ from = null, to = null }: { from?: Date | null; to?: Date | null } = {}) {
  const ctx = await requireScope();
  const plans = ctx.can("PLAN") || ctx.can("CONTROL") || ctx.can("CONFIGURE");
  const [progress, lists] = await Promise.all([planProgress(ctx, { from, to }), planLists(ctx).catch(() => [])]);
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  // Under each list stage: the revision in force, linked to its document, that it was uploaded
  // directly, or that there is none.
  const inForce = (kind: string) => {
    const list = lists.find((one) => one.kind === kind);
    // Uploaded here without a document, after any document's read: that is what is in force.
    if (list?.direct) {
      const { at, by, why } = list.direct;
      return <span className="text-amber-800" title={[by ? `By ${by}` : null, why ? `Why: ${why}` : null].filter(Boolean).join("\n") || undefined}>Uploaded directly, {day(at)}</span>;
    }
    const docs = list?.documents ?? [];
    const released = docs.filter((one) => one.released);
    if (!docs.length) return "None yet";
    if (!released.length) return "Not released yet";
    if (released.length > 1) return `${released.length} documents in force`;
    return <Link href={`/documents/${released[0].id}`} className="font-semibold text-link hover:underline">Rev {released[0].released!.value}</Link>;
  };
  const under: React.ReactNode[] = [
    inForce("SCHEDULE"),
    <>
      {inForce("DEPARTMENTS")}
      {/* Only a problem is counted here: actions no discipline is tagged on. */}
      {progress.untagged.length ? <>{" · "}<Link href="/actions?view=table&untagged=1" className="font-semibold text-amber-800 hover:underline">{progress.untagged.length} untagged</Link></> : null}
    </>,
    inForce("REQUIREMENTS"),
    // Counted only in the window: a month either side of today, or the dates chosen.
    progress.actions ? (
      <span title={progress.window.chosen ? "Actions within the dates chosen" : "Actions within a month either side of today"}>
        <span className={`font-semibold ${!progress.listed ? "text-slate-600" : progress.complete === progress.listed ? "text-emerald-700" : "text-amber-800"}`}>
          {progress.complete} of {progress.listed} ready
        </span>
        <span className="block">{day(progress.window.from)} – {day(progress.window.to)}</span>
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
