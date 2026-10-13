import { meetsRequirement } from "@/lib/schedule/readiness";

/**
 * Where an action stands, said once for every page that shows it. The schedule
 * and the action's own page used to work it out each in their own way, and an
 * action could read "Still ahead" on one and "At risk" on the other.
 *
 * Seven states, and they are not degrees of the same thing:
 * - nothing listed — no document is asked for;
 * - done — every document was there by the day;
 * - late receipt — every document is there, the last after the day;
 * - ready — every document is there and the day is still ahead;
 * - overdue — the day has passed with something still missing;
 * - at risk — the action's day is within a missing document's risk window
 *   (its own from the requirements list, or the project's), counted back from the day;
 * - still ahead — something is missing, but nothing is owed soon.
 */
export type ActionState = "DONE" | "LATE_RECEIPT" | "READY" | "UPCOMING" | "AT_RISK" | "NOT_READY" | "UNKNOWN";

export const ACTION_STATES: { code: ActionState; label: string }[] = [
  { code: "DONE", label: "Done" },
  { code: "LATE_RECEIPT", label: "Late receipt" },
  { code: "READY", label: "Ready" },
  { code: "UPCOMING", label: "Still ahead" },
  { code: "AT_RISK", label: "At risk" },
  { code: "NOT_READY", label: "Overdue" },
  { code: "UNKNOWN", label: "Nothing listed" },
];

export const stateLabel = (state: ActionState) => ACTION_STATES.find((one) => one.code === state)!.label;

/** Days before an action's day that a missing document puts it at risk, unless the project or the document says otherwise. */
export const DEFAULT_RISK_DAYS = 7;

const DAY = 86_400_000;

type Stateful = {
  scheduledDate: Date | null;
  lastMetAt: Date | null;
  entries: { requiredBy: Date; requiredStatus: string; riskDays?: number | null; document: { revisions: { statusCode: string | null; meets?: boolean }[] } }[];
};

/** The start of the day `now` falls in: a day passes at midnight, not 24 hours after it began. */
function startOfDay(now: Date): Date {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day;
}

/** Whether the action's day is over: before today, not merely earlier than this minute. */
export function dayHasPassed(action: { scheduledDate: Date | null }, now = new Date()): boolean {
  return !!action.scheduledDate && action.scheduledDate < startOfDay(now);
}

export function actionState(action: Stateful, riskDays = DEFAULT_RISK_DAYS, now = new Date()): ActionState {
  const total = action.entries.length;
  if (!total) return "UNKNOWN";
  const missing = action.entries.filter((entry) => !meetsRequirement(entry.document.revisions, entry.requiredStatus));
  const passed = dayHasPassed(action, now);
  if (!missing.length) {
    if (!passed) return "READY";
    const afterwards = !!action.lastMetAt && !!action.scheduledDate && action.lastMetAt > action.scheduledDate;
    return afterwards ? "LATE_RECEIPT" : "DONE";
  }
  if (passed) return "NOT_READY";
  const from = riskFrom(action, riskDays);
  return from && from.getTime() <= now.getTime() ? "AT_RISK" : "UPCOMING";
}

/**
 * The day an action is at risk from, and its departments confirm by hand: its
 * day less the longest-reaching risk window of a document still missing. The
 * backend writes the same day (Activity.RiskFrom). Null when nothing is missing
 * or there is no day.
 */
export function riskFrom<E extends Stateful["entries"][number]>(
  action: { scheduledDate: Date | null; entries: E[] }, riskDays = DEFAULT_RISK_DAYS, only?: (entry: E) => boolean,
): Date | null {
  if (!action.scheduledDate) return null;
  const missing = action.entries.filter((entry) => (!only || only(entry)) && !meetsRequirement(entry.document.revisions, entry.requiredStatus));
  if (!missing.length) return null;
  const day = startOfDay(action.scheduledDate).getTime();
  return new Date(Math.min(...missing.map((entry) => day - (entry.riskDays ?? riskDays) * DAY)));
}

/**
 * Whether an action was postponed: a decision from the organization's list that
 * does not proceed, not taken back by Document Control. The schedule and the
 * action's page both ask this.
 */
export function isPostponed(action: { notes: { decision: string; reversedAt?: Date | null }[] }, postponeCodes: string[]): boolean {
  return action.notes.some((note) => postponeCodes.includes(note.decision) && !note.reversedAt);
}
