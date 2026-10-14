import { TONE } from "@/lib/core/tones";
// Domain constants from the Document Management Standard v1.

export const ROLES = ["ADMIN", "CONTROLLER", "APPROVER", "REVIEWER", "AUTHOR", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrator",
  CONTROLLER: "Document Controller",
  APPROVER: "Approver",
  REVIEWER: "Reviewer",
  AUTHOR: "Author / Originator",
  VIEWER: "Viewer",
};
/**
 * A title that only repeats the document type says nothing: the type field
 * already holds it, and nobody can find the document by it. One list, used by
 * the form, the register, release and the conformance checks alike.
 */
export const EMPTY_TITLE_WORDS = [
  "report", "drawing", "layout", "document", "specification", "spec", "sketch", "plan", "note", "memo",
  "list", "schedule", "calculation", "datasheet", "procedure", "manual", "untitled", "test",
];
export function isEmptyTitle(title: string | null | undefined): boolean {
  const words = (title ?? "").trim().toLowerCase().replace(/s$/, "");
  return words.length === 0 || EMPTY_TITLE_WORDS.includes(words);
}

// §7.2 — revision states (fixed set, forward-only §7.5)
export const REV_STATES = ["IN_PREPARATION", "IN_REVIEW", "NOT_RELEASED", "RETURNED", "RELEASED", "SUPERSEDED", "VOID"] as const;
export type RevState = (typeof REV_STATES)[number];
export const REV_STATE_LABEL: Record<RevState, string> = {
  IN_PREPARATION: "In preparation",
  IN_REVIEW: "In review",
  NOT_RELEASED: "Not released",
  RETURNED: "Returned to review",
  RELEASED: "Released & issued",
  SUPERSEDED: "Superseded",
  VOID: "Void",
};

export function revStateColor(state: string): string {
  return REV_STATE_COLOR[state as RevState] ?? "";
}

/** In the reference tones: under way, waiting on someone, done, sent back, out of play. */
export const REV_STATE_COLOR: Record<RevState, string> = {
  IN_PREPARATION: TONE.idle,
  IN_REVIEW: TONE.moving,
  NOT_RELEASED: TONE.waiting,
  RETURNED: TONE.refused,
  RELEASED: TONE.done,
  SUPERSEDED: TONE.idle,
  VOID: TONE.refused,
};

// §7.3 — document states (fixed set)
export const DOC_STATES = ["PLANNED", "ACTIVE", "WITHDRAWN", "CANCELLED", "ARCHIVED"] as const;
export type DocState = (typeof DOC_STATES)[number];
export const DOC_STATE_LABEL: Record<DocState, string> = {
  PLANNED: "Planned",
  ACTIVE: "Active",
  WITHDRAWN: "Withdrawn",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};
export const DOC_MEANING: Record<DocState, { means: string; how: string }> = {
  PLANNED: { means: "The number is reserved; nothing has been released under it yet.", how: "Set when the document is created or listed." },
  ACTIVE: { means: "In use \u2014 at least one revision has been released.", how: "Automatic, at the first release." },
  WITHDRAWN: { means: "Taken out of use after it was released. Its revisions stay on record.", how: "Document Control, with a reason." },
  CANCELLED: { means: "Dropped before anything was released.", how: "Document Control, with a reason. Not possible once released." },
  ARCHIVED: { means: "Closed at the end of its life, kept for retention.", how: "Document Control, with a reason." },
};

export const REV_MEANING: Record<RevState, { means: string; how: string }> = {
  IN_PREPARATION: { means: "Being written. Only the author's side works from it.", how: "The author starts a new revision." },
  IN_REVIEW: { means: "Submitted; reviewers and approvers are looking at it.", how: "The author sends it for review." },
  RETURNED: { means: "Reviewed and sent back. It is kept as what was submitted and what was said about it, and it is never released. The next revision replaces it.", how: "The control function sends it back to its author; the verdict that asked for changes authorizes the next revision." },
  NOT_RELEASED: { means: "The route is finished and the status is decided, but Document Control has not published it. Nobody may work from it.", how: "Automatic, when the deciding step of the route answers." },
  RELEASED: { means: "The current revision \u2014 the one people work from.", how: "Document Control releases it, once it is approved and no blocking comment is open." },
  SUPERSEDED: { means: "Replaced by a later released revision. Kept, not used.", how: "Automatic, when the next revision is released." },
  VOID: { means: "Found to be wrong after release and cancelled.", how: "Document Control, with a reason and a check of what was built from it." },
};

export const DOC_STATE_COLOR: Record<DocState, string> = {
  PLANNED: TONE.idle,
  ACTIVE: TONE.done,
  WITHDRAWN: TONE.refused,
  CANCELLED: TONE.idle,
  ARCHIVED: TONE.idle,
};

// §2.6 — reasons for issue (fixed set; issue codes are mapped to these per C.5.6)
export const REASONS_FOR_ISSUE = ["INFORMATION", "REVIEW", "APPROVAL", "PRICING", "EXECUTION", "RECORD", "REQUEST"] as const;
export type ReasonForIssue = (typeof REASONS_FOR_ISSUE)[number];
export const REASON_LABEL: Record<ReasonForIssue, string> = {
  INFORMATION: "Information",
  REVIEW: "Review",
  APPROVAL: "Approval",
  PRICING: "Pricing",
  EXECUTION: "Execution",
  RECORD: "Record",
  // Asking the other party for something — an RFI, a clarification, a missing
  // document. It carries no obligation on them beyond answering, which is
  // exactly why it needs a reason of its own rather than borrowing Review.
  REQUEST: "Request",
};
// Reason → which revision maturity it requires (§2.6)
// Which reasons open a review cycle per revision (§11.11)
// Which reasons require a response
// §12.6 — the five exposure conditions
export const EXPOSURES = [
  { key: "UNPROPAGATED_SUPERSESSION", label: "Replaced, but recipients not told", detail: "A newer revision exists; people who got the old one were never informed.", who: "Document Control" },
  { key: "BLOCKED_WORK", label: "Released, but the verdict says stop", detail: "A released revision carries a binding verdict that does not permit the work to proceed.", who: "Document Control and executing party" },
  { key: "ORPHANED_WITHDRAWAL", label: "Withdrawn but still needed", detail: "A schedule action or package still requires a withdrawn document.", who: "Package or action owner" },
  { key: "UNRESOLVED_VOID", label: "Declared void — nobody has said what was done from it", detail: "A revision was declared void: it should never have been used at all, unlike a superseded one that was right in its day. Whatever was built, ordered or decided from it has to be found and reassessed, and no such record exists.", who: "The party that performed the work" },
] as const;

/**
 * What an advisory step's comments amount to, recorded as the step's answer.
 * It is not a list an organization publishes, because nobody chooses it: it is
 * read off the comments that step left, and the only list behind it is the one
 * list of comment classifications. Three states are all there are — nothing was
 * said, something was said, or something was said that stops the release.
 */
export const ADVICE_CODES = ["NO_COMMENT", "COMMENTS", "COMMENTS_BLOCKING"] as const;
export const ADVICE_LABEL: Record<string, string> = {
  NO_COMMENT: "No comments",
  COMMENTS: "Comments, none blocking",
  COMMENTS_BLOCKING: "Blocking comments",
};
export const ADVICE_MEANING: Record<string, string> = {
  NO_COMMENT: "The step read the revision and wrote nothing.",
  COMMENTS: "The step left comments; none of them stops the release.",
  COMMENTS_BLOCKING: "The step left a comment that stops the release until it is settled.",
};
// D.7 — recommended review outcome set (proceed / resubmission consequences §9.3)
export const OUTCOME_CONSEQUENCES: Record<string, { proceed: boolean; resubmit: boolean; label: string; blurb: string }> = {
  APPROVED: { proceed: true, resubmit: false, label: "Approved", blurb: "Fit for the use its status permits. Nothing outstanding." },
  APPROVED_WITH_COMMENTS: { proceed: true, resubmit: true, label: "Approved with comments", blurb: "Fit to work from. Comments incorporated at the next revision." },
  REVISE_AND_RESUBMIT: { proceed: false, resubmit: true, label: "Revise and resubmit", blurb: "Not fit to work from. Comments resolved and item resubmitted." },
  REJECTED: { proceed: false, resubmit: false, label: "Rejected", blurb: "Fundamentally deficient, or submitted in error. Fresh submission required." },
};

// §3.5 — fields that shall never be encoded in the document number
// §6.2 — letters excluded from alphabetic revision series
export const STANDARD_VERSION = "1.0";
export const APP_NAME = "DELIOS · EDMS";
