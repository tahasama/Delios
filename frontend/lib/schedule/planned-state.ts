import { DEFAULT_RISK_DAYS } from "@/lib/schedule/action-state";

/**
 * What a document's planned date says today, read the same everywhere it is shown (register, document page, a
 * supplier's package): ready (released), submitted (with whoever checks or reviews it), or, while nothing is in yet,
 * overdue, at risk (inside the risk window), today, or in so many days.
 */
type PlannedState = { word: string; tone: string };

const PLANNED_TONE = {
  ready: "text-emerald-700",
  submitted: "text-sky-700",
  late: "text-red-700",
  risk: "text-amber-800",
  future: "text-slate-500",
} as const;

/** Where a document is against its planned date. `progress`: released, submitted (in review, received, accepted), or neither. */
export function plannedState(
  due: Date | string | null | undefined,
  progress: "released" | "submitted" | "none",
  riskDays = DEFAULT_RISK_DAYS,
  now = new Date(),
): PlannedState | null {
  if (progress === "released") return { word: "ready", tone: PLANNED_TONE.ready };
  if (progress === "submitted") return { word: "submitted", tone: PLANNED_TONE.submitted };
  if (!due) return null;
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(new Date(due)) - day(now)) / 86_400_000);
  if (days < 0) return { word: `overdue · ${-days} day${days === -1 ? "" : "s"}`, tone: PLANNED_TONE.late };
  if (days === 0) return { word: "due today", tone: PLANNED_TONE.risk };
  if (days <= riskDays) return { word: `at risk · ${days} day${days === 1 ? "" : "s"} left`, tone: PLANNED_TONE.risk };
  return { word: `in ${days} days`, tone: PLANNED_TONE.future };
}

/**
 * How far a document has gone, from its newest revision's state (and, for a supplier's, its stage): released, submitted
 * (received, accepted, in review, decided), or not in yet (none, in preparation of ours, or back with its author).
 */
export function plannedProgress(hasReleased: boolean, latestState: string | null | undefined, supplierStage?: string | null): "released" | "submitted" | "none" {
  if (hasReleased) return "released";
  if (supplierStage === "ACCEPTED") return "submitted";
  if (latestState === "RECEIVED" || latestState === "IN_REVIEW" || latestState === "NOT_RELEASED") return "submitted";
  return "none";
}
