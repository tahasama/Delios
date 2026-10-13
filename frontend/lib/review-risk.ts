import type { Tenant } from "./tenant";

/**
 * A review that is about to miss its date is worth one warning, sent by the
 * system, once. After that it is a person's job: Document Control decides
 * whether to chase it, and the chase is a transmittal, which leaves evidence.
 *
 * The same shape as the warning on a late activity: warn once, record when, and
 * never warn again for the same review.
 *
 * The backend keeps the reviews and sends no such warning yet, and this server
 * no longer writes to them: nothing is warned.
 */
export async function warnLateReviews(_t: Tenant): Promise<number> {
  return 0;
}
