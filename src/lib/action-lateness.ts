import type { Tenant } from "./tenant";
import { activityDetail, activityLateness } from "./api/schedule";
import { holders } from "./api/settings";

/**
 * Why a document was not there when the action needed it — and whose part of
 * the chain it was.
 *
 * The checkpoints are read in order, because they are a succession: one cannot
 * be late without making the next one late too. The first that slips is the
 * cause; the ones after it inherit the delay rather than own it.
 *
 *   first · it went for review by the day it was owed
 *       — the planned submission date: the day it is needed, less the days its
 *         route takes. Owed by whoever produces it.
 *   then  · one checkpoint for every step of the route, by the day that step
 *         was given — each answers for its own time, named apart so nobody
 *         carries a delay that began before them. Owed by the step.
 *   last  · it was released, then issued, by the day it is needed
 *       — owed by Document Control.
 *
 * The backend works the chain out; this reads it.
 */
export type Checkpoint = {
  /**
   * The step, named as the people on the job name it: an outside approval is
   * not "the decision", and a drawing a supplier owes us is not "sent for
   * review". A column that names the step wrongly starts the argument it was
   * written to end.
   */
  name: string;
  /** What its day was called — the deadline this step was measured against. */
  deadline: string;
  /** The day it was due, and the day it happened. */
  due: Date | null;
  at: Date | null;
  late: boolean;
  /** Who owed it, in the words the action's page will print. */
  owedBy: string;
};

export type DocumentLateness = {
  docNumber: string;
  title: string;
  requiredStatus: string;
  checkpoints: Checkpoint[];
  /** The first checkpoint that slipped, or null where nothing did. */
  cause: Checkpoint | null;
  /** Still not there at all. */
  outstanding: boolean;
};

const day = (value: string | null) => (value ? new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value) : null);

export async function latenessOf(
  t: Tenant,
  actionId: string,
): Promise<{ rows: DocumentLateness[]; controlHolds: boolean }> {
  const [detail, chains, control] = await Promise.all([
    activityDetail(t, actionId),
    activityLateness(t, actionId),
    holders(t.projectId, "CONTROL").catch(() => []),
  ]);
  const needs = new Map((detail?.needs ?? []).map((one) => [one.id, one]));
  const point = (one: { name: string; deadline: string; due: string | null; at: string | null; late: boolean; owedBy: string }): Checkpoint =>
    ({ name: one.name, deadline: one.deadline, due: day(one.due), at: day(one.at), late: one.late, owedBy: one.owedBy });

  const rows = chains.map((chain): DocumentLateness => {
    const need = needs.get(chain.requirementId);
    const checkpoints = chain.checkpoints.map(point);
    return {
      docNumber: chain.documentNumber,
      title: need?.title ?? "",
      requiredStatus: need ? (need.requiredStatuses.length ? need.requiredStatuses.join("/") : need.purpose) : "",
      checkpoints,
      cause: checkpoints.find((one) => one.late) ?? null,
      outstanding: chain.state !== "MET",
    };
  });

  return { rows, controlHolds: control.length > 0 };
}
