import { api, projectPath } from "@/lib/client";
import type { RegisterPage } from "@/lib/types";
/** A schedule need still waiting on a withdrawn document. */
type OrphanedNeed = { id: string; documentId: string; document: { docNumber: string }; action: { code: string; name: string } };

/** Withdrawn documents that an activity of the schedule still needs, one line per activity. */
export async function orphanedNeeds(t: { projectId: string }): Promise<OrphanedNeed[]> {
  const page = await api<RegisterPage>(projectPath(t, "/register"), { keep: { areas: ["docs", "transmittals"] }, query: { view: "all", state: "WITHDRAWN", per: 250 } });
  return page.rows.flatMap((row) => row.activities.map((activity) => ({
    id: `${row.id}:${activity.code}`, documentId: row.id, document: { docNumber: row.number }, action: activity,
  })));
}
