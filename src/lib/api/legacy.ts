import "server-only";
import { cache } from "react";
import { api, ApiProblem, projectPath } from "./client";
import type { DocumentView, ReviewView, RevisionView } from "./types";

/**
 * The screens were written against the old database's shapes: a document with
 * its revisions, each with its files, approvals and review cycles. The data now
 * comes from the backend; these build the same shapes from it, so a screen
 * changes only the line that loads its data.
 *
 * How the backend's records map:
 *   a review            → a review cycle (its comments, everyone seated on it)
 *   the review's verdict → the cycle's outcome, and the revision's approval
 *   decided, not yet released (review DECIDED) → revision state NOT_RELEASED
 */

type Scope = { projectId: string };

export type LegacyFile = {
  id: string; name: string; path: string; size: number; mime: string; sha256: string; kind: string; revisionId: string | null;
  cycleId: string | null; uploadedById: string | null; uploadedByName: string | null; createdAt: Date; transmittalId: string | null;
  status: string; submission: number;
};

export type LegacyComment = {
  id: string; cycleId: string; authorId: string; authorName: string; text: string; classification: string; progressionPreventing: boolean;
  closesWith: string; closesWithStep: number | null; status: string; resolution: string | null; closedAt: Date | null;
  reclassifiedAt: Date | null; reclassifiedByName: string | null; originalProgressionPreventing: boolean | null; createdAt: Date;
};

export type LegacyAssignment = { id: string; cycleId: string; userId: string; userName: string; order: number; completedAt: Date | null };

export type LegacyCycle = {
  id: string; number: string | null; revisionId: string; mode: string; sequence: number; status: string; openedById: string; openedByName: string;
  transmittalId: string | null; submittedAt: Date; receivedAt: Date | null; issuedToReviewAt: Date | null; returnedFromReviewAt: Date | null;
  returnedToOriginatorAt: Date | null; dueAt: Date | null; outcome: string | null; outcomeAt: Date | null; outcomeByName: string | null;
  outcomeNote: string | null; binding: boolean; partyId: string | null; dispatchedAt: Date | null; issueRequestId: string | null; createdAt: Date;
  comments: LegacyComment[]; assignments: LegacyAssignment[];
  /** The backend's review, for screens that need more than the old cycle carried. */
  review: ReviewView;
};

export type LegacyApproval = {
  id: string; revisionId: string; approverId: string; approverName: string; approverRole: string; matrixVersion: number; decidedAt: Date;
  note: string | null; withdrawnAt: Date | null; withdrawnBy: string | null; withdrawnReason: string | null;
};

export type LegacyRevision = {
  id: string; documentId: string; value: string; series: string; state: string; statusCode: string | null; statusSetAt: Date | null;
  statusSetByName: string | null; returnedAt: Date | null; returnedReason: string | null; heldAt: Date | null; heldReason: string | null;
  heldByName: string | null; phase: string | null; reasonForRevision: string | null; changeDescription: string | null;
  plannedSubmissionDate: Date | null; issueDate: Date | null; nativeFileId: string | null; renditionFileId: string | null; appVersion: string | null;
  authorizationReason: string | null; authorizedById: string | null; authorizedByName: string | null; authorizedAt: Date | null;
  releasedAt: Date | null; releasedById: string | null; releasedByName: string | null; issuedAt: Date | null; supersededAt: Date | null;
  supersededById: string | null; voidedAt: Date | null; voidReason: string | null; voidAuthority: string | null; voidReassessment: string | null;
  submittedAt: Date | null; submittedById: string | null; submittedByName: string | null; authoredById: string | null; authoredByName: string | null;
  authoredByParty: string | null; uploadedById: string | null; uploadedByName: string | null; createdAt: Date; extras: string | null;
  files: LegacyFile[]; approvals: LegacyApproval[]; cycles: LegacyCycle[];
  /** The backend's own reading of it: RECEIVED, CORRECTING… and its files' scan. */
  backend: RevisionView;
};

export type LegacyDocument = {
  id: string; extras: string | null; projectId: string; docNumber: string; title: string; deliverableType: string; docType: string; discipline: string;
  originator: string | null; subProject: string | null; contractRef: string | null; criticality: string | null; confidentiality: string | null;
  retentionClass: string | null; state: string; kind: string; confirmedAt: Date | null; confirmedByName: string | null; disposedAt: Date | null;
  disposedBy: string | null; disposalBasis: string | null; legalHold: boolean; isPlaceholder: boolean; previousId: string | null;
  legacyScheme: string | null; createdDate: Date; receivedDate: Date | null; plannedDate: Date | null; appVersion: string | null;
  createdById: string; createdByName: string; createdAt: Date; updatedAt: Date;
  revisions: LegacyRevision[];
  baselineEntries: { id: string; requiredBy: Date | null; requiredStatus: string; purpose: string; state: string; waiverNote: string | null;
    action: { id: string; code: string; name: string; scheduledDate: Date | null } }[];
  packageMembers: { id: string; requiredStatus: string; package: { id: string; identifier: string; title: string; recipientName: string; state: string; category: string } }[];
};

export type ContextTransmittal = {
  id: string; number: string; reason: string; toName: string; issuedAt: string; revision: string; forReview: boolean; direction: string;
  revisionId: string | null; fromName: string | null; itemKind: string;
  recipients: { name: string; organization: string | null; person: boolean; openedAt: string | null; acknowledgedAt: string | null; dispatchedAt: string | null }[];
};

export type BackendContext = {
  reviews: { id: string; number: string; revisionId: string; revision: string; routeName: string; state: string; verdict: string | null; grantedStatus: string | null; startedAt: string; decidedAt: string | null }[];
  transmittals: ContextTransmittal[];
  packages: { id: string; number: string; title: string; state: string; kind: string; required: string[]; to: string }[];
  activities: { activityId: string; code: string; name: string; purpose: string; neededBy: string | null; state: string; waiverNote: string | null; needId: string; requiredStatuses: string[]; start: string | null }[];
  history: { at: string; actor: string | null; action: string; entityType: string | null; entityLabel: string | null; detail: string | null }[];
};

const date = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

/** The backend's document, or null when it does not exist or is not the reader's to see. */
export const backendDocument = cache(async (scope: Scope, id: string): Promise<DocumentView | null> => {
  try {
    return await api<DocumentView>(projectPath(scope, `/documents/${id}`));
  } catch (e) {
    if (e instanceof ApiProblem && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
});

/** Reviews, transmittals, packages, activities and history around one document. */
export const documentContext = cache(async (scope: Scope, id: string): Promise<BackendContext> =>
  api<BackendContext>(projectPath(scope, `/documents/${id}/context`)));

/** One review in full: its steps, who sits on them and the comments. */
export const backendReview = cache(async (scope: Scope, id: string): Promise<ReviewView> =>
  api<ReviewView>(projectPath(scope, `/reviews/${id}`)));

/** A review as the old review cycle read: one cycle per review, binding when it has a deciding step. */
export function cycleOf(review: ReviewView, sequence: number): LegacyCycle {
  const deciding = review.steps.find((s) => s.deciding) ?? review.steps[review.steps.length - 1];
  const decider = deciding?.participants.find((p) => p.answer && p.answer !== "NONE")?.name ?? deciding?.participants[0]?.name ?? null;
  const closed = review.state === "RELEASED" || review.state === "RETURNED";
  return {
    id: review.id, number: review.number, revisionId: review.revisionId, mode: deciding?.mode ?? "PARALLEL", sequence,
    status: closed ? "CLOSED" : "OPEN", openedById: "", openedByName: review.startedBy, transmittalId: deciding?.transmittalId ?? null,
    submittedAt: new Date(review.startedAt), receivedAt: new Date(review.startedAt), issuedToReviewAt: new Date(review.startedAt),
    returnedFromReviewAt: date(review.decidedAt), returnedToOriginatorAt: review.state === "RETURNED" ? date(review.closedAt) : null,
    dueAt: date(review.steps.find((s) => s.state === "OPEN")?.dueDate ?? null), outcome: review.verdict, outcomeAt: date(review.decidedAt),
    outcomeByName: review.verdict ? decider : null, outcomeNote: review.returnNote, binding: review.steps.some((s) => s.deciding),
    partyId: null, dispatchedAt: date(deciding?.dispatchedAt ?? null), issueRequestId: null, createdAt: new Date(review.startedAt),
    comments: review.comments.map((c) => ({
      id: c.id, cycleId: review.id, authorId: "", authorName: c.author, text: c.text, classification: c.class, progressionPreventing: c.blocking,
      closesWith: c.closesWith, closesWithStep: c.closesWithStep, status: c.status, resolution: c.resolution, closedAt: null,
      reclassifiedAt: null, reclassifiedByName: null, originalProgressionPreventing: null, createdAt: new Date(c.createdAt),
    })),
    assignments: review.steps.flatMap((s, i) => s.participants.map((p, j) => ({
      id: `${review.id}-${i}-${j}`, cycleId: review.id, userId: "", userName: p.name, order: s.number, completedAt: date(p.answeredAt),
    }))),
    review,
  };
}

/** A revision as the old database held it. */
export function revisionOf(documentId: string, r: RevisionView, reviews: ReviewView[], transmittals: ContextTransmittal[]): LegacyRevision {
  const mine = reviews.filter((one) => one.revisionId === r.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const cycles = mine.map((one, i) => cycleOf(one, i + 1));
  const decided = mine.filter((one) => one.verdict).sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));
  const pending = mine.some((one) => one.state === "DECIDED");
  // The files of the newest submission come first: that is what a screen reads as "the" file.
  const files = [...r.files].sort((a, b) => b.submission - a.submission || b.createdAt.localeCompare(a.createdAt)).map((f) => ({
    id: f.id, name: f.name, path: "", size: f.size, mime: f.contentType, sha256: f.sha256, kind: f.kind, revisionId: r.id, cycleId: null,
    uploadedById: r.authoredById, uploadedByName: r.authoredByName, createdAt: new Date(f.createdAt), transmittalId: null, status: f.status,
    submission: f.submission,
  }));
  const current = files.filter((f) => f.submission === r.submission);
  const issued = transmittals.filter((t) => t.revisionId === r.id && t.direction === "OUTGOING" && !t.forReview)
    .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))[0];
  return {
    id: r.id, documentId, value: r.value, series: r.series,
    state: r.state === "IN_REVIEW" && pending ? "NOT_RELEASED" : r.state,
    statusCode: r.statusCode, statusSetAt: date(decided[0]?.decidedAt), statusSetByName: null, returnedAt: date(r.returnedAt), returnedReason: r.returnedReason,
    heldAt: null, heldReason: null, heldByName: null, phase: null, reasonForRevision: r.reasonForRevision, changeDescription: r.changeDescription,
    plannedSubmissionDate: null, issueDate: date(issued?.issuedAt), nativeFileId: current.find((f) => f.kind === "NATIVE")?.id ?? null,
    renditionFileId: current.find((f) => f.kind === "RENDITION")?.id ?? null, appVersion: null, authorizationReason: null, authorizedById: null,
    authorizedByName: null, authorizedAt: null, releasedAt: date(r.releasedAt), releasedById: null, releasedByName: r.releasedByName,
    issuedAt: date(issued?.issuedAt), supersededAt: date(r.supersededAt), supersededById: null, voidedAt: null, voidReason: null, voidAuthority: null,
    voidReassessment: null, submittedAt: date(r.submissions[0]?.submittedAt), submittedById: r.authoredById, submittedByName: r.submissions[0]?.submittedBy ?? null,
    authoredById: r.authoredById, authoredByName: r.authoredByName, authoredByParty: r.authoredByParty, uploadedById: r.authoredById,
    uploadedByName: r.authoredByName, createdAt: new Date(r.createdAt), extras: null, files,
    approvals: decided.map((one) => {
      const deciding = one.steps.find((s) => s.deciding);
      const by = deciding?.participants.find((p) => p.answer && p.answer !== "NONE");
      return {
        id: one.id, revisionId: r.id, approverId: "", approverName: by?.name ?? one.startedBy, approverRole: deciding?.function ?? deciding?.party ?? deciding?.title ?? "",
        matrixVersion: 0, decidedAt: new Date(one.decidedAt!), note: by?.note ?? null, withdrawnAt: null, withdrawnBy: null, withdrawnReason: null,
      };
    }),
    cycles,
    backend: r,
  };
}

/** A document as the old database held it, with its revisions, cycles, approvals, activities and packages. */
export const legacyDocument = cache(async (scope: Scope, id: string): Promise<LegacyDocument | null> => {
  const doc = await backendDocument(scope, id);
  if (!doc) return null;
  const context = await documentContext(scope, id);
  const reviews = await Promise.all(context.reviews.map((one) => backendReview(scope, one.id)));
  return {
    id: doc.id, extras: null, projectId: scope.projectId, docNumber: doc.number, title: doc.title, deliverableType: doc.deliverableType,
    docType: doc.docType, discipline: doc.discipline, originator: doc.originator, subProject: doc.subproject, contractRef: doc.contractRef,
    criticality: doc.criticality, confidentiality: doc.confidentiality, retentionClass: doc.retentionClass, state: doc.state, kind: doc.kind,
    confirmedAt: null, confirmedByName: null, disposedAt: null, disposedBy: null, disposalBasis: null, legalHold: false,
    isPlaceholder: doc.isPlaceholder, previousId: null, legacyScheme: null, createdDate: new Date(doc.createdAt), receivedDate: date(doc.receivedDate),
    plannedDate: date(doc.plannedDate), appVersion: null, createdById: doc.createdById, createdByName: doc.createdByName,
    createdAt: new Date(doc.createdAt), updatedAt: new Date(doc.updatedAt),
    revisions: doc.revisions.map((r) => revisionOf(doc.id, r, reviews, context.transmittals))
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
