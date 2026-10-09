import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { Card } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import { StagePath } from "../../documents/[id]/next-step";
import { departmentsOf } from "@/lib/schedule";
import { getSet } from "@/lib/config";
import { legacyActions, scheduleSource } from "@/lib/api/schedule";
import { backendDocument } from "@/lib/api/legacy";
import { planLists, type PlanListKind } from "@/lib/plan-lists";
import { actionState, ACTION_STATES, DEFAULT_RISK_DAYS, type ActionState } from "@/lib/action-state";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Document requirements" };

const STAGES = ["Schedule", "Disciplines per action", "Document requirements", "Documents ready"];
const HAS_EVERYTHING: ActionState[] = ["READY", "DONE", "LATE_RECEIPT"];

/**
 * How far the project is from knowing what every action needs, drawn the way
 * the app draws every process: the stages in a row, then one point per stage
 * with its date, its count and what is still missing. Each list is uploaded on
 * the schedule and put in force by releasing its document.
 */
export default async function RequirementsPage() {
  const ctx = await requireScope();
  const [actions, lists, disciplines, { source }] = await Promise.all([
    legacyActions(ctx),
    planLists(ctx),
    getSet("DISCIPLINES"),
    scheduleSource(ctx),
  ]);
  const deptName = (code: string) => disciplines.find((one) => one.code === code)?.label ?? code;
  const riskDays = source?.riskWindowDays ?? DEFAULT_RISK_DAYS;

  // Each list's document, and its latest released revision: the one in force.
  const released = async (kind: PlanListKind) => {
    const doc = lists.find((one) => one.kind === kind)?.documents[0] ?? null;
    if (!doc) return { doc: null, revision: null as { value: string; releasedAt: Date } | null };
    const view = await backendDocument(ctx, doc.id);
    const last = [...(view?.revisions ?? [])].reverse().find((one) => one.releasedAt);
    return { doc, revision: last ? { value: last.value, releasedAt: new Date(last.releasedAt!) } : null };
  };
  const [schedule, tags, needs] = await Promise.all([released("SCHEDULE"), released("DEPARTMENTS"), released("REQUIREMENTS")]);

  const tagged = actions.filter((one) => departmentsOf(one).length);
  const untagged = actions.filter((one) => !departmentsOf(one).length);
  // Every (action, discipline) the tags ask about, and whether the requirements list answers it.
  const pairs = tagged.flatMap((one) => departmentsOf(one).map((department) => ({ action: one, department })));
  const unanswered = pairs.filter(({ action, department }) => !action.entries.some((entry) => entry.department === department));
  const byDiscipline = [...new Set(pairs.map((one) => one.department))].sort().map((department) => ({
    department,
    documents: tagged.flatMap((one) => one.entries).filter((entry) => entry.department === department).length,
    missing: unanswered.filter((one) => one.department === department).map((one) => one.action.code),
  }));
  const stateOf = new Map(actions.map((one) => [one.id, actionState(one, riskDays)]));
  const counts = new Map<ActionState, number>();
  for (const state of stateOf.values()) counts.set(state, (counts.get(state) ?? 0) + 1);
  const listed = actions.filter((one) => one.entries.length);
  const complete = listed.filter((one) => HAS_EVERYTHING.includes(stateOf.get(one.id)!));

  const at = !schedule.revision || !actions.length ? 0
    : untagged.length ? 1
      : unanswered.length || !listed.length ? 2
        : complete.length === listed.length ? 4 : 3;
  const docLink = (doc: { id: string } | null, revision: { value: string } | null, words: string) =>
    doc ? <Link href={`/documents/${doc.id}`} className="font-semibold text-link hover:underline">{words}{revision ? `, rev ${revision.value}` : ""}</Link> : null;
  const codes = (list: string[]) => (
    <span className="font-mono">
      {list.slice(0, 12).map((code, i) => <span key={code}>{i ? ", " : ""}<Link href={`/actions/${code}`} className="text-link hover:underline">{code}</Link></span>)}
      {list.length > 12 ? ` and ${list.length - 12} more` : ""}
    </span>
  );

  return (
    <section className="register register-sheet register-sheet-open">
      <div className="border-b border-line px-5 pt-6 pb-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="plate-title min-w-0 text-slate-950">Document requirements</h1>
          <Link href="/actions" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Schedule</Link>
        </div>
        <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-500">
          How far the project is from knowing what every action needs. Each list is uploaded on the schedule; releasing it puts it in force.
        </p>
        <div className="mt-4">
          <StagePath stages={STAGES} at={at} />
        </div>
      </div>

      <div className="px-5 py-5 sm:px-6">
        <Card className="max-w-3xl">
          <Timeline
            points={[
              {
                label: "Schedule released",
                at: schedule.revision?.releasedAt ?? null,
                holder: actions.length ? `${actions.length} action${actions.length === 1 ? "" : "s"}` : "no action yet",
                here: at === 0,
                detail: docLink(schedule.doc, schedule.revision, "The schedule") ?? "No schedule yet: upload it on the schedule.",
              },
              {
                label: "Disciplines tagged",
                at: tags.revision && actions.length && !untagged.length ? tags.revision.releasedAt : null,
                holder: `${tagged.length} of ${actions.length} actions`,
                here: at === 1,
                detail: (
                  <>
                    {docLink(tags.doc, tags.revision, "Disciplines per action")}
                    {untagged.length ? <p className="mt-1 text-amber-800">No discipline yet: {codes(untagged.map((one) => one.code))}</p> : null}
                  </>
                ),
              },
              {
                label: "Requirements listed",
                at: needs.revision && pairs.length && !unanswered.length ? needs.revision.releasedAt : null,
                holder: `${pairs.length - unanswered.length} of ${pairs.length} discipline answers`,
                here: at === 2,
                detail: (
                  <>
                    {docLink(needs.doc, needs.revision, "Document requirements")}
                    {byDiscipline.length ? (
                      <ul className="mt-1.5 space-y-0.5">
                        {byDiscipline.map((one) => (
                          <li key={one.department}>
                            <span className="font-semibold text-slate-700">{deptName(one.department)}</span>
                            <span className="text-slate-500"> · {one.documents} document{one.documents === 1 ? "" : "s"}</span>
                            {one.missing.length ? <span className="text-amber-800"> · nothing listed for {codes(one.missing)}</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ),
              },
              {
                label: "Documents ready",
                at: null,
                holder: listed.length ? `${complete.length} of ${listed.length} actions have everything` : "nothing listed yet",
                here: at >= 3,
                detail: listed.length ? (
                  <p className="flex flex-wrap gap-x-3 gap-y-1">
                    {ACTION_STATES.filter((one) => counts.get(one.code)).map((one) => (
                      <Link key={one.code} href={`/actions?view=table&state=${one.code}`} className="text-link hover:underline">
                        {counts.get(one.code)} {one.label.toLowerCase()}
                      </Link>
                    ))}
                  </p>
                ) : null,
              },
            ]}
          />
        </Card>
      </div>
    </section>
  );
}
