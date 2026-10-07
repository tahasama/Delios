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
