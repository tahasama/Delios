import type { Tenant } from "./tenant";
import { meetsRequirement } from "./readiness";

export type RiskAction = {
  id: string;
  code: string;
  name: string;
  scheduledDate: Date | null;
  departments: string | null;
  riskNotifiedAt: Date | null;
  entries: { department: string | null; requiredStatus: string; document: { discipline: string; docNumber: string; revisions: { statusCode: string | null; meets?: boolean }[] } }[];
};

/** Which departments are short, and by how much. */
export function shortfall(action: RiskAction) {
  const short = new Map<string, { missing: number; total: number; numbers: string[] }>();
  for (const e of action.entries) {
    const dept = e.department ?? e.document.discipline;
    const row = short.get(dept) ?? { missing: 0, total: 0, numbers: [] };
    row.total++;
    if (!meetsRequirement(e.document.revisions, e.requiredStatus)) {
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
 *
 * The backend neither records that moment on an activity nor sends
 * notifications, so nothing is sent from here.
 */
export async function warnOnceAtRisk(_t: Tenant, _actions: RiskAction[]): Promise<number> {
  return 0;
}
