import { cache } from "react";
import type { Tenant } from "@/lib/core/tenant";
import type { DocumentClass, Verb } from "@/lib/core/permissions";
import { api, projectPath } from "@/lib/client";
import { reviewOfRequest } from "@/lib/reviews/api";

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
 * The control function and administrators are left out of the list. They hold every
 * verb so that an emergency has a way through, and normally they do not review
 * at all — offering them as the ordinary answer to "who takes this step" would
 * turn the exception into the habit. Where the route needs somebody the matrix
 * does not name, whoever configures the route adds them to the step.
 *
 * The backend keeps the hand-overs and applies these rules; the review a
 * hand-over is raised from is the review the screens call a cycle.
 */

/** The document facts the matrix reads. */
type Target = DocumentClass;

/** A hand-over on record for a review: who handed it to whom, until when, and where it stands. */
type DelegationRecord = {
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
  const rows = await api<BackendDelegation[]>(projectPath(t, `/reviews/${cycleId}/delegations`), { keep: { areas: ["reviews"] } }).catch(() => [] as BackendDelegation[]);
  for (const row of rows) if (!flags().has(row.toUserId)) flags().set(row.toUserId, row.flag);
  return rows.map((row) => ({
    id: row.id, fromUserId: row.fromUserId, toUserId: row.toUserId, verb: row.verb, status: row.status,
    endDate: new Date(`${row.endDate}T23:59:59`), reason: row.reason, refusedReason: row.refusedReason,
    askedByName: row.askedBy, grantedByName: row.grantedBy, fromUser: { name: row.fromName }, toUser: { name: row.toName },
  }));
}

type Options = {
  candidates: { id: string; name: string; functionName: string; inMatrix: boolean }[];
  /** For the control function and whoever holds Manage: whose seat on the open step they may hand over for them. */
  seats: { id: string; name: string }[];
  throughControl: boolean;
};

/** Who may take the open step of a review, as the backend offers them for the person asking. */
const allOptions = cache(async (t: Tenant, cycleId: string): Promise<Options> =>
  api<Options>(projectPath(t, `/reviews/${cycleId}/delegation-options`), { keep: { areas: ["reviews"] } })
    .then((one) => ({ ...one, seats: one.seats ?? [] })).catch(() => ({ candidates: [], seats: [], throughControl: false })));
const options = cache(async (t: Tenant, cycleId: string) => (await allOptions(t, cycleId)).candidates);

/**
 * Handing somebody else's seat over (the control function, whoever holds Manage): the people on the open step not yet
 * answered, and who may take it. Empty for anyone else.
 */
export async function handOverForOthers(t: Tenant, cycleId: string): Promise<Options> {
  return allOptions(t, cycleId);
}

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

/** What informing in flow offers: the project's people, and who is copied in already. Closed for anyone else. */
export type StepPeopleOptions = {
  open: boolean;
  people?: { id: string; name: string }[];
  copied?: string[];
};

export async function stepPeopleOptions(t: Tenant, cycleId: string): Promise<StepPeopleOptions> {
  return api<StepPeopleOptions>(projectPath(t, `/reviews/${cycleId}/people`), { keep: { areas: ["reviews"] } }).catch(() => ({ open: false }));
}
