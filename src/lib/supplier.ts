import { legacyDocument, documentContext } from "./api/legacy";
import type { LegacyPackage } from "./api/packages";
import { supplierStage, supplierStamp, type SupplierStage } from "./state-names";

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

/** In the supplier's own set of states, the same words as the register and the document page (`SUPPLIER_STAGE_LABEL`). */
export const STATE_LABEL: Record<SupplierState, string> = {
  NOT_SENT: "Sent",
  AWAITING_CHECK: "Received",
  REJECTED: "Returned",
  TO_ROUTE: "Accepted",
  IN_REVIEW: "In review",
  RETURNED: "Returned",
  APPROVED: "Released & issued",
};

/** Whose court the ball is in. */
export const WITH_SUPPLIER: SupplierState[] = ["NOT_SENT", "REJECTED", "RETURNED"];

export type SupplierRow = {
  doc: { id: string; docNumber: string; title: string; isPlaceholder: boolean };
  revision: { id: string; value: string; submittedAt: Date | null; statusCode: string | null } | null;
  state: SupplierState;
  due: Date | null;
  late: boolean;          // not sent and past due, or sent after due
  arrivedOnTime: boolean | null;
  reason: string | null;  // rejection reason or review outcome note
  outcome: string | null; // review outcome code
  transmittal: { id: string; number: string } | null;
  submissions: number;    // revisions ever submitted — 1 means first-time
  /** When the review's answer went back to them: returned with its comments, or released and issued. */
  issuedBack: Date | null;
  /** Every comment made on the revision, for the list that goes back to the supplier. */
  comments: { by: string; text: string; blocking: boolean; settled: boolean; review: string | null; rev: string }[];
};

/**
 * Where a revision stands, from the backend's state: sent in and waiting for
 * Document Control (RECEIVED), sent back for a correction (CORRECTING),
 * accepted and waiting to be routed (IN_PREPARATION), and so on.
 */
function stateOf(revisionState: string | null): SupplierState {
  switch (revisionState) {
    case "RECEIVED": return "AWAITING_CHECK";
    case "CORRECTING": return "REJECTED";
    case "IN_PREPARATION": return "TO_ROUTE";
    case "IN_REVIEW": case "NOT_RELEASED": return "IN_REVIEW";
    case "RETURNED": return "RETURNED";
    case "RELEASED": case "SUPERSEDED": return "APPROVED";
    default: return "NOT_SENT";
  }
}

/**
 * The package's documents, each where it stands. In a list, read from the
 * package alone; on the package's own page, from each document in full (when
 * it was sent, the comments, the transmittal it came on).
 */
export async function supplierRows(t: { projectId: string }, pkg: LegacyPackage): Promise<SupplierRow[]> {
  const now = Date.now();
  return Promise.all(pkg.view.members.map(async (m): Promise<SupplierRow> => {
    const due = m.dueDate ? new Date(m.dueDate) : pkg.completionDate;
    const light: SupplierRow = {
      doc: { id: m.documentId, docNumber: m.documentNumber, title: m.title, isPlaceholder: !m.latestRevision },
      revision: m.latestRevision ? { id: "", value: m.latestRevision, submittedAt: null, statusCode: m.status } : null,
      state: stateOf(m.latestState), due, late: false, arrivedOnTime: null, reason: null, outcome: null, transmittal: null,
      submissions: m.latestRevision ? 1 : 0, comments: [], issuedBack: null,
    };
    light.late = light.state === "NOT_SENT" && !!due && due.getTime() < now;
    if (!pkg.detail || !m.latestRevision) return light;
    const [doc, context] = await Promise.all([
      legacyDocument(t, m.documentId).catch(() => null),
      documentContext(t, m.documentId).catch(() => null),
    ]);
    const rev = doc?.revisions[0];
    if (!doc || !rev) return light;
    const cycle = rev.cycles[rev.cycles.length - 1] ?? null;
    // Sent back to the supplier after Document Control took it back: with them, not returned.
    const resent = rev.backend.state === "CORRECTING" && supplierStage(true, { state: rev.backend.state, resentAt: rev.backend.resent?.at, returnedAt: rev.backend.returnedAt }) === "SENT";
    const state = resent ? "NOT_SENT" : stateOf(rev.backend.state);
    const incoming = (context?.transmittals ?? [])
      .filter((one) => one.direction === "INCOMING" && one.revisionId === rev.id)
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0] ?? null;
    const arrivedOnTime = rev.submittedAt && due ? rev.submittedAt.getTime() <= due.getTime() : rev.submittedAt ? true : null;
    return {
      doc: { id: doc.id, docNumber: doc.docNumber, title: doc.title, isPlaceholder: doc.isPlaceholder },
      revision: { id: rev.id, value: rev.value, submittedAt: rev.submittedAt, statusCode: rev.statusCode },
      state, due,
      late: state === "NOT_SENT" ? !!due && due.getTime() < now : arrivedOnTime === false,
      arrivedOnTime,
      reason: state === "REJECTED" || state === "RETURNED" ? rev.backend.returnedReason ?? cycle?.outcomeNote ?? null : null,
      outcome: cycle?.outcome ?? null,
      transmittal: incoming ? { id: incoming.id, number: incoming.number } : null,
      submissions: doc.revisions.filter((r) => r.submittedAt).length,
      issuedBack: state === "RETURNED" ? rev.returnedAt : state === "APPROVED" ? rev.issuedAt ?? rev.releasedAt : null,
      // The comments of the latest revision's reviews — the ones its verdict
      // rests on. A revision not yet reviewed has none, and shows none.
      comments: rev.cycles.flatMap((cy) => cy.comments.map((one) => ({ by: one.authorName, text: one.text, blocking: one.progressionPreventing, settled: one.status === "CLOSED", review: cy.number, rev: rev.value }))),
    };
  }));
}

/** The figures from the two-stage diagram, for one package. */
export function supplierFigures(rows: SupplierRow[]) {
  const planned = rows.length;
  const arrived = rows.filter((r) => r.state !== "NOT_SENT").length;
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

/**
 * Where a supplier's package stands as a whole, in the reader's words: not shared yet (ours only); nothing sent yet;
 * sent, nothing back (theirs: to be transmitted); partly received (partly transmitted); all received
 * (transmitted); complete, every document released. `notAsked`: lines not asked of the supplier yet.
 */
export function packageStage(pkg: LegacyPackage, rows: SupplierRow[], side: "ours" | "theirs"): { word: string; tone: string; notAsked: number } {
  const asked = new Set(pkg.view.members.filter((m) => m.requestedAt).map((m) => m.documentId));
  const lines = rows.filter((r) => asked.has(r.doc.id));
  const notAsked = side === "ours" ? rows.length - lines.length : 0;
  const back = lines.filter((r) => r.state !== "NOT_SENT").length;
  const done = lines.filter((r) => r.state === "APPROVED").length;
  const slate = "bg-slate-100 text-slate-600 ring-slate-200", amber = "bg-amber-50 text-amber-900 ring-amber-200";
  const sky = "bg-sky-50 text-sky-800 ring-sky-200", green = "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (side === "ours" && !pkg.view.sharedAt) return { word: "not shared", tone: slate, notAsked };
  if (!lines.length) return { word: side === "ours" ? "nothing sent yet" : "nothing asked yet", tone: slate, notAsked };
  if (done === lines.length && !notAsked) return { word: "complete", tone: green, notAsked };
  if (back === 0) return { word: side === "ours" ? "sent to supplier" : "to be transmitted", tone: amber, notAsked };
  if (back < lines.length) return { word: side === "ours" ? `partly received · ${back} of ${lines.length}` : `partly transmitted · ${back} of ${lines.length}`, tone: sky, notAsked };
  return { word: side === "ours" ? "received" : "transmitted", tone: sky, notAsked };
}

/** A package line's state as the supplier's stage. */
export const STAGE_OF: Record<SupplierState, SupplierStage> = {
  NOT_SENT: "SENT", AWAITING_CHECK: "RECEIVED", REJECTED: "RETURNED_CHECK", TO_ROUTE: "ACCEPTED",
  IN_REVIEW: "IN_REVIEW", RETURNED: "RETURNED_REVIEW", APPROVED: "RELEASED",
};

const LINE_TONE: Record<SupplierStage, "done" | "waiting" | "refused" | "moving"> = {
  SENT: "waiting", RECEIVED: "moving", ACCEPTED: "moving", RETURNED_CHECK: "refused",
  IN_REVIEW: "moving", RELEASED: "done", RETURNED_REVIEW: "refused",
};

/**
 * Where one line of a supplier's package stands, in the reader's words (the same stamps as the register): sent to
 * supplier / to be transmitted, received / transmitted, accepted, returned / to correct, in review, released,
 * returned / to revise. A line not sent to the supplier yet reads so (only we see it). Who holds it is said beside it.
 */
export function lineStage(row: SupplierRow, asked: boolean, side: "ours" | "theirs"): { word: string; tone: "done" | "waiting" | "refused" | "moving" | "idle"; holder: string } {
  if (!asked) return { word: "not sent to supplier", tone: "idle", holder: "" };
  const stage = STAGE_OF[row.state];
  const theirs = WITH_SUPPLIER.includes(row.state);
  return {
    word: supplierStamp(stage, side),
    tone: LINE_TONE[stage],
    holder: side === "ours" ? (theirs ? "with the supplier" : "with us") : (theirs ? "with you" : "with us"),
  };
}

/**
 * A supplier package's counts, the same on its page and in the list: how many were sent to the supplier, how many
 * came back, who holds what was sent, and how many are late (not back by their date).
 */
export function packageCounts(pkg: LegacyPackage, rows: SupplierRow[]) {
  const asked = new Set(pkg.view.members.filter((m) => m.requestedAt).map((m) => m.documentId));
  const sent = rows.filter((r) => asked.has(r.doc.id));
  return {
    total: rows.length,
    sent: sent.length,
    notSent: rows.length - sent.length,
    received: sent.filter((r) => r.state !== "NOT_SENT").length,
    withThem: sent.filter((r) => WITH_SUPPLIER.includes(r.state)).length,
    withUs: sent.filter((r) => !WITH_SUPPLIER.includes(r.state) && r.state !== "APPROVED").length,
    late: rows.filter((r) => r.state === "NOT_SENT" && r.late).length,
  };
}
