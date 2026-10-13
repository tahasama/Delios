import "server-only";
import { departmentsOf } from "@/lib/schedule";
import { legacyActions, scheduleSource } from "@/lib/api/schedule";
import { actionState, DEFAULT_RISK_DAYS, type ActionState } from "@/lib/action-state";

export const PLAN_STAGES = ["Schedule", "Disciplines", "Requirements", "Documents ready"];

const HAS_EVERYTHING: ActionState[] = ["READY", "DONE", "LATE_RECEIPT"];

/**
 * How far the project is from knowing what every action needs: the stage it
 * has reached, and the one count that says why for each stage.
 */
export async function planProgress(scope: { projectId: string }, window?: { from: Date | null; to: Date | null }) {
  const [actions, { source, imports }] = await Promise.all([legacyActions(scope), scheduleSource(scope)]);
  const riskDays = source?.riskWindowDays ?? DEFAULT_RISK_DAYS;
  const inForce = imports.find((one) => one.status === "DONE") ?? null;
  const untagged = actions.filter((one) => !departmentsOf(one).length).map((one) => one.code);
  const pairs = actions.flatMap((one) => departmentsOf(one).map((department) => ({ action: one, department })));
  const answered = pairs.filter(({ action, department }) => action.entries.some((entry) => entry.department === department)).length;
  // Every document ready is asked of the actions in a window, never the whole
  // schedule: a month either side of today, or the dates the reader chose.
  const day = 24 * 60 * 60 * 1000;
  const from = window?.from ?? new Date(Date.now() - 30 * day);
  const to = window?.to ?? new Date(Date.now() + 30 * day);
  const inWindow = actions.filter((one) => one.scheduledDate && one.scheduledDate >= from && one.scheduledDate <= to);
  const listed = inWindow.filter((one) => one.entries.length);
  const complete = listed.filter((one) => HAS_EVERYTHING.includes(actionState(one, riskDays))).length;
  const at = !actions.length ? 0
    : untagged.length ? 1
      : answered < pairs.length || !listed.length ? 2
        : listed.length && complete === listed.length ? 4 : 3;
  return {
    at,
    schedule: source && actions.length ? { documentId: source.documentId, revision: inForce?.revisionValue ?? null, actions: actions.length } : null,
    tagged: actions.length - untagged.length,
    untagged,
    actions: actions.length,
    answered,
    asked: pairs.length,
    complete,
    listed: listed.length,
    window: { from, to, chosen: !!(window?.from || window?.to) },
  };
}
