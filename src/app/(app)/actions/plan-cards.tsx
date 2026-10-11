import { Fragment } from "react";
import Link from "next/link";
import { mayUploadLists } from "@/lib/permissions";
import { requireScope } from "@/lib/scope";
import { planLists } from "@/lib/plan-lists";
import { planProgress, PLAN_STAGES } from "@/lib/plan-progress";
import { PlanListPanel } from "./plan-list-panel";
import { UploadSwitch } from "./upload-switch";

/**
 * How far the schedule has come — the stages in a row, each with the revision
 * in force under it. For whoever plans the project, the first three stages are
 * also its uploads: the schedule, the disciplines each action concerns, the
 * documents each discipline needs.
 */
export async function PlanCards({ from = null, to = null }: { from?: Date | null; to?: Date | null } = {}) {
  const ctx = await requireScope();
  const plans = mayUploadLists(ctx.user.verbs);
  const [progress, lists] = await Promise.all([planProgress(ctx, { from, to }), planLists(ctx).catch(() => [])]);
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  const STATE: Record<string, string> = { IN_PREPARATION: "in preparation", IN_REVIEW: "in review", RECEIVED: "received", CORRECTING: "being corrected" };
  // Under each list: what is in force, then the one detail worth knowing about it.
  const listLines = (kind: string, extra?: React.ReactNode) => {
    const list = lists.find((one) => one.kind === kind);
    const docs = list?.documents ?? [];
    const released = docs.filter((one) => one.released);
    const coming = docs.find((one) => one.pending)?.pending ?? null;
    const comingLine = coming ? <p>Rev {coming.value} {STATE[coming.state] ?? coming.state.replaceAll("_", " ").toLowerCase()}</p> : null;
    // Uploaded here without a document, after any document's read: that is what is in force.
    if (list?.direct) {
      const { at, by, why } = list.direct;
      return (
        <>
          <p className="font-semibold text-amber-800" title={why ? `Why: ${why}` : undefined}>Uploaded directly, {day(at)}</p>
          {by ? <p>by {by}</p> : null}
          {extra}
        </>
      );
    }
    if (!docs.length) return <><p className="font-semibold text-slate-600">None yet</p>{extra}</>;
    if (!released.length) return <><p className="font-semibold text-slate-600">Not released yet</p>{comingLine}{extra}</>;
    const first = released[0];
    return (
      <>
        <p>
          {released.length > 1
            ? <span className="font-semibold text-slate-700">{released.length} documents in force</span>
            : <Link href={`/documents/${first.id}`} className="font-semibold text-link hover:underline">Rev {first.released!.value}</Link>}
          {released.every((one) => one.read) ? <span> · read</span> : <span className="text-amber-800"> · not read yet</span>}
        </p>
        {comingLine}
        {extra}
      </>
    );
  };
  // Only a problem is counted here: actions no discipline is tagged on.
  const untagged = progress.untagged.length
    ? <p><Link href="/actions?view=table&untagged=1" className="font-semibold text-amber-800 hover:underline">{progress.untagged.length} action{progress.untagged.length === 1 ? "" : "s"} untagged</Link></p>
    : null;
  const under: React.ReactNode[] = [listLines("SCHEDULE"), listLines("DEPARTMENTS", untagged), listLines("REQUIREMENTS")];

  // The result the three lists feed: counted only in the window, a month either side of today or the dates chosen.
  const outcome = progress.actions ? (
    <>
      <p className={`text-[13px] font-semibold ${!progress.listed ? "text-slate-600" : progress.complete === progress.listed ? "text-emerald-700" : "text-amber-800"}`}>
        {progress.complete} of {progress.listed} actions ready
      </p>
      <p title={progress.window.chosen ? "The dates chosen" : "A month either side of today"}>{day(progress.window.from)} – {day(progress.window.to)}</p>
    </>
  ) : <p>No actions yet</p>;

  const keyed = under.map((node, i) => <Fragment key={i}>{node}</Fragment>);
  const [listStages, resultStage] = [PLAN_STAGES.slice(0, 3), PLAN_STAGES[3]];
  // Whoever plans the project opens each list's upload from its own stage.
  const STAGE: Record<string, number> = { SCHEDULE: 0, DEPARTMENTS: 1, REQUIREMENTS: 2 };
  const panels = plans
    ? lists.map((list) => ({ stage: STAGE[list.kind], kind: list.kind, panel: <PlanListPanel list={list} control /> }))
    : [];
  return <UploadSwitch stages={listStages} at={progress.at} under={keyed} result={{ name: resultStage, current: progress.at >= 3, lines: outcome }} panels={panels} />;
}
