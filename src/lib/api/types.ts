/**
 * The shapes the backend answers with, as TypeScript types. Each matches a
 * record in backend/src/Delios.Host; the comment names it.
 */

/** GET /api/me (IdentityEndpoints.MeAsync). */
export type Me = {
  user: { id: string; name: string; email: string; isAdmin: boolean; party: { code: string; name: string; isInternal: boolean } | null };
  tenant: { slug: string; name: string };
  projects: MeProject[];
};

export type MeProject = {
  id: string;
  code: string;
  name: string;
  timeZone: string;
  function: { code: string; name: string };
  verbs: string[];
};

/** POST /api/auth/sign-in when a second step is needed (SignInStep). */
export type SignInStep = { next: "MFA_CODE" | "MFA_SETUP"; challenge: string };

/** GET /api/projects/{id}/work (ReviewService.WorkAsync). */
export type Work = {
  steps: WorkItem[];
  gate: WorkItem[];
  revisions: RevisionWork[];
  issues: IssueWork[];
};

export type WorkItem = {
  reviewId: string;
  number: string;
  documentId: string;
  documentNumber: string;
  title: string;
  revisionValue: string;
  kind: "ANSWER_STEP" | "DISPATCH_STEP" | "RECORD_ANSWER" | "READY_TO_RELEASE" | "SEND_BACK";
  stepTitle: string | null;
  dueDate: string | null;
  since: string;
  /** The person's step gives the verdict (otherwise it is advice). */
  deciding: boolean;
  /** On Document Control's gate: what the review decided, and the status it grants. */
  verdict: string | null;
  status: string | null;
};

export type RevisionWork = {
  kind: "ACCEPT_SUBMISSION" | "CORRECT_AND_RESUBMIT" | "RETURNED_BY_REVIEW" | "TO_ROUTE" | "DRAFT";
  documentId: string;
  documentNumber: string;
  title: string;
  revisionId: string;
  revision: string;
  submission: number;
  note: string | null;
  since: string;
};

export type IssueWork = {
  kind: "CARRY_OUT_REQUEST" | "DISPATCH_TRANSMITTAL" | "ACKNOWLEDGE_TRANSMITTAL" | "REGISTER_UNPLANNED" | "SEND_PLACEHOLDER";
  requestId: string | null;
  transmittalId: string | null;
  recipientId: string | null;
  label: string;
  reason: string;
  who: string | null;
  dueDate: string | null;
  since: string;
  /** SEND_PLACEHOLDER: the placeholder to fill. */
  documentId: string | null;
};

/** A value of one of the organization's lists (Register.cs ListValue). */
export type ListValue = { code: string; label: string; status: string; props: Record<string, unknown> | null };

/** GET /api/projects/{id}/register (Register.cs). */
export type RegisterPage = {
  total: number;
  page: number;
  pages: number;
  per: number;
  sizes: number[];
  rows: RegisterRow[];
  lists: {
    values: Record<string, ListValue[]>;
    usedDisciplines: string[];
    usedDocTypes: string[];
    parties: { code: string; name: string }[];
    activities: { code: string; name: string }[];
  };
};

export type RegisterRow = {
  id: string; number: string; title: string; deliverableType: string; docType: string; discipline: string;
  originator: string | null; subproject: string | null; contractRef: string | null; criticality: string | null;
  confidentiality: string | null; retentionClass: string | null; isPlaceholder: boolean; state: string;
  revision: string | null; revisionState: string | null; latestRevisionId: string | null;
  releasedRevisionId: string | null; releasedRevision: string | null;
  proposedStatus: string | null; releasedStatus: string | null; releasedAt: string | null;
  verdict: string | null; decidedBy: string | null; plannedDate: string | null; issuedAt: string | null;
  createdAt: string; updatedAt: string; revisionStartedAt: string | null; fileAddedAt: string | null;
  packages: number; activities: { code: string; name: string }[];
};

/** GET /documents/{id} (Contracts.cs DocumentView). */
export type DocumentView = {
  id: string; number: string; title: string; deliverableType: string; docType: string; discipline: string;
  originator: string | null; subproject: string | null; contractRef: string | null; criticality: string | null;
  confidentiality: string | null; retentionClass: string | null; state: string; kind: string; isPlaceholder: boolean;
  receivedDate: string | null; plannedDate: string | null; createdByName: string; createdAt: string; updatedAt: string;
  revisions: RevisionView[];
  createdById: string;
  legalHold: boolean; legalHoldReason: string | null; previousNumber: string | null; legacyScheme: string | null; appVersion: string | null;
  extras: Record<string, string> | null;
  confirmedAt?: string | null; confirmedByName?: string | null; correctsId?: string | null;
};

export type RevisionView = {
  id: string; value: string; series: string; state: string; filesState: string; reasonForRevision: string | null;
  changeDescription: string | null; authoredByName: string; createdAt: string; statusCode: string | null;
  releasedAt: string | null; supersededAt: string | null; returnedReason: string | null; submission: number;
  controlOutcome: string | null;
  submissions: { number: number; submittedAt: string; submittedBy: string; outcome: string | null; note: string | null; decidedBy: string | null; decidedAt: string | null }[];
  files: { id: string; name: string; kind: string; contentType: string; size: number; sha256: string; status: string; statusDetail: string | null; detectedType: string | null; createdAt: string; derivedFromId: string | null; submission: number }[];
  authoredById: string; authoredByParty: string | null; releasedByName: string | null; returnedAt: string | null;
  heldAt: string | null; heldReason: string | null; heldByName: string | null;
  voidedAt: string | null; voidReason: string | null; voidAuthority: string | null; voidReassessment: string | null;
};

/** GET /documents/{id}/context (DocumentContext.cs). */
export type DocumentContext = {
  reviews: { id: string; number: string; revisionId: string; revision: string; routeName: string; state: string; verdict: string | null; grantedStatus: string | null; startedAt: string; decidedAt: string | null }[];
  transmittals: { id: string; number: string; reason: string; toName: string; issuedAt: string; revision: string; forReview: boolean }[];
  packages: { id: string; number: string; title: string; state: string }[];
  activities: { activityId: string; code: string; name: string; purpose: string; neededBy: string | null; state: string; waiverNote: string | null }[];
  history: { at: string; actor: string | null; action: string; entityType: string | null; entityLabel: string | null; detail: string | null }[];
};

/** GET /documents/{id}/routes (ReviewEndpoints RouteView). */
export type RouteView = { id: string; name: string; description: string | null; isDefault: boolean; verdictSet?: string; steps: { title: string; functionCode: string | null; partyCode: string | null; mode: string; reason: string | null; userIds?: string[] }[] };

/** GET /reviews (ReviewList.cs). */
export type ReviewsPage = { total: number; page: number; pages: number; per: number; sizes: number[]; rows: ReviewListRow[] };

export type ReviewListRow = {
  id: string; number: string; documentId: string; documentNumber: string; title: string; revision: string; routeName: string;
  state: string; open: boolean; currentStep: number | null; stepTitle: string | null; verdict: string | null; grantedStatus: string | null;
  decidedBy: string | null; reviewers: { name: string; done: boolean }[]; dueDate: string | null; routeDueDate: string | null;
  startedAt: string; startedBy: string; closedAt: string | null; discipline: string; docType: string; deliverableType: string;
  originator: string | null; contractRef: string | null; receivedAt: string | null;
  comments: { by: string; text: string; blocking: boolean; settled: boolean }[];
  warnedAt?: string | null;
  /** Why it was withdrawn or sent back, in the words recorded. */
  note?: string | null;
};

/** GET /reviews/{id} (ReviewEndpoints ReviewView). */
export type ReviewView = {
  id: string; number: string; documentId: string; revisionId: string; route: string; state: string; currentStep: number | null;
  verdict: string | null; grantedStatus: string | null; startedBy: string; startedAt: string; decidedAt: string | null;
  closedAt: string | null; closedBy: string | null; returnNote: string | null;
  steps: {
    number: number; title: string; function: string | null; party: string | null; participation: string | null; mode: string;
    deciding: boolean; state: string; dueDate: string | null; answer: string | null; grantsStatuses: string[];
    participants: { name: string; answer: string | null; grantedStatus: string | null; note: string | null; answeredAt: string | null; userId: string }[];
    transmittalId: string | null; dispatchedAt: string | null; dispatchChannel: string | null; dispatchRef: string | null;
    dispatchedBy: string | null; foreignAnswer: string | null; recordedBy: string | null; evidenceFileId: string | null;
    warnedAt?: string | null;
    /** Who a step not yet open will go to: the people named on it and the function that answers it. */
    goesTo?: string[] | null;
  }[];
  comments: {
    id: string; step: number; author: string; text: string; class: string; blocking: boolean; closesWith: string; closesWithStep: number | null;
    status: string; resolution: string | null; closedBy: string | null; createdAt: string; authorId: string;
    originalBlocking?: boolean | null; reclassifiedAt?: string | null; reclassifiedBy?: string | null;
  }[];
  approvalWithdrawnAt?: string | null; approvalWithdrawnBy?: string | null; approvalWithdrawnReason?: string | null;
  verdictSet?: string;
};

/** GET /reviews/{id}/me. */
export type ReviewMe = { seated: boolean; answered: boolean; control: boolean };

/** GET /transmittals/log (TransmittalLog.cs). */
export type TransmittalLog = { total: number; page: number; pages: number; per: number; sizes: number[]; rows: TransmittalLogRow[] };
export type TransmittalLogRow = {
  id: string; number: string; subject: string; reason: string; toName: string; issuedBy: string; issuedAt: string; documents: number;
  status: "TO_SEND" | "OVERDUE" | "AWAITING_REPLY" | "AWAITING_ACK" | "TO_REGISTER" | "COMPLETE";
  recipients: { id: string; name: string; seen: boolean; kind: "TO" | "CC"; organization: string | null }[];
  responseRequired: boolean; responseDue: string | null; forReview: boolean;
  direction: "OUTGOING" | "INCOMING"; from: string | null; theirReference: string | null;
};

/** GET /transmittals/{id} (TransmittalEndpoints TransmittalView). */
export type TransmittalView = {
  id: string; number: string; direction: string; reason: string; subject: string; message: string | null; to: string;
  responseRequired: boolean; responseDue: string | null; issuedAt: string; issuedBy: string; issueRequestId: string | null; reviewStepId: string | null;
  items: TransmittalItem[];
  recipients: {
    id: string; name: string; organization: string | null; person: boolean; openedAt: string | null; acknowledgedAt: string | null;
    dispatchedAt: string | null; dispatchChannel: string | null; dispatchRef: string | null; dispatchedBy: string | null; proofFileId: string | null;
    kind: "TO" | "CC"; userId: string | null; partyId: string | null; notifiedAt: string | null; viewCount: number; lastViewedAt: string | null;
  }[];
  /** Incoming: the organization that sent it, its own reference, and (recorded for it) its covering letter. */
  from: string | null; theirReference: string | null; proofFileId: string | null; packageId: string | null;
  state: "ISSUED" | "DRAFT"; issuedById: string | null;
  inReplyTo: TransmittalRef | null; answers: TransmittalRef[]; follows: TransmittalRef | null; followedBy: TransmittalRef[];
  receiptNote: string | null; extras: Record<string, string> | null; followKind: string | null;
};

/** Another transmittal of the same exchange (TransmittalEndpoints TransmittalRef). */
export type TransmittalRef = {
  id: string; number: string; subject: string; issuedAt: string; direction: string; followKind: string | null;
  items: number; recipients: number; issuedBy: string; from: string | null;
};

/**
 * One item of a transmittal: a revision sent, a placeholder asked for (with its
 * due date), a submission received (a filled placeholder or a correction), or
 * something unplanned received that waits to be registered.
 */
export type TransmittalItem = {
  id: string; kind: "REVISION" | "PLACEHOLDER" | "SUBMISSION" | "UNPLANNED" | "ATTACHMENT";
  documentId: string | null; revisionId: string | null; documentNumber: string; title: string; revision: string; status: string | null;
  dueDate: string | null; submission: number | null; docType: string | null; registeredAt: string | null; registeredBy: string | null;
  files: { id: string; name: string; size: number; sha256: string; status: string }[];
};

/** GET /addressees: who a transmittal can go to. */
export type Addressees = {
  people: { id: string; name: string; function: string; organization: string | null }[];
  parties: { id: string; code: string; name: string; participation: string }[];
};

/** GET /revisions/{id}/issue-requests (IssueRequestView). */
export type IssueRequestView = {
  id: string; revisionId: string; reason: string; userIds: string[]; partyIds: string[]; note: string | null; offDistributionReason: string | null;
  raisedBy: string; raisedAt: string; status: string; closedAt: string | null; closedBy: string | null; transmittals: string[];
  raisedById: string; transmittalIds: string[];
};

/** GET /documents/{id}/distribution (DistributionView): who the matrix proposes, everyone else, and the parties. */
export type Distribution = {
  proposed: { id: string; name: string; function: string; organization: string | null }[];
  others: { id: string; name: string; function: string; organization: string | null }[];
  parties: { id: string; code: string; name: string; participation: string }[];
};

/** GET /packages (PackageEndpoints.cs PackageSummary). */
export type PackageSummary = {
  id: string; number: string; title: string; reason: string; state: string; members: number;
  hasRule: boolean; completionDate: string | null; createdAt: string;
  kind: "DELIVERY" | "SUPPLY"; supplier: string | null; purchaseOrder: string | null;
};

/** The rule a package fills itself by (Entities.cs PackageRule); empty lists mean any. */
export type PackageRule = { deliverableTypes: string[]; disciplines: string[]; docTypes: string[]; originators: string[]; assetIds?: string[] };

/** GET /packages/{id} (PackageEndpoints.cs PackageView). */
export type PackageView = {
  id: string; number: string; title: string; description: string | null; reason: string;
  requiredStatuses: string[]; completionDate: string | null; rule: PackageRule | null; excluded: string[];
  recipientPartyIds: string[]; ownerIds: string[]; acceptorIds: string[]; state: string;
  assessedAt: string | null; shortfall: { documentId: string; documentNumber: string; required: string[]; current: string | null }[];
  shortfallIssuedAt: string | null; shortfallAcceptedAt: string | null; shortfallAcceptedBy: string | null;
  closedAt: string | null; closedBy: string | null; closureNote: string | null;
  acceptedAt: string | null; acceptedBy: string | null; createdBy: string;
  members: {
    documentId: string; documentNumber: string; title: string; revision: string | null; status: string | null; required: string[]; ready: boolean; byRule: boolean;
    /** Supply: when the supplier was asked for it; its latest revision and where that stands; when it is due. */
    requestedAt: string | null; latestRevision: string | null; latestState: string | null; dueDate: string | null;
  }[];
  transmittals: { id: string; number: string; direction: "OUTGOING" | "INCOMING"; issuedAt: string; items: number }[];
  kind: "DELIVERY" | "SUPPLY"; supplierPartyId: string | null; supplier: string | null; purchaseOrder: string | null;
  reasons?: string[]; extras?: Record<string, string> | null;
};

/** GET /activity (ActivityEndpoints.cs): one act of the project, for Home's journal and log. */
export type ActivityRow = { id: number; at: string; actorName: string; action: string; entityType: string | null; entityLabel: string | null; detail: string | null };

/** GET /activities (ScheduleEndpoints.cs ActivitySummary). */
export type ActivitySummary = {
  id: string; code: string; name: string; start: string | null; finish: string | null; responsible: string | null;
  departments: string[]; state: string; readiness: string; needs: number; met: number; waived: number; nextNeededBy: string | null;
  /** The planner's own ID for the action in the schedule file; `code` is our number. */
  externalId?: string | null;
};
