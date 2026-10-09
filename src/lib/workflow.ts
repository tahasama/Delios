import type { Tenant } from "./tenant";
import { holdersOf } from "./permissions";

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

/**
 * Two lists, one per kind of step. An advisory step says what its comments
 * amount to; only the deciding step gives a verdict. Keeping them apart is why
 * an adviser cannot reach a final code, and a decider cannot file advice.
 */
export const VERDICT_SET = "REVIEW_OUTCOMES";
export const ADVICE_SET = "REVIEW_ADVICE";

/**
 * What an adviser's comments amount to. An adviser is not asked: the answer is
 * already in what they wrote, and asking a second time only allows the two to
 * disagree. A blocking comment is the whole of "I object"; no comment is the
 * whole of "nothing to say".
 */
export function adviceFor(comments: { progressionPreventing: boolean }[]): "none" | "some" | "blocking" {
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
  const { backendReview } = await import("./api/legacy");
  const mine = (await backendReview(t, cycleId)).comments.filter((c) => c.authorId === userId).map((c) => ({ progressionPreventing: c.blocking }));
  return { code: await adviceCode(adviceFor(mine)), comments: mine.length, blocking: mine.filter((c) => c.progressionPreventing).length };
}

async function adviceCode(kind: "none" | "some" | "blocking"): Promise<string> {
  const { getActiveSet } = await import("./config");
  const values = await getActiveSet(ADVICE_SET);
  const meant = values.find((one) => (one.props as { comments?: string }).comments === kind);
  return meant?.code ?? STANDARD_ADVICE[kind];
}

/** Which list a step answers from: the last step decides, the rest advise. */
export function setKeyForStep(stepIndex: number, stepCount: number, stepSetKey?: string | null, templateSetKey?: string | null): string {
  const decides = stepIndex === stepCount - 1;
  if (decides) return templateSetKey ?? stepSetKey ?? VERDICT_SET;
  return stepSetKey ?? ADVICE_SET;
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

/** Working days only: a review that opens on Friday is not late on Monday. */
export function addWorkingDays(from: Date, days: number): Date {
  const out = new Date(from);
  let left = Math.max(0, Math.round(days));
  while (left > 0) {
    out.setDate(out.getDate() + 1);
    const day = out.getDay();
    if (day !== 0 && day !== 6) left--;
  }
  return out;
}

/**
 * Where a step stands against its date. "At risk" is its last day: time to
 * warn whoever holds it, while they can still answer on time.
 */
export type DueState = "none" | "on time" | "at risk" | "overdue";
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

/** Whose verdict binds on the deciding step: the last person of a serial or consolidated step, or everyone. */
export function bindsOnStep(step: { mode?: string; participantIds: string[] }, userId: string): boolean {
  if (step.mode === "SERIAL" || step.mode === "ALL_CONSOLIDATOR") return step.participantIds[step.participantIds.length - 1] === userId;
  return true;
}

/** Every route ends in its decision: the last step binds (Approve), the rest advise (Review). */
export function normalizeRoute<S extends { act: "REVIEW" | "APPROVAL" }>(steps: S[]): S[] {
  return steps.map((s, i) => ({ ...s, act: i === steps.length - 1 ? "APPROVAL" : "REVIEW" }));
}

export function parseSteps(json: string): WfRuntimeStep[] {
  try {
    const steps = JSON.parse(json) as WfRuntimeStep[];
    return steps.map((s) => ({ ...s, status: s.status ?? "pending", decidedBy: s.decidedBy ?? [] }));
  } catch {
    return [];
  }
}

export async function getRunForRevision(t: Tenant, revisionId: string): Promise<RunData | null> {
  // A run is the newest review of the revision; its steps as the route recorded them.
  const { backendRevision, documentContext, backendReview } = await import("./api/legacy");
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
  }));
  const status = review.state === "IN_PROGRESS" ? "ACTIVE" : review.state === "RETURNED" ? "RETURNED" : "DONE";
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
  const { holders } = await import("./api/settings");
  const verb = act === "APPROVAL" ? "APPROVE" : "REVIEW";
  const lists = await Promise.all(docs.map((d) => holders(t.projectId, verb, d.deliverableType, d.docType, d.discipline, d.criticality, d.confidentiality)));
  const out = (lists[0] ?? [])
    .filter((one) => lists.every((list) => list.some((other) => other.id === one.id)))
    .map((one) => ({ id: one.id, name: one.name, functionId: one.functionCode, functionName: one.functionName, department: one.department }));
  return [...new Map(out.map((one) => [one.id, one])).values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type Proposal = { id: string; why: string };

/**
 * Who a step proposes, and why: the holders of the step's functions, or else
 * those whose department is the documents' discipline.
 */
export async function proposeForStep(t: Tenant, docs: DocClass[], step: { act: "REVIEW" | "APPROVAL"; mode?: string; participantIds: string[]; functionIds?: string[] }): Promise<Proposal[]> {
  const eligible = await eligiblePeople(t, docs, step.act);
  const named = eligible.filter((p) => step.participantIds.includes(p.id) || (step.functionIds ?? []).includes(p.functionId))
    .map((p) => ({ id: p.id, why: step.participantIds.includes(p.id) ? "named in the route" : `${p.functionName} (route)` }));
  if (named.length || step.participantIds.length || (step.functionIds ?? []).length) return named;
  const disciplines = new Set(docs.map((d) => d.discipline).filter(Boolean));
  return eligible.filter((p) => p.department && disciplines.has(p.department)).map((p) => ({ id: p.id, why: `${p.department} department` }));
}
