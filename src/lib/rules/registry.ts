import type { Tenant } from "../tenant";
import type { SessionUser } from "../auth";
import type { Verb } from "../permissions";

/**
 * Gates: the preconditions for an act, stated once and asked twice.
 *
 * Every one of these already existed, buried as a `throw` inside the function
 * that performs the act. That works, but it only ever answers *after* someone
 * has committed to trying — which is the opposite of telling them whether what
 * they are about to do is allowed.
 *
 * A gate is the same condition written declaratively, so it can be evaluated
 * before the act as well as during it. `preflight()` runs them for a checklist;
 * the action runs them again before it writes. One definition, no drift.
 */

export const INTENTS = [
  "CREATE_DOCUMENT",
  "CREATE_REVISION",
  "SUBMIT_FOR_REVIEW",
  "RECORD_OUTCOME",
  "APPROVE",
  "RELEASE",
  "ISSUE",
  "ACCEPT_TRANSMITTAL",
  "VOID",
  "WITHDRAW",
] as const;
export type Intent = (typeof INTENTS)[number];

export const INTENT_LABEL: Record<Intent, string> = {
  CREATE_DOCUMENT: "Create a document",
  CREATE_REVISION: "Start a revision",
  SUBMIT_FOR_REVIEW: "Send for review",
  RECORD_OUTCOME: "Record a review outcome",
  APPROVE: "Approve",
  RELEASE: "Release",
  ISSUE: "Issue a transmittal",
  ACCEPT_TRANSMITTAL: "Accept a transmittal",
  VOID: "Void a revision",
  WITHDRAW: "Withdraw a document",
};

/** The verb someone must hold before the act is even considered. */
export const INTENT_VERB: Record<Intent, Verb> = {
  CREATE_DOCUMENT: "CREATE",
  CREATE_REVISION: "REVISE",
  SUBMIT_FOR_REVIEW: "REVISE",
  RECORD_OUTCOME: "REVIEW",
  APPROVE: "APPROVE",
  RELEASE: "CONTROL",
  ISSUE: "TRANSMIT",
  ACCEPT_TRANSMITTAL: "ACCEPT",
  VOID: "CONTROL",
  WITHDRAW: "CONTROL",
};

export type Verdict = "OK" | "WARN" | "BLOCK";

export type GateOutcome = {
  verdict: Verdict;
  /** What is true right now, in one line. */
  message: string;
  /** What to do about it, when it is not OK. */
  remedy?: string;
};

/** What the act is about. Gates read only the parts they need. */
export type Subject = {
  documentId?: string;
  revisionId?: string;
  cycleId?: string;
  transmittalId?: string;
  /** Intent-specific input the person has chosen but not yet committed. */
  statusCode?: string;
  outcomeCode?: string;
};

export type GateContext = Tenant & {
  user: SessionUser;
  can: (verb: Verb, target?: { discipline?: string | null; docType?: string | null; deliverableType?: string | null; criticality?: string | null; confidentiality?: string | null } | null) => boolean;
  why: (verb: Verb, target?: { discipline?: string | null; docType?: string | null; deliverableType?: string | null; criticality?: string | null; confidentiality?: string | null } | null) => string;
};

export type Gate = {
  id: string;
  intent: Intent;
  /** Short label for the checklist line. */
  title: string;
  clause: string;
  /** The Annex H check this prevents, where one exists — keeps the two traceable. */
  preventsCheck?: string;
  evaluate(ctx: GateContext, subject: Subject): Promise<GateOutcome>;
};

const GATES: Gate[] = [];

export function registerGate(gate: Gate) {
  GATES.push(gate);
}

export function gatesFor(intent: Intent): Gate[] {
  return GATES.filter((g) => g.intent === intent);
}

export function allGates(): Gate[] {
  return [...GATES];
}

// ── The verdict ──────────────────────────────────────────────────────────────

export type GateLine = GateOutcome & { id: string; title: string; clause: string };

export type Preflight = {
  intent: Intent;
  label: string;
  /** True when nothing blocks. Warnings do not block. */
  ok: boolean;
  blocked: GateLine[];
  warnings: GateLine[];
  passed: GateLine[];
  /** One sentence for a button tooltip or a refusal message. */
  summary: string;
};

export function summarise(intent: Intent, lines: GateLine[]): Preflight {
  const blocked = lines.filter((l) => l.verdict === "BLOCK");
  const warnings = lines.filter((l) => l.verdict === "WARN");
  const passed = lines.filter((l) => l.verdict === "OK");
  const label = INTENT_LABEL[intent];

  let summary: string;
  if (blocked.length === 1) summary = blocked[0].message;
  else if (blocked.length > 1) summary = `${blocked.length} things block this: ${blocked.map((b) => b.title).join(", ")}.`;
  else if (warnings.length) summary = `You can ${label.toLowerCase()}, with ${warnings.length} thing(s) to note.`;
  else summary = `Ready to ${label.toLowerCase()}.`;

  return { intent, label, ok: blocked.length === 0, blocked, warnings, passed, summary };
}

// ── Small helpers gates share ────────────────────────────────────────────────

export const ok = (message: string): GateOutcome => ({ verdict: "OK", message });
export const warn = (message: string, remedy?: string): GateOutcome => ({ verdict: "WARN", message, remedy });
export const block = (message: string, remedy?: string): GateOutcome => ({ verdict: "BLOCK", message, remedy });
