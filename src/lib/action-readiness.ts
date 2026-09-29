import type { Tenant } from "./tenant";

/**
 * What an action is waiting for, written on the action.
 *
 * Whether an action has what it needs is a question about every document on its
 * list and the revision each one carries. Asked row by row it cannot be filtered
 * or paged in the database at all, and the schedule ends up loading itself into
 * memory to show fifteen lines of itself. So the answer is kept on the action:
 * how many documents it needs, how many are met under each of the two readings
 * an organization may choose between, and the earliest day one still missing is
 * owed.
 *
 * Nothing here is a new fact. It is the same comparison, in the place the
 * schedule can sort, filter and page by.
 */
export async function restateAction(t: Tenant, actionId: string): Promise<void> {
  const entries = await t.db.baselineEntry.findMany({
    where: { actionId },
    select: { requiredStatus: true, requiredBy: true, documentId: true },
  });
  if (!entries.length) {
    await t.db.action.update({
      where: { id: actionId },
      data: { needCount: 0, metIssuedCount: 0, metStatusCount: 0, nextNeededAt: null },
    });
    return;
  }

  // One query for every document on the list, not one per line.
  const documents = await t.db.document.findMany({
    where: { id: { in: [...new Set(entries.map((one) => one.documentId))] } },
    select: {
      id: true,
      // The register already keeps what the newest revision says; the released
      // one is asked for beside it.
      latestStatusCode: true,
      revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1, select: { statusCode: true } },
    },
  });
  const released = new Map(documents.map((one) => [one.id, one.revisions[0]?.statusCode ?? null]));
  const carried = new Map(documents.map((one) => [one.id, one.latestStatusCode]));

  let metIssued = 0;
  let metStatus = 0;
  let next: Date | null = null;
  for (const entry of entries) {
    const issued = released.get(entry.documentId) === entry.requiredStatus;
    if (issued) metIssued++;
    else if (!next || entry.requiredBy < next) next = entry.requiredBy;
    if (carried.get(entry.documentId) === entry.requiredStatus) metStatus++;
  }

  await t.db.action.update({
    where: { id: actionId },
    data: { needCount: entries.length, metIssuedCount: metIssued, metStatusCount: metStatus, nextNeededAt: next },
  });
}

/** Every action that lists this document — the ones a released revision changes. */
export async function actionsListing(t: Tenant, documentId: string): Promise<string[]> {
  const rows = await t.db.baselineEntry.findMany({ where: { documentId }, select: { actionId: true } });
  return [...new Set(rows.map((one) => one.actionId))];
}
