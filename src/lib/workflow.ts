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
  mode: "ANY_OF" | "ALL_CONSOLIDATOR" | "SERIAL" | "ALL";
  participantIds: string[];
  /** Functions whose holders are proposed at send time, filtered by the distribution matrix. */
  functionIds?: string[];
  outcomeSetKey?: string;
  title?: string;
};

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
  const cycle = await db.reviewCycle.create({
    data: { projectId,
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
      binding: step.act === "APPROVAL",
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

/** Start a template run on a revision in preparation. */
export async function startWorkflowRun(t: Tenant, revisionId: string, templateId: string, user: SessionUser, overrideParticipantIds?: string[][]): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const { db, projectId } = t;
  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
  if (rev.state !== "IN_PREPARATION") return { ok: false, error: `${rev.document.docNumber} rev ${rev.value} is not in preparation.` };
  const active = await db.workflowRun.findFirst({ where: { revisionId, status: "ACTIVE" } });
  if (active) return { ok: false, error: "A workflow is already running for this revision." };

  const template = await db.workflowTemplate.findUniqueOrThrow({ where: { id: templateId } });
  const baseSteps = normalizeRoute(JSON.parse(template.steps) as WfStep[]);
  if (!baseSteps.length) return { ok: false, error: "The template has no steps." };

  const proposed = await Promise.all(baseSteps.map((s) => proposeForStep(t, [rev.document], s)));
  const steps: WfRuntimeStep[] = baseSteps.map((s, i) => ({
    ...s,
    outcomeSetKey: setKeyForStep(i, baseSteps.length, s.outcomeSetKey, template.outcomeSetKey),
    participantIds: overrideParticipantIds?.[i]?.length ? overrideParticipantIds[i] : proposed[i].map((p) => p.id),
    status: i === 0 ? "active" : "pending",
    decidedBy: [],
  }));
  if (steps.some((s) => !s.participantIds.length)) return { ok: false, error: "Every step needs at least one participant." };
  const offMatrix = await offMatrixParticipants(t, rev.document, steps);
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
  const next = run.currentStep + 1;
  if (next >= steps.length) {
    await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps), status: "DONE" } });
    const rev = await db.revision.findUniqueOrThrow({ where: { id: run.revisionId }, include: { document: true } });
    await audit({ tenant: t, actor: user, action: "WORKFLOW_COMPLETED", entityType: "WorkflowRun", entityId: runId, entityLabel: `${rev.document.docNumber} rev ${rev.value}`, detail: "Binding verdict permits release — ready for release by the control function." });
    const contributorIds = await contributorRecipients(t, rev.document.createdById, rev.document.originator);
    await notifyMany(contributorIds, "WORKFLOW_DONE", `Workflow complete: ${rev.document.docNumber} rev ${rev.value}`, "All steps are done. The control function can now release it.", `/documents/${rev.documentId}`, t);
    const controllers = await holdersOf(t, "CONTROL");
    await notifyMany(controllers.map((c) => c.id), "RELEASE_READY", `Ready to release: ${rev.document.docNumber} rev ${rev.value}`, `Workflow "${run.templateName}" completed.`, `/documents/${rev.documentId}`, t);
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
export async function recordStepOutcome(t: Tenant, runId: string, user: SessionUser, outcomeCode: string, note?: string, proposedStatus?: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  const { db, projectId } = t;
  const run = await db.workflowRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "ACTIVE") return { ok: false, error: "This workflow is not active." };
  const steps = parseSteps(run.steps);
  const step = steps[run.currentStep];
  if (!step || step.status !== "active") return { ok: false, error: "No active step to decide on." };
  if (!step.participantIds.includes(user.id)) return { ok: false, error: "Only a participant of this step records its verdict." };

  const rev = await db.revision.findUniqueOrThrow({ where: { id: run.revisionId }, include: { document: true } });
  const label = `${rev.document.docNumber} rev ${rev.value}`;
  const outcomeSetKey = step.outcomeSetKey ?? VERDICT_SET;
  /** Closing a step ends the review interval; only a verdict that sends the revision back returns it to its author. */
  const closed = (toAuthor: boolean) => ({ returnedFromReviewAt: new Date(), returnedToOriginatorAt: toAuthor ? new Date() : null, status: "CLOSED" });

  const verdict = await verdictMeaning(t, outcomeSetKey, outcomeCode);
  if (!verdict) return { ok: false, error: `Choose an active verdict from ${outcomeSetKey}.` };
  // The last step decides; every earlier step advises.
  const decides = run.currentStep === steps.length - 1;
  const returnsToAuthor = !verdict.proceed;
  // Within the deciding step, whose verdict binds depends on how it decides:
  // serial and consolidated steps bind on their last person; the others on everyone.
  const binds = decides && bindsOnStep(step, user.id);
  // The deciders say what the revision may be used for; the control function
  // releases at exactly that and cannot change it.
  if (binds && !returnsToAuthor) {
    if (!proposedStatus) return { ok: false, error: "Say what this revision may be used for once released — “to be IFC”, for instance." };
    const published = await t.db.configValue.findFirst({ where: { setKey: "STATUSES", code: proposedStatus, status: "ACTIVE" } });
    if (!published) return { ok: false, error: `“${proposedStatus}” is not one of the published statuses.` };
    await t.db.revision.update({ where: { id: rev.id }, data: { proposedStatus } });
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

  // What this person's comments amount to is one fact, said once. Advice must
  // match the comments they left; a verdict that returns the revision, or
  // carries comments into the next one, must say what has to change.
  const own = step.cycleId
    ? await db.reviewComment.findMany({ where: { cycleId: step.cycleId, authorId: user.id }, select: { progressionPreventing: true } })
    : [];
  const blocking = own.filter((c) => c.progressionPreventing).length;
  if (verdict.advice) {
    if (verdict.comments === "none" && own.length) return { ok: false, error: `You left ${own.length} comment${own.length > 1 ? "s" : ""} on this revision. Choose “Comments, not blocking”, or “Comments, blocking” if one of them must be settled first.` };
    if (verdict.comments === "some" && !own.length) return { ok: false, error: "You have not written a comment. Write one, or choose “Nothing to say”." };
    if (verdict.comments === "some" && blocking) return { ok: false, error: "One of your comments is marked blocking, so your advice is “Comments, blocking”." };
    if (verdict.comments === "blocking" && !blocking) return { ok: false, error: "None of your comments is marked blocking. Mark the one that must be settled, or choose “Comments, not blocking”." };
  }
  if (binds && returnsToAuthor && !note && !blocking) return { ok: false, error: `${verdict.label} goes back to the author — say what must change, or mark the blocking comment that says it.` };
  if (binds && !returnsToAuthor && verdict.resubmit && !note) {
    const written = await db.reviewComment.count({ where: { cycle: { revisionId: run.revisionId } } });
    if (!written) return { ok: false, error: `${verdict.label} carries comments into the next revision, so there must be comments. Write them, or choose the verdict that accepts it outright.` };
  }

  const finishBindingDecision = async () => {
    if (!decides) return advance(t, runId, user);
    if (returnsToAuthor) return returnWorkflow(t, runId, user, `${verdict.label}${note ? ` — ${note}` : ""}`);
    await recordApproval(t, rev.id, user, `Binding verdict ${verdict.code} — ${verdict.label}${note ? `: ${note}` : ""}`);
    return advance(t, runId, user);
  };

  // A note is kept as a comment so it reads with the rest; an empty one is not
  // worth a row, and an empty row would make "accepted with comments" look
  // like it carried comments.
  if (step.cycleId && note) {
    await db.reviewComment.create({
      data: { projectId, cycleId: step.cycleId, authorId: user.id, authorName: user.name, text: note, classification: "NON_BLOCKING", progressionPreventing: false, status: "CLOSED", resolution: note, closedAt: new Date() },
    });
  }
  step.decidedBy = [...(step.decidedBy ?? []), user.id];

  if (step.mode === "ANY_OF") {
    await db.reviewCycle.update({ where: { id: step.cycleId }, data: { outcome: outcomeCode, outcomeAt: new Date(), outcomeByName: user.name, outcomeNote: note ?? null, ...closed(decides && returnsToAuthor) } });
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
      await db.reviewCycle.update({ where: { id: step.cycleId }, data: { outcome: outcomeCode, outcomeAt: new Date(), outcomeByName: user.name, outcomeNote: note ?? null, ...closed(decides && returnsToAuthor) } });
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
    await db.reviewCycle.update({ where: { id: step.cycleId }, data: { outcome: worst.code, outcomeAt: new Date(), outcomeByName: user.name, outcomeNote: note ?? null, ...closed(decides && worst.returns) } });
    if (decides && worst.returns) await returnWorkflow(t, runId, user, "The deciders asked for changes.");
    else if (decides) { await recordApproval(t, rev.id, user, `Binding verdict ${worst.code}`); await advance(t, runId, user); }
    else await advance(t, runId, user);
    return { ok: true, message: decides ? `All verdicts in — ${label} decided.` : `All inputs in — ${label} moves to the decider.` };
  }

  // ALL_CONSOLIDATOR
  await db.reviewAssignment.updateMany({ where: { cycleId: step.cycleId, userId: user.id }, data: { completedAt: new Date() } });
  const othersDone = step.participantIds.slice(0, -1).every((p) => step.decidedBy!.includes(p));
  const consolidator = step.participantIds[step.participantIds.length - 1];
  if (user.id === consolidator && othersDone) {
    await db.reviewCycle.update({ where: { id: step.cycleId }, data: { outcome: outcomeCode, outcomeAt: new Date(), outcomeByName: user.name, outcomeNote: note ?? null, ...closed(decides && returnsToAuthor) } });
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
