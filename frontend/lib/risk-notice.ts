import type { Tenant } from "./tenant";
type RiskAction = {
  id: string;
  code: string;
  name: string;
  scheduledDate: Date | null;
  departments: string | null;
  riskNotifiedAt: Date | null;
  entries: { department: string | null; requiredStatus: string; document: { discipline: string; docNumber: string; revisions: { statusCode: string | null; meets?: boolean }[] } }[];
};

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
