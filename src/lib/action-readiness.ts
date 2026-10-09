import type { Tenant } from "./tenant";
import { documentContext } from "./api/legacy";

/**
 * What an action is waiting for, written on the action.
 *
 * Whether an action has what it needs is a question about every document on its
 * list and the revision each one carries. The backend keeps the answer on the
 * activity — how many it needs, how many are met or waived, and the earliest
 * day one still missing is owed — and restates it itself whenever a need is
 * added or waived, the schedule moves or a document is released. Nothing is
 * left to restate from here.
 */
export async function restateAction(_t: Tenant, _actionId: string): Promise<void> {}

/** Every action that lists this document — the ones a released revision changes. */
export async function actionsListing(t: Tenant, documentId: string): Promise<string[]> {
  const context = await documentContext(t, documentId);
  return [...new Set(context.activities.map((one) => one.activityId))];
}
