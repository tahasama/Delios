import type { Tenant } from "./tenant";
import { EXPOSURES } from "./standard";
import { untoldRecipients } from "./supersession";
import { haltedWhere } from "./halted";

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

export async function outOfDateRisks(t: Tenant): Promise<OutOfDateRisk[]> {
  const [untold, blocked, orphaned, unresolvedVoid] = await Promise.all([
    untoldRecipients(t).then((rows) => rows.length),
    haltedWhere(t).then((where) => t.db.revision.count({ where })),
    t.db.baselineEntry.count({ where: { document: { state: "WITHDRAWN" } } }),
    t.db.revision.count({ where: { state: "VOID", voidReassessment: null } }),
  ]);
  const counts: Record<string, number> = {
    UNPROPAGATED_SUPERSESSION: untold,
    BLOCKED_WORK: blocked,
    ORPHANED_WITHDRAWAL: orphaned,
    UNRESOLVED_VOID: unresolvedVoid,
  };
  return EXPOSURES.map((e) => ({ key: e.key, label: e.label, detail: e.detail, who: e.who, count: counts[e.key] ?? 0 })).filter((e) => e.count > 0);
}
