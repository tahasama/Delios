/**
 * A person's acts, as the audit trail codes them, in the words a person would use (their activity in Settings →
 * People & access). A code not listed reads as its own words, lower case.
 */
const WORDS: Record<string, string> = {
  // Opened and downloaded
  DOCUMENT_VIEWED: "Opened a document",
  DOWNLOAD: "Downloaded a file",
  ACTIVITY_READ: "Read someone's activity",
  TRANSMITTAL_OPENED: "Opened a transmittal",
  // Sign-ins and security
  SIGN_IN: "Signed in",
  SIGN_IN_MFA: "Signed in, with the second step",
  SIGN_IN_SSO: "Signed in with the organization's sign-in",
  SIGN_IN_FAILED: "Failed to sign in",
  LOGIN: "Signed in",
  ACCOUNT_LOCKED: "Account locked after failed sign-ins",
  MFA_ENABLED: "Turned the second sign-in step on",
  MFA_DISABLED: "Turned the second sign-in step off",
  MFA_FAILED: "Failed the second sign-in step",
  MFA_RESET: "Reset someone's second sign-in step",
  PASSWORD_RESET: "Chose a new password",
  PASSWORD_RESET_ASKED: "Asked for a new password",
  SSO_CONFIGURED: "Set up the organization's sign-in",
  SECURITY_POLICY_CHANGED: "Changed the sign-in rules",
  SWITCHED_IN: "Switched in from their own organization",
  ACCESS_REFUSED: "Was refused access",
  // Reviews and decisions
  REVIEW_STARTED: "Sent for review",
  STEP_DISPATCHED: "Sent a review step to an outside party",
  ADVICE: "Gave advice on a review",
  VERDICT: "Gave a verdict",
  REVIEW_DECIDED: "Review decided",
  REVIEW_SENT_BACK_TO_STEP: "Sent a review back to a step",
  COMMENT_CHANGED: "Changed a comment",
  COMMENT_WITHDRAWN: "Took a comment back",
  COMMENT_CLOSED: "Closed a comment",
  DELEGATION_REQUESTED: "Asked to hand a review step over",
  DELEGATION_GRANTED: "Let a review step be handed over",
  DELEGATION_REFUSED: "Refused a hand-over",
  DELEGATION_WITHDRAWN: "Took a hand-over back",
  OUTSIDE_APPROVAL_ASKED: "Asked for outside approval",
  OUTSIDE_APPROVED: "Recorded outside approval",
  OUTSIDE_REFUSED: "Recorded an outside refusal",
  RESUBMITTED: "Sent a corrected revision back",
  // Releases and issues
  RELEASED: "Released a revision",
  SENT_FOR_RELEASE: "Sent for release",
  ISSUED: "Issued a revision",
  ISSUE_REQUESTED: "Asked for a revision to be sent",
  SUPERSEDED: "Revision superseded",
  STAMPED: "PDF stamped",
  STAMP_NOT_POSSIBLE: "PDF could not be stamped",
  // Returns, holds and ends
  RETURNED_TO_AUTHOR: "Returned to its author",
  RETURNED_FOR_CORRECTION: "Returned for correction",
  RETURNED_TO_SENDER: "Returned to whoever sent it",
  WITHDRAWN_FOR_UPDATE: "Withdrew for an update",
  APPROVAL_WITHDRAWN: "Took an approval back",
  DECISION_REVERSED: "Took a decision back",
  VOIDED: "Voided a revision",
  UNVOIDED: "Took a void back",
  VOID_REASSESSED: "Recorded what came of a void",
  LEGAL_HOLD: "Put on or lifted a legal hold",
  REVISION_HELD: "Put a revision on hold",
  REVISION_HOLD_LIFTED: "Lifted a hold",
  HELD_RETURNED: "Returned a held revision",
  HANDED_BACK: "Handed a document back for an update",
  HAND_BACK_REFUSED: "Refused to hand a document back",
  ASKED_BACK: "Asked for a document back",
  STATE_TRANSITION: "Cancelled, withdrew or reinstated a document",
  // Transmittals
  TRANSMITTAL_ISSUED: "Sent a transmittal",
  TRANSMITTAL_RECEIVED: "Recorded a transmittal received",
  TRANSMITTAL_ACKNOWLEDGED: "Acknowledged a transmittal",
  TRANSMITTAL_DISPATCHED: "Dispatched a transmittal",
  TRANSMITTAL_CHASED: "Chased an answer",
  TRANSMITTAL_FILES_KEPT: "Kept files with what arrived",
  EMAIL_REPLY_RECEIVED: "A reply came by email",
  EMAIL_REPLY_SET_ASIDE: "Set an email reply aside",
  SUPPLY_REQUESTED: "Asked a supplier for documents",
  SENT_TO_SUPPLIER: "Sent a document to its supplier",
  SUBMISSION_ACCEPTED: "Accepted what a supplier sent",
  // Packages
  PACKAGE_CREATED: "Made a package",
  PACKAGE_CHANGED: "Changed a package",
  PACKAGE_RULE: "Narrowed a package by a rule",
  PACKAGE_SHARED: "Shared a package",
  PACKAGE_UNSHARED: "Put a package back to not shared",
  PACKAGE_MEMBERS_ADDED: "Added documents to a package",
  PACKAGE_MEMBERS_REMOVED: "Took documents out of a package",
  PACKAGE_DELIVERED: "Delivered a package",
  PACKAGE_ASSESSED: "Checked a package",
  PACKAGE_ACCEPTED: "Accepted a package",
  PACKAGE_CLOSED: "Closed a package",
  PACKAGE_DELETED: "Deleted an empty package",
  SHORTFALL_ISSUED: "Asked for what a package is missing",
  SHORTFALL_ACCEPTED: "Accepted a package short",
  // Schedule
  SCHEDULE_READ: "Read the schedule",
  SCHEDULE_NOT_READ: "Schedule could not be read",
  SCHEDULE_SOURCE_SET: "Chose the project's schedule",
  DEPARTMENTS_READ: "Read the disciplines per action",
  DEPARTMENTS_NOT_READ: "Disciplines per action could not be read",
  DEPARTMENTS_NOTIFIED: "Told the disciplines",
  REQUIREMENTS_READ: "Read the requirements list",
  REQUIREMENTS_NOT_READ: "Requirements list could not be read",
  REQUIREMENTS_ISSUED: "Issued the requirements list",
  REQUIREMENT_CALL: "Called on the disciplines",
  REQUIREMENT_CALL_ANSWERED: "Answered a call",
  REQUIREMENT_CALL_REMINDED: "Reminded a discipline",
  LIST_READ_FROM_UPLOAD: "Read a list from an upload",
  LIST_UPLOADED_WITHOUT_DOCUMENT: "Uploaded a list with no document",
  ACTIVITY_DECISION: "Recorded whether an action went ahead",
  ACTIVITY_DEPARTMENTS: "Changed an action's disciplines",
  ACTIVITY_REQUEST_ANSWERED: "Answered a request on an action",
  ACTIVITY_REQUEST_CHECKED: "Checked a request on an action",
  ACTIVITY_REQUEST_CONFIRMED: "Confirmed a request on an action",
  ACTIVITY_REQUEST_REFUSED: "Refused a request on an action",
  READINESS_CONFIRMED: "Confirmed going ahead",
  READINESS_REVOKED: "Took a confirmation back",
  POSTPONEMENT_CONFIRMED: "Confirmed a postponement",
  NEED_ADDED: "Added a document to an action",
  NEED_REMOVED: "Took a document off an action",
  NEED_WAIVED: "Waived a document an action needs",
  NEED_WAIVER_WITHDRAWN: "Took a waiver back",
  NOTICE_SENT: "Sent a notice",
  CONTROLLED_UPLOADED: "Uploaded a list",
  CONTROLLED_SUBMITTED: "Sent a list for approval",
  CONTROLLED_APPROVED: "Approved a list",
  CONTROLLED_REJECTED: "Refused a list",
  CONTROLLED_DISCARDED: "Discarded a list",
  // The register
  REGISTER_ENTRY: "Registered a document",
  UNPLANNED_REGISTERED: "Registered what arrived",
  METADATA_CHANGE: "Changed a document's details",
  REVISION_ESTABLISHED: "Started a revision",
  FILE_UPLOADED: "Uploaded a file",
  FILES_UPDATED: "Changed a revision's files",
  FILE_CLEAN: "File passed the virus check",
  REVISION_FILES_READY: "A revision's files are ready",
  REVISION_FILES_REJECTED: "A revision's files were refused",
  RECORD_CONFIRMED: "Confirmed a record",
  RECORD_CORRECTED: "Corrected a record",
  RELATIONSHIP: "Linked documents",
  ASSET_ADDED: "Added a tag",
  ASSET_UPDATED: "Changed a tag",
  ASSET_RETIRED: "Retired a tag",
  CHECK_RUN: "Ran the checks",
  CHECK_SWITCHED_ON: "Switched a check on",
  CHECK_SWITCHED_OFF: "Switched a check off",
  DEFECT_ACCEPTED: "Accepted a finding",
  EXCEPTION_RECORDED: "Recorded an exception",
  CONTENT_EXTRACTED: "Read a file's content",
  EXTRACTION_REQUESTED: "Asked for a file's content to be read",
  EXTRACTION_MODE_CHANGED: "Changed how content is read",
  NUMBER_RANGE_ISSUED: "Reserved numbers",
  // People and settings
  USER_CREATED: "Made an account",
  USER_UPDATED: "Changed an account",
  SIGN_UP: "Signed the organization up",
  EMAIL_CONFIRMED: "Confirmed an email",
  MEMBERSHIP_CHANGED: "Changed who is on a project",
  PERSON_CONFIRMED: "Confirmed someone joining",
  PERSON_REFUSED: "Refused someone joining",
  PERSON_JOINED_PROJECT: "Put someone on a project",
  PERSON_LEFT_PROJECT: "Took someone off a project",
  LINKED_PERSON_ADDED: "Put one of their people on our project",
  LINKED_PERSON_REMOVED: "Took one of their people off our project",
  GUEST_BROUGHT_OVER: "Brought a guest account over",
  GRANT_ALL: "Given every right",
  CONTROL_PEOPLE: "Named who acts as the control function",
  ACCESS_GRANTED: "Gave access",
  ACCESS_REVOKED: "Took access away",
  FUNCTION_CREATED: "Made a function",
  FUNCTION_UPDATED: "Changed a function",
  PARTY_CREATED: "Added an organization",
  ORGANIZATION_IDENTIFIED: "Gave our organization's identifier",
  DOMAIN_LINK_SENT: "Sent the link to prove our domain",
  DOMAIN_CONFIRMED: "Proved our email domain",
  ORGANIZATION_CLAIMED: "Claimed an entry others made for us",
  CLAIM_VOUCHED: "Vouched for an organization's claim",
  CLAIM_REFUSED: "Refused an organization's claim",
  MERGE_ASKED: "Asked for two organizations to be merged",
  MERGE_AGREED: "Agreed to a merge",
  MERGE_REFUSED: "Refused a merge",
  PARTY_UPDATED: "Changed an organization",
  PROJECT_CREATED: "Opened a project",
  PROJECT_UPDATED: "Changed a project",
  PROJECT_JOINED: "Joined a project",
  PROJECT_PARTY_SET: "Said how an organization takes part",
  PROJECT_PARTY_REMOVED: "Took an organization off a project",
  ORGANIZATION_INVITED: "Invited an organization to link",
  ORGANIZATION_INVITATION_RECEIVED: "Was invited to link",
  ORGANIZATION_LINKED: "Linked with an organization",
  ORGANIZATION_REFUSED: "Refused to link",
  ORGANIZATION_LINK_ENDED: "Ended a link",
  TENANT_CREATED: "Organization opened",
  SETTING_CHANGED: "Changed a setting",
  VALUE_CHANGED: "Changed a list value",
  VALUE_DELETED: "Deleted a list value never used",
  LIST_CREATED: "Made a list",
  LIST_CHANGED: "Changed a list",
  LIST_DELETED: "Deleted a list never used",
  NUMBERING_SCHEME_CREATED: "Made a numbering scheme",
  NUMBERING_SCHEME_UPDATED: "Changed a numbering scheme",
  NUMBERING_ROUTED: "Chose which numbering a type follows",
  REVISION_SCHEME_CREATED: "Made a revision scheme",
  REVISION_SCHEME_UPDATED: "Changed a revision scheme",
  REVISION_SCHEME_ROUTED: "Chose which revision scheme a type follows",
  ROUTE_CREATED: "Made a review route",
  ROUTE_UPDATED: "Changed a review route",
  VERDICT_LIST_CREATED: "Made a verdict list",
  VERDICT_LIST_CHANGED: "Changed a verdict list",
};

export function activityWords(action: string): string {
  const words = WORDS[action];
  if (words) return words;
  const plain = action.replaceAll("_", " ").toLowerCase();
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/**
 * Where the thing acted on is opened, so every title in the log is a link: a document (or the document of a revision
 * or a file, `documentId` from the backend), a review, a transmittal, a package, an action, a person, a tag, or the
 * Settings page that keeps a list, a function, an organization, a route, a scheme.
 */
export function activityLink(entityType: string | null, entityId: string | null, label?: string | null, documentId?: string | null): string | null {
  const set = (one: string | null | undefined) => (one ? `/settings/config?set=${encodeURIComponent(one)}` : "/settings/config");
  switch (entityType) {
    case "Document": return entityId ? `/documents/${entityId}` : null;
    case "Revision":
    case "StoredFile": return documentId ? `/documents/${documentId}` : null;
    case "Review": return entityId ? `/reviews/${entityId}` : null;
    case "Transmittal": return entityId ? `/transmittals/${entityId}` : null;
    case "Package": return label ? `/packages/${encodeURIComponent(label.split(" ")[0])}` : null;
    case "Activity": return label ? `/actions/${encodeURIComponent(label.split(" ")[0])}` : null;
    case "User": return entityId ? `/settings/users/${entityId}` : null;
    case "Asset": return entityId ? `/assets/${entityId}` : null;
    case "Value": return label?.startsWith("VERDICT") || label?.includes("VERDICT") ? "/settings/verdicts" : set(label?.split("/")[0]);
    case "Setting": return label?.startsWith("SET:") ? set(label.slice(4)) : "/settings/flow";
    case "Function": return "/settings/functions";
    case "Party":
    case "OrganizationLink": return "/settings/parties";
    case "Project": return "/organization/projects";
    case "ReviewRoute": return "/settings/workflow-templates";
    case "NumberingScheme":
    case "SchemeRouting":
    case "NumberRange": return "/settings/numbering";
    case "RevisionScheme":
    case "RevisionSchemeRouting": return "/settings/revisions";
    case "IdentityProvider": return "/settings/security";
    case "CheckRun":
    case "Defect":
    case "Exception": return "/conformance/checks";
    case "ControlledVersion":
    case "RequirementCall":
    case "Notice": return "/schedule";
    default: return null;
  }
}

/**
 * A detail as a person reads it. Some acts keep what changed as data ("{…} → {…}"); that reads as the fields that
 * changed, each "was → now", and a single record as its fields. Anything else stays as written.
 */
export function readableDetail(detail: string | null): string | null {
  if (!detail) return null;
  const parse = (text: string): Record<string, unknown> | null => {
    try {
      const value = JSON.parse(text.trim());
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    } catch {
      return null;
    }
  };
  const words = (key: string) => {
    const plain = key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
    return plain.charAt(0).toUpperCase() + plain.slice(1);
  };
  const show = (value: unknown) =>
    value === null || value === undefined || value === "" ? "none"
      : Array.isArray(value) ? value.join(", ") || "none"
      : typeof value === "object" ? Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k} ${String(v)}`).join(", ")
      : String(value);
  const arrow = detail.indexOf(" → ");
  if (arrow > 0) {
    const was = parse(detail.slice(0, arrow));
    const now = parse(detail.slice(arrow + 3));
    if (was || now) {
      const keys = [...new Set([...Object.keys(was ?? {}), ...Object.keys(now ?? {})])];
      const changed = keys.filter((k) => JSON.stringify(was?.[k]) !== JSON.stringify(now?.[k]));
      if (!changed.length) return "Nothing changed.";
      return changed.map((k) => `${words(k)}: ${show(was?.[k])} → ${show(now?.[k])}`).join("\n");
    }
  }
  const one = parse(detail);
  if (one) return Object.entries(one).map(([k, v]) => `${words(k)}: ${show(v)}`).join("\n");
  return detail;
}
