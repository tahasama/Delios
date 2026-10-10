import type { ActionState } from "@/lib/action-state";

/**
 * Where an action stands, struck like a rubber stamp: the one loud mark on a
 * calm sheet. Each state has its own colour and its own border, so it reads
 * without colour too — solid ready, dashed at risk, doubled overdue.
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

export function StateStamp({ state, size = "sm" }: { state: ActionState; size?: "sm" | "lg" }) {
  return (
    <span className={`docket-stamp docket-stamp-${state.toLowerCase().replace("_", "-")}${size === "lg" ? " docket-stamp-lg" : ""}`}>
      {WORD[state]}
    </span>
  );
}
