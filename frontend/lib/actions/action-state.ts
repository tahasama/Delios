/**
 * Where an action stands, said once for every page that shows it. The backend
 * works it out (PlanAction.state, Actions/ScheduleEndpoints.Plan.cs); these are
 * its words on screen.
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

/**
 * Whether an action was postponed: a decision from the organization's list that
 * does not proceed, not taken back by the control function. The schedule and the
 * action's page both ask this.
 */
export function isPostponed(action: { decisions: { decision: string; reversedAt?: Date | null }[] }, postponeCodes: string[]): boolean {
  return action.decisions.some((note) => postponeCodes.includes(note.decision) && !note.reversedAt);
}
