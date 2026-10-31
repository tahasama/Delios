import { Fragment } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { mayUploadLists } from "@/lib/core/permissions";
import { requireScope } from "@/lib/core/scope";
import { planLists } from "@/lib/actions/plan-lists";
import { planProgress, PLAN_STAGES } from "@/lib/actions/plan-progress";
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
  // Who uploads the lists: the control function, or a function given Plan. The backend refuses anyone else.
  // Who uploads the lists: one rule, the backend's (Control or Plan held outright).
  const plans = mayUploadLists(ctx.user.verbs);
  const [progress, lists] = await Promise.all([planProgress(ctx, { from, to }), planLists(ctx)]);
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  // Under each list stage: the revision in force, linked to its document, that it was uploaded
  // directly, or that there is none.
  const inForce = (kind: string) => {
    // The lists are ours: another organization's people see only what they need, under the last stage.
    if (!ctx.user.isInternal) return null;
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
    if (released.length > 1) return `${released.length} documents released`;
    return <Link href={`/documents/${released[0].id}`} className="font-semibold text-link hover:underline">Rev {released[0].released!.value}</Link>;
  };
  // The file the list in force was read from, as it came (owner: "that same file should be downloadable as is").
  const file = (kind: string) => {
    const list = lists.find((one) => one.kind === kind);
    const read = !!list?.direct || !!list?.documents.some((one) => one.released && one.read);
    return ctx.user.isInternal && read ? (
      <a href={`/api/schedule/lists/${kind}`} title="Download the file it was read from, as it came" aria-label="Download the file it was read from"
        className="ml-1 inline-flex align-middle text-slate-500 hover:text-link"><Download className="h-3.5 w-3.5" /></a>
    ) : null;
  };
  const under: React.ReactNode[] = [
    <>{inForce("SCHEDULE")}{file("SCHEDULE")}</>,
    <>
      {inForce("DEPARTMENTS")}{file("DEPARTMENTS")}
      {/* Only a problem is counted here: actions no discipline is tagged on. */}
      {progress.untagged ? <>{" · "}<Link href="/schedule?view=table&untagged=1" className="font-semibold text-amber-800 hover:underline">{progress.untagged} untagged</Link></> : null}
    </>,
    <>{inForce("REQUIREMENTS")}{file("REQUIREMENTS")}</>,
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

  const keyed = under.map((node, i) => <Fragment key={i}>{node}</Fragment>);
  // Whoever plans the project opens each list's upload from its own stage.
  const STAGE: Record<string, number> = { SCHEDULE: 0, DEPARTMENTS: 1, REQUIREMENTS: 2 };
  // Whoever holds Manage opens them too: to read a list again from its other source, never to upload one.
  const switcher = ctx.user.isInternal && (ctx.can("CONTROL") || ctx.can("MANAGE"));
  const panels = plans || switcher
    ? lists.map((list) => ({ stage: STAGE[list.kind], kind: list.kind, panel: <PlanListPanel list={list} control={plans} switcher={switcher} projectCode={ctx.project.code} /> }))
    : [];
  return <UploadSwitch stages={PLAN_STAGES} at={progress.at} under={keyed} panels={panels} />;
}
