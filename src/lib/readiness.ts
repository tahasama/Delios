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
 * The revision a requirement is judged against: the released one, or simply the
 * newest. One row either way — never the whole history of the document.
 */
export function countingRevision(reading: ReadyReading) {
  // Written as a literal rather than through Prisma's argument type: the scoped
  // client's own generics make that comparison cost more than it is worth.
  return reading === "STATUS"
    ? { orderBy: { createdAt: "desc" }, take: 1, select: { value: true, state: true, statusCode: true } } as const
    : { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1, select: { value: true, state: true, statusCode: true } } as const;
}

/** Does this document meet what the action asks of it? */
export function meetsRequirement(
  revisions: { statusCode: string | null }[],
  requiredStatus: string,
): boolean {
  return revisions[0]?.statusCode === requiredStatus;
}
