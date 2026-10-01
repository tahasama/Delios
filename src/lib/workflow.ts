import type { Tenant } from "./tenant";
import { audit, notifyMany } from "./audit";
import type { SessionUser } from "./auth";
import { holdersOf } from "./permissions";
import { verdictMeaning, assertMayGiveBindingVerdict, recordApproval } from "./verdict";

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

/**
 * Who answers an external step, in our system. A party with accounts here
 * answers for itself. A party without them is carried by its liaison — the
 * function named on the party, or the control function if none is — who sends
 * the pack out and records what comes back.
 */
export async function partyStepHolders(t: Tenant, partyId: string): Promise<{ ids: string[]; byProxy: boolean; party: { id: string; name: string; participation: string } }> {
  const party = await t.db.party.findUniqueOrThrow({ where: { id: partyId }, select: { id: true, name: true, kind: true, participation: true, liaisonFunction: true } });
  // A collaborator or a guest holds accounts here and answers for itself;
  // an organization that is not on the EDMS is carried by one of our people.
  const answersHere = party.kind === "OFFLINE" ? false : party.kind === "COLLABORATOR" || party.kind === "GUEST" || party.participation === "IN_APP";
  if (answersHere) {
    const people = await t.db.user.findMany({ where: { partyId, active: true }, select: { id: true } });
    if (people.length) return { ids: people.map((person) => person.id), byProxy: false, party };
    // They are meant to answer here but hold no account yet: rather than a step
    // nobody can act on, it is carried until their accounts exist.
  }
  // A function is held through a project membership, so the liaison is whoever
  // holds that function on this project.
  const liaison = party.liaisonFunction
    ? await t.db.projectMembership.findMany({
        where: { projectId: t.projectId, functionId: party.liaisonFunction, active: true, user: { active: true } },
        select: { userId: true },
      })
    : [];
  if (liaison.length) return { ids: liaison.map((seat) => seat.userId), byProxy: true, party };
  const controllers = await holdersOf(t, "CONTROL");
  return { ids: controllers.map((person) => person.id), byProxy: true, party };
}

/**
 * The number a review carries, from the scheme the organization published. A
 * review is a record like a transmittal or an action, and is referred to the
 * same way.
 */
export async function reviewNumber(t: Tenant): Promise<string> {
  const { nextRecordNumber } = await import("./numbering-records");
  const project = await t.db.project.findUnique({ where: { id: t.projectId }, select: { code: true } });
  return nextRecordNumber(t, "REVIEW", { project: project?.code ?? "" }, "RV");
}

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

/** What the route moves to after this step, in the words the route uses. */
function nextStepName(steps: WfRuntimeStep[], current: number): string {
  const next = steps[current + 1];
  if (!next) return "Document Control";
  return next.title ?? (current + 2 === steps.length ? "the decision" : `step ${current + 2}`);
}

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
  const { db, projectId } = t;
  const run = await db.workflowRun.findFirst({
    where: { revisionId, status: { in: ["ACTIVE", "DONE", "RETURNED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!run) return null;
  return { id: run.id, revisionId: run.revisionId, templateName: run.templateName, steps: parseSteps(run.steps), currentStep: run.currentStep, status: run.status };
}

async function spawnCycleForStep(t: Tenant, revisionId: string, step: WfRuntimeStep, user: SessionUser, seq: number, label: string) {
  const { db, projectId } = t;
  const number = await reviewNumber(t);
  const cycle = await db.reviewCycle.create({
    data: { projectId,
      number,
      revisionId,
      mode: step.mode === "SERIAL" ? "SERIAL" : "PARALLEL",
      sequence: seq,
      status: "OPEN",
      openedById: user.id,
      openedByName: user.name,
      submittedAt: new Date(),
      receivedAt: new Date(),
      issuedToReviewAt: new Date(),
      outcomeSetKey: step.outcomeSetKey ?? null,
      // What the route asked of this step, kept on the step itself: an answer is
      // judged against what was asked, not against the route as edited since.
      grantsStatuses: step.grantsStatuses?.length ? JSON.stringify(step.grantsStatuses) : null,
      dueAt: step.days ? addWorkingDays(new Date(), step.days) : null,
      binding: step.act === "APPROVAL",
      partyId: step.partyId ?? null,
    },
  });
  const participants = await db.user.findMany({ where: { id: { in: step.participantIds } } });
  await db.reviewAssignment.createMany({
    data: participants.map((p, i) => ({ projectId, cycleId: cycle.id, userId: p.id, userName: p.name, order: i + 1 })),
  });
  const revision = await db.revision.findUniqueOrThrow({ where: { id: revisionId }, select: { documentId: true } });
  await notifyMany(step.participantIds, "REVIEW_REQUEST", `Workflow step ${seq}: ${label}`, step.act === "APPROVAL" ? "Your binding verdict is requested." : "Your review is requested.", `/documents/${revision.documentId}`, t);
  return cycle;
}

/**
 * Open the cycle for one step of a run that is already going. Used when the
 * control function sends a revision back to a step: the route picks up there
 * rather than starting again.
 */
export async function spawnCycleAt(t: Tenant, runId: string, index: number, user: SessionUser) {
  const { db } = t;
  const run = await db.workflowRun.findUniqueOrThrow({ where: { id: runId } });
  const steps = parseSteps(run.steps);
  const step = steps[index];
  if (!step) return;
  const rev = await db.revision.findUniqueOrThrow({ where: { id: run.revisionId }, include: { document: true } });
  const cycle = await spawnCycleForStep(t, run.revisionId, step, user, index + 1, `${rev.document.docNumber} rev ${rev.value}`);
  steps[index].cycleId = cycle.id;
  await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps) } });
}

/**
 * Send a running route back to an earlier step.
 *
 * The person holding the step that is open may do this, and only backwards: a
 * reviewer who opens the wrong file, or who should never have been the one
 * answering, has somewhere to go that is not answering falsely. They cannot
 * reach forward, and they cannot rewind to a step that has not answered, so
 * nobody's verdict is quietly undone — and the one they do rewind is recorded
 * with their name, their reason and a notice to everyone on the route.
 *
 * It is for a fault in the route. A document that is wrong is replaced by the
 * next revision, which is why the reason comes from the published list.
 */
export async function rewindRoute(
  t: Tenant,
  runId: string,
  user: SessionUser,
  toStep: number,
  returnReason: string,
  words: string,
): Promise<{ ok: boolean; error?: string }> {
  const { db } = t;
  const run = await db.workflowRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "ACTIVE") return { ok: false, error: "This route is not running." };
  const steps = parseSteps(run.steps);
  const here = run.currentStep;
  if (!steps[here]?.participantIds.includes(user.id)) {
    return { ok: false, error: "Only somebody holding the step that is open can send it back." };
  }
  const index = toStep - 1;
  if (!(index >= 0 && index < here)) {
    return { ok: false, error: "A step can only be sent back to one before it, and that one must already have answered." };
  }
  if (steps[index].status !== "done") return { ok: false, error: "That step has not answered yet." };
  void words;
  const published = await db.configValue.findFirst({ where: { setKey: "RETURN_REASONS", code: returnReason, status: "ACTIVE" } });
  if (!published) {
    return { ok: false, error: "Choose one of the published reasons. They are all faults in the route: a document that is wrong is replaced by the next revision." };
  }

  const rev = await db.revision.findUniqueOrThrow({ where: { id: run.revisionId }, include: { document: true } });
  const label = `${rev.document.docNumber} rev ${rev.value}`;
  const backTo = steps[index].title ?? `step ${toStep}`;

  // Everything from that step onward is open again; the answers before it stand.
  for (let i = index; i < steps.length; i++) {
    steps[i].status = i === index ? "active" : "pending";
    steps[i].decidedBy = [];
    steps[i].inputs = [];
    steps[i].cycleId = undefined;
  }
  await db.reviewCycle.updateMany({ where: { revisionId: run.revisionId, status: "OPEN" }, data: { status: "CLOSED" } });
  await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps), currentStep: index } });
  await spawnCycleAt(t, runId, index, user);

  await audit({
    tenant: t, actor: user, action: "ROUTE_REWOUND", entityType: "WorkflowRun", entityId: runId,
    entityLabel: label, oldValue: steps[here].title ?? `step ${here + 1}`, newValue: backTo,
    detail: `${published.label}: ${words}`,
  });
  await notifyMany(
    [...new Set(steps.flatMap((one) => one.participantIds))],
    "ROUTE_REWOUND",
    `${label} \u2014 back to ${backTo}`,
    `${user.name} sent it back from ${steps[here].title ?? `step ${here + 1}`}. ${published.label}: ${words}`,
    `/documents/${rev.documentId}`,
    t,
  );
  return { ok: true };
}

/** Start a template run on a revision in preparation. */
export async function startWorkflowRun(t: Tenant, revisionId: string, templateId: string, user: SessionUser, overrideParticipantIds?: string[][]): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const { db, projectId } = t;
  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
  if (rev.state !== "IN_PREPARATION") return { ok: false, error: `${rev.document.docNumber} rev ${rev.value} is not in preparation.` };
  // A type the organization does not review has no route to go down.
  const { typeSkipsReview } = await import("./review-need");
  if (await typeSkipsReview(t, rev.document.docType)) return { ok: false, error: `${rev.document.docType} is not reviewed — it goes from preparation straight to release.` };
  if (!rev.renditionFileId && !rev.nativeFileId) {
    return { ok: false, error: `${rev.document.docNumber} rev ${rev.value} has no file. Attach what is to be reviewed first — a verdict on nothing is worth less than no verdict.` };
  }
  const active = await db.workflowRun.findFirst({ where: { revisionId, status: "ACTIVE" } });
  if (active) return { ok: false, error: "A workflow is already running for this revision." };
  // One revision of a document is in motion at a time, so one route runs on it.
  const elsewhere = await db.revision.findFirst({
    where: { documentId: rev.documentId, state: "IN_REVIEW", NOT: { id: revisionId } },
    orderBy: { createdAt: "desc" },
  });
  if (elsewhere) return { ok: false, error: `Rev ${elsewhere.value} of ${rev.document.docNumber} is already in review. One revision at a time.` };

  const template = await db.workflowTemplate.findUniqueOrThrow({ where: { id: templateId } });
  const baseSteps = normalizeRoute(JSON.parse(template.steps) as WfStep[]);
  if (!baseSteps.length) return { ok: false, error: "The template has no steps." };

  // An external step is seated from its party rather than from the matrix:
  // either the party's own people, or the liaison who carries it for them.
  const proposed = await Promise.all(baseSteps.map((s) => (s.partyId ? Promise.resolve([]) : proposeForStep(t, [rev.document], s))));
  const seated = await Promise.all(baseSteps.map((s) => (s.partyId ? partyStepHolders(t, s.partyId) : Promise.resolve(null))));
  const steps: WfRuntimeStep[] = baseSteps.map((s, i) => ({
    ...s,
    outcomeSetKey: setKeyForStep(i, baseSteps.length, s.outcomeSetKey, template.outcomeSetKey),
    participantIds: overrideParticipantIds?.[i]?.length
      ? overrideParticipantIds[i]
      : seated[i]
        ? seated[i]!.ids
        : proposed[i].map((p) => p.id),
    status: i === 0 ? "active" : "pending",
    decidedBy: [],
  }));
  if (steps.some((s) => !s.participantIds.length)) return { ok: false, error: "Every step needs at least one participant." };
  // The matrix governs our own people. An outside party is on the route because
  // the route says so, and its liaison answers for it.
  const offMatrix = await offMatrixParticipants(t, rev.document, steps.filter((s) => !s.partyId));
  if (offMatrix.length) return { ok: false, error: `Not on the distribution matrix: ${offMatrix.join("; ")}. Add them in Functions & permissions, or choose others.` };

  const run = await db.workflowRun.create({
    data: { projectId,
      revisionId,
      templateId,
      templateName: template.name,
      steps: JSON.stringify(steps),
      currentStep: 0,
      status: "ACTIVE",
      startedById: user.id,
      startedByName: user.name,
    },
  });

  const label = `${rev.document.docNumber} rev ${rev.value}`;
  const cycle = await spawnCycleForStep(t, revisionId, steps[0], user, 1, label);
  steps[0].cycleId = cycle.id;
  await db.workflowRun.update({ where: { id: run.id }, data: { steps: JSON.stringify(steps) } });
  await db.revision.update({ where: { id: revisionId }, data: { state: "IN_REVIEW" } });
  await audit({
    tenant: t,
    actor: user,
    action: "WORKFLOW_STARTED",
    entityType: "WorkflowRun",
    entityId: run.id,
    entityLabel: `${label} — ${template.name}`,
    detail: `Template "${template.name}" with ${steps.length} step(s).`,
  });
  return { ok: true, runId: run.id };
}

/** Advance after the current step completed; spawn the next, or finish the run. */
async function advance(t: Tenant, runId: string, user: SessionUser) {
  const { db, projectId } = t;
  const run = await db.workflowRun.findUniqueOrThrow({ where: { id: runId } });
  const steps = parseSteps(run.steps);
  steps[run.currentStep].status = "done";
  await tellTheRoute(t, run.revisionId, steps, run.currentStep);
  // A reservation held against this step is settled by this step answering.
  // "Approved, under reserve of the architect" closes when the architect
  // approves, and the revision does not go round again for it.
  const settled = await db.reviewComment.updateMany({
    where: { cycle: { revisionId: run.revisionId }, progressionPreventing: true, status: "OPEN", closesWith: "STEP", closesWithStep: run.currentStep + 1 },
    data: { status: "CLOSED", closedAt: new Date(), resolution: `Settled by ${steps[run.currentStep].title ?? `step ${run.currentStep + 1}`}.` },
  });
  if (settled.count) {
    await audit({
      tenant: t, actor: user, action: "CONDITION_SETTLED", entityType: "Revision", entityId: run.revisionId,
      detail: `${settled.count} reservation${settled.count === 1 ? "" : "s"} settled by ${steps[run.currentStep].title ?? `step ${run.currentStep + 1}`}.`,
    });
  }
  const next = run.currentStep + 1;
  if (next >= steps.length) {
    await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps), status: "DONE" } });
    // The route is over and the status is settled. Nobody may act on it until
    // Document Control publishes it, and the state is what says so.
    await db.revision.update({ where: { id: run.revisionId }, data: { state: "NOT_RELEASED" } });
    const rev = await db.revision.findUniqueOrThrow({ where: { id: run.revisionId }, include: { document: true } });
    await audit({ tenant: t, actor: user, action: "WORKFLOW_COMPLETED", entityType: "WorkflowRun", entityId: runId, entityLabel: `${rev.document.docNumber} rev ${rev.value}`, detail: "Binding verdict permits release — ready for release by the control function." });
    const contributorIds = await contributorRecipients(t, rev.document.createdById, rev.document.originator);
    await notifyMany(contributorIds, "WORKFLOW_DONE", `Workflow complete: ${rev.document.docNumber} rev ${rev.value}`, "All steps are done. The control function can now release it.", `/documents/${rev.documentId}`, t);
    await readyForRelease(t, run.revisionId, user, `Workflow "${run.templateName}" completed.`);
    return;
  }
  steps[next].status = "active";
  const nextRevision = await db.revision.findUniqueOrThrow({ where: { id: run.revisionId }, include: { document: true } });
  const label = `${nextRevision.document.docNumber} rev ${nextRevision.value}`;
  await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps), currentStep: next } });
  const cycle = await spawnCycleForStep(t, run.revisionId, steps[next], user, next + 1, label);
  steps[next].cycleId = cycle.id;
  await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps) } });
}

/**
 * Tell everyone on the route what just happened. They are the people who decide
 * what to ask for once the revision is released — a new revision, an issue, an
 * approval — so they hear it as it goes rather than at the end.
 */
async function tellTheRoute(t: Tenant, revisionId: string, steps: WfRuntimeStep[], index: number) {
  const step = steps[index];
  const everyone = [...new Set(steps.flatMap((one) => one.participantIds))].filter((id) => !step.participantIds.includes(id));
  if (!everyone.length) return;
  const rev = await t.db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
  const cycle = step.cycleId ? await t.db.reviewCycle.findUnique({ where: { id: step.cycleId }, select: { outcome: true, outcomeByName: true } }) : null;
  const next = steps[index + 1];
  await notifyMany(
    everyone,
    "STEP_ANSWERED",
    `${rev.document.docNumber} rev ${rev.value} — ${step.title ?? `step ${index + 1}`} answered`,
    `${cycle?.outcome ?? "Answered"}${cycle?.outcomeByName ? ` by ${cycle.outcomeByName}` : ""}. ${next ? `Now with ${next.title ?? `step ${index + 2}`}.` : "The route is over; it waits to be released."}`,
    `/documents/${rev.documentId}`,
    t,
  );
}

/** Return the workflow to the author (a decline anywhere). §7.5 — replaced, not corrected. */
async function returnWorkflow(t: Tenant, runId: string, user: SessionUser, reason: string) {
  const { db, projectId } = t;
  const run = await db.workflowRun.findUniqueOrThrow({ where: { id: runId } });
  const steps = parseSteps(run.steps);
  steps[run.currentStep].status = "declined";
  await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps), status: "RETURNED" } });
  const rev = await db.revision.findUniqueOrThrow({ where: { id: run.revisionId }, include: { document: true } });
  await db.revision.update({
    where: { id: run.revisionId },
    data: {
      authorizationReason: `Declined in workflow "${run.templateName}": ${reason}`,
      authorizedById: user.id,
      authorizedByName: user.name,
      authorizedAt: new Date(),
    },
  });
  await audit({ tenant: t, actor: user, action: "WORKFLOW_RETURNED", entityType: "WorkflowRun", entityId: runId, entityLabel: `${rev.document.docNumber} rev ${rev.value}`, detail: reason });
  const contributorIds = await contributorRecipients(t, rev.document.createdById, rev.document.originator);
 await notifyMany(contributorIds, "WORKFLOW_RETURNED", `Changes requested: ${rev.document.docNumber} rev ${rev.value}`, `${reason} — prepare the next revision.`, `/documents/${rev.documentId}`, t);
}

/**
 * A revision whose content is settled — by its route's binding verdict, or by
 * being a type that is not reviewed — on its way into the register. An outside
 * approval asked for opens first and the revision waits; otherwise Document
 * Control publishes it, or, where there is no gate, it is released at once at
 * the status it carries and issued as asked. The revision is Not released here.
 */
export async function readyForRelease(t: Tenant, revisionId: string, user: SessionUser, why: string, basis = "the binding verdict") {
  const { db } = t;
  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
  const contributorIds = await contributorRecipients(t, rev.document.createdById, rev.document.originator);
  // Release is a step like any other, and an organization that has no control
  // function does not have it. Where nobody holds Control — or where the
  // project says it wants no gate — the binding verdict releases the revision
  // at the status it decided on, and issues it as the decider asked.
  // An outside party that has to approve it answers before anything is
  // released: the step opens now, and the revision waits.
  const { openApprovalStep } = await import("./issue-requests");
  const outside = await openApprovalStep(t, revisionId, user);
  if (outside.opened) {
    await audit({
      tenant: t, actor: user, action: "STEP_DISPATCHED", entityType: "Revision", entityId: revisionId,
      entityLabel: `${rev.document.docNumber} rev ${rev.value}`,
      detail: `Waiting on ${outside.party ?? "an outside party"} to approve it before it is released and issued.`,
    });
    await notifyMany(contributorIds, "WORKFLOW_DONE", `Waiting on ${outside.party ?? "an outside party"}: ${rev.document.docNumber} rev ${rev.value}`, "The route is done. It is released and issued when their approval comes back.", `/documents/${rev.documentId}`, t);
    return;
  }

  const controllers = await holdersOf(t, "CONTROL");
  const { issueGateIsControl } = await import("./issue-requests");
  if (!controllers.length || !(await issueGateIsControl(t))) {
    const { releaseRevision } = await import("./lifecycle");
    try {
      // Releasing is issuing; the act sends what the decider asked for.
      await releaseRevision(t, revisionId, user, rev.statusCode ?? "");
      await audit({ tenant: t, actor: user, action: "RELEASE", entityType: "Revision", entityId: revisionId, entityLabel: `${rev.document.docNumber} rev ${rev.value}`, detail: controllers.length ? `Released on ${basis}: this project issues without a Document Control gate.` : `Released on ${basis}: this organization publishes no control function.` });
    } catch (e) {
      await notifyMany(contributorIds, "RELEASE_BLOCKED", `Not released: ${rev.document.docNumber} rev ${rev.value}`, e instanceof Error ? e.message : "Release failed.", `/documents/${rev.documentId}`, t);
    }
    return;
  }
  await notifyMany(controllers.map((c) => c.id), "RELEASE_READY", `Ready to release: ${rev.document.docNumber} rev ${rev.value}`, why, `/documents/${rev.documentId}`, t);
}

async function contributorRecipients(t: Tenant, createdById: string, originator: string | null) {
  const { db, projectId } = t;
  const ids = new Set([createdById]);
  if (originator) {
    const party = await db.party.findFirst({ where: { code: originator } });
    if (party) {
      const users = await db.user.findMany({ where: { partyId: party.id, active: true }, select: { id: true } });
      users.forEach((user) => ids.add(user.id));
    }
  }
  return [...ids];
}

/**
 * Record a verdict on the active step. On an advisory step it is input for
 * the decider; on the last step it is the binding verdict.
 * ANY_OF: the first participant's outcome closes the step.
 * SERIAL: participants decide in order; the last one's outcome is binding (§9.7).
 * ALL_CONSOLIDATOR: everyone records; the last-named participant records the binding outcome.
 */
export async function recordStepOutcome(
  t: Tenant,
  runId: string,
  user: SessionUser,
  outcomeCode: string,
  note?: string,
  issuedFor?: string,
  /** Ticked when the step keeps the status the revision arrived with. */
  confirmedStatus?: boolean,
  /**
   * When this step's comment is a reservation on a later step's answer, which
   * step closes it — counting from 1. Empty means the next revision closes it.
   */
  closesWithStep?: number | null,
  /**
   * What the deciding step asks for once the revision is released. Only the
   * deciding step is offered it, and only as a convenience: anybody with
   * standing on the document may ask, at any time, as often as the work needs.
   */
  request?: {
    /** Unticked means "not now" — the decision stands and nothing is asked for. */
    give: boolean;
    reason: string;
    recipients: { internalUserIds: string[]; partyIds: string[] };
    delegated: boolean;
    note?: string | null;
    /** An outside party has to approve it before it is released at all. */
    needsApproval?: boolean;
    approverId?: string | null;
  },
  /**
   * An outside party decided, and one of our people wrote it down. The verdict
   * is theirs; the record says who entered it.
   */
  onBehalfOf?: string,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  let said = onBehalfOf ? `${onBehalfOf} (recorded by ${user.name})` : user.name;
  const { db, projectId } = t;
  const run = await db.workflowRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "ACTIVE") return { ok: false, error: "This workflow is not active." };
  const steps = parseSteps(run.steps);
  const step = steps[run.currentStep];
  if (!step || step.status !== "active") return { ok: false, error: "No active step to decide on." };
  const rev = await db.revision.findUniqueOrThrow({ where: { id: run.revisionId }, include: { document: true } });
  const label = `${rev.document.docNumber} rev ${rev.value}`;
  const decidesStep = run.currentStep === steps.length - 1;
  // A participant answers their own step. Somebody else answers it only through
  // a delegation from a participant, and only if the matrix names them for the
  // same act on this class — so the step never reaches a person the route and
  // the matrix together leave out (§8.5).
  let inPlaceOf: string | null = null;
  if (!step.participantIds.includes(user.id)) {
    const { delegationInForce } = await import("./delegation");
    const del = await delegationInForce(t, {
      userId: user.id,
      verb: decidesStep ? "APPROVE" : "REVIEW",
      target: rev.document,
      cycleId: step.cycleId ?? null,
    });
    if (!del || !step.participantIds.includes(del.fromUserId)) {
      return { ok: false, error: "Only a participant of this step records its verdict, or somebody holding a delegation from one of them." };
    }
    inPlaceOf = del.fromUser.name;
    said = `${user.name} for ${inPlaceOf} (by delegation)`;
  }
  const outcomeSetKey = decidesStep ? step.outcomeSetKey ?? VERDICT_SET : ADVICE_SET;
  /** Closing a step ends the review interval; only a verdict that sends the revision back returns it to its author. */
  const closed = (_toAuthor: boolean) => ({ returnedFromReviewAt: new Date(), status: "CLOSED" });

  const verdict = await verdictMeaning(t, outcomeSetKey, outcomeCode);
  if (!verdict) return { ok: false, error: `Choose an active verdict from ${outcomeSetKey}.` };
  // The last step decides; every earlier step advises. Only a decision sends a
  // revision back — advice is input to that decision, never the end of the route.
  const decides = decidesStep;
  const returnsToAuthor = decides && !verdict.proceed;
  // Within the deciding step, whose verdict binds depends on how it decides:
  // serial and consolidated steps bind on their last person; the others on everyone.
  const binds = decides && bindsOnStep(step, user.id);
  // Every step says what the revision is issued for — not only the last one. A
  // step that keeps the status it arrived with says so on purpose, so nobody
  // passes a document on without having looked at what it is for.
  if (issuedFor || !returnsToAuthor) {
    if (!issuedFor) return { ok: false, error: "Say what this revision is issued for, or confirm the status it already carries." };
    // Keeping the status is a decision, so it is taken rather than allowed to
    // happen: nobody passes a document on without saying what it is for.
    if (rev.statusCode && issuedFor === rev.statusCode && !confirmedStatus) {
      return { ok: false, error: `It stays at ${rev.statusCode} — confirm that is still what it is issued for.` };
    }
    const published = await t.db.configValue.findFirst({ where: { setKey: "STATUSES", code: issuedFor, status: "ACTIVE" } });
    if (!published) return { ok: false, error: `“${issuedFor}” is not one of the published statuses.` };
    // The route may narrow what the deciding step is allowed to name.
    if (decides && step.grantsStatuses?.length && !step.grantsStatuses.includes(issuedFor)) {
      return { ok: false, error: `This step may only decide on ${step.grantsStatuses.join(", ")}.` };
    }
    await t.db.revision.update({
      where: { id: rev.id },
      data: { statusCode: issuedFor, statusSetAt: new Date(), statusSetByName: said },
    });
  }
  // The person who settled what the revision is for is also the likeliest to
  // know who needs it, so they are asked while they are here. Saying "not now"
  // is an answer: the decision stands, and the record shows nobody asked.
  if (binds && !returnsToAuthor && request?.give) {
    const { noRecipients } = await import("./issue-requests");
    if (!request.delegated && noRecipients(request.recipients)) {
      return { ok: false, error: "Say who it goes to, or leave it to the author, or untick \u201cask for it to be issued now\u201d." };
    }
    if (request.needsApproval && !request.approverId) {
      return { ok: false, error: "Say which party has to approve it before it is released." };
    }
    await t.db.issueRequest.create({
      data: {
        projectId,
        revisionId: rev.id,
        reason: request.reason,
        recipients: JSON.stringify(request.recipients),
        note: request.note ?? null,
        delegated: request.delegated,
        needsApproval: !!request.needsApproval,
        approverId: request.approverId ?? null,
        raisedById: user.id,
        raisedByName: said,
      },
    });
    if (request.delegated) {
      await notifyMany(
        [rev.document.createdById],
        "ISSUE_DELEGATED",
        `Who should get ${label}?`,
        "The decision left it to you to say who this revision goes to. Ask for it when you know.",
        `/documents/${rev.documentId}`,
        t,
      );
    }
  }
  if (binds && !returnsToAuthor) {
    try { await assertMayGiveBindingVerdict(t, rev.id, user); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Not permitted." }; }
  }
  // A route started before every step had its own cycle: give this one its cycle now.
  if (!step.cycleId) {
    const cycle = await spawnCycleForStep(t, run.revisionId, step, user, run.currentStep + 1, label);
    step.cycleId = cycle.id;
    await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps) } });
  }
  if (!decides) await db.reviewCycle.update({ where: { id: step.cycleId }, data: { binding: false } });

  // A verdict that returns the revision, or carries comments into the next one,
  // has to say what must change. A blocking comment already says it.
  const own = step.cycleId
    ? await db.reviewComment.findMany({ where: { cycleId: step.cycleId }, select: { progressionPreventing: true } })
    : [];
  const blocking = own.filter((c) => c.progressionPreventing).length;
  if (binds && returnsToAuthor && !note) return { ok: false, error: `${verdict.label} sends the revision back — say what is wrong with it, so the next revision answers it.` };
  if (binds && !returnsToAuthor && verdict.resubmit && !note) {
    const written = await db.reviewComment.count({ where: { cycle: { revisionId: run.revisionId } } });
    if (!written) return { ok: false, error: `${verdict.label} carries comments into the next revision, so there must be comments. Write them, or choose the verdict that accepts it outright.` };
  }

  /** The code the closing cycle carries: what the person actually chose. */
  const closingCode = async () => outcomeCode;

  const finishBindingDecision = async () => {
    if (!decides) return advance(t, runId, user);
    if (returnsToAuthor) {
      // The verdict asks for changes, so it authorizes the next revision. It
      // does not stop this one reaching the control function: a revision that
      // has been decided is released at what it is good for, and whoever wants
      // the next one starts it when they are ready.
      await db.revision.update({
        where: { id: rev.id },
        data: {
          authorizationReason: `${verdict.label}${note ? ` — ${note}` : ""}`,
          authorizedById: user.id,
          authorizedByName: user.name,
          authorizedAt: new Date(),
        },
      });
    } else {
      await recordApproval(t, rev.id, user, `Binding verdict ${verdict.code} — ${verdict.label}${note ? `: ${note}` : ""}`);
    }
    return advance(t, runId, user);
  };

  // The comment a verdict carries is the verdict's own words, so it is kept as
  // a comment and it inherits the verdict: one that says the revision cannot go
  // on as it stands is blocking, and stays open until somebody settles it.
  const blocks = returnsToAuthor || verdict.blocking || verdict.resubmit;
  if (step.cycleId && note) {
    await db.reviewComment.create({
      data: { projectId, cycleId: step.cycleId, authorId: user.id, authorName: said, text: note,
        classification: blocks ? "BLOCKING" : "NON_BLOCKING", progressionPreventing: !!blocks,
        // A reservation on somebody else's answer is closed by that answer. One
        // that is not says so by default: the next revision settles it.
        closesWith: blocks && closesWithStep ? "STEP" : "REVISION",
        closesWithStep: blocks && closesWithStep ? closesWithStep : null,
        status: blocks ? "OPEN" : "CLOSED", resolution: blocks ? null : note, closedAt: blocks ? null : new Date() },
    });
  }
  step.decidedBy = [...(step.decidedBy ?? []), user.id];

  if (step.mode === "ANY_OF") {
    await db.reviewCycle.update({ where: { id: step.cycleId }, data: { outcome: await closingCode(), outcomeAt: new Date(), outcomeByName: said, outcomeNote: note ?? null, ...closed(decides && returnsToAuthor) } });
    await finishBindingDecision();
    return { ok: true, message: `Decision recorded on ${label}.` };
  }

  if (step.mode === "SERIAL") {
    const idx = step.participantIds.indexOf(user.id);
    const before = step.participantIds.slice(0, idx);
    const decidedSet = new Set(step.decidedBy);
    const pendingBefore = before.filter((p) => !decidedSet.has(p));
 if (pendingBefore.length) return { ok: false, error: "Serial review: earlier reviewers decide first." };
    const isLast = idx === step.participantIds.length - 1;
    if (isLast) {
      await db.reviewCycle.update({ where: { id: step.cycleId }, data: { outcome: await closingCode(), outcomeAt: new Date(), outcomeByName: said, outcomeNote: note ?? null, ...closed(decides && returnsToAuthor) } });
      await finishBindingDecision();
      return { ok: true, message: `Final serial decision recorded on ${label}.` };
    }
    await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps) } });
    await db.reviewAssignment.updateMany({ where: { cycleId: step.cycleId, userId: user.id }, data: { completedAt: new Date() } });
    return { ok: true, message: `Recorded — waiting for the remaining serial reviewers.` };
  }

  if (step.mode === "ALL") {
    await db.reviewAssignment.updateMany({ where: { cycleId: step.cycleId, userId: user.id }, data: { completedAt: new Date() } });
    step.inputs = [...(step.inputs ?? []).filter((i) => i.userId !== user.id), { userId: user.id, code: outcomeCode, returns: returnsToAuthor }];
    const allDone = step.participantIds.every((p) => step.decidedBy!.includes(p));
    await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps) } });
    if (!allDone) return { ok: true, message: "Input recorded — waiting for the others on this step." };
    const worst = step.inputs.find((i) => i.returns) ?? step.inputs[step.inputs.length - 1];
    await db.reviewCycle.update({ where: { id: step.cycleId }, data: { outcome: decides ? worst.code : await closingCode(), outcomeAt: new Date(), outcomeByName: said, outcomeNote: note ?? null, ...closed(decides && worst.returns) } });
    if (decides && worst.returns) await returnWorkflow(t, runId, user, "The deciders asked for changes.");
    else if (decides) { await recordApproval(t, rev.id, user, `Binding verdict ${worst.code}`); await advance(t, runId, user); }
    else await advance(t, runId, user);
    return { ok: true, message: decides ? `All verdicts in — ${label} decided.` : `All inputs in — ${label} moves to ${nextStepName(steps, run.currentStep)}.` };
  }

  // ALL_CONSOLIDATOR
  await db.reviewAssignment.updateMany({ where: { cycleId: step.cycleId, userId: user.id }, data: { completedAt: new Date() } });
  const othersDone = step.participantIds.slice(0, -1).every((p) => step.decidedBy!.includes(p));
  const consolidator = step.participantIds[step.participantIds.length - 1];
  if (user.id === consolidator && othersDone) {
    await db.reviewCycle.update({ where: { id: step.cycleId }, data: { outcome: await closingCode(), outcomeAt: new Date(), outcomeByName: said, outcomeNote: note ?? null, ...closed(decides && returnsToAuthor) } });
    await finishBindingDecision();
    return { ok: true, message: `Consolidated decision recorded on ${label}.` };
  }
  await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps) } });
  return { ok: true, message: `Recorded — the consolidator closes this step once everyone has decided.` };
}

/**
 * Kept for callers that still say "approve" or "decline": both are a verdict on
 * the active step now. Approve picks the set's plain proceed code; decline its
 * request-changes code, unless a code is given.
 */
export async function recordStepApproval(t: Tenant, runId: string, user: SessionUser, approve: boolean, note?: string, outcomeCode?: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  const run = await t.db.workflowRun.findUniqueOrThrow({ where: { id: runId } });
  const step = parseSteps(run.steps)[run.currentStep];
  const setKey = step?.outcomeSetKey ?? "REVIEW_OUTCOMES";
  let code = outcomeCode;
  if (!code) {
    const values = await t.db.configValue.findMany({ where: { setKey, status: "ACTIVE" } });
    const props = (v: { props: string | null }) => { try { return v.props ? JSON.parse(v.props) : {}; } catch { return {}; } };
    const pick = values.find((v) => (approve ? props(v).proceed === true && props(v).resubmit !== true : props(v).proceed !== true && props(v).resubmit === true));
    code = pick?.code;
  }
  if (!code) return { ok: false, error: `No ${approve ? "approving" : "request-changes"} verdict is published in ${setKey}.` };
  return recordStepOutcome(t, runId, user, code, note, outcomeCode ? undefined : undefined);
}

async function runIdToRevision(t: Tenant, runId: string): Promise<string> {
  const { db, projectId } = t;
  const run = await db.workflowRun.findUniqueOrThrow({ where: { id: runId }, select: { revisionId: true } });
  return run.revisionId;
}

/**
 * Who on a route may not take part for this document under the distribution
 * matrix: a review step needs REVIEW, an approval step APPROVE, for the
 * document's class, through the function the person holds on this project.
 * Document Control sends to people the matrix names — never to anyone else.
 */
export async function offMatrixParticipants(
  t: Tenant,
  doc: { deliverableType: string; docType: string; discipline: string; criticality: string | null; confidentiality: string | null },
  steps: { act: "REVIEW" | "APPROVAL"; mode?: string; participantIds: string[] }[],
): Promise<string[]> {
  const { loadActor, can } = await import("./permissions");
  const ids = [...new Set(steps.flatMap((s) => s.participantIds))];
  const memberships = await t.db.projectMembership.findMany({
    where: { projectId: t.projectId, userId: { in: ids }, active: true },
    include: { user: { select: { name: true } } },
  });
  const actors = new Map<string, Awaited<ReturnType<typeof loadActor>>>();
  const problems: string[] = [];
  for (const step of steps) {
    for (const id of step.participantIds) {
      // On the deciding step only those whose verdict binds need Approve; the rest advise.
      const verb = step.act === "APPROVAL" && bindsOnStep(step, id) ? "APPROVE" : "REVIEW";
      const m = memberships.find((x) => x.userId === id);
      if (!m) { problems.push(`${id} is not on this project`); continue; }
      if (!actors.has(m.functionId)) actors.set(m.functionId, await loadActor(t, m.functionId));
      if (!can(actors.get(m.functionId) ?? null, verb, doc)) problems.push(`${m.user.name} may not ${verb === "APPROVE" ? "approve" : "review"} this document`);
    }
  }
  return [...new Set(problems)];
}

type DocClass = { deliverableType: string; docType: string; discipline: string; criticality: string | null; confidentiality: string | null };

/**
 * Who may take part in a step for ALL of these documents: people on this
 * project whose function holds the step's verb for every document's class.
 */
export async function eligiblePeople(t: Tenant, docs: DocClass[], act: "REVIEW" | "APPROVAL") {
  const { loadActor, can } = await import("./permissions");
  const verb = act === "APPROVAL" ? "APPROVE" : "REVIEW";
  const memberships = await t.db.projectMembership.findMany({
    where: { projectId: t.projectId, active: true, user: { active: true } },
    include: { user: { select: { id: true, name: true } }, function: { select: { id: true, name: true } } },
  });
  const actors = new Map<string, Awaited<ReturnType<typeof loadActor>>>();
  const out: { id: string; name: string; functionId: string; functionName: string }[] = [];
  for (const m of memberships) {
    if (!actors.has(m.functionId)) actors.set(m.functionId, await loadActor(t, m.functionId));
    const actor = actors.get(m.functionId) ?? null;
    if (docs.every((d) => can(actor, verb, d))) out.push({ id: m.user.id, name: m.user.name, functionId: m.functionId, functionName: m.function.name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type Proposal = { id: string; why: string };

/**
 * Who a step proposes, and why — the initiator can then add or remove anyone
 * the matrix allows.
 *
 *   1. The route names people or functions: those, where the matrix allows them.
 *   2. Otherwise, auto-assign by the documents' discipline: holders of a grant
 *      the matrix narrows to that discipline (e.g. Lead Electrical Engineer
 *      approves EL), then people whose department is that discipline.
 */
export async function proposeForStep(t: Tenant, docs: DocClass[], step: { act: "REVIEW" | "APPROVAL"; mode?: string; participantIds: string[]; functionIds?: string[] }): Promise<Proposal[]> {
  // A serial or consolidated deciding step also seats advisers; only its last
  // person must be able to approve, which is checked when the route starts.
  const seatsAdvisers = step.act === "APPROVAL" && (step.mode === "SERIAL" || step.mode === "ALL_CONSOLIDATOR") && step.participantIds.length > 1;
  const eligible = await eligiblePeople(t, docs, seatsAdvisers ? "REVIEW" : step.act);
  // Named people keep the route's order — in serial and consolidated steps the order decides who binds.
  const named = [
    ...step.participantIds.filter((id) => eligible.some((p) => p.id === id)).map((id) => ({ id, why: "named in the route" })),
    ...eligible
      .filter((p) => !step.participantIds.includes(p.id) && (step.functionIds ?? []).includes(p.functionId))
      .map((p) => ({ id: p.id, why: `${p.functionName} (route)` })),
  ];
  if (named.length || step.participantIds.length || (step.functionIds ?? []).length) return named;

  const disciplines = [...new Set(docs.map((d) => d.discipline).filter(Boolean))] as string[];
  if (!disciplines.length) return [];
  const verb = step.act === "APPROVAL" ? "APPROVE" : "REVIEW";
  const rules = await t.db.permissionRule.findMany({ where: { discipline: { in: disciplines } }, select: { functionId: true, verbs: true, discipline: true } });
  const byGrant = eligible
    .filter((p) => rules.some((r) => r.functionId === p.functionId && r.verbs.includes(`"${verb}"`)))
    .map((p) => ({ id: p.id, why: `${disciplines.join("/")} ${verb === "APPROVE" ? "approver" : "reviewer"} in the matrix` }));
  if (byGrant.length) return byGrant;
  const members = await t.db.projectMembership.findMany({ where: { projectId: t.projectId, active: true, department: { in: disciplines } }, select: { userId: true, department: true } });
  return eligible
    .filter((p) => members.some((m) => m.userId === p.id))
    .map((p) => ({ id: p.id, why: `${members.find((m) => m.userId === p.id)!.department} department` }));
}
