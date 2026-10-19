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
  kind: "ANSWER_STEP" | "DISPATCH_STEP" | "RECORD_ANSWER" | "READY_TO_RELEASE" | "SEND_BACK" | "SEND_TO_REVIEWERS";
  stepTitle: string | null;
  dueDate: string | null;
  since: string;
  /** The person's step gives the verdict (otherwise it is advice). */
  deciding: boolean;
  /** On The control function's gate: what the review decided, and the status it grants. */
  verdict: string | null;
  status: string | null;
};

export type RevisionWork = {
  kind: "ACCEPT_SUBMISSION" | "CORRECT_AND_RESUBMIT" | "RETURNED_BY_REVIEW" | "NEXT_REVISION_DUE" | "TO_ROUTE" | "DRAFT";
  documentId: string;
  documentNumber: string;
  title: string;
  revisionId: string;
  revision: string;
  submission: number;
  note: string | null;
  since: string;
  /** Sent to the supplier again after the control function took it back, rather than returned by its check. */
  resent?: boolean;
};

export type IssueWork = {
  kind: "CARRY_OUT_REQUEST" | "DISPATCH_TRANSMITTAL" | "ACKNOWLEDGE_TRANSMITTAL" | "REGISTER_UNPLANNED" | "SEND_PLACEHOLDER" | "SAY_WHO_RECEIVES" | "ANSWER_HAND_BACK";
  requestId: string | null;
  transmittalId: string | null;
  recipientId: string | null;
  label: string;
  reason: string;
  who: string | null;
  dueDate: string | null;
  since: string;
  /** SEND_PLACEHOLDER: the placeholder to fill; CARRY_OUT_REQUEST and SAY_WHO_RECEIVES: the document. */
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
  /** The answers kept with it to the project's own fields and lists of its own. */
  extras?: Record<string, string> | null;
  id: string; number: string; title: string; deliverableType: string; docType: string; discipline: string;
  originator: string | null; subproject: string | null; contractRef: string | null; criticality: string | null;
  confidentiality: string | null; retentionClass: string | null; isPlaceholder: boolean; state: string;
  revision: string | null; revisionState: string | null; latestRevisionId: string | null;
  releasedRevisionId: string | null; releasedRevision: string | null;
  proposedStatus: string | null; releasedStatus: string | null; releasedAt: string | null;
  verdict: string | null; decidedBy: string | null; plannedDate: string | null; issuedAt: string | null;
  createdAt: string; updatedAt: string; revisionStartedAt: string | null; fileAddedAt: string | null;
  packages: number; activities: { code: string; name: string }[];
  /** Asked of a supplier: where it stands in the supplier's set (`SupplierStage`); null otherwise. */
  supplier?: string | null;
  /** Exchanged with a supplier: true while they hold it, false while we do. */
  withSupplier?: boolean | null;
  /** The phase it is in now (PHASES). */
  phase?: string | null;
  /** Taken as it came, under its supplier's number and revisions. */
  asReceived?: boolean;
};

/** An ask to hand a supplier's document back for an update (RETURN_FOR_UPDATE), with its answer. */
export type HandBack = {
  id: string; kind: string; fromSupplier: boolean; askedBy: string; reason: string; askedAt: string;
  answeredAt: string | null; answeredBy: string | null; accepted: boolean | null; answer: string | null;
};

/** GET /documents/{id} (Contracts.cs DocumentView). */
export type DocumentView = {
  id: string; number: string; title: string; deliverableType: string; docType: string; discipline: string;
  originator: string | null; subproject: string | null; contractRef: string | null; criticality: string | null;
  confidentiality: string | null; retentionClass: string | null; state: string; kind: string; isPlaceholder: boolean;
  receivedDate: string | null; plannedDate: string | null; createdByName: string; createdAt: string; updatedAt: string;
  revisions: RevisionView[];
  createdById: string;
  legalHold: boolean; legalHoldReason: string | null; legalHoldAt?: string | null; legalHoldBy?: string | null; previousNumber: string | null; legacyScheme: string | null; appVersion: string | null;
  extras: Record<string, string> | null;
  confirmedAt?: string | null; confirmedByName?: string | null; correctsId?: string | null;
  /** The hold lifted; the document cancelled or withdrawn; reinstated after. Each kept beside what it answers. */
  holdLifted?: Written | null; ended?: Written | null; reinstated?: Written | null;
  /** Exchanged with a supplier: who holds it, the only side that may change it (true the supplier, false us); null otherwise. */
  withSupplier?: boolean | null;
  /** The phase it is in now (PHASES): its next revision is named by that phase's line. */
  phase?: string | null;
  /** Taken as it came from a supplier's package with no placeholders: its number, revisions and states are theirs. */
  asReceived?: boolean;
};

/** Something a person decided and wrote down: when, who, and why, in their words. */
export type Written = { at: string; by: string; reason: string };

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
  /** A void taken back; the void's own reason stays beside it. */
  unvoided?: Written | null;
  /** Sent to its supplier again after it was taken back: the same revision comes back from them. */
  resent?: Written | null;
  /**
   * What it amounts to (Documents/Contracts.cs RevisionReading): waiting for, or sent back by, the check on arrival
   * (its files then belong to the transmittal; the document keeps `keptSubmission`'s); decided and waiting for release,
   * with what was granted; when it first went out. Present on GET /documents/{id}.
   */
  reading?: { awaitingCheck: boolean; keptSubmission: number; decided: boolean; granted: string | null; issuedAt: string | null } | null;
  /** The phase the document was in when this revision was started. */
  phase?: string | null;
  /** Taken as it came: the status and review outcome its sender gave it, in their words. */
  theirStatus?: string | null; theirOutcome?: string | null;
};
/** GET /documents/{id}/routes (ReviewEndpoints RouteView). */
export type RouteView = { id: string; name: string; description: string | null; isDefault: boolean; verdictSet?: string; verdicts?: string | null; verdictCodes?: string[] | null; verdictsMismatch?: boolean; steps: { title: string; functionCode: string | null; partyCode: string | null; mode: string; reason: string | null; userIds?: string[] }[] };

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
    originalBlocking?: boolean | null; reclassifiedAt?: string | null; reclassifiedBy?: string | null; reclassifyNote?: string | null;
  }[];
  /** Each time the route was sent back to a step, with what the steps it reset had answered: kept, never erased. */
  sendBacks?: SendBack[];
  approvalWithdrawnAt?: string | null; approvalWithdrawnBy?: string | null; approvalWithdrawnReason?: string | null;
  verdictSet?: string;
  /** The set of the review outcomes it decides from, and its verdicts: only those are offered to the deciding step. */
  verdicts?: string | null; verdictCodes?: string[] | null;
  /** Who started the review: they may notify its people by hand. */
  startedById?: string | null;
  /** Sent for review, waiting for the control function to send it to its reviewers (the project's choice). */
  awaitsIssue?: boolean;
};
/** GET /transmittals/log (TransmittalLog.cs). */
export type TransmittalLog = { total: number; page: number; pages: number; per: number; sizes: number[]; rows: TransmittalLogRow[] };
export type TransmittalLogRow = {
  id: string; number: string; subject: string; reason: string; toName: string; issuedBy: string; issuedAt: string; documents: number;
  status: "TO_SEND" | "OVERDUE" | "AWAITING_REPLY" | "AWAITING_ACK" | "TO_REGISTER" | "COMPLETE";
  recipients: { id: string; name: string; seen: boolean; kind: "TO" | "CC"; organization: string | null }[];
  responseRequired: boolean; responseDue: string | null; forReview: boolean;
  direction: "OUTGOING" | "INCOMING"; from: string | null; theirReference: string | null;
  /** What came in: what the control function's check said of its documents; null for anything else. */
  check?: "TO_CHECK" | "RETURNED" | "PARTLY_RETURNED" | "ACCEPTED" | null;
  /** Where the answer it asks stands (backend AnswerStates); null when none is asked. */
  answer?: "AWAITED" | "OVERDUE" | "ON_TIME" | "LATE" | null;
};

/** GET /transmittals/{id} (TransmittalEndpoints TransmittalView). */
export type TransmittalView = {
  id: string; number: string; direction: string; reason: string; subject: string; message: string | null; to: string;
  responseRequired: boolean; responseDue: string | null; issuedAt: string; issuedBy: string; issueRequestId: string | null; reviewStepId: string | null;
  /** Where the answer it asks stands (backend AnswerStates). */
  answer?: "AWAITED" | "OVERDUE" | "ON_TIME" | "LATE" | null;
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
  /** It asks for a document to be added to this schedule action; answered once the control function has. */
  activity: {
    id: string; answeredAt: string | null; answeredBy: string | null; answer: string | null; kind: "DOCUMENT" | "DISCIPLINE";
    confirm?: boolean; checkedAt?: string | null; checkedBy?: string | null; confirmerId?: string | null; confirmerName?: string | null;
  } | null;
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
  files: { id: string; name: string; size: number; sha256: string; status: string; kind: string | null }[];
  /** Unplanned: matched by hand to one of our documents rather than registered anew. */
  matched?: boolean;
  /** Sent as it comes (a package with no placeholders): the status and review outcome the sender gave it. */
  theirStatus?: string | null; theirOutcome?: string | null;
  /** Sent as it comes and returned by the check, with why. */
  returnedAt?: string | null; returnedBy?: string | null; returnedReason?: string | null;
};

/**
 * A transmittal as its page shows it (Transmittals/TransmittalService.Page.cs): where it stands, who checked what
 * came in, each document it carried as it stands now, the files that came with it, the request it carried out.
 */
export type TransmittalPage = {
  transmittal: TransmittalView;
  status: "DRAFT" | "ISSUED" | "REJECTED" | "ACCEPTED";
  issuingParty: string; checkedBy: string | null; checkedAt: string | null; returnedReason: string | null;
  /** May this person accept or return what arrived (the control function; with none, whoever it was for). */
  mayCheck?: boolean;
  /** Sent into a package taking documents as they come: the check accepts or returns what came, all at once. */
  asReceived?: boolean;
  /** Something unplanned under a number of theirs matched before to one of ours: that number of ours, by item. */
  matchedBefore?: Record<string, string> | null;
  carried: CarriedItem[];
  files: { id: string; name: string; size: number; sha256: string; keptBy: string; keptAt: string }[];
  issueRequests: { id: string; reason: string; note: string | null }[];
  /** How each organization it went to takes things outside the system, by its id. */
  parties: Record<string, { externalSystem: string | null; evidenceRequired: boolean }>;
};

export type CarriedItem = {
  id: string; kind: TransmittalItem["kind"]; documentId: string; revisionId: string | null; number: string; title: string; revision: string;
  status: string | null; revisionState: string; currentRevision: string | null; neededFor: { code: string; name: string }[]; sentBefore: number;
  arrival: { state: "TO_CHECK" | "RETURNED" | "ACCEPTED"; by: string | null; at: string | null; note: string | null } | null;
  review: { id: string; startedAt: string; open: boolean } | null;
  files: TransmittalItem["files"];
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
  raisedById: string; transmittalIds: string[]; delegated?: boolean; approverPartyId?: string | null; approvalState?: string | null;
  /** Who the control function took off it when releasing. */
  releaseNote?: string | null;
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
  /** What the acceptance authority wrote when accepting it. */
  acceptNote?: string | null;
  members: {
    documentId: string; documentNumber: string; title: string; revision: string | null; status: string | null; required: string[]; ready: boolean; byRule: boolean;
    /** Supply: when the supplier was asked for it; its latest revision and where that stands; when it is due. */
    requestedAt: string | null; latestRevision: string | null; latestState: string | null; dueDate: string | null;
  }[];
  transmittals: { id: string; number: string; direction: "OUTGOING" | "INCOMING"; issuedAt: string; items: number }[];
  kind: "DELIVERY" | "SUPPLY"; supplierPartyId: string | null; supplier: string | null; purchaseOrder: string | null;
  reasons?: string[]; extras?: Record<string, string> | null;
  /** A supplier's package: shared with its supplier (once, for good), by whom; made by itself with its first document. */
  sharedAt?: string | null; sharedBy?: string | null; autoCreated?: boolean;
  /** The supplier's people on this project: who sees it once shared. Ours only. */
  supplierPeople?: string[] | null;
  /**
   * Its people and dates in words: who it goes to (its supplier, or its recipients), who puts it together and who
   * accepts it, the supplier's code, when it was opened, when it was delivered.
   */
  names: { to: string; owners: string; acceptors: string; supplierCode: string | null; createdAt: string; deliveredAt: string | null };
  /** A supplier's package taking documents as they come (no placeholders): what they are filed under, since when, by whom. */
  asReceived?: { deliverableType: string; docType: string; discipline: string; since: string | null; by: string | null } | null;
};

/** GET /activity (ActivityEndpoints.cs): one act of the project, for Home's journal and log. */
export type ActivityRow = { id: number; at: string; actorName: string; action: string; entityType: string | null; entityLabel: string | null; detail: string | null };

/** GET /activities (ScheduleEndpoints.cs ActivitySummary). */
export type ActivitySummary = {
  id: string; code: string; name: string; start: string | null; finish: string | null; responsible: string | null;
  departments: string[]; state: string; readiness: string; needs: number; met: number; waived: number; nextNeededBy: string | null;
  /** The planner's own ID for the action in the schedule file; `code` is our number. */
  externalId?: string | null;
  /** The latest schedule read moved it: the dates before, and which read ("rev C", "a direct upload"). */
  moved?: { wasStart: string | null; wasFinish: string | null; in: string; at: string } | null;
};

/** The route sent back to a step: who, when, why, and what the steps it reset had answered. */
export type SendBack = {
  at: string; by: string; toStep: number; reason: string; note: string | null;
  answers: { step: number; title: string; who: string; answer: string | null; status: string | null; note: string | null; at: string | null }[];
};
