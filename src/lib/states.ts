/**
 * The states the system works out itself, as people read them. Codes come from
 * the backend (Documents/Entities.cs, DocumentStates and RevisionStates); the
 * organization's own lists (statuses, verdicts…) are never named here.
 */
export const DOCUMENT_STATES: Record<string, { label: string; means: string }> = {
  PLANNED: { label: "Planned", means: "The number is reserved; nothing has been released under it yet." },
  ACTIVE: { label: "Active", means: "In use: at least one revision has been released." },
  WITHDRAWN: { label: "Withdrawn", means: "Taken out of use after it was released. Its revisions stay on record." },
  CANCELLED: { label: "Cancelled", means: "Dropped before anything was released." },
  ARCHIVED: { label: "Archived", means: "Closed at the end of its life, kept for retention." },
};

export const REVISION_STATES: Record<string, { label: string; means: string }> = {
  NONE: { label: "No revision yet", means: "Registered; no revision has been started." },
  RECEIVED: { label: "Received", means: "Sent in by another organization; Document Control checks it before anyone reviews it." },
  CORRECTING: { label: "Being corrected", means: "Returned for a correction under the same revision; the next submission replaces it." },
  IN_PREPARATION: { label: "In preparation", means: "Being written. Only the author's side works from it." },
  IN_REVIEW: { label: "In review", means: "Submitted; reviewers and approvers are looking at it." },
  RELEASED: { label: "Released", means: "The current revision: the one people work from." },
  RETURNED: { label: "Returned", means: "Reviewed and sent back. Kept as submitted; the next revision replaces it." },
  SUPERSEDED: { label: "Superseded", means: "Replaced by a later released revision. Kept, not used." },
  VOID: { label: "Void", means: "Found to be wrong after release and cancelled." },
};
