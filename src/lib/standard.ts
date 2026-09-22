// Domain constants from the Document Management Standard v1.

export const ROLES = ["ADMIN", "CONTROLLER", "APPROVER", "REVIEWER", "AUTHOR", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  AUTHOR: 1,
  REVIEWER: 2,
  APPROVER: 3,
  CONTROLLER: 3,
  ADMIN: 5,
};

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrator",
  CONTROLLER: "Document Controller",
  APPROVER: "Approver",
  REVIEWER: "Reviewer",
  AUTHOR: "Author / Originator",
  VIEWER: "Viewer",
};

export const ROLE_BLURB: Record<Role, string> = {
  ADMIN: "Full access — configuration, users, authority matrix, audit.",
  CONTROLLER: "The designated control function: numbers, custody, releases, transmittals, obsolescence.",
  APPROVER: "Releases approval decisions for revisions within their authority.",
  REVIEWER: "Performs assigned reviews and records comment sheets.",
  AUTHOR: "Creates documents and revisions, submits for review and approval.",
  VIEWER: "Read-only access to released, current information.",
};

// §7.2 — revision states (fixed set, forward-only §7.5)
export const REV_STATES = ["IN_PREPARATION", "IN_REVIEW", "RELEASED", "SUPERSEDED", "VOID"] as const;
export type RevState = (typeof REV_STATES)[number];
export const REV_STATE_LABEL: Record<RevState, string> = {
  IN_PREPARATION: "In preparation",
  IN_REVIEW: "In review",
  RELEASED: "Released",
  SUPERSEDED: "Superseded",
  VOID: "Void",
};
export const REV_STATE_COLOR: Record<RevState, string> = {
  IN_PREPARATION: "bg-slate-100 text-slate-700 ring-slate-300",
  IN_REVIEW: "bg-amber-100 text-amber-800 ring-amber-300",
  RELEASED: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  SUPERSEDED: "bg-violet-100 text-violet-800 ring-violet-300",
  VOID: "bg-red-100 text-red-800 ring-red-300",
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
export const DOC_STATE_COLOR: Record<DocState, string> = {
  PLANNED: "bg-sky-100 text-sky-800 ring-sky-300",
  ACTIVE: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  WITHDRAWN: "bg-red-100 text-red-800 ring-red-300",
  CANCELLED: "bg-slate-200 text-slate-700 ring-slate-300",
  ARCHIVED: "bg-zinc-100 text-zinc-700 ring-zinc-300",
};

// §2.6 — reasons for issue (fixed set; issue codes are mapped to these per C.5.6)
export const REASONS_FOR_ISSUE = ["INFORMATION", "REVIEW", "APPROVAL", "PRICING", "EXECUTION", "RECORD"] as const;
export type ReasonForIssue = (typeof REASONS_FOR_ISSUE)[number];
export const REASON_LABEL: Record<ReasonForIssue, string> = {
  INFORMATION: "Information",
  REVIEW: "Review",
  APPROVAL: "Approval",
  PRICING: "Pricing",
  EXECUTION: "Execution",
  RECORD: "Record",
};
// Reason → which revision maturity it requires (§2.6)
export const REASON_MATURITY: Record<ReasonForIssue, string> = {
  INFORMATION: "Whatever exists",
  REVIEW: "Sufficient to be understood",
  APPROVAL: "Complete and internally consistent",
  PRICING: "Scope fully defined",
  EXECUTION: "Approved and current",
  RECORD: "Final; reflects what was done",
};
// Which reasons open a review cycle per revision (§11.11)
export const REASONS_WITH_REVIEW: ReasonForIssue[] = ["REVIEW", "APPROVAL"];
// Which reasons require a response
export const REASONS_WITH_RESPONSE: ReasonForIssue[] = ["REVIEW", "APPROVAL", "PRICING"];

// §12.6 — the five exposure conditions
export const EXPOSURES = [
  { key: "UNPROPAGATED_SUPERSESSION", label: "Replaced, but recipients not told", detail: "A newer revision exists; people who got the old one were never informed.", who: "Document Control" },
  { key: "UNCONTROLLED_CURRENT_USE", label: "Registered copy out of date", detail: "Document Control registered a controlled copy (a printed set, a site shelf) of a revision that has since been replaced.", who: "Copy holder" },
  { key: "BLOCKED_WORK", label: "Work blocked by a comment", detail: "A released revision still has an open blocking comment.", who: "Reviewer and executing party" },
  { key: "ORPHANED_WITHDRAWAL", label: "Withdrawn but still needed", detail: "A schedule action or package still requires a withdrawn document.", who: "Package or action owner" },
  { key: "UNRESOLVED_VOID", label: "Voided — impact not checked", detail: "A revision was voided and nobody has recorded what was built from it.", who: "The party that performed the work" },
] as const;

// §11.9 — transmittal acceptance conditions (minimum set)
export const ACCEPTANCE_CONDITIONS = [
  { key: "a", label: "Items listed are present and no unlisted items are enclosed" },
  { key: "b", label: "Revisions enclosed match those listed" },
  { key: "c", label: "A reason for issue is stated and corresponds to the items issued" },
  { key: "d", label: "Files are readable, complete, and in the required format" },
  { key: "e", label: "The transmittal is addressed to a party and contract to which the items relate" },
] as const;

// D.7 — recommended review outcome set (proceed / resubmission consequences §9.3)
export const OUTCOME_CONSEQUENCES: Record<string, { proceed: boolean; resubmit: boolean; label: string; blurb: string }> = {
  APPROVED: { proceed: true, resubmit: false, label: "Approved", blurb: "Fit for the use its status permits. Nothing outstanding." },
  APPROVED_WITH_COMMENTS: { proceed: true, resubmit: true, label: "Approved with comments", blurb: "Fit to work from. Comments incorporated at the next revision." },
  REVISE_AND_RESUBMIT: { proceed: false, resubmit: true, label: "Revise and resubmit", blurb: "Not fit to work from. Comments resolved and item resubmitted." },
  REJECTED: { proceed: false, resubmit: false, label: "Rejected", blurb: "Fundamentally deficient, or submitted in error. Fresh submission required." },
};

// §3.5 — fields that shall never be encoded in the document number
export const EXCLUDED_FROM_NUMBER = ["revision", "status", "date", "person"];

// §6.2 — letters excluded from alphabetic revision series
export const EXCLUDED_REV_LETTERS = ["I", "O", "Q", "S", "X", "Z"];

export const STANDARD_NAME = "Document Management Standard";
export const STANDARD_VERSION = "1.0";
export const APP_NAME = "DELIOS · EDMS";
