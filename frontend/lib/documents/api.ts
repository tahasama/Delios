import "server-only";
import { cache } from "react";
import { api, ApiProblem, projectPath } from "@/lib/client";
import type { DocumentView, ReviewView, RevisionView, Written, HandBack } from "@/lib/types";

/**
 * A document as its page shows it: its revisions (newest first), each with its
 * files, decisions and reviews (one review cycle per review, with its comments
 * and everyone seated on it), and the actions and packages it is in. Built from
 * the backend's document, its context and its reviews; what a revision amounts
 * to (waiting for the check, decided and not released, granted, first issued) is
 * the backend's reading (RevisionReading), not worked out here.
 */

type Scope = { projectId: string };

export type PageFile = {
  id: string; name: string; path: string; size: number; mime: string; sha256: string; kind: string; revisionId: string | null;
  cycleId: string | null; uploadedById: string | null; uploadedByName: string | null; createdAt: Date; transmittalId: string | null;
  status: string; submission: number;
};

type PageComment = {
  id: string; cycleId: string; authorId: string; authorName: string; text: string; classification: string; progressionPreventing: boolean;
  closesWith: string; closesWithStep: number | null; status: string; resolution: string | null; closedAt: Date | null;
  reclassifiedAt: Date | null; reclassifiedByName: string | null; originalProgressionPreventing: boolean | null; createdAt: Date;
};

type PageAssignment = { id: string; cycleId: string; userId: string; userName: string; order: number; completedAt: Date | null };

export type PageCycle = {
  id: string; number: string | null; revisionId: string; mode: string; sequence: number; status: string; openedById: string; openedByName: string;
  /** Taken back out of review to be changed. */
  withdrawn?: boolean;
  transmittalId: string | null; submittedAt: Date; receivedAt: Date | null; issuedToReviewAt: Date | null; returnedFromReviewAt: Date | null;
  returnedToOriginatorAt: Date | null; dueAt: Date | null; outcome: string | null; outcomeAt: Date | null; outcomeByName: string | null;
  outcomeNote: string | null; binding: boolean; partyId: string | null; dispatchedAt: Date | null; issueRequestId: string | null; createdAt: Date;
  comments: PageComment[]; assignments: PageAssignment[];
  /** The backend's review, for what the cycle does not carry. */
  review: ReviewView;
};

export type PageApproval = {
  id: string; revisionId: string; approverId: string; approverName: string; approverRole: string; matrixVersion: number; decidedAt: Date;
  note: string | null; withdrawnAt: Date | null; withdrawnBy: string | null; withdrawnReason: string | null;
};

export type PageRevision = {
  id: string; documentId: string; value: string; series: string; state: string; statusCode: string | null; statusSetAt: Date | null;
  statusSetByName: string | null; returnedAt: Date | null; returnedReason: string | null; heldAt: Date | null; heldReason: string | null;
  heldByName: string | null; phase: string | null; reasonForRevision: string | null; changeDescription: string | null;
  plannedSubmissionDate: Date | null; issueDate: Date | null; nativeFileId: string | null; renditionFileId: string | null; appVersion: string | null;
  authorizationReason: string | null; authorizedById: string | null; authorizedByName: string | null; authorizedAt: Date | null;
  releasedAt: Date | null; releasedById: string | null; releasedByName: string | null; issuedAt: Date | null; supersededAt: Date | null;
  supersededById: string | null; voidedAt: Date | null; voidReason: string | null; voidAuthority: string | null; voidReassessment: string | null;
  submittedAt: Date | null; submittedById: string | null; submittedByName: string | null; authoredById: string | null; authoredByName: string | null;
  authoredByParty: string | null; uploadedById: string | null; uploadedByName: string | null; createdAt: Date; extras: string | null;
  /** Sent in by another organization and not accepted by the check yet (or sent back by it): its files are not the document's. */
  awaitingCheck?: boolean;
  files: PageFile[]; approvals: PageApproval[]; cycles: PageCycle[];
  /** The backend's own reading of it: RECEIVED, CORRECTING… and its files' scan. */
  backend: RevisionView;
};

export type PageDocument = {
  id: string; extras: string | null; projectId: string; docNumber: string; title: string; deliverableType: string; docType: string; discipline: string;
  originator: string | null; subProject: string | null; phase: string | null; contractRef: string | null; criticality: string | null; confidentiality: string | null;
  retentionClass: string | null; state: string; kind: string; confirmedAt: Date | null; confirmedByName: string | null; disposedAt: Date | null;
  disposedBy: string | null; disposalBasis: string | null; legalHold: boolean;
  legalHoldReason: string | null; legalHoldAt: Date | null; legalHoldBy: string | null; isPlaceholder: boolean; previousId: string | null;
  holdLifted: Written | null; ended: Written | null; reinstated: Written | null;
  /** Exchanged with a supplier: true while they hold it (only they change it), false while we do; null otherwise. */
  withSupplier: boolean | null;
  /** Taken as it came from a supplier's package with no placeholders. */
  asReceived: boolean;
  /** Some function on the project has a clearance below its confidentiality: its people read it only if named on it. */
  aboveSomeClearance: boolean;
  legacyScheme: string | null; createdDate: Date; receivedDate: Date | null; plannedDate: Date | null; appVersion: string | null;
  createdById: string; createdByName: string; createdAt: Date; updatedAt: Date;
  revisions: PageRevision[];
  baselineEntries: { id: string; requiredBy: Date | null; requiredStatus: string; purpose: string; state: string; waiverNote: string | null;
    action: { id: string; code: string; name: string; scheduledDate: Date | null } }[];
  packageMembers: { id: string; requiredStatus: string; package: { id: string; identifier: string; title: string; recipientName: string; state: string; category: string } }[];
};

type ContextTransmittal = {
  id: string; number: string; reason: string; toName: string; issuedAt: string; revision: string; forReview: boolean; direction: string;
  revisionId: string | null; fromName: string | null; itemKind: string;
  /** Whether the reader may open it: one they may not see is listed, not linked. */
  mayOpen: boolean;
  recipients: { name: string; organization: string | null; person: boolean; openedAt: string | null; acknowledgedAt: string | null; dispatchedAt: string | null }[];
};

type BackendContext = {
  reviews: { id: string; number: string; revisionId: string; revision: string; routeName: string; state: string; verdict: string | null; grantedStatus: string | null; startedAt: string; decidedAt: string | null }[];
  transmittals: ContextTransmittal[];
  packages: { id: string; number: string; title: string; state: string; kind: string; required: string[]; to: string }[];
  activities: { activityId: string; code: string; name: string; purpose: string; neededBy: string | null; state: string; waiverNote: string | null; needId: string; requiredStatuses: string[]; start: string | null }[];
  history: { at: string; actor: string | null; action: string; entityType: string | null; entityId?: string | null; entityLabel: string | null; detail: string | null }[];
};

const date = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

/** The backend's document, or null when it does not exist or is not the reader's to see. */
export const backendDocument = cache(async (scope: Scope, id: string): Promise<DocumentView | null> => {
  try {
    return await api<DocumentView>(projectPath(scope, `/documents/${id}`), { keep: { areas: [], doc: id, fallback: ["reviews", "transmittals"] } });
  } catch (e) {
    if (e instanceof ApiProblem && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
});

/** Several reviews in full at once (a document's page): one read, never one a review. */
export async function backendReviews(scope: Scope, ids: string[]): Promise<ReviewView[]> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return [];
  return api<ReviewView[]>(projectPath(scope, `/reviews/many?ids=${wanted.map(encodeURIComponent).join(",")}`));
}

/** Several documents at once, those the reader may see (a form enclosing them): one read, never one a document. */
export async function backendDocuments(scope: Scope, ids: string[]): Promise<DocumentView[]> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return [];
  return api<DocumentView[]>(projectPath(scope, `/documents/many?ids=${wanted.map(encodeURIComponent).join(",")}`), { keep: { areas: ["docs", "reviews", "transmittals"] } });
}

/** Reviews, transmittals, packages, activities and history around one document. */
export const documentContext = cache(async (scope: Scope, id: string): Promise<BackendContext> =>
  api<BackendContext>(projectPath(scope, `/documents/${id}/context`), { keep: { areas: [], doc: id, fallback: ["reviews", "transmittals", "plan", "packages"] } }));

/** Every ask to hand a supplier's document back, newest first, with its answer. */
export const handBacks = cache(async (scope: Scope, id: string): Promise<HandBack[]> =>
  api<HandBack[]>(projectPath(scope, `/documents/${id}/asks`)).catch(() => []));

/** One review in full: its steps, who sits on them and the comments. */
export const backendReview = cache(async (scope: Scope, id: string): Promise<ReviewView> =>
  api<ReviewView>(projectPath(scope, `/reviews/${id}`), { keep: { areas: ["reviews"] } }));

/** A review as a review cycle on the document page: one per review, binding when it has a deciding step. */
function cycleOf(review: ReviewView, sequence: number): PageCycle {
  const deciding = review.steps.find((s) => s.deciding) ?? review.steps[review.steps.length - 1];
  const decider = deciding?.participants.find((p) => p.answer && p.answer !== "NONE")?.name ?? deciding?.participants[0]?.name ?? null;
  const closed = review.state === "RELEASED" || review.state === "RETURNED" || review.state === "WITHDRAWN";
  return {
    id: review.id, number: review.number, revisionId: review.revisionId, mode: deciding?.mode ?? "PARALLEL", sequence,
    status: closed ? "CLOSED" : "OPEN", withdrawn: review.state === "WITHDRAWN", openedById: review.startedById ?? "", openedByName: review.startedBy, transmittalId: deciding?.transmittalId ?? null,
    submittedAt: new Date(review.startedAt), receivedAt: new Date(review.startedAt), issuedToReviewAt: new Date(review.startedAt),
    returnedFromReviewAt: date(review.decidedAt), returnedToOriginatorAt: review.state === "RETURNED" ? date(review.closedAt) : null,
    dueAt: date(review.steps.find((s) => s.state === "OPEN")?.dueDate ?? null), outcome: review.verdict, outcomeAt: date(review.decidedAt),
    outcomeByName: review.verdict ? decider : null, outcomeNote: review.returnNote, binding: review.steps.some((s) => s.deciding),
    partyId: null, dispatchedAt: date(deciding?.dispatchedAt ?? null), issueRequestId: null, createdAt: new Date(review.startedAt),
    comments: review.comments.map((c) => ({
      id: c.id, cycleId: review.id, authorId: c.authorId, authorName: c.author, text: c.text, classification: c.class, progressionPreventing: c.blocking,
      closesWith: c.closesWith, closesWithStep: c.closesWithStep, status: c.status, resolution: c.resolution, closedAt: null,
      reclassifiedAt: date(c.reclassifiedAt ?? null), reclassifiedByName: c.reclassifiedBy ?? null,
      originalProgressionPreventing: c.originalBlocking ?? null, createdAt: new Date(c.createdAt),
    })),
    assignments: review.steps.flatMap((s, i) => s.participants.map((p, j) => ({
      id: `${review.id}-${i}-${j}`, cycleId: review.id, userId: p.userId, userName: p.name, order: s.number, completedAt: date(p.answeredAt),
    }))),
    review,
  };
}

/** A revision as the document page shows it. */
function revisionOf(documentId: string, r: RevisionView, reviews: ReviewView[]): PageRevision {
  const mine = reviews.filter((one) => one.revisionId === r.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  // A type that is not reviewed goes on to release through a review with no steps: no cycle, and its rule stands in for an approval.
  const cycles = mine.filter((one) => one.steps.length).map((one, i) => cycleOf(one, i + 1));
  const decided = mine.filter((one) => one.verdict).sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));
  // The backend says what it amounts to (RevisionReading): waiting for the check, decided, granted, first issued.
  const reading = r.reading ?? { awaitingCheck: false, keptSubmission: r.submission, decided: false, granted: null, issuedAt: null };
  const awaitingCheck = reading.awaitingCheck;
  const kept = awaitingCheck ? r.files.filter((f) => f.submission === reading.keptSubmission) : r.files;
  // The files of the newest submission come first: that is what a screen reads as "the" file.
  const files = [...kept].sort((a, b) => b.submission - a.submission || b.createdAt.localeCompare(a.createdAt)).map((f) => ({
    id: f.id, name: f.name, path: "", size: f.size, mime: f.contentType, sha256: f.sha256, kind: f.kind, revisionId: r.id, cycleId: null,
    uploadedById: r.authoredById, uploadedByName: r.authoredByName, createdAt: new Date(f.createdAt), transmittalId: null, status: f.status,
    submission: f.submission,
  }));
  const current = files.filter((f) => f.submission === reading.keptSubmission);
  return {
    id: r.id, documentId, value: r.value, series: r.series,
    state: reading.decided ? "NOT_RELEASED" : r.state,
    // Decided and waiting for release: what the decider granted is what it carries.
    statusCode: (reading.decided ? reading.granted : null) ?? r.statusCode ?? null, statusSetAt: date(decided[0]?.decidedAt), statusSetByName: null, returnedAt: date(r.returnedAt), returnedReason: r.returnedReason,
    heldAt: date(r.heldAt), heldReason: r.heldReason, heldByName: r.heldByName, phase: r.phase ?? null, reasonForRevision: r.reasonForRevision, changeDescription: r.changeDescription,
    plannedSubmissionDate: null, issueDate: date(reading.issuedAt), nativeFileId: current.find((f) => f.kind === "NATIVE")?.id ?? null,
    renditionFileId: current.find((f) => f.kind === "RENDITION")?.id ?? null, appVersion: null, authorizationReason: null, authorizedById: null,
    authorizedByName: null, authorizedAt: null, releasedAt: date(r.releasedAt), releasedById: null, releasedByName: r.releasedByName,
    issuedAt: date(reading.issuedAt), supersededAt: date(r.supersededAt), supersededById: null, voidedAt: date(r.voidedAt), voidReason: r.voidReason, voidAuthority: r.voidAuthority,
    voidReassessment: r.voidReassessment, submittedAt: date(r.submissions[0]?.submittedAt), submittedById: r.authoredById, submittedByName: r.submissions[0]?.submittedBy ?? null,
    authoredById: r.authoredById, authoredByName: r.authoredByName, authoredByParty: r.authoredByParty, uploadedById: r.authoredById,
    uploadedByName: r.authoredByName, createdAt: new Date(r.createdAt), extras: null, files, awaitingCheck,
    approvals: decided.map((one) => {
      const deciding = one.steps.find((s) => s.deciding);
      const by = deciding?.participants.find((p) => p.answer && p.answer !== "NONE");
      return {
        id: one.id, revisionId: r.id, approverId: by?.userId ?? "", approverName: by?.name ?? one.startedBy, approverRole: deciding?.function ?? deciding?.party ?? deciding?.title ?? "",
        matrixVersion: 0, decidedAt: new Date(one.decidedAt!), note: by?.note ?? null, withdrawnAt: date(one.approvalWithdrawnAt ?? null), withdrawnBy: one.approvalWithdrawnBy ?? null, withdrawnReason: one.approvalWithdrawnReason ?? null,
      };
    }),
    cycles,
    backend: r,
  };
}

/** A document as its page shows it, with its revisions, review cycles, decisions, actions and packages. */
export const documentPage = cache(async (scope: Scope, id: string): Promise<PageDocument | null> => {
  const doc = await backendDocument(scope, id);
  if (!doc) return null;
  const context = await documentContext(scope, id);
  const read = new Map((await backendReviews(scope, context.reviews.map((one) => one.id))).map((one) => [one.id, one]));
  const reviews = context.reviews.map((one) => read.get(one.id)).filter((one): one is ReviewView => !!one);
  return {
    id: doc.id, extras: doc.extras ? JSON.stringify(doc.extras) : null, projectId: scope.projectId, docNumber: doc.number, title: doc.title, deliverableType: doc.deliverableType,
    docType: doc.docType, discipline: doc.discipline, originator: doc.originator, subProject: doc.subproject, phase: doc.phase ?? null, contractRef: doc.contractRef,
    criticality: doc.criticality, confidentiality: doc.confidentiality, retentionClass: doc.retentionClass, state: doc.state, kind: doc.kind,
    confirmedAt: date(doc.confirmedAt ?? null), confirmedByName: doc.confirmedByName ?? null, disposedAt: null, disposedBy: null, disposalBasis: null, legalHold: doc.legalHold,
    legalHoldReason: doc.legalHoldReason ?? null, legalHoldAt: date(doc.legalHoldAt ?? null), legalHoldBy: doc.legalHoldBy ?? null,
    holdLifted: doc.holdLifted ?? null, ended: doc.ended ?? null, reinstated: doc.reinstated ?? null,
    withSupplier: doc.withSupplier ?? null,
    asReceived: !!doc.asReceived,
    aboveSomeClearance: !!doc.aboveSomeClearance,
    isPlaceholder: doc.isPlaceholder, previousId: doc.previousNumber, legacyScheme: doc.legacyScheme, createdDate: new Date(doc.createdAt), receivedDate: date(doc.receivedDate),
    plannedDate: date(doc.plannedDate), appVersion: doc.appVersion, createdById: doc.createdById, createdByName: doc.createdByName,
    createdAt: new Date(doc.createdAt), updatedAt: new Date(doc.updatedAt),
    revisions: doc.revisions.map((r) => revisionOf(doc.id, r, reviews))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    baselineEntries: context.activities.map((a) => ({
      id: a.needId, requiredBy: date(a.neededBy), requiredStatus: a.requiredStatuses.join(","), purpose: a.purpose, state: a.state, waiverNote: a.waiverNote,
      action: { id: a.activityId, code: a.code, name: a.name, scheduledDate: date(a.start) },
    })),
    packageMembers: context.packages.map((p) => ({
      id: `${p.id}-${doc.id}`, requiredStatus: p.required.join(","),
      package: { id: p.id, identifier: p.number, title: p.title, recipientName: p.to, state: p.state, category: p.kind === "SUPPLY" ? "SUPPLIER" : "DELIVERY" },
    })),
  };
});

/** A revision on its own, with the document it belongs to. */
export const backendRevision = cache(async (scope: Scope, revisionId: string) =>
  api<{ id: string; documentId: string; value: string; state: string; statusCode: string | null; authoredById: string; authoredByName: string }>(
    projectPath(scope, `/revisions/${revisionId}`)));

/** What the caller may do about sending a revision out, and who wrote it. */
export const revisionStanding = cache(async (scope: Scope, revisionId: string) =>
  api<{ mayRequest: boolean; letsItOut: boolean; author: string | null; authorId: string | null }>(projectPath(scope, `/revisions/${revisionId}/standing`)));

/** The review a revision is in, or was last in: the newest one. Null when it never went to review. */
export async function reviewOfRevision(scope: Scope, revisionId: string): Promise<{ id: string; documentId: string; state: string } | null> {
  const revision = await backendRevision(scope, revisionId);
  const latest = (await documentContext(scope, revision.documentId)).reviews
    .filter((one) => one.revisionId === revisionId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return latest ? { id: latest.id, documentId: revision.documentId, state: latest.state } : null;
}
