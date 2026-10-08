import type { Tenant } from "./tenant";
import { policy } from "./control-activities";

/**
 * Whether a document on an action's list counts as delivered.
 *
 * Two honest readings, and the project says which it uses. The strict one asks
 * for a revision that went through its route, was released and reached the
 * people who were named — what the schedule was built on. The other asks only
 * what the newest revision carries, however it got there, for an organization
 * that works from an approved status and keeps distribution elsewhere.
 *
 * Both readings are one comparison against one revision, so a page loads the
 * revision that counts and nothing else.
 */
export type ReadyReading = "ISSUED" | "STATUS";

export async function readyReading(t: Tenant): Promise<ReadyReading> {
  return (await policy(t, "POLICY_READY")) === "STATUS" ? "STATUS" : "ISSUED";
}

/**
 * Does this document meet what the action asks of it? The backend answers it
 * (whether the released revision serves the need's purpose) and the revision
 * carries that answer; without one, the status is compared as it always was.
 */
export function meetsRequirement(
  revisions: { statusCode: string | null; meets?: boolean }[],
  requiredStatus: string,
): boolean {
  return revisions[0]?.meets ?? revisions[0]?.statusCode === requiredStatus;
}
