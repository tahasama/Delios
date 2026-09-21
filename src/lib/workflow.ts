import type { Tenant } from "./tenant";
import { audit, notifyMany } from "./audit";
import type { SessionUser } from "./auth";

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
    },
  });
  const participants = await db.user.findMany({ where: { id: { in: step.participantIds } } });
  await db.reviewAssignment.createMany({
    data: participants.map((p, i) => ({ projectId, cycleId: cycle.id, userId: p.id, userName: p.name, order: i + 1 })),
  });
  const revision = await db.revision.findUniqueOrThrow({ where: { id: revisionId }, select: { documentId: true } });
  await notifyMany(step.participantIds, "REVIEW_REQUEST", `Workflow step ${seq}: ${label}`, step.act === "APPROVAL" ? "Your approval is requested." : "Your review is requested.", `/documents/${revision.documentId}`, t);
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
  const baseSteps = JSON.parse(template.steps) as WfStep[];
  if (!baseSteps.length) return { ok: false, error: "The template has no steps." };

  const proposed = await Promise.all(baseSteps.map((s) => proposeForStep(t, [rev.document], s)));
  const steps: WfRuntimeStep[] = baseSteps.map((s, i) => ({
    ...s,
    outcomeSetKey: s.act === "REVIEW" ? (s.outcomeSetKey ?? template.outcomeSetKey ?? "REVIEW_OUTCOMES") : s.outcomeSetKey,
    participantIds: overrideParticipantIds?.[i]?.length ? overrideParticipantIds[i] : proposed[i],
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
  const first = steps[0];
  if (first.act === "REVIEW") {
    const cycle = await spawnCycleForStep(t, revisionId, first, user, 1, label);
    steps[0].cycleId = cycle.id;
    await db.workflowRun.update({ where: { id: run.id }, data: { steps: JSON.stringify(steps) } });
  } else {
    await notifyMany(first.participantIds, "APPROVAL_REQUEST", `Approval requested: ${label}`, "Your approval is requested (workflow step 1).", `/documents/${rev.documentId}`, t);
  }
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
    await audit({ tenant: t, actor: user, action: "WORKFLOW_COMPLETED", entityType: "WorkflowRun", entityId: runId, entityLabel: `${rev.document.docNumber} rev ${rev.value}`, detail: "All steps complete — ready for release by the control function." });
    const contributorIds = await contributorRecipients(t, rev.document.createdById, rev.document.originator);
    await notifyMany(contributorIds, "WORKFLOW_DONE", `Workflow complete: ${rev.document.docNumber} rev ${rev.value}`, "All steps are done. The control function can now release it.", `/documents/${rev.documentId}`, t);
    const controllers = await db.user.findMany({ where: { role: { in: ["CONTROLLER", "ADMIN"] }, active: true } });
    await notifyMany(controllers.map((c) => c.id), "RELEASE_READY", `Ready to release: ${rev.document.docNumber} rev ${rev.value}`, `Workflow "${run.templateName}" completed.`, `/documents/${rev.documentId}`, t);
    return;
  }
  steps[next].status = "active";
  const nextRevision = await db.revision.findUniqueOrThrow({ where: { id: run.revisionId }, include: { document: true } });
  const label = `${nextRevision.document.docNumber} rev ${nextRevision.value}`;
  await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps), currentStep: next } });
  const step = steps[next];
  if (step.act === "REVIEW") {
    const seq = next + 1;
    const cycle = await spawnCycleForStep(t, run.revisionId, step, user, seq, label);
    steps[next].cycleId = cycle.id;
    await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps) } });
  } else {
    await notifyMany(step.participantIds, "APPROVAL_REQUEST", `Approval requested (step ${next + 1}): ${label}`, "Your approval is requested.", `/documents/${nextRevision.documentId}`, t);
  }
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
  await notifyMany(contributorIds, "WORKFLOW_RETURNED", `Changes requested: ${rev.document.docNumber} rev ${rev.value}`, `${reason} — prepare the next revision (§7.5).`, `/documents/${rev.documentId}`, t);
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
 * Record a decision on the active REVIEW step.
 * ANY_OF: the first participant's outcome closes the step.
 * SERIAL: participants decide in order; the last one's outcome is binding (§9.7).
 * ALL_CONSOLIDATOR: everyone records; the last-named participant records the binding outcome.
 */
export async function recordStepOutcome(t: Tenant, runId: string, user: SessionUser, outcomeCode: string, note?: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  const { db, projectId } = t;
  const run = await db.workflowRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "ACTIVE") return { ok: false, error: "This workflow is not active." };
  const steps = parseSteps(run.steps);
  const step = steps[run.currentStep];
  if (!step || step.status !== "active") return { ok: false, error: "No active step to decide on." };
  if (step.act !== "REVIEW") return { ok: false, error: "The active step is an approval — record the approval instead." };
  if (!step.participantIds.includes(user.id)) return { ok: false, error: "Only a participant of this step records its outcome." };

  const rev = await db.revision.findUniqueOrThrow({ where: { id: run.revisionId }, include: { document: true } });
  const label = `${rev.document.docNumber} rev ${rev.value}`;
  const outcomeSetKey = step.outcomeSetKey ?? "REVIEW_OUTCOMES";
  const outcomeValue = await db.configValue.findFirst({ where: { setKey: outcomeSetKey, code: outcomeCode } });
  if (!outcomeValue || outcomeValue.status !== "ACTIVE") return { ok: false, error: `Choose an active outcome from ${outcomeSetKey}.` };
  let consequences: { proceed?: boolean; resubmit?: boolean } = {};
  try { consequences = outcomeValue.props ? JSON.parse(outcomeValue.props) : {}; } catch { consequences = {}; }
  const returnsToAuthor = consequences.proceed === false || consequences.resubmit === true;

  const finishBindingDecision = async () => {
    if (returnsToAuthor) await returnWorkflow(t, runId, user, `${outcomeValue.label}${note ? ` — ${note}` : ""}`);
    else await advance(t, runId, user);
  };

  if (step.cycleId) {
    await db.reviewComment.create({
      data: { projectId, cycleId: step.cycleId, authorId: user.id, authorName: user.name, text: note || `(recorded outcome: ${outcomeCode})`, classification: "NON_BLOCKING", progressionPreventing: false, status: "CLOSED", resolution: note ?? undefined, closedAt: new Date() },
    });
  }
  step.decidedBy = [...(step.decidedBy ?? []), user.id];

  if (step.mode === "ANY_OF") {
    await db.reviewCycle.update({ where: { id: step.cycleId }, data: { outcome: outcomeCode, outcomeAt: new Date(), outcomeByName: user.name, outcomeNote: note ?? null, returnedFromReviewAt: new Date(), returnedToOriginatorAt: new Date(), status: "CLOSED" } });
    await finishBindingDecision();
    return { ok: true, message: `Decision recorded on ${label}.` };
  }

  if (step.mode === "SERIAL") {
    const idx = step.participantIds.indexOf(user.id);
    const before = step.participantIds.slice(0, idx);
    const decidedSet = new Set(step.decidedBy);
    const pendingBefore = before.filter((p) => !decidedSet.has(p));
    if (pendingBefore.length) return { ok: false, error: "Serial review: earlier reviewers decide first (§9.7)." };
    const isLast = idx === step.participantIds.length - 1;
    if (isLast) {
      await db.reviewCycle.update({ where: { id: step.cycleId }, data: { outcome: outcomeCode, outcomeAt: new Date(), outcomeByName: user.name, outcomeNote: note ?? null, returnedFromReviewAt: new Date(), returnedToOriginatorAt: new Date(), status: "CLOSED" } });
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
    await db.reviewCycle.update({ where: { id: step.cycleId }, data: { outcome: worst.code, outcomeAt: new Date(), outcomeByName: user.name, outcomeNote: note ?? null, returnedFromReviewAt: new Date(), returnedToOriginatorAt: new Date(), status: "CLOSED" } });
    const isLastStep = run.currentStep === steps.length - 1;
    if (isLastStep && worst.returns) await returnWorkflow(t, runId, user, "A reviewer asked for changes.");
    else await advance(t, runId, user);
    return { ok: true, message: isLastStep ? `All inputs in — ${label} decided.` : `All inputs in — ${label} moves to the next step.` };
  }

  // ALL_CONSOLIDATOR
  await db.reviewAssignment.updateMany({ where: { cycleId: step.cycleId, userId: user.id }, data: { completedAt: new Date() } });
  const othersDone = step.participantIds.slice(0, -1).every((p) => step.decidedBy!.includes(p));
  const consolidator = step.participantIds[step.participantIds.length - 1];
  if (user.id === consolidator && othersDone) {
    await db.reviewCycle.update({ where: { id: step.cycleId }, data: { outcome: outcomeCode, outcomeAt: new Date(), outcomeByName: user.name, outcomeNote: note ?? null, returnedFromReviewAt: new Date(), returnedToOriginatorAt: new Date(), status: "CLOSED" } });
    await finishBindingDecision();
    return { ok: true, message: `Consolidated decision recorded on ${label}.` };
  }
  await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps) } });
  return { ok: true, message: `Recorded — the consolidator closes this step once everyone has decided.` };
}

/** Record the approval act on an active APPROVAL step (Part 8). Declining returns the workflow. */
export async function recordStepApproval(t: Tenant, runId: string, user: SessionUser, approve: boolean, note?: string, outcomeCode?: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  const { db, projectId } = t;
  const run = await db.workflowRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "ACTIVE") return { ok: false, error: "This workflow is not active." };
  const steps = parseSteps(run.steps);
  const step = steps[run.currentStep];
  if (!step || step.status !== "active") return { ok: false, error: "No active step." };
  if (step.act !== "APPROVAL") return { ok: false, error: "The active step is a review — record the outcome instead." };
  if (!step.participantIds.includes(user.id)) return { ok: false, error: "Only a participant of this step records the approval." };
  if (approve && !note && false) return { ok: false, error: "" };

  const rev = await db.revision.findUniqueOrThrow({ where: { id: await runIdToRevision(t, runId) }, include: { document: true } });
  const label = `${rev.document.docNumber} rev ${rev.value}`;

  if (!approve) {
    if (!note) return { ok: false, error: "Declining requires a reason for the author." };
    const declineCode = outcomeCode ?? (await db.configValue.findFirst({ where: { setKey: "REVIEW_OUTCOMES", status: "ACTIVE" } }))?.code ?? "REVISE_AND_RESUBMIT";
    if (step.cycleId) {
      await db.reviewCycle.update({ where: { id: step.cycleId }, data: { outcome: declineCode, outcomeAt: new Date(), outcomeByName: user.name, outcomeNote: note, status: "CLOSED", returnedFromReviewAt: new Date(), returnedToOriginatorAt: new Date() } });
    }
    await audit({ tenant: t, actor: user, action: "REVIEW_OUTCOME", entityType: "WorkflowRun", entityId: runId, entityLabel: label, newValue: declineCode, detail: note });
    await returnWorkflow(t, runId, user, note);
    return { ok: true, message: `Declined — returned to the author with your reason.` };
  }

  // authority matrix still applies to the approval act (§8.3)
  const { recordApproval } = await import("./lifecycle");
  try {
    await recordApproval(t, rev.id, user, note);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Approval rejected." };
  }
  if (step.cycleId) {
    await db.reviewCycle.update({ where: { id: step.cycleId }, data: { status: "CLOSED", outcome: outcomeCode ?? undefined, outcomeAt: new Date(), outcomeByName: user.name, outcomeNote: note ?? null, returnedFromReviewAt: new Date(), returnedToOriginatorAt: new Date() } });
  }
  step.decidedBy = [...(step.decidedBy ?? []), user.id];
  await db.workflowRun.update({ where: { id: runId }, data: { steps: JSON.stringify(steps) } });
  await advance(t, runId, user);
  return { ok: true, message: `Approved ${label}.` };
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
  steps: { act: "REVIEW" | "APPROVAL"; participantIds: string[] }[],
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
    const verb = step.act === "APPROVAL" ? "APPROVE" : "REVIEW";
    for (const id of step.participantIds) {
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

/**
 * The people a step proposes: the template's named people plus the holders of
 * its named functions — kept only where the matrix allows them for every
 * document being sent.
 */
export async function proposeForStep(t: Tenant, docs: DocClass[], step: { act: "REVIEW" | "APPROVAL"; participantIds: string[]; functionIds?: string[] }): Promise<string[]> {
  const eligible = await eligiblePeople(t, docs, step.act);
  const ids = new Set<string>();
  for (const p of eligible) {
    if (step.participantIds.includes(p.id) || (step.functionIds ?? []).includes(p.functionId)) ids.add(p.id);
  }
  return [...ids];
}
