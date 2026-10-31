import type { Tenant } from "@/lib/core/tenant";
// Configuration-first workflow engine. A WorkflowTemplate is a list of steps:
//   { act: REVIEW | APPROVAL, mode: ANY_OF | ALL_CONSOLIDATOR | SERIAL, participantIds: [], outcomeSetKey? }
// The engine runs the steps in order against a revision:
//   REVIEW   → a review cycle; outcome chosen from the step's bound published set.
//              ANY_OF: first participant's decision closes the step.
//              SERIAL: participants decide in order; the last one's outcome is binding (§9.7).
//              ALL_CONSOLIDATOR: everyone records; the last-named participant records the binding outcome.
//              ALL: everyone gives input, in any order; the step closes when all have. Inputs are
//                   not binding unless it is the last step, where the most severe input binds.
//                   Typical: three specialists in parallel, then their lead in the next step.
//   APPROVAL → the approval act (Part 8) by the step participant (authority matrix still applies).
// Declining anywhere returns the workflow to the author: the revision keeps its
// outcome, and the next revision is a new submission (§7.5 — replaced, not corrected).
//
// One decision per route. Earlier steps give advice: their verdicts are recorded
// and passed on, but never end the route. The LAST step gives the binding
// verdict, and only people who may approve the document take it. A binding
// verdict that permits release is recorded as the release approval; one that
// does not returns the route to the author. There is no separate approval act.
const ADVICE_SET = "REVIEW_ADVICE";

/**
 * What an adviser's comments amount to. An adviser is not asked: the answer is
 * already in what they wrote, and asking a second time only allows the two to
 * disagree. A blocking comment is the whole of "I object"; no comment is the
 * whole of "nothing to say".
 */
function adviceFor(comments: { progressionPreventing: boolean }[]): "none" | "some" | "blocking" {
  if (comments.some((c) => c.progressionPreventing)) return "blocking";
  return comments.length ? "some" : "none";
}

/** The organization's own code for that advice, found by what it means rather than by its name. */
const STANDARD_ADVICE = { none: "NO_COMMENT", some: "COMMENTS", blocking: "COMMENTS_BLOCKING" } as const;
/**
 * What this adviser's comments amount to on this step, for the form that
 * records it: the code, and the counts it was worked out from.
 */
export async function myAdvice(t: Tenant, cycleId: string, userId: string): Promise<{ code: string; comments: number; blocking: number }> {
  const { backendReview } = await import("@/lib/documents/api");
  const review = await backendReview(t, cycleId);
  const mine = review.comments.filter((c) => c.authorId === userId).map((c) => ({ progressionPreventing: c.blocking }));
  return { code: await adviceCode(adviceFor(mine), review.adviceCodes), comments: mine.length, blocking: mine.filter((c) => c.progressionPreventing).length };
}

/** The advice meaning what the comments say, from the review's own set of advice where it has one. */
async function adviceCode(kind: "none" | "some" | "blocking", offered?: string[] | null): Promise<string> {
  const { getActiveSet } = await import("@/lib/settings/config");
  const values = (await getActiveSet(ADVICE_SET)).filter((one) => !offered || offered.includes(one.code));
  const meant = values.find((one) => (one.props as { comments?: string }).comments === kind);
  return meant?.code ?? STANDARD_ADVICE[kind];
}

export type WfStep = {
  act: "REVIEW" | "APPROVAL";
  /**
   * An outside party answers this step. The party decides how it reaches them:
   * a party that holds accounts here answers in the app, and one that does not
   * is sent the pack by the liaison, who records the answer it comes back with.
   * Everything else about the step is the same.
   */
  partyId?: string;
  mode: "ANY_OF" | "ALL_CONSOLIDATOR" | "SERIAL" | "ALL";
  participantIds: string[];
  /** Functions whose holders are proposed at send time, filtered by the distribution matrix. */
  functionIds?: string[];
  outcomeSetKey?: string;
  title?: string;
  /** Working days this step has once it opens. Left empty, the step has no date. */
  days?: number;
  /**
   * On the deciding step, the statuses it may name. Left empty, it may name any
   * status the status list allows a step to name.
   */
  grantsStatuses?: string[];
};
/**
 * Where a step stands against its date. "At risk" is its last day: time to
 * warn whoever holds it, while they can still answer on time.
 */
type DueState = "none" | "on time" | "at risk" | "overdue";
export function dueState(dueAt: Date | null | undefined, closed: boolean, now = new Date()): DueState {
  if (!dueAt) return "none";
  if (closed) return "on time";
  if (dueAt.getTime() < now.getTime()) return "overdue";
  return dueAt.getTime() - now.getTime() <= 86_400_000 ? "at risk" : "on time";
}

export type WfRuntimeStep = WfStep & {
  status: "pending" | "active" | "done" | "declined";
  cycleId?: string;
  decidedBy?: string[];
  /** Who a step not yet open will go to. */
  goesTo?: string[];
  /** ALL mode: each participant's input, so the step can close on the most severe one. */
  inputs?: { userId: string; code: string; returns: boolean }[];
};

export type RunData = {
  id: string;
  revisionId: string;
  templateName: string;
  steps: WfRuntimeStep[];
  currentStep: number;
  status: string;
};

export async function getRunForRevision(t: Tenant, revisionId: string): Promise<RunData | null> {
  // A run is the newest review of the revision; its steps as the route recorded them.
  const { backendRevision, documentContext, backendReview } = await import("@/lib/documents/api");
  const revision = await backendRevision(t, revisionId);
  const latest = (await documentContext(t, revision.documentId)).reviews
    .filter((one) => one.revisionId === revisionId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!latest) return null;
  const review = await backendReview(t, latest.id);
  const steps: WfRuntimeStep[] = review.steps.map((step) => ({
    act: step.deciding ? "APPROVAL" : "REVIEW",
    mode: step.mode === "ALL" ? "ALL" : "ANY_OF",
    participantIds: step.participants.map((one) => one.userId),
    title: step.title,
    grantsStatuses: step.grantsStatuses,
    status: step.state === "DONE" ? (review.state === "RETURNED" && step.answer === null ? "declined" : "done") : step.state === "OPEN" ? "active" : "pending",
    cycleId: review.id,
    decidedBy: step.participants.filter((one) => one.answeredAt).map((one) => one.userId),
    inputs: step.participants.filter((one) => one.answer).map((one) => ({ userId: one.userId, code: one.answer!, returns: false })),
    goesTo: step.goesTo ?? [],
  }));
  const status = review.state === "IN_PROGRESS" ? "ACTIVE" : review.state === "RETURNED" ? "RETURNED" : review.state === "WITHDRAWN" ? "WITHDRAWN" : "DONE";
  return {
    id: review.id, revisionId, templateName: review.route, steps,
    currentStep: review.currentStep ? review.currentStep - 1 : steps.length, status,
  };
}

type DocClass = { deliverableType: string; docType: string; discipline: string; criticality: string | null; confidentiality: string | null };

/**
 * Who may take part in a step for ALL of these documents: people on this
 * project whose function holds the step's verb for every document's class.
 */
export async function eligiblePeople(t: Tenant, docs: DocClass[], act: "REVIEW" | "APPROVAL") {
  const { holders } = await import("@/lib/settings/api");
  const verb = act === "APPROVAL" ? "APPROVE" : "REVIEW";
  // Documents of the same class have the same holders: asked once per class, never once per document.
  const classes = [...new Map(docs.map((d) => [[d.deliverableType, d.docType, d.discipline, d.criticality, d.confidentiality].join("\u0001"), d])).values()];
  const lists = await Promise.all(classes.map((d) => holders(t.projectId, verb, d.deliverableType, d.docType, d.discipline, d.criticality, d.confidentiality)));
  const out = (lists[0] ?? [])
    .filter((one) => lists.every((list) => list.some((other) => other.id === one.id)))
    .map((one) => ({ id: one.id, name: one.name, functionId: one.functionCode, functionName: one.functionName, department: one.department }));
  return [...new Map(out.map((one) => [one.id, one])).values()].sort((a, b) => a.name.localeCompare(b.name));
}
