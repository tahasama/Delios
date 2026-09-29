import type { Tenant } from "./tenant";

/**
 * A document is needed seven days before its activity unless the list gives it a
 * date of its own. Plain days, not working days: a schedule counts in days, and
 * a needed-by date that quietly shifts with weekends is a date nobody can
 * predict from the activity.
 */
export const DEFAULT_LEAD_DAYS = 7;

/** `days` days before `date`. */
export function daysBefore(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

/** `days` working days (Mon–Fri) after `date`. */
export function businessDaysAfter(date: Date, days: number): Date {
  const d = new Date(date);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

/** When a requirement is needed, from its action's date and its own rule. */
export function neededBy(actionDate: Date | null, entry: { leadBusinessDays: number | null; manualDate: boolean; requiredBy?: Date }): Date | null {
  if (entry.manualDate) return entry.requiredBy ?? null;
  if (!actionDate) return entry.requiredBy ?? null;
  // The column is still named for working days; what it holds is days.
  return daysBefore(actionDate, entry.leadBusinessDays ?? DEFAULT_LEAD_DAYS);
}

/**
 * The next system action code — A00001, A00002… — for a schedule that does not
 * carry its own. Codes are assigned once and never reused (§14.2): the counter
 * only moves forward, and a code already taken by hand is skipped.
 */
export async function nextActionCode(t: Tenant): Promise<string> {
  for (;;) {
    const seq = await t.db.$transaction(async (tx) => {
      const c = await tx.numberCounter.findUnique({ where: { projectId_prefix: { projectId: t.projectId, prefix: "ACTION" } } });
      if (c) {
        await tx.numberCounter.update({ where: { id: c.id }, data: { next: { increment: 1 } } });
        return c.next;
      }
      await tx.numberCounter.create({ data: { projectId: t.projectId, prefix: "ACTION", next: 2 } });
      return 1;
    });
    const code = `A${String(seq).padStart(5, "0")}`;
    if (!(await t.db.action.findFirst({ where: { code } }))) return code;
  }
}

/** Departments stored on an action, as a list. */
export function departmentsOf(action: { departments: string | null }): string[] {
  return (action.departments ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Move every rule-based needed-by date to follow its action. Returns how many moved. */
export async function redateRequirements(t: Tenant): Promise<number> {
  const entries = await t.db.baselineEntry.findMany({ where: { manualDate: false }, include: { action: true } });
  let moved = 0;
  for (const e of entries) {
    const next = neededBy(e.action.scheduledDate, e);
    if (next && next.getTime() !== e.requiredBy.getTime()) {
      await t.db.baselineEntry.update({ where: { id: e.id }, data: { requiredBy: next } });
      moved++;
    }
  }
  return moved;
}

// ── Comparing two schedule versions ─────────────────────────────────────────

export type ScheduleActivityLike = {
  actionCode: string;
  externalId: string;
  name: string;
  baselineDate: Date | null;
  forecastDate: Date | null;
  responsibleParty: string | null;
};

export type ScheduleChange = {
  type: "NEW" | "DATE_CHANGED" | "DETAIL_CHANGED" | "REMOVED" | "UNCHANGED";
  activity: ScheduleActivityLike;
  previous: ScheduleActivityLike | null;
};

const dateValue = (date: Date | null | undefined) => date?.toISOString().slice(0, 10) ?? "";

/** What changed between a schedule version and the one before it, activity by activity. */
export function compareScheduleActivities(current: ScheduleActivityLike[], previous: ScheduleActivityLike[]): ScheduleChange[] {
  const before = new Map(previous.map((activity) => [activity.actionCode, activity]));
  const after = new Map(current.map((activity) => [activity.actionCode, activity]));
  const changes: ScheduleChange[] = [];
  for (const activity of current) {
    const old = before.get(activity.actionCode) ?? null;
    let type: ScheduleChange["type"] = "UNCHANGED";
    if (!old) type = "NEW";
    else if (dateValue(old.baselineDate) !== dateValue(activity.baselineDate) || dateValue(old.forecastDate) !== dateValue(activity.forecastDate)) type = "DATE_CHANGED";
    else if (old.name !== activity.name || old.responsibleParty !== activity.responsibleParty || old.externalId !== activity.externalId) type = "DETAIL_CHANGED";
    changes.push({ type, activity, previous: old });
  }
  for (const activity of previous) {
    if (!after.has(activity.actionCode)) changes.push({ type: "REMOVED", activity, previous: activity });
  }
  return changes.sort((a, b) => a.activity.actionCode.localeCompare(b.activity.actionCode));
}
