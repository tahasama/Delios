import type { ActionState } from "@/lib/action-state";

/**
 * Where an action stands, as the coloured tag of its card on the planning
 * board: the same colour as its card, so a state reads the same everywhere.
 */
const WORD: Record<ActionState, string> = {
  DONE: "Done",
  LATE_RECEIPT: "Late receipt",
  READY: "Ready",
  UPCOMING: "Still ahead",
  AT_RISK: "At risk",
  NOT_READY: "Overdue",
  UNKNOWN: "Nothing listed",
};

/** The class suffix of a state, shared by tags and board cards. */
export const stateClass = (state: ActionState) => state.toLowerCase().replace("_", "-");

export function StateTag({ state, size = "sm" }: { state: ActionState; size?: "sm" | "lg" }) {
  return <span className={`state-tag state-${stateClass(state)}${size === "lg" ? " state-tag-lg" : ""}`}>{WORD[state]}</span>;
}
