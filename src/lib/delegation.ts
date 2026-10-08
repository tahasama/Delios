import { cache } from "react";
import type { Tenant } from "./tenant";
import type { DocumentClass, Verb } from "./permissions";
import { api, projectPath } from "./api/client";
import { reviewOfRequest } from "./api/reviews";

/**
 * Handing a review step to somebody else.
 *
 * Unless the project makes the matrix the only rule (POLICY_MATRIX), it
 * recommends: anyone on the project may be handed the step, somebody it does
 * not name for the act is flagged, and the record says who handed it to whom —
 * the person who delegated answers for the choice. What follows is the strict
 * reading, which applies only when the project asks for it.
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
 *
 * The backend keeps the hand-overs and applies these rules; the review a
 * hand-over is raised from is the review the screens call a cycle.
 */

/** The document facts the matrix reads. */
export type Target = DocumentClass;

/** A hand-over on record for a review: who handed it to whom, until when, and where it stands. */
export type DelegationRecord = {
  id: string; fromUserId: string; toUserId: string; verb: string; status: string; endDate: Date; reason: string | null;
  refusedReason: string | null; askedByName: string | null; grantedByName: string | null;
  fromUser: { name: string }; toUser: { name: string };
};

type BackendDelegation = {
  id: string; step: number; fromUserId: string; fromName: string; toUserId: string; toName: string; verb: string; status: string;
  endDate: string; reason: string | null; refusedReason: string | null; flag: string | null; askedBy: string; grantedBy: string | null;
};

/** The flags of the hand-overs read for this request, by who took them: the backend says them with each hand-over. */
const flags = cache(() => new Map<string, string | null>());

/** The hand-overs raised from a review, newest first. */
export async function delegationsOn(t: Tenant, cycleId: string): Promise<DelegationRecord[]> {
  const rows = await api<BackendDelegation[]>(projectPath(t, `/reviews/${cycleId}/delegations`)).catch(() => [] as BackendDelegation[]);
  for (const row of rows) if (!flags().has(row.toUserId)) flags().set(row.toUserId, row.flag);
  return rows.map((row) => ({
    id: row.id, fromUserId: row.fromUserId, toUserId: row.toUserId, verb: row.verb, status: row.status,
    endDate: new Date(`${row.endDate}T23:59:59`), reason: row.reason, refusedReason: row.refusedReason,
    askedByName: row.askedBy, grantedByName: row.grantedBy, fromUser: { name: row.fromName }, toUser: { name: row.toName },
  }));
}

/** Who may take the open step of a review, as the backend offers them for the person asking. */
const options = cache(async (t: Tenant, cycleId: string) =>
  api<{ candidates: { id: string; name: string; functionName: string; inMatrix: boolean }[] }>(projectPath(t, `/reviews/${cycleId}/delegation-options`))
    .then((one) => one.candidates).catch(() => []));

/**
 * Who this person may hand a step of this kind to: those the matrix names,
 * and — unless it is the only rule — everybody else on the project, flagged.
 * Asked of the review the page stands on.
 */
export async function delegateCandidates(
  t: Tenant,
  _asked: { target: Target; verb: Verb; fromUserId: string },
  cycleId?: string,
): Promise<{ id: string; name: string; functionName: string; inMatrix: boolean }[]> {
  const id = cycleId ?? reviewOfRequest();
  return id ? options(t, id) : [];
}

/**
 * The flag on a hand-over the matrix would not have made, or null. Said on the
 * record and beside the hand-over; it never stops it unless the matrix binds.
 */
export async function delegationFlag(
  _t: Tenant,
  { toUserId }: { target: Target; verb: Verb; toUserId: string; toName: string },
): Promise<string | null> {
  return flags().get(toUserId) ?? null;
}

/**
 * Why this delegation may not exist, or null when it may. The backend applies
 * the rest of the rule when the hand-over is made.
 */
export async function delegationRefusal(
  _t: Tenant,
  { fromUserId, toUserId }:
    { target: Target; verb: Verb; fromUserId: string; fromName: string; toUserId: string; toName: string },
): Promise<string | null> {
  if (fromUserId === toUserId) return "A step cannot be handed to the person who already holds it.";
  return null;
}

/**
 * The delegation, if any, that lets `userId` act in somebody else's place here.
 * The backend seats the person a step was handed to; this is not asked separately.
 */
export async function delegationInForce(
  _t: Tenant,
  _asked: { userId: string; verb: Verb; target: Target; cycleId?: string | null },
): Promise<{ id: string; fromUserId: string; fromUser: { id: string; name: string } } | null> {
  return null;
}

/**
 * May this person answer a review cycle — as one of its reviewers, or holding a
 * delegation from one of them? The name it is answered in is returned with it,
 * because the record says whose step was answered and who answered it.
 */
export async function mayAnswerCycle(
  t: Tenant,
  { cycleId }: { cycleId: string; userId: string; verb: Verb },
): Promise<{ ok: boolean; onBehalfOf: string | null }> {
  const me = await api<{ seated: boolean; onBehalfOf: string | null }>(projectPath(t, `/reviews/${cycleId}/me`)).catch(() => null);
  return { ok: !!me?.seated, onBehalfOf: me?.onBehalfOf ?? null };
}
