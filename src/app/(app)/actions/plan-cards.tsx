import Link from "next/link";
import { fmtDate } from "@/lib/utils";
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
export async function PlanCards({ from = null, to = null, missing = 0, undated = 0 }: { from?: Date | null; to?: Date | null; missing?: number; undated?: number } = {}) {
  const ctx = await requireScope();
  const plans = ctx.can("PLAN") || ctx.can("CONTROL") || ctx.can("CONFIGURE");
  const [progress, lists] = await Promise.all([planProgress(ctx, { from, to }), plans ? planLists(ctx) : Promise.resolve([])]);

  const summary = (
    <div className="min-w-0 flex-1 basis-[30rem] space-y-1.5">
      <StagePath stages={PLAN_STAGES} at={progress.at} />
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-slate-500">
        {progress.schedule ? (
          <span>
            Dates from{" "}
            <Link href={`/documents/${progress.schedule.documentId}`} className="font-semibold text-link hover:underline">
              the schedule{progress.schedule.revision ? `, rev ${progress.schedule.revision}` : ""}
            </Link>
            {" "}· <Link href="/actions/schedules" className="text-link hover:underline">each version and its moved dates</Link>
          </span>
        ) : <span>No schedule yet</span>}
      </p>
      {/* The counts somebody came for, each in its own boxed field: a printed
          label, the figure in ink, pink where somebody is needed. */}
      {progress.actions ? (
        <div className="fields mt-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
          <div className="field">
            <span className="field-label">Documents ready</span>
            <span className="field-value">{progress.complete}<small>of {progress.listed}</small></span>
            <span className="field-note">{progress.window.chosen ? "dates chosen" : "a month either side of today"}: {fmtDate(progress.window.from)} → {fmtDate(progress.window.to)}</span>
          </div>
          <Link href="/actions?happened=WITHOUT&all=1" className="field" data-tone={missing ? "needs" : undefined}>
            <span className="field-label">Went ahead, documents missing</span>
            <span className="field-value">{missing}</span>
            <span className="field-note">every date</span>
          </Link>
          <Link href="/actions?view=table&nodate=1" className="field" data-tone={undated ? "needs" : undefined}>
            <span className="field-label">No date</span>
            <span className="field-value">{undated}</span>
            <span className="field-note">listed in the table only</span>
          </Link>
          <div className="field" data-tone={progress.untagged.length ? "needs" : undefined}>
            <span className="field-label">Disciplines tagged</span>
            <span className="field-value">{progress.tagged}<small>of {progress.actions}</small></span>
            {progress.untagged.length ? (
              <span className="field-note">
                missing: {progress.untagged.slice(0, 4).map((code, i) => <span key={code}>{i ? ", " : ""}<Link href={`/actions/${code}`} className="font-semibold text-link hover:underline">{code}</Link></span>)}
                {progress.untagged.length > 4 ? <> and <Link href="/actions?view=table&untagged=1" className="font-semibold text-link hover:underline">{progress.untagged.length - 4} more</Link></> : null}
              </span>
            ) : <span className="field-note">every action</span>}
          </div>
          <div className="field">
            <span className="field-label">Discipline lists</span>
            <span className="field-value">{progress.answered}<small>of {progress.asked}</small></span>
            <span className="field-note">disciplines that said what each action needs</span>
          </div>
        </div>
      ) : null}
    </div>
  );
  if (!plans) return summary;

  const LABEL: Record<string, string> = { SCHEDULE: "Schedule", DEPARTMENTS: "Disciplines", REQUIREMENTS: "Requirements" };
  return <UploadSwitch line={summary} panels={lists.map((list) => ({ kind: list.kind, label: LABEL[list.kind], panel: <PlanListPanel list={list} control={ctx.can("CONTROL") || ctx.can("PLAN")} /> }))} />;
}
