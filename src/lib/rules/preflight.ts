import "server-only";
import { requireScope, type Scope } from "../scope";
import {
  gatesFor,
  summarise,
  INTENT_VERB,
  INTENT_LABEL,
  type GateContext,
  type GateLine,
  type Intent,
  type Preflight,
  type Subject,
} from "./registry";
import "./gates";

/**
 * Ask whether an act is allowed, before anyone commits to it.
 *
 * Requirement 3 of the rebuild: the person should always know whether what they
 * are doing is OK. That means the answer has to be available *before* the
 * button, not only as an error after it — and it has to be the same answer the
 * act itself will give, or the screen is lying.
 *
 * So both sides call this. The screen renders it as a checklist; the action
 * calls `enforce()` and refuses with the same words.
 */

function contextFrom(scope: Scope): GateContext {
  return {
    orgId: scope.orgId,
    projectId: scope.projectId,
    db: scope.db,
    user: scope.user,
    can: scope.can,
    why: scope.why,
  };
}

export async function preflight(intent: Intent, subject: Subject, scope?: Scope): Promise<Preflight> {
  const ctx = scope ?? (await requireScope());
  const gateCtx = contextFrom(ctx);
  const lines: GateLine[] = [];

  // The verb comes first: without it the rest of the checklist is noise, since
  // nothing on it would make the act permitted.
  const verb = INTENT_VERB[intent];
  const target = await classOf(ctx, subject);
  if (!ctx.can(verb, target)) {
    lines.push({
      id: "PERM",
      title: `You may ${INTENT_LABEL[intent].toLowerCase()}`,
      clause: "§1.4 · §11.8",
      verdict: "BLOCK",
      message: ctx.why(verb, target),
      remedy: "Your function decides this. An administrator can change it in Functions & permissions.",
    });
    return summarise(intent, lines);
  }
  lines.push({
    id: "PERM",
    title: `You may ${INTENT_LABEL[intent].toLowerCase()}`,
    clause: "§1.4",
    verdict: "OK",
    message: `${ctx.actor.functionName} holds this.`,
  });

  for (const gate of gatesFor(intent)) {
    try {
      const outcome = await gate.evaluate(gateCtx, subject);
      lines.push({ id: gate.id, title: gate.title, clause: gate.clause, ...outcome });
    } catch (e) {
      // A gate that cannot answer must not be read as permission.
      lines.push({
        id: gate.id,
        title: gate.title,
        clause: gate.clause,
        verdict: "BLOCK",
        message: `This could not be checked: ${e instanceof Error ? e.message : "unknown error"}.`,
        remedy: "Reload and try again; if it persists it is a fault worth reporting.",
      });
    }
  }

  return summarise(intent, lines);
}

/** The classification the permission matrix should be asked about. */
async function classOf(scope: Scope, subject: Subject) {
  if (subject.revisionId) {
    const rev = await scope.db.revision.findFirst({
      where: { id: subject.revisionId },
      select: { document: { select: { deliverableType: true, docType: true, discipline: true, criticality: true, confidentiality: true } } },
    });
    return rev?.document ?? null;
  }
  if (subject.documentId) {
    return scope.db.document.findFirst({
      where: { id: subject.documentId },
      select: { deliverableType: true, docType: true, discipline: true, criticality: true, confidentiality: true },
    });
  }
  return null;
}

/**
 * The same question, asked by the act itself. Throws with the reason so the
 * refusal a person sees is word for word what the checklist showed them.
 */
export async function enforce(intent: Intent, subject: Subject, scope?: Scope): Promise<Preflight> {
  const result = await preflight(intent, subject, scope);
  if (!result.ok) {
    const first = result.blocked[0];
    throw new Error(first.remedy ? `${first.message} ${first.remedy}` : first.message);
  }
  return result;
}

export type { Preflight, Intent, Subject };
