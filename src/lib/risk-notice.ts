import type { Tenant } from "./tenant";
import { audit, notifyMany } from "./audit";
import { departmentMembers } from "./requirements-process";
import { departmentsOf } from "./schedule";
import { fmtDate } from "./utils";

export type RiskAction = {
  id: string;
  code: string;
  name: string;
  scheduledDate: Date | null;
  departments: string | null;
  riskNotifiedAt: Date | null;
  entries: { department: string | null; requiredStatus: string; document: { discipline: string; docNumber: string; revisions: { statusCode: string | null }[] } }[];
};

/** Which departments are short, and by how much. */
export function shortfall(action: RiskAction) {
  const short = new Map<string, { missing: number; total: number; numbers: string[] }>();
  for (const e of action.entries) {
    const dept = e.department ?? e.document.discipline;
    const row = short.get(dept) ?? { missing: 0, total: 0, numbers: [] };
    row.total++;
    if (e.document.revisions[0]?.statusCode !== e.requiredStatus) {
      row.missing++;
      row.numbers.push(`${e.document.docNumber} at ${e.requiredStatus}`);
    }
    short.set(dept, row);
  }
  return [...short.entries()].filter(([, r]) => r.missing).map(([department, r]) => ({ department, ...r }));
}

/**
 * The first warning goes out by itself. When an activity first shows as at
 * risk — documents still missing with the date approaching, or already past —
 * everyone in the departments concerned is told once, and the moment is
 * recorded on the activity. Every later reminder is sent by a person, from the
 * activity, as a transmittal.
 */
export async function warnOnceAtRisk(t: Tenant, actions: RiskAction[]): Promise<number> {
  let sent = 0;
  for (const action of actions) {
    if (action.riskNotifiedAt) continue;
    const departments = departmentsOf(action);
    if (!departments.length || !action.entries.length) continue;
    const short = shortfall(action).filter((s) => departments.includes(s.department));
    if (!short.length) continue;

    const to = new Set<string>();
    for (const d of departments) for (const id of await departmentMembers(t, d)) to.add(id);
    // Recorded even when nobody is on the departments yet, so it is not sent twice.
    await t.db.action.update({ where: { id: action.id }, data: { riskNotifiedAt: new Date() } });
    const headline = short.map((s) => `${s.department} ${s.missing} of ${s.total} missing`).join(", ");
    if (to.size) {
      await notifyMany([...to], "ACTION_READINESS",
        `${action.code} on ${fmtDate(action.scheduledDate)} is at risk — ${headline}`,
        `${action.name}. Departments concerned: ${departments.join(", ")}. Still missing: ${short.map((s) => s.numbers.join(", ")).join("; ")}.`,
        `/actions/${action.code}`, t);
    }
    await audit({
      tenant: t, actor: { id: "system", name: "The system" } as never, action: "REQUIREMENTS_REMINDER",
      entityType: "Action", entityId: action.id, entityLabel: action.code,
      detail: `Automatic first warning: ${headline}. ${to.size ? `${to.size} person(s) told.` : "Nobody is on those departments yet."}`,
    });
    sent++;
  }
  return sent;
}
