/**
 * The names of the organization's lists, exactly as the backend keys them
 * (ValueSets, ReviewSets, TransmittalSets in backend/src/Delios.Host). Screens
 * use these names only, so a list is never asked for under a wrong name.
 */
export const LISTS = {
  disciplines: "DISCIPLINES",
  documentTypes: "DOCUMENT_TYPES",
  deliverableTypes: "DELIVERABLE_TYPES",
  subprojects: "SUBPROJECTS",
  purchaseOrders: "PURCHASE_ORDERS",
  criticality: "CRITICALITY",
  confidentiality: "CONFIDENTIALITY",
  retentionClasses: "RETENTION_CLASSES",
  statuses: "STATUSES",
  verdicts: "REVIEW_OUTCOMES",
  advice: "REVIEW_ADVICE",
  commentClasses: "COMMENT_CLASSES",
  returnReasons: "RETURN_REASONS",
  controlOutcomes: "CONTROL_OUTCOMES",
  reasonsForIssue: "REASONS_FOR_ISSUE",
  activityDecisions: "ACTIVITY_DECISIONS",
} as const;

export type ListName = (typeof LISTS)[keyof typeof LISTS];
