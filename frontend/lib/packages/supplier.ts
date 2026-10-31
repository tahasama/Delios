import { packageLines } from "@/lib/packages/api";
import type { PackageView } from "@/lib/types";
import { supplierStage, supplierStamp, type SupplierStage } from "@/lib/core/state-names";
import { stateLook } from "@/lib/core/state-look";

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
  | "AWAITING_CHECK"  // sent; the control function has not checked it
  | "REJECTED"        // failed the check; back with the supplier
  | "TO_ROUTE"        // accepted; the control function sends it for review
  | "IN_REVIEW"
  | "RETURNED"        // review asked for changes; back with the supplier
  | "APPROVED";       // review passed (awaiting or after release)
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
  /** When it was released and issued. */
  issued: Date | null;
  /** Every comment made on the revision, for the list that goes back to the supplier. */
  comments: { by: string; text: string; blocking: boolean; settled: boolean; review: string | null; rev: string }[];
};

/**
 * Where a revision stands, from the backend's state: sent in and waiting for
 * The control function (RECEIVED), sent back for a correction (CORRECTING),
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
export async function supplierRows(t: { projectId: string }, pkg: PackageView, detail = false): Promise<SupplierRow[]> {
  const now = Date.now();
  // In full: every line read at once from the backend, never document by document.
  const lines = detail ? new Map((await packageLines(t, pkg.id).catch(() => [])).map((one) => [one.documentId, one])) : null;
  return Promise.all(pkg.members.map(async (m): Promise<SupplierRow> => {
    const due = m.dueDate ? new Date(m.dueDate) : pkg.completionDate ? new Date(pkg.completionDate) : null;
    const light: SupplierRow = {
      doc: { id: m.documentId, docNumber: m.documentNumber, title: m.title, isPlaceholder: !m.latestRevision },
      revision: m.latestRevision ? { id: "", value: m.latestRevision, submittedAt: null, statusCode: m.status } : null,
      state: stateOf(m.latestState), due, late: false, arrivedOnTime: null, reason: null, outcome: null, transmittal: null,
      submissions: m.latestRevision ? 1 : 0, comments: [], issued: null,
    };
    light.late = light.state === "NOT_SENT" && !!due && due.getTime() < now;
    if (!detail || !m.latestRevision) return light;
    const line = lines?.get(m.documentId);
    if (!line?.revisionId) return light;
    // Sent back to the supplier after the control function took it back: with them, not returned.
    const resent = line.revisionState === "CORRECTING" && supplierStage(true, { state: line.revisionState, resentAt: line.resentAt ?? undefined, returnedAt: line.returnedAt }) === "SENT";
    const state = resent ? "NOT_SENT" : stateOf(line.revisionState);
    const submittedAt = line.submittedAt ? new Date(line.submittedAt) : null;
    const arrivedOnTime = submittedAt && due ? submittedAt.getTime() <= due.getTime() : submittedAt ? true : null;
    const issued = line.issuedAt ?? line.releasedAt;
    return {
      doc: { id: line.documentId, docNumber: line.number, title: line.title, isPlaceholder: line.isPlaceholder },
      revision: { id: line.revisionId, value: line.revision!, submittedAt, statusCode: line.statusCode },
      state, due,
      late: state === "NOT_SENT" ? !!due && due.getTime() < now : arrivedOnTime === false,
      arrivedOnTime,
      reason: state === "REJECTED" || state === "RETURNED" ? line.returnedReason ?? line.outcomeNote ?? null : null,
      outcome: line.outcome,
      transmittal: line.incomingId && line.incomingNumber ? { id: line.incomingId, number: line.incomingNumber } : null,
      submissions: line.submissions,
      issued: state === "APPROVED" && issued ? new Date(issued) : null,
      // The comments of the latest revision's reviews — the ones its verdict
      // rests on. A revision not yet reviewed has none, and shows none.
      comments: line.comments,
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
export function packageStage(pkg: PackageView, rows: SupplierRow[], side: "ours" | "theirs"): { word: string; tone: string; notAsked: number } {
  const c = packageCounts(pkg, rows);
  const notAsked = side === "ours" ? c.notSent : 0;
  const slate = "bg-slate-100 text-slate-600 ring-slate-200", amber = "bg-amber-50 text-amber-900 ring-amber-200";
  const sky = "bg-sky-50 text-sky-800 ring-sky-200", green = "bg-emerald-50 text-emerald-800 ring-emerald-200";
  const violet = "bg-violet-50 text-violet-800 ring-violet-200";
  if (side === "ours" && !pkg.sharedAt) return { word: "not shared yet", tone: slate, notAsked };
  if (!c.sent) return { word: side === "ours" ? "nothing sent to the supplier yet" : "nothing asked of you yet", tone: slate, notAsked };
  if (c.released === c.total) return { word: "complete: every document released", tone: green, notAsked };
  // Who has to act next: the supplier on what it holds, us on what came back.
  if (c.withThem && c.withUs) return { word: side === "ours" ? `waiting: supplier ${c.withThem} · us ${c.withUs}` : `${c.withThem} for you · ${c.withUs} with us`, tone: violet, notAsked };
  if (c.withThem) return { word: side === "ours" ? `waiting on the supplier (${c.withThem})` : `${c.withThem} for you to send`, tone: amber, notAsked };
  if (c.withUs) return { word: side === "ours" ? `waiting on us (${c.withUs})` : `${c.withUs} with us`, tone: sky, notAsked };
  return { word: side === "ours" ? "released so far; the rest not sent yet" : "released so far", tone: green, notAsked };
}

/** A package line's state as the supplier's stage. */
const STAGE_OF: Record<SupplierState, SupplierStage> = {
  NOT_SENT: "SENT", AWAITING_CHECK: "RECEIVED", REJECTED: "RETURNED_CHECK", TO_ROUTE: "ACCEPTED",
  IN_REVIEW: "IN_REVIEW", RETURNED: "RETURNED_REVIEW", APPROVED: "RELEASED",
};

const LINE_TONE: Record<SupplierStage, "done" | "waiting" | "refused" | "moving"> = {
  SENT: "waiting", RECEIVED: "moving", ACCEPTED: "moving", RETURNED_CHECK: "refused",
  IN_REVIEW: "moving", RELEASED: "done", RETURNED_REVIEW: "refused",
};

/** The side colour of each stage (the key is `lib/core/rails.ts`, "Supplier documents"). */
const LINE_RAIL: Record<SupplierStage, string> = {
  SENT: "rail-sent", RECEIVED: "rail-check", ACCEPTED: "rail-checked", RETURNED_CHECK: "rail-returned",
  IN_REVIEW: "rail-review", RELEASED: "rail-released", RETURNED_REVIEW: "rail-rejected",
};

/**
 * Where one line of a supplier's package stands, in the reader's words (the same stamps as the register): sent to
 * supplier / to be transmitted, received / transmitted, accepted, returned / to correct, in review, released,
 * returned / to revise. A line not sent to the supplier yet reads so (only we see it). Who holds it is said beside it.
 */
export function lineStage(row: SupplierRow, asked: boolean, side: "ours" | "theirs"): { word: string; tone: "done" | "waiting" | "refused" | "moving" | "idle"; holder: string; rail: string; pill: string } {
  if (!asked) return { word: "not sent to supplier", tone: "idle", holder: "", rail: "rail-none", pill: stateLook("NONE").pill };
  const stage = STAGE_OF[row.state];
  const theirs = WITH_SUPPLIER.includes(row.state);
  return {
    word: supplierStamp(stage, side),
    tone: LINE_TONE[stage],
    rail: LINE_RAIL[stage],
    // Each stage its own colour, as in the register (`lib/core/state-look.ts`): accepted never reads as released.
    pill: stateLook(stage).pill,
    holder: side === "ours" ? (theirs ? "with the supplier" : "with us") : (theirs ? "with you" : "with us"),
  };
}

/**
 * A supplier package's counts, the same on its page and in the list: how many were sent to the supplier, how many
 * came back, who holds what was sent, and how many are late (not back by their date).
 */
export function packageCounts(pkg: PackageView, rows: SupplierRow[]) {
  const asked = new Set(pkg.members.filter((m) => m.requestedAt).map((m) => m.documentId));
  const sent = rows.filter((r) => asked.has(r.doc.id));
  return {
    total: rows.length,
    /** Asked of the supplier on a transmittal. */
    sent: sent.length,
    /** Not asked of the supplier yet: ours to send. */
    notSent: rows.length - sent.length,
    /** Ever came back from the supplier. */
    received: sent.filter((r) => r.state !== "NOT_SENT").length,
    /** The supplier holds it: to send, to correct or to revise. */
    withThem: sent.filter((r) => WITH_SUPPLIER.includes(r.state)).length,
    /** We hold it: to check, to send for review, or in review. */
    withUs: sent.filter((r) => !WITH_SUPPLIER.includes(r.state) && r.state !== "APPROVED").length,
    /** Of those with us, waiting for the control function's check. */
    toCheck: sent.filter((r) => r.state === "AWAITING_CHECK").length,
    released: sent.filter((r) => r.state === "APPROVED").length,
    late: rows.filter((r) => r.state === "NOT_SENT" && r.late).length,
    /** Late and still with the supplier (asked, not back by its date). */
    lateWithThem: sent.filter((r) => r.state === "NOT_SENT" && r.late).length,
    /** Late and not even sent to the supplier yet. */
    lateNotSent: rows.filter((r) => !asked.has(r.doc.id) && r.state === "NOT_SENT" && r.late).length,
  };
}
