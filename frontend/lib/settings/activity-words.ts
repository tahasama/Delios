/**
 * A person's acts, as the audit trail codes them, in the words a person would use (their activity in Settings →
 * People & access). A code not listed reads as its own words, lower case.
 */
const WORDS: Record<string, string> = {
  SIGN_IN: "Signed in",
  SIGN_IN_MFA: "Signed in, with the second step",
  SIGN_IN_SSO: "Signed in with the organization's sign-in",
  SIGN_IN_FAILED: "Failed to sign in",
  ACCOUNT_LOCKED: "Account locked after failed sign-ins",
  DOCUMENT_VIEWED: "Opened a document",
  DOWNLOAD: "Downloaded a file",
  REGISTER_ENTRY: "Registered a document",
  FILE_UPLOADED: "Uploaded a file",
  METADATA_CHANGE: "Changed a document's details",
  REVIEW_STARTED: "Sent for review",
  REVIEW_DECIDED: "Decided a review",
  REVIEW_SENT_BACK_TO_STEP: "Sent a review back to a step",
  STEP_DISPATCHED: "Sent a review step out",
  COMMENT_CHANGED: "Changed a comment",
  COMMENT_WITHDRAWN: "Took a comment back",
  COMMENT_CLOSED: "Closed a comment",
  RELEASED: "Released a revision",
  ISSUED: "Issued a revision",
  SENT_FOR_RELEASE: "Sent for release",
  SUPERSEDED: "Superseded a revision",
  RETURNED_TO_AUTHOR: "Returned to its author",
  RETURNED_FOR_CORRECTION: "Returned for correction",
  WITHDRAWN_FOR_UPDATE: "Withdrew for an update",
  REVISION_HELD: "Put a revision on hold",
  REVISION_HOLD_LIFTED: "Lifted a hold",
  TRANSMITTAL_ISSUED: "Sent a transmittal",
  TRANSMITTAL_OPENED: "Opened a transmittal",
  PACKAGE_CREATED: "Made a package",
  PACKAGE_CHANGED: "Changed a package",
  PACKAGE_SHARED: "Shared a package",
  PACKAGE_MEMBERS_ADDED: "Added documents to a package",
  PACKAGE_MEMBERS_REMOVED: "Took documents out of a package",
  PACKAGE_ACCEPTED: "Accepted a package",
  READINESS_CONFIRMED: "Confirmed going ahead",
  READINESS_REVOKED: "Took a confirmation back",
  ACTIVITY_DECISION: "Recorded whether an action went ahead",
  POSTPONEMENT_CONFIRMED: "Confirmed a postponement",
  NOTICE_SENT: "Sent a notice",
  MEMBERSHIP_CHANGED: "Changed who is on a project",
  PERSON_CONFIRMED: "Confirmed someone joining",
  PERSON_REFUSED: "Refused someone joining",
  USER_CREATED: "Made an account",
  SETTING_CHANGED: "Changed a setting",
  CONTROL_PEOPLE: "Named who acts as the control function",
  ACTIVITY_READ: "Read someone's activity",
  CHECK_RUN: "Ran the checks",
};

export function activityWords(action: string): string {
  const words = WORDS[action];
  if (words) return words;
  const plain = action.replaceAll("_", " ").toLowerCase();
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/** Where the thing acted on is opened, when it has a page of its own. */
export function activityLink(entityType: string | null, entityId: string | null): string | null {
  if (!entityId) return null;
  if (entityType === "Document") return `/documents/${entityId}`;
  if (entityType === "Review") return `/reviews/${entityId}`;
  if (entityType === "Transmittal") return `/transmittals/${entityId}`;
  if (entityType === "User") return `/settings/users/${entityId}`;
  return null;
}
