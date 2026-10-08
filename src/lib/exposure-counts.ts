import { EXPOSURES } from "./standard";
import { untoldRecipients } from "./supersession";
import { haltedRevisions } from "./halted";
import { api, projectPath } from "./api/client";
import type { RegisterPage } from "./api/types";

/**
 * The four out-of-date risks, counted.
 *
 * Not checks: nothing here passes or fails, and none of it is a fault in the
 * register. It is information that was right once and may still be in somebody's
 * hands, which is a different question with a different answer — somebody has
 * to be told. The counts are read here so the catalogue can show them beside
 * the checks without owning the screen that acts on them.
 */
export type OutOfDateRisk = { key: string; label: string; detail: string; who: string; count: number };

/** A schedule need still waiting on a withdrawn document. */
export type OrphanedNeed = { id: string; documentId: string; document: { docNumber: string }; action: { code: string; name: string } };

/** Withdrawn documents that an activity of the schedule still needs, one line per activity. */
export async function orphanedNeeds(t: { projectId: string }): Promise<OrphanedNeed[]> {
  const page = await api<RegisterPage>(projectPath(t, "/register"), { query: { view: "all", state: "WITHDRAWN", per: 250 } });
  return page.rows.flatMap((row) => row.activities.map((activity) => ({
    id: `${row.id}:${activity.code}`, documentId: row.id, document: { docNumber: row.number }, action: activity,
  })));
}

export async function outOfDateRisks(t: { projectId: string }): Promise<OutOfDateRisk[]> {
  const [untold, blocked, orphaned] = await Promise.all([
    untoldRecipients(t).then((rows) => rows.length),
    haltedRevisions(t).then((rows) => rows.length),
    orphanedNeeds(t).then((rows) => rows.length),
  ]);
  const counts: Record<string, number> = {
    UNPROPAGATED_SUPERSESSION: untold,
    BLOCKED_WORK: blocked,
    ORPHANED_WITHDRAWAL: orphaned,
    // A void revision's reassessment is not kept by the backend.
    UNRESOLVED_VOID: 0,
  };
  return EXPOSURES.map((e) => ({ key: e.key, label: e.label, detail: e.detail, who: e.who, count: counts[e.key] ?? 0 })).filter((e) => e.count > 0);
}
