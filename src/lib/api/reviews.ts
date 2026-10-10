import "server-only";
import { cache } from "react";
import { api, apiFetch, ApiProblem, projectPath, type Query } from "./client";
import { backendDocument, backendRevision, backendReview, legacyDocument, type LegacyDocument, type LegacyRevision } from "./legacy";
import type { RegisterPage, ReviewsPage, ReviewView, TransmittalView } from "./types";
import type { RunData, WfRuntimeStep } from "../workflow";
import { getMe } from "./me";

/**
 * The review screens were written against review cycles: one cycle per step of
 * a route, each with its own seats, comments and outcome. The backend keeps one
 * review per route, with its steps inside it. These read a review back as the
 * cycle of the step it stands at (the open one; once answered, the deciding
 * one), and the route around it as the run the screens drew.
 */

type Scope = { projectId: string };
type Step = ReviewView["steps"][number];

/** A day the backend gives (2026-10-14) as the end of that day: a step due today is not late until tonight. */
export function dueDay(day: string | null | undefined): Date | null {
  return day ? new Date(`${day}T23:59:59`) : null;
}

/** Working days from one moment to a day: what a route was given, counted the way it is counted. */
export function workingDaysBetween(from: Date, to: Date): number {
  const day = new Date(from);
  let days = 0;
  while (day.toISOString().slice(0, 10) < to.toISOString().slice(0, 10)) {
    day.setDate(day.getDate() + 1);
    if (day.getDay() !== 0 && day.getDay() !== 6) days++;
  }
  return days;
}

/** One page of the reviews list, filtered and sorted by the backend. */
export async function reviewsPage(scope: Scope, query: Query): Promise<ReviewsPage> {
  return api<ReviewsPage>(projectPath(scope, "/reviews"), { query });
}

/** The disciplines and document types the project's documents hold, so a filter offers only those. */
export async function valuesInUse(scope: Scope): Promise<{ disciplines: string[]; docTypes: string[] }> {
  const register = await api<RegisterPage>(projectPath(scope, "/register"), { query: { per: 25 } });
  return { disciplines: register.lists.usedDisciplines, docTypes: register.lists.usedDocTypes };
}

/** The step a review stands at: the open one, or once none is, the last that answered. */
function focusOf(review: ReviewView): Step {
  return review.steps.find((one) => one.state === "OPEN")
    ?? [...review.steps].reverse().find((one) => one.state === "DONE")
    ?? review.steps[review.steps.length - 1];
}

/** The id a step goes by as a cycle: the review's own for the step it stands at, one of its own for the others. */
function stepCycleId(review: ReviewView, step: Step): string | undefined {
  if (step.state === "WAITING") return undefined;
  return step.number === focusOf(review).number ? review.id : `${review.id}:${step.number}`;
}

/** Who answered a step, and when the last of them did. */
function answered(step: Step) {
  const done = step.participants.filter((one) => one.answeredAt);
  const last = done.map((one) => one.answeredAt!).sort().pop() ?? null;
  return { names: done.map((one) => one.name).join(", ") || null, at: last ? new Date(last) : null };
}

/** A step's comments as the cycle held them. */
function commentsOf(review: ReviewView, step: number) {
  return review.comments.filter((one) => one.step === step).map((one) => ({
    id: one.id, authorId: one.authorId, authorName: one.author, text: one.text, progressionPreventing: one.blocking,
    status: one.status === "OPEN" ? "OPEN" : "CLOSED", closesWith: one.closesWith, closesWithStep: one.closesWithStep,
    resolution: one.resolution, createdAt: new Date(one.createdAt),
  }));
}

/** The name a stored file goes by, from its download; null when it cannot be read. */
async function fileName(scope: Scope, fileId: string): Promise<string | null> {
  const response = await apiFetch(projectPath(scope, `/files/${fileId}/download`));
  await response.body?.cancel();
  if (!response.ok) return null;
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  return encoded ? decodeURIComponent(encoded) : /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? null;
}

export type ReviewCycle = Awaited<ReturnType<typeof readCycle>>;

/**
 * Somebody a step was handed to sits on it in its holder's place while the
 * hand-over is in force: they are seated here as the holder is.
 */
async function standIn(scope: Scope, review: ReviewView, step: Step) {
  if (step.state !== "OPEN") return [];
  const me = await api<{ seated: boolean; answered: boolean; onBehalfOf: string | null }>(projectPath(scope, `/reviews/${review.id}/me`)).catch(() => null);
  const who = me?.onBehalfOf ? (await getMe())?.user : null;
  if (!me?.onBehalfOf || !who) return [];
  return [{ id: `${review.id}-${step.number}-standin`, userId: who.id, userName: who.name, completedAt: me.answered ? new Date() : null }];
}

async function readCycle(scope: Scope, review: ReviewView) {
  const doc = (await legacyDocument(scope, review.documentId)) as LegacyDocument;
  const rev = doc.revisions.find((one) => one.id === review.revisionId) as LegacyRevision;
  const step = focusOf(review);
  const by = answered(step);
  const outcome = step.deciding ? review.verdict : step.answer;
  const transmittal = step.transmittalId
    ? await api<TransmittalView>(projectPath(scope, `/transmittals/${step.transmittalId}`)).then((one) => ({ id: one.id, number: one.number })).catch(() => null)
    : null;
  const proof = step.evidenceFileId ? await fileName(scope, step.evidenceFileId).catch(() => null) : null;
  return {
    id: review.id, number: review.number as string | null, sequence: rev.cycles.find((one) => one.id === review.id)?.sequence ?? 1,
    revisionId: review.revisionId, revision: { ...rev, document: doc },
    binding: step.deciding, outcomeSetKey: step.deciding ? review.verdictSet ?? "REVIEW_OUTCOMES" : "REVIEW_ADVICE" as string | null,
    outcome, outcomeByName: outcome ? (step.deciding ? by.names ?? review.closedBy : by.names) : null,
    outcomeAt: outcome ? (step.deciding && review.decidedAt ? new Date(review.decidedAt) : by.at) : null,
    status: step.state === "OPEN" ? "OPEN" : "CLOSED", grantsStatuses: JSON.stringify(step.grantsStatuses) as string | null,
    dueAt: dueDay(step.dueDate),
    // A review goes to its reviewers the moment it starts; there is no separate issuing.
    openedById: "", openedByName: review.startedBy, submittedAt: new Date(review.startedAt), receivedAt: new Date(review.startedAt),
    issuedToReviewAt: new Date(review.startedAt) as Date | null, returnedFromReviewAt: review.decidedAt ? new Date(review.decidedAt) : null,
    returnedToOriginatorAt: review.state === "RETURNED" && review.closedAt ? new Date(review.closedAt) : null,
    comments: commentsOf(review, step.number),
    assignments: [...step.participants.map((one, index) => ({
      id: `${review.id}-${step.number}-${index}`, userId: one.userId, userName: one.name, completedAt: one.answeredAt ? new Date(one.answeredAt) : null,
    })), ...(await standIn(scope, review, step))],
    party: step.party ? { name: step.party, participation: step.participation ?? "IN_APP" } : null,
    dispatchedAt: step.dispatchedAt ? new Date(step.dispatchedAt) : null, dispatchChannel: step.dispatchChannel, dispatchRef: step.dispatchRef,
    transmittal,
    files: step.evidenceFileId ? [{ id: step.evidenceFileId, kind: "EVIDENCE", name: proof ?? "their answer" }] : [],
  };
}

/** The review this request read as a cycle: the one a review page stands on. */
const readThisRequest = cache(() => ({ id: null as string | null }));
export function reviewOfRequest(): string | null {
  return readThisRequest().id;
}

/** A review as the cycle of the step it stands at; null when it does not exist or is not the reader's to see. */
export const reviewCycle = cache(async (scope: Scope, id: string): Promise<ReviewCycle | null> => {
  readThisRequest().id = id;
  try {
    return await readCycle(scope, await backendReview(scope, id));
  } catch (e) {
    if (e instanceof ApiProblem && (e.status === 404 || e.status === 400 || e.status === 403)) return null;
    throw e;
  }
});

/** The route a review runs, as the run the screens drew: each step that has opened is a cycle of its own. */
export async function reviewRun(scope: Scope, id: string): Promise<RunData> {
  const review = await backendReview(scope, id);
  const steps: WfRuntimeStep[] = review.steps.map((step) => ({
    act: step.deciding ? "APPROVAL" : "REVIEW",
    mode: step.mode === "ALL" ? "ALL" : "ANY_OF",
    participantIds: step.participants.map((one) => one.userId),
    title: step.title,
    grantsStatuses: step.grantsStatuses,
    status: step.state === "DONE" ? "done" : step.state === "OPEN" ? "active" : "pending",
    cycleId: stepCycleId(review, step),
    decidedBy: step.participants.filter((one) => one.answeredAt).map((one) => one.userId),
    goesTo: step.goesTo ?? [],
  }));
  return {
    id: review.id, revisionId: review.revisionId, templateName: review.route, steps,
    currentStep: review.currentStep ? review.currentStep - 1 : steps.length,
    status: review.state === "IN_PROGRESS" ? "ACTIVE" : review.state === "RETURNED" ? "RETURNED" : "DONE",
  };
}

/** What each step before the one a review stands at said: its answer, who gave it, and its comments. */
export async function earlierSteps(scope: Scope, id: string) {
  const review = await backendReview(scope, id);
  const here = focusOf(review).number;
  return review.steps.filter((step) => step.number < here && step.state !== "WAITING").map((step) => {
    const by = answered(step);
    return {
      id: stepCycleId(review, step)!, number: null as string | null, outcome: step.answer, outcomeByName: by.names, outcomeAt: by.at,
      comments: commentsOf(review, step.number),
    };
  });
}

/** Every step of a review that has opened, as the cycles the route's progress draws. */
export async function routeSteps(scope: Scope, id: string) {
  const review = await backendReview(scope, id);
  return review.steps.filter((step) => step.state !== "WAITING").map((step) => {
    const by = answered(step);
    const outcome = step.deciding ? review.verdict : step.answer;
    return {
      id: stepCycleId(review, step)!, outcome, outcomeAt: outcome ? by.at : null, outcomeByName: by.names,
      dispatchedAt: step.dispatchedAt ? new Date(step.dispatchedAt) : null, assignments: step.participants.map((one) => ({ userName: one.name })),
    };
  });
}

/** The people waiting on a review's open step, and the revision it is of: what a reminder needs. */
export async function waitingOn(scope: Scope, id: string): Promise<{ revisionId: string; userIds: string[] }> {
  const review = await backendReview(scope, id);
  const open = review.steps.find((one) => one.state === "OPEN");
  return { revisionId: review.revisionId, userIds: (open?.participants ?? []).filter((one) => !one.answeredAt).map((one) => one.userId) };
}

export type SendableRevision = {
  id: string; documentId: string; value: string; statusCode: string | null; renditionFileId: string | null; nativeFileId: string | null;
  document: { docNumber: string; title: string };
};

/** A revision being prepared, with the files of its current submission; null when it is not one. */
async function sendable(scope: Scope, documentId: string, id: string): Promise<SendableRevision | null> {
  const doc = await backendDocument(scope, documentId);
  const revision = doc?.revisions.find((one) => one.id === id);
  if (!doc || !revision || revision.state !== "IN_PREPARATION") return null;
  const current = revision.files.filter((one) => one.submission === revision.submission);
  return {
    id, documentId: doc.id, value: revision.value, statusCode: revision.statusCode,
    renditionFileId: current.find((one) => one.kind === "RENDITION")?.id ?? null, nativeFileId: current.find((one) => one.kind === "NATIVE")?.id ?? null,
    document: { docNumber: doc.number, title: doc.title },
  };
}

/** The revisions asked for that are still being prepared, with their documents. */
export async function preparingRevisions(scope: Scope, ids: string[]): Promise<SendableRevision[]> {
  const found = await Promise.all(ids.map(async (id) => {
    const revision = await backendRevision(scope, id).catch(() => null);
    return revision ? sendable(scope, revision.documentId, id) : null;
  }));
  return found.filter((one): one is SendableRevision => !!one);
}

/** Every revision being prepared on the project, newest first (up to 250, as the register gives them). */
export async function revisionsInPreparation(scope: Scope): Promise<SendableRevision[]> {
  const register = await api<RegisterPage>(projectPath(scope, "/register"), {
    query: { rev: "IN_PREPARATION", view: "all", sort: "revStarted", dir: "desc", per: 250 },
  });
  const found = await Promise.all(register.rows.filter((row) => row.latestRevisionId).map((row) => sendable(scope, row.id, row.latestRevisionId!)));
  return found.filter((one): one is SendableRevision => !!one);
}
