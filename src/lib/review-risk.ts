import type { Tenant } from "./tenant";
import { audit, notifyMany } from "./audit";
import { holdersOf } from "./permissions";
import { dueState } from "./workflow";

/**
 * A review that is about to miss its date is worth one warning, sent by the
 * system, once. After that it is a person's job: Document Control decides
 * whether to chase it, and the chase is a transmittal, which leaves evidence.
 *
 * The same shape as the warning on a late activity: warn once, record when, and
 * never warn again for the same review.
 */
export async function warnLateReviews(t: Tenant): Promise<number> {
  const soon = new Date(Date.now() + 86_400_000);
  const cycles = await t.db.reviewCycle.findMany({
    where: { status: "OPEN", outcome: null, riskNotifiedAt: null, dueAt: { not: null, lte: soon } },
    include: {
      assignments: { select: { userId: true, userName: true, completedAt: true } },
      revision: { select: { value: true, documentId: true, document: { select: { docNumber: true, title: true } } } },
    },
  });
  if (!cycles.length) return 0;
  const controllers = await holdersOf(t, "CONTROL");
  let warned = 0;
  for (const cycle of cycles) {
    const state = dueState(cycle.dueAt, false);
    const label = `${cycle.revision.document.docNumber} rev ${cycle.revision.value}`;
    const outstanding = cycle.assignments.filter((a) => !a.completedAt);
    const who = outstanding.map((a) => a.userName).join(", ") || "nobody assigned";
    await notifyMany(
      [...outstanding.map((a) => a.userId), ...controllers.map((c) => c.id)],
      "REVIEW_AT_RISK",
      `${state === "overdue" ? "Overdue" : "Due tomorrow"}: ${label}`,
      `${cycle.binding ? "The decision" : "Advice"} on ${label} is ${state === "overdue" ? "past its date" : "due tomorrow"} and still open. Waiting on ${who}.`,
      `/reviews/${cycle.id}`,
      t,
    );
    await t.db.reviewCycle.update({ where: { id: cycle.id }, data: { riskNotifiedAt: new Date() } });
    await audit({
      tenant: t,
      actor: { id: "system", name: "Automatic warning" } as never,
      action: "REVIEW_AT_RISK",
      entityType: "ReviewCycle",
      entityId: cycle.id,
      entityLabel: label,
      detail: `Warned ${outstanding.length} reviewer(s) and ${controllers.length} in the control function: due ${cycle.dueAt?.toDateString()}.`,
    });
    warned++;
  }
  return warned;
}
