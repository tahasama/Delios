import type { Tenant } from "./tenant";

/**
 * Where each document a supplier owes us stands, in the two stages Document
 * Control works in:
 *   Stage 1 — submission: not sent (late once past due) → sent → Document
 *             Control's check (accept, or reject with a reason → resend).
 *   Stage 2 — review: accepted → routed for review → approved, or returned
 *             with an outcome that asks for a resubmission (→ Stage 1).
 */
export type SupplierState =
  | "NOT_SENT"        // nothing submitted yet
  | "AWAITING_CHECK"  // sent; Document Control has not checked it
  | "REJECTED"        // failed the check; back with the supplier
  | "TO_ROUTE"        // accepted; Document Control sends it for review
  | "IN_REVIEW"
  | "RETURNED"        // review asked for changes; back with the supplier
  | "APPROVED";       // review passed (awaiting or after release)

export const STATE_LABEL: Record<SupplierState, string> = {
  NOT_SENT: "Not sent",
  AWAITING_CHECK: "Waiting for our check",
  REJECTED: "Rejected — resend",
  TO_ROUTE: "Accepted — to route",
  IN_REVIEW: "In review",
  RETURNED: "Returned — resubmit",
  APPROVED: "Approved",
};

/** Whose court the ball is in. */
export const WITH_SUPPLIER: SupplierState[] = ["NOT_SENT", "REJECTED", "RETURNED"];

export type SupplierRow = {
  doc: { id: string; docNumber: string; title: string; isPlaceholder: boolean };
  revision: { id: string; value: string; submittedAt: Date | null; statusCode: string | null } | null;
  state: SupplierState;
  due: Date;
  late: boolean;          // not sent and past due, or sent after due
  arrivedOnTime: boolean | null;
  reason: string | null;  // rejection reason or review outcome note
  outcome: string | null; // review outcome code
  transmittal: { id: string; number: string } | null;
  submissions: number;    // revisions ever submitted — 1 means first-time
};

export async function supplierRows(t: Tenant, pkg: { partyCode: string | null; completionDate: Date; membershipFilter?: string | null; membershipExcluded?: string | null }): Promise<SupplierRow[]> {
  if (!pkg.partyCode) return [];
  // Everything from the supplier, narrowed by the package's rule if it has one,
  // less what was taken out by hand.
  const { parseFilter, parseExcluded } = await import("./package-rule");
  const filter = parseFilter(pkg.membershipFilter);
  const excluded = parseExcluded(pkg.membershipExcluded);
  const tagged = filter?.assetIds?.length
    ? (await t.db.relationship.findMany({ where: { kind: "DOC_ASSET", toId: { in: filter.assetIds } }, select: { fromId: true } })).map((one) => one.fromId)
    : null;
  const docs = await t.db.document.findMany({
    where: {
      originator: pkg.partyCode,
      state: { notIn: ["CANCELLED", "WITHDRAWN"] },
      ...(filter?.disciplines?.length ? { discipline: { in: filter.disciplines } } : {}),
      ...(filter?.docTypes?.length ? { docType: { in: filter.docTypes } } : {}),
      AND: [
        ...(tagged ? [{ id: { in: tagged } }] : []),
        ...(excluded.length ? [{ id: { notIn: excluded } }] : []),
      ],
    },
    orderBy: { docNumber: "asc" },
    include: {
      // Needed-by dates from the approved requirements list are the supplier's baseline.
      baselineEntries: { orderBy: { requiredBy: "asc" }, take: 1 },
      revisions: {
        orderBy: { createdAt: "desc" },
        include: {
          workflowRuns: { orderBy: { createdAt: "desc" }, take: 1 },
          cycles: { orderBy: { sequence: "desc" }, take: 1 },
          transmittalItems: { include: { transmittal: true } },
        },
      },
    },
  });
  const now = Date.now();

  return docs.map((doc) => {
    const rev = doc.revisions[0] ?? null;
    const due = doc.baselineEntries[0]?.requiredBy ?? rev?.plannedSubmissionDate ?? pkg.completionDate;
    const incoming = rev?.transmittalItems
      .map((i) => i.transmittal)
      .filter((tr) => tr.direction === "INCOMING")
      .sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null;
    const run = rev?.workflowRuns[0] ?? null;
    const cycle = rev?.cycles[0] ?? null;

    let state: SupplierState = "NOT_SENT";
    let reason: string | null = null;
    if (rev) {
      if (rev.state === "RELEASED" || rev.state === "SUPERSEDED" || run?.status === "DONE") state = "APPROVED";
      else if (run?.status === "RETURNED") { state = "RETURNED"; reason = cycle?.outcomeNote ?? null; }
      else if (rev.state === "IN_REVIEW") state = "IN_REVIEW";
      else if (rev.submittedAt && incoming?.status === "REJECTED") { state = "REJECTED"; reason = incoming.rejectionReason; }
      else if (rev.submittedAt && incoming?.status === "ISSUED") state = "AWAITING_CHECK";
      else if (rev.submittedAt && incoming && incoming.status === "ACCEPTED") state = "TO_ROUTE";
    }
    const arrivedOnTime = rev?.submittedAt ? rev.submittedAt.getTime() <= due.getTime() : null;
    const late = state === "NOT_SENT" ? due.getTime() < now : arrivedOnTime === false;

    return {
      doc: { id: doc.id, docNumber: doc.docNumber, title: doc.title, isPlaceholder: doc.isPlaceholder },
      revision: rev ? { id: rev.id, value: rev.value, submittedAt: rev.submittedAt, statusCode: rev.statusCode } : null,
      state, due, late, arrivedOnTime, reason,
      outcome: cycle?.outcome ?? null,
      transmittal: incoming ? { id: incoming.id, number: incoming.number } : null,
      submissions: doc.revisions.filter((r) => r.submittedAt).length,
    };
  });
}

/** The figures from the two-stage diagram, for one package. */
export function supplierFigures(rows: SupplierRow[]) {
  const planned = rows.length;
  const arrived = rows.filter((r) => r.revision?.submittedAt).length;
  const onTime = rows.filter((r) => r.arrivedOnTime === true).length;
  const lateArrived = rows.filter((r) => r.arrivedOnTime === false).length;
  const notArrivedLate = rows.filter((r) => r.state === "NOT_SENT" && r.late).length;
  const approved = rows.filter((r) => r.state === "APPROVED");
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  return {
    planned,
    arrived,
    notArrived: planned - arrived,
    notArrivedLate,
    submissionProgress: pct(arrived, planned),
    onSchedule: pct(onTime, arrived),
    late: lateArrived,
    pendingOurs: rows.filter((r) => ["AWAITING_CHECK", "TO_ROUTE", "IN_REVIEW"].includes(r.state)).length,
    pendingSupplier: rows.filter((r) => ["NOT_SENT", "REJECTED", "RETURNED"].includes(r.state)).length,
    approved: approved.length,
    firstTime: pct(approved.filter((r) => r.submissions <= 1).length, approved.length),
  };
}
