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
};

export type RevisionWork = {
  kind: "ACCEPT_SUBMISSION" | "CORRECT_AND_RESUBMIT";
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
  kind: "CARRY_OUT_REQUEST" | "DISPATCH_TRANSMITTAL" | "ACKNOWLEDGE_TRANSMITTAL";
  requestId: string | null;
  transmittalId: string | null;
  recipientId: string | null;
  label: string;
  reason: string;
  who: string | null;
  dueDate: string | null;
  since: string;
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
};

export type RevisionView = {
  id: string; value: string; series: string; state: string; filesState: string; reasonForRevision: string | null;
  changeDescription: string | null; authoredByName: string; createdAt: string; statusCode: string | null;
  releasedAt: string | null; supersededAt: string | null; returnedReason: string | null; submission: number;
  controlOutcome: string | null;
  submissions: { number: number; submittedAt: string; submittedBy: string; outcome: string | null; note: string | null; decidedBy: string | null; decidedAt: string | null }[];
  files: { id: string; name: string; kind: string; contentType: string; size: number; sha256: string; status: string; statusDetail: string | null; detectedType: string | null; createdAt: string; derivedFromId: string | null; submission: number }[];
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
export type RouteView = { id: string; name: string; description: string | null; isDefault: boolean; steps: { title: string }[] };
