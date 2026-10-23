/**
 * Which properties each published value set carries, and how to edit them in
 * plain controls. Behaviour across the app reads these — never code constants.
 *
 * Pure data, deliberately free of the database and of `server-only`, so the
 * things that generate and read spreadsheets can use it too.
 */

/**
 * Whether a set is a list of review verdicts.
 *
 * An organization that wants its own verdicts (for suppliers' documents, say) publishes a second list, and it has to
 * behave like the first: same meaning chooser, and offered where a route picks its verdict list. It says so itself
 * ("What it is", on the set: `kind` VERDICTS); the starter lists are known by their key.
 */
export function isVerdictSet(setKey: string, kind?: string | null): boolean {
  if (kind === "VERDICTS") return true;
  if (kind) return false;
  return /OUTCOME|VERDICT|REVIEW/.test(setKey.toUpperCase()) && !/ADVICE/.test(setKey.toUpperCase());
}

/** The properties a set's values carry, including a list that behaves like one. */
export function propFieldsFor(setKey: string, kind?: string | null): PropField[] | undefined {
  const exact = SET_PROP_FIELDS[setKey];
  if (exact) return exact;
  // A second verdict list is still a verdict list.
  if (isVerdictSet(setKey, kind)) return SET_PROP_FIELDS.REVIEW_OUTCOMES;
  return undefined;
}

export type PropField =
  | { key: string; label: string; type: "bool"; hint?: string }
  | { key: string; label: string; type: "int"; hint?: string }
  | { key: string; label: string; type: "text"; hint?: string }
  | { key: string; label: string; type: "select"; options: string[]; labels?: Record<string, string>; hint?: string }
  /** One value of another published list, offered from that list. */
  | { key: string; label: string; type: "set"; setKey: string; hint?: string }
  /** Several values of another published list, kept as a list of codes. */
  | { key: string; label: string; type: "sets"; setKey: string; hint?: string }
  /** One plain question whose answer sets several stored properties at once. */
  | { key: string; label: string; type: "choice"; options: ChoiceOption[]; read: (props: Record<string, unknown>) => string; hint?: string };

import type { ChoiceOption } from "@/lib/reviews/verdict-effect";

import { VERDICT_EFFECT, verdictEffect } from "@/lib/reviews/verdict-effect";
;

/** Whether a document type goes down a review route before it is released. */
const REVIEW_NEED: ChoiceOption[] = [
  { value: "YES", label: "Reviewed — it goes down a review route before release", sets: { review: true } },
  { value: "NO", label: "Not reviewed — from Prepare straight to release", sets: { review: false } },
];

export const SET_PROP_FIELDS: Record<string, PropField[]> = {
  DOCUMENT_TYPES: [
    { key: "review", label: "Reviewed before release", type: "choice", options: REVIEW_NEED, read: (props) => (props.review === false ? "NO" : "YES"), hint: "asked when the type is published; a type that is not reviewed goes from Prepare straight to release" },
    { key: "deliverables", label: "Deliverable types", type: "sets", setKey: "DELIVERABLE_TYPES", hint: "the deliverable types this document type belongs to; the new-document form offers it only for those. None ticked: read from \"Who produces it\"" },
    { key: "appliesTo", label: "Who produces it", type: "select", options: ["Supplier", "Non-supplier", "Unclassified"], hint: "used when no deliverable type is ticked; supplier documents carry the supplier fields in their number" },
    { key: "record", label: "A record — fixed once confirmed, never revised", type: "bool", hint: "minutes, a test result, a photo: documents of this type are registered as records, nobody is asked" },
 { key: "describesAsset", label: "Describes equipment — link it to an asset", type: "bool", hint: "" },
    { key: "readsRequirements", label: "Is a document requirements list — read when released", type: "bool", hint: "the spreadsheet on each released revision becomes what the activities need" },
    { key: "criticality", label: "Recommended criticality", type: "set", setKey: "CRITICALITY", hint: "filled in when a document of this type is created; whoever creates it may choose another" },
  ],
  STATUSES: [
 { key: "executes", label: "Allows work on site or in the shop", type: "bool", hint: "building, fabricating, installing or ordering from it" },
    { key: "may", label: "May be used for", type: "text" },
    { key: "mayNot", label: "May NOT be used for", type: "text" },
  ],
  REVIEW_OUTCOMES: [
 { key: "effect", label: "What this verdict does", type: "choice", options: VERDICT_EFFECT, read: verdictEffect, hint: "" },
  ],
  // Whose order it is: a document of another supplier may not name it (backend PO_OF_ANOTHER_SUPPLIER). Unset, the
  // supplier whose package carries the order owns it.
  PURCHASE_ORDERS: [
    { key: "supplier", label: "Supplier", type: "text", hint: "the supplier's code (Organizations); only its documents may name this order" },
  ],
  SUBPROJECTS: [
    { key: "project", label: "Belongs to project", type: "text", hint: "the project code; leave it empty to offer this sub-project on every project" },
  ],
  // Advice is read off the comments, never chosen, so only its wording is an
  // organization's business.
  REVIEW_ADVICE: [
    { key: "comments", label: "What the adviser's comments amount to", type: "select", options: ["none", "some", "blocking"] },
    { key: "meaning", label: "What it means", type: "text" },
  ],
  // Why a review route is rewound to an earlier step on the same revision.
  // Every one of them is a fault in the route, not in the document: a document
  // that is wrong is replaced by the next revision, never sent round again.
  RETURN_REASONS: [
    { key: "meaning", label: "What it means", type: "text" },
  ],
  REASONS_FOR_ISSUE: [
    { key: "family", label: "Kind of transmittal", type: "select", options: ["Data", "Information"], hint: "data carries documents (review, approval, execution…); information carries a request, an answer, a confirmation, an RFI. Unset is data" },
 { key: "maturity", label: "Required maturity", type: "text", hint: "what state the revision must be in" },
 { key: "reviewCycle", label: "Needs a review", type: "bool", hint: "received documents go down a review route once accepted" },
    { key: "response", label: "Needs a reply", type: "bool", hint: "the recipient must answer within the reply period" },
 { key: "acceptancePeriodDays", label: "Acceptance period (days)", type: "int", hint: "" },
 { key: "responseDays", label: "Response period (days)", type: "int", hint: "runs from acceptance" },
  ],
  COMMENT_CLASSES: [
 { key: "progressionPreventing", label: "Blocks the work until it is closed", type: "bool", hint: "" },
  ],
  CONFIDENTIALITY: [
 { key: "default", label: "Used when none is chosen", type: "bool", hint: "" },
  ],
  ISSUE_CODES: [
    { key: "reason", label: "Maps to reason for issue", type: "select", options: ["INFORMATION", "REVIEW", "APPROVAL", "PRICING", "EXECUTION", "RECORD", "REQUEST"] },
  ],
  CRITICALITY: [
    { key: "meaning", label: "What it means", type: "text", hint: "in plain words, with examples — shown when someone chooses it" },
 { key: "approval", label: "Minimum approval role", type: "select", options: ["REVIEWER", "APPROVER", "CONTROLLER", "ADMIN"], hint: "" },
    { key: "retention", label: "Suggested retention class", type: "text" },
 { key: "format", label: "Format obligation", type: "text", hint: "" },
  ],
  // What this organization is contracted to do on a project. The seven the app
  // ships carry a starting matrix; one an organization adds carries its own
  // definition, and its rows are written in the matrix like any other.
  // The handful of groups every discipline falls in, so a new sector adds its
  // disciplines under an existing group instead of inventing structure.
  DISCIPLINE_GROUPS: [
    { key: "description", label: "What falls in it", type: "text", hint: "" },
  ],
  DISCIPLINES: [
    { key: "group", label: "Discipline group", type: "text", hint: "a published group code — ENG, SITE, QSE, MGMT, OPS" },
  ],
  DOC_FAMILIES: [
    { key: "description", label: "What falls in it", type: "text", hint: "" },
  ],
  CONTRACT_ROLES: [
    { key: "approval", label: "Where approval sits", type: "text", hint: "one line, read by whoever opens a project under this role" },
    { key: "description", label: "What the role is", type: "text", hint: "" },
  ],
  RETENTION_CLASSES: [
 { key: "basis", label: "Kept because", type: "text", hint: "" },
 { key: "startsFrom", label: "Period runs from", type: "text", hint: "" },
  ],
};