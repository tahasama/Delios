/**
 * A document is needed seven days before its activity unless the list gives it a
 * date of its own. Plain days, not working days: a schedule counts in days, and
 * a needed-by date that quietly shifts with weekends is a date nobody can
 * predict from the activity.
 */
export const DEFAULT_LEAD_DAYS = 7;

type Coded = { code: string; props: Record<string, unknown> };

/**
 * What an action needs a document for, and the status it needs, when nobody
 * says: the reason that builds from it, and the first status that permits
 * execution. The requirements list and a document added by hand use the same.
 */
export function needDefaults(reasons: Coded[], statuses: Coded[]): { purpose: string; status: string } {
  return {
    purpose: (reasons.find((r) => r.code === "EXECUTION") ?? reasons.find((r) => r.code === "CONSTRUCTION") ?? reasons[0])?.code ?? "EXECUTION",
    status: (statuses.find((v) => v.props.executionFlag === true || v.props.executes === true) ?? statuses[0])?.code ?? "",
  };
}

/** `days` days before `date`. */
export function daysBefore(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

/** Departments stored on an action, as a list. */
export function departmentsOf(action: { departments: string | null }): string[] {
  return (action.departments ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// ── Comparing two schedule versions ─────────────────────────────────────────
