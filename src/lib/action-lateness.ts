import type { Tenant } from "./tenant";

/**
 * Why a document was not there when the action needed it — and whose part of
 * the chain it was.
 *
 * The checkpoints are read in order, because they are a succession: one cannot
 * be late without making the next one late too. The first that slips is the
 * cause; the ones after it inherit the delay rather than own it.
 *
 *   first · it went for review by the day it was owed
 *       — the planned submission date: what the requirements list gives it, or
 *         seven days before the action by default. Owed by whoever produces it.
 *   then  · one checkpoint for every step of the route, by the day that step
 *         was given — an advisory step, a client's own review and an outside
 *         approval each answer for their own time, named apart so nobody
 *         carries a delay that began before them. Owed by the step.
 *   last  · it was released and issued by the day of the action
 *       — owed by Document Control; where a project has none, by the decider,
 *         or by whoever started the route if the decider handed it to them.
 *
 * This is written so that nobody has to argue about it afterwards.
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

export async function latenessOf(
  t: Tenant,
  actionId: string,
): Promise<{ rows: DocumentLateness[]; controlHolds: boolean }> {
  const action = await t.db.action.findUniqueOrThrow({
    where: { id: actionId },
    select: { scheduledDate: true },
  });
  const entries = await t.db.baselineEntry.findMany({
    where: { actionId },
    orderBy: { requiredBy: "asc" },
    include: {
      document: {
        select: {
          docNumber: true, title: true, originator: true, deliverableType: true,
          revisions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              statusCode: true, state: true, releasedAt: true, issuedAt: true, authoredByName: true,
              cycles: {
                orderBy: { sequence: "asc" },
                select: {
                  sequence: true, submittedAt: true, dueAt: true, outcomeAt: true, binding: true,
                  issueRequestId: true, partyId: true,
                  party: { select: { name: true } },
                  assignments: { select: { userName: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const { hasControlFunction } = await import("./issue-requests");
  const controlHolds = await hasControlFunction(t);

  const rows = entries.map((entry): DocumentLateness => {
    const revision = entry.document.revisions[0] ?? null;
    const cycles = revision?.cycles ?? [];
    const opened = cycles[0]?.submittedAt ?? null;
    const issued = revision?.issuedAt ?? revision?.releasedAt ?? null;
    const external = entry.document.deliverableType !== "ENG";
    const producer = external
      ? entry.document.originator ?? "the party that produces it"
      : revision?.authoredByName ?? "our own engineering";

    // Every step of the route is a checkpoint of its own. A route's first step
    // can be late and its last still answer on time, and whoever reads this
    // afterwards is owed the step that actually slipped — not the one that
    // inherited the delay. So an outside approval, a client's own review and
    // each of our own steps are named apart.
    const stepName = (cycle: (typeof cycles)[number]) =>
      cycle.issueRequestId
        ? "External approval"
        : cycle.partyId
          ? "Client review"
          : cycle.binding
            ? "Review decision"
            : `Review step ${cycle.sequence}`;

    const stepOwner = (cycle: (typeof cycles)[number]) =>
      cycle.party?.name
      ?? (cycle.assignments.length ? cycle.assignments.map((one) => one.userName).join(", ") : null)
      ?? "the reviewing step";

    const checkpoints: Checkpoint[] = [
      {
        name: external ? "Supplier sent" : "Sent for review",
        deadline: "Submission due",
        due: entry.requiredBy,
        at: opened,
        late: !!opened && opened > entry.requiredBy,
        owedBy: producer,
      },
      ...cycles.map((cycle): Checkpoint => ({
        name: stepName(cycle),
        deadline: "Review due",
        due: cycle.dueAt ?? null,
        at: cycle.outcomeAt ?? null,
        late: !!cycle.outcomeAt && !!cycle.dueAt && cycle.outcomeAt > cycle.dueAt,
        owedBy: stepOwner(cycle),
      })),
      {
        name: "Released & issued",
        deadline: "Day of the activity",
        due: action.scheduledDate,
        at: issued,
        late: !!issued && !!action.scheduledDate && issued > action.scheduledDate,
        owedBy: controlHolds ? "Document Control" : "whoever decided it",
      },
    ];

    return {
      docNumber: entry.document.docNumber,
      title: entry.document.title,
      requiredStatus: entry.requiredStatus,
      checkpoints,
      cause: checkpoints.find((one) => one.late) ?? null,
      outstanding: revision?.statusCode !== entry.requiredStatus || revision?.state !== "RELEASED",
    };
  });

  return { rows, controlHolds };
}
