import type { Tenant } from "./tenant";
import { holdersOf, can, loadActor, type DocumentClass, type Verb } from "./permissions";

/**
 * Handing a review step to somebody else.
 *
 * The distribution matrix names who may advise and who may decide on a class of
 * document; the review route picks, out of those, the step that advises and the
 * step that decides. A person may hand their own step to another person **the
 * matrix already names for the same act on the same class** — a lead to the
 * engineer, a department manager to the lead, either to the other — and to
 * nobody else. Somebody the matrix does not name for it, a technician on an
 * electrical drawing, can never receive it, however it is asked for.
 *
 * Both ends are checked again every time a delegation is used, so retiring a
 * function, moving somebody off the project or approving a new matrix ends a
 * delegation that no longer makes sense without anybody having to revoke it.
 *
 * Document Control and administrators are left out of the list. They hold every
 * verb so that an emergency has a way through, and normally they do not review
 * at all — offering them as the ordinary answer to "who takes this step" would
 * turn the exception into the habit. Where the route needs somebody the matrix
 * does not name, whoever configures the route adds them to the step.
 */

/** The document facts the matrix reads. */
export type Target = DocumentClass;

/** Holds the verb only by the privilege that exists for emergencies. */
async function byPrivilege(t: Tenant): Promise<Set<string>> {
  const [control, configure] = await Promise.all([holdersOf(t, "CONTROL"), holdersOf(t, "CONFIGURE")]);
  return new Set([...control, ...configure].map((one) => one.id));
}

/** Who this person may hand a step of this kind to. */
export async function delegateCandidates(
  t: Tenant,
  { target, verb, fromUserId }: { target: Target; verb: Verb; fromUserId: string },
) {
  const [named, privileged] = await Promise.all([holdersOf(t, verb, target), byPrivilege(t)]);
  return named.filter((one) => one.id !== fromUserId && !privileged.has(one.id));
}

/** Does this person hold the verb for this class in the matrix, right now? */
async function named(t: Tenant, userId: string, verb: Verb, target: Target): Promise<boolean> {
  const membership = await t.db.projectMembership.findFirst({
    where: { projectId: t.projectId, userId, active: true, user: { active: true } },
    select: { functionId: true },
  });
  if (!membership) return false;
  return can(await loadActor(t, membership.functionId), verb, target);
}

/**
 * Why this delegation may not exist, or null when it may. One sentence, in the
 * words of the person who would read it.
 */
export async function delegationRefusal(
  t: Tenant,
  { target, verb, fromUserId, fromName, toUserId, toName }:
    { target: Target; verb: Verb; fromUserId: string; fromName: string; toUserId: string; toName: string },
): Promise<string | null> {
  if (fromUserId === toUserId) return "A step cannot be handed to the person who already holds it.";
  const act = verb === "APPROVE" ? "decide" : "advise";
  if (!(await named(t, fromUserId, verb, target))) {
    return `${fromName} may not ${act} on this document, so there is nothing to hand over.`;
  }
  if (!(await named(t, toUserId, verb, target))) {
    return `${toName} is not named to ${act} on this kind of document. A step may only be handed to somebody the distribution matrix already names for it.`;
  }
  if ((await byPrivilege(t)).has(toUserId)) {
    return `${toName} holds that verb as Document Control or as an administrator, for emergencies — not as somebody who ${act}s. If this step needs them, add them to it on the route.`;
  }
  return null;
}

/**
 * The delegation, if any, that lets `userId` act in somebody else's place here.
 * A delegation raised from one review covers that review only; one raised
 * without a review covers the class its scope names.
 */
export async function delegationInForce(
  t: Tenant,
  { userId, verb, target, cycleId }: { userId: string; verb: Verb; target: Target; cycleId?: string | null },
) {
  const rows = await t.db.delegation.findMany({
    where: {
      toUserId: userId,
      status: "ACTIVE",
      verb,
      endDate: { gte: new Date() },
      ...(cycleId ? { OR: [{ cycleId }, { cycleId: null }] } : { cycleId: null }),
    },
    include: { fromUser: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  for (const row of rows) {
    // Both ends, as they stand today — not as they stood when it was granted.
    if (!(await named(t, row.fromUserId, verb, target))) continue;
    if (!(await named(t, userId, verb, target))) continue;
    return row;
  }
  return null;
}

/**
 * May this person answer a review cycle — as one of its reviewers, or holding a
 * delegation from one of them? The name it is answered in is returned with it,
 * because the record says whose step was answered and who answered it.
 */
export async function mayAnswerCycle(
  t: Tenant,
  { cycleId, userId, verb }: { cycleId: string; userId: string; verb: Verb },
): Promise<{ ok: boolean; onBehalfOf: string | null }> {
  const cycle = await t.db.reviewCycle.findUnique({
    where: { id: cycleId },
    select: { assignments: { select: { userId: true } }, revision: { select: { document: true } } },
  });
  if (!cycle) return { ok: false, onBehalfOf: null };
  if (cycle.assignments.some((seat) => seat.userId === userId)) return { ok: true, onBehalfOf: null };
  const del = await delegationInForce(t, { userId, verb, target: cycle.revision.document, cycleId });
  if (del && cycle.assignments.some((seat) => seat.userId === del.fromUserId)) {
    return { ok: true, onBehalfOf: del.fromUser.name };
  }
  return { ok: false, onBehalfOf: null };
}
