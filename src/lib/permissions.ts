import type { Tenant } from "./tenant";

/**
 * What someone may do, decided by the function they hold on the project rather
 * than by a rank attached to the person (§1.4 — "Ownership is by role, not by
 * individual").
 *
 * One table drives every answer. §11.8 requires distribution to be "defined by
 * classification and recipient role, not decided per transmittal", which is the
 * same statement as "who may approve this?" addressed to a different verb — so
 * approval authority and distribution are read from the same rules rather than
 * maintained as two matrices that drift apart.
 */

/**
 * Before a project is chosen there is no function to read, so the account's
 * standing role stands in. Everywhere inside a project the matrix decides and
 * this table is never consulted.
 */
export const ROLE_FALLBACK_VERBS: Record<string, string[]> = {
  ADMIN: ["READ", "CREATE", "REVISE", "REVIEW", "APPROVE", "TRANSMIT", "RECEIVE", "ACCEPT", "CONTROL", "CONFIGURE"],
  CONTROLLER: ["READ", "CREATE", "REVISE", "TRANSMIT", "RECEIVE", "ACCEPT", "CONTROL"],
  APPROVER: ["READ", "REVIEW", "APPROVE", "RECEIVE"],
  REVIEWER: ["READ", "REVIEW", "RECEIVE"],
  AUTHOR: ["READ", "CREATE", "REVISE", "RECEIVE"],
  VIEWER: ["READ"],
};

/** The verbs this person holds: the project function's, or the role's until one exists. */
export function heldVerbs(user: { verbs?: string[]; role?: string } | null | undefined): string[] {
  if (!user) return [];
  return user.verbs ?? ROLE_FALLBACK_VERBS[user.role ?? ""] ?? [];
}

export const VERBS = [
  "READ",
  "CREATE",
  "REVISE",
  "REVIEW",
  "APPROVE",
  "TRANSMIT",
  "RECEIVE",
  "ACCEPT",
  "CONTROL",
  "CONFIGURE",
  "PLAN",
  "ROUTES",
  "MATRIX",
] as const;
export type Verb = (typeof VERBS)[number];

export const VERB_LABEL: Record<Verb, string> = {
  READ: "Read",
  CREATE: "Create",
  REVISE: "Revise",
  REVIEW: "Review",
  APPROVE: "Approve",
  TRANSMIT: "Transmit",
  RECEIVE: "Receive",
  ACCEPT: "Accept",
  CONTROL: "Control",
  CONFIGURE: "Configure",
  PLAN: "Plan",
  ROUTES: "Review routes",
  MATRIX: "Read matrix",
};

export const VERB_BLURB: Record<Verb, string> = {
  READ: "See the document and open its files.",
  CREATE: "Raise a new register entry.",
  REVISE: "Start a new revision and submit it.",
  REVIEW: "Be assigned a review and record comments.",
 APPROVE: "Record the approval decision.",
 TRANSMIT: "Issue it to another party.",
 RECEIVE: "Be named on the distribution for it.",
 ACCEPT: "Run the acceptance check on an incoming transmittal.",
  CONTROL: "Act as the control function: release, supersede, withdraw.",
  CONFIGURE: "Publish value sets, schemes, people and this matrix.",
  PLAN: "Project manager: tag the departments each scheduled activity concerns.",
  ROUTES: "Create and edit review routes (workflow templates).",
  MATRIX: "Read this distribution matrix without being able to change it.",
};

/**
 * Verbs about the organization's own set-up rather than a document class. An
 * administrator (Configure) holds them all; anyone else holds one only where
 * the matrix grants it — which is how an administrator authorizes Document
 * Control to read the matrix or maintain review routes.
 */
export const ORGANIZATION_VERBS: Verb[] = ["PLAN", "ROUTES", "MATRIX"];

export function implies(held: readonly string[], verb: Verb): boolean {
  return held.includes(verb) || (ORGANIZATION_VERBS.includes(verb) && held.includes("CONFIGURE"));
}

/**
 * §5.7 — confidentiality as an ordered scale. The organization's own levels
 * come from the CONFIDENTIALITY value set's `level` property; this ordering is
 * the fallback when a value has not declared one.
 */
export const DEFAULT_CONFIDENTIALITY_LEVEL: Record<string, number> = {
  PUBLIC: 1,
  INTERNAL: 2,
  RESTRICTED: 3,
  CONFIDENTIAL: 4,
  SECRET: 5,
};

/**
 * The confidentiality codes open to everybody on the project.
 *
 * A level at or below the one marked as the default — Internal, in the
 * reference configuration — is the ordinary register: everyone who reaches the
 * project reads it. Anything above it is closed, and closed means read by the
 * people named on the document itself, one by one, and by nobody else.
 */
export function openConfidentiality(
  values: { code: string; props?: Record<string, unknown> }[],
): string[] {
  const levels = new Map(values.map((one) => [one.code, typeof one.props?.level === "number" ? (one.props.level as number) : DEFAULT_CONFIDENTIALITY_LEVEL[one.code.toUpperCase()] ?? 1]));
  const marked = values.filter((one) => one.props?.default === true).map((one) => levels.get(one.code) ?? 2);
  const ceiling = marked.length ? Math.max(...marked) : 2;
  return values.filter((one) => (levels.get(one.code) ?? 1) <= ceiling).map((one) => one.code);
}

export function confidentialityLevel(
  code: string | null | undefined,
  levels?: Map<string, number>,
): number {
  if (!code) return 1;
  const declared = levels?.get(code);
  if (typeof declared === "number") return declared;
  return DEFAULT_CONFIDENTIALITY_LEVEL[code.toUpperCase()] ?? 1;
}

// ── The actor ────────────────────────────────────────────────────────────────

/** The class of a document, as far as the matrix is concerned. */
export type DocumentClass = {
  deliverableType?: string | null;
  docType?: string | null;
  discipline?: string | null;
  criticality?: string | null;
  confidentiality?: string | null;
};

export type Rule = {
  deliverableType: string | null;
  docType: string | null;
  discipline: string | null;
  criticality: string | null;
  confidentiality: string | null;
  verbs: Verb[];
};

export type Actor = {
  functionId: string;
  functionCode: string;
  functionName: string;
  clearance: number;
  legacyRole: string;
  rules: Rule[];
  /** Confidentiality code → level, as this organization published it. */
  levels: Map<string, number>;
};

function parseVerbs(json: string): Verb[] {
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw.filter((v): v is Verb => (VERBS as readonly string[]).includes(v));
  } catch {
    return [];
  }
}

/**
 * Load the function and its rules. Cheap enough to do per request: one function
 * row and its handful of rules.
 */
export async function loadActor(t: Tenant, functionId: string): Promise<Actor | null> {
  const [fn, rules, confidentialityValues] = await Promise.all([
    t.db.function.findFirst({ where: { id: functionId } }),
    t.db.permissionRule.findMany({ where: { functionId }, orderBy: { sort: "asc" } }),
    t.db.configValue.findMany({ where: { setKey: "CONFIDENTIALITY" }, select: { code: true, props: true } }),
  ]);
  if (!fn || !fn.active) return null;

  const levels = new Map<string, number>();
  for (const value of confidentialityValues) {
    if (!value.props) continue;
    try {
      const level = (JSON.parse(value.props) as { level?: unknown }).level;
      if (typeof level === "number") levels.set(value.code, level);
    } catch {
      /* a malformed property is simply not a declared level */
    }
  }

  return {
    functionId: fn.id,
    functionCode: fn.code,
    functionName: fn.name,
    clearance: fn.clearance,
    legacyRole: fn.legacyRole,
    levels,
    rules: rules.map((r) => ({
      deliverableType: r.deliverableType,
      docType: r.docType,
      discipline: r.discipline,
      criticality: r.criticality,
      confidentiality: r.confidentiality,
      verbs: parseVerbs(r.verbs),
    })),
  };
}

// ── The decision ─────────────────────────────────────────────────────────────

/** A rule applies when every selector it states matches. A null states nothing. */
function matches(rule: Rule, target: DocumentClass): boolean {
  const pairs: [string | null, string | null | undefined][] = [
    [rule.deliverableType, target.deliverableType],
    [rule.docType, target.docType],
    [rule.discipline, target.discipline],
    [rule.criticality, target.criticality],
    [rule.confidentiality, target.confidentiality],
  ];
  return pairs.every(([selector, value]) => selector === null || selector === value);
}

/**
 * May this actor do `verb`?
 *
 * With a target, the rules are narrowed to those whose class selectors match
 * it. Without a target the question is "anywhere at all", which is what
 * configuration and control verbs ask.
 *
 * Confidentiality is not asked here. A document above the open levels is read
 * by the people named on it — see `DocumentAccess` and the reader filter in
 * `src/lib/tenant.ts` — so a closed document never reaches this question.
 *
 * Grants accumulate: a function's rules are a union, never a precedence chain.
 * There is deliberately no deny rule — a permission someone does not hold is
 * simply absent, which is far easier to read off the matrix than a set of
 * grants and overrides.
 */
export function can(actor: Actor | null, verb: Verb, target?: DocumentClass | null): boolean {
  if (!actor) return false;
  const applicable = target ? actor.rules.filter((r) => matches(r, target)) : actor.rules;
  return applicable.some((r) => implies(r.verbs, verb));
}

/** Every verb this actor holds against a class — for explaining a decision. */
export function verbsFor(actor: Actor | null, target?: DocumentClass | null): Verb[] {
  if (!actor) return [];
  const applicable = target ? actor.rules.filter((r) => matches(r, target)) : actor.rules;
  const held = new Set<Verb>();
  for (const rule of applicable) for (const verb of rule.verbs) held.add(verb);
  return VERBS.filter((v) => held.has(v));
}

/**
 * Why a decision went the way it did, in the words the Standard uses. Feeds the
 * refusal messages, which must name the requirement and its owner (§1.4, §17.5).
 */
export function explain(actor: Actor | null, verb: Verb, target?: DocumentClass | null): string {
  if (!actor) return "You hold no function on this project.";
  if (can(actor, verb, target)) return `${actor.functionName} may ${VERB_LABEL[verb].toLowerCase()} this.`;
 return `${actor.functionName} does not hold "${VERB_LABEL[verb]}" for this classification. The permission matrix decides this, not the document.`;
}

/**
 * Everyone on this project whose function grants `verb` — optionally for one
 * document class. The replacement for "every user whose role is X": who may
 * act is read from the matrix, not from a rank on the account.
 */
export async function holdersOf(
  t: Tenant,
  verb: Verb,
  target?: DocumentClass | null,
): Promise<{ id: string; name: string; functionName: string; department: string | null }[]> {
  const members = await t.db.projectMembership.findMany({
    where: { projectId: t.projectId, active: true, user: { active: true } },
    include: { user: { select: { id: true, name: true } } },
  });
  const actors = new Map<string, Actor | null>();
  const out: { id: string; name: string; functionName: string; department: string | null }[] = [];
  for (const m of members) {
    if (!actors.has(m.functionId)) actors.set(m.functionId, await loadActor(t, m.functionId));
    const actor = actors.get(m.functionId)!;
    if (can(actor, verb, target)) out.push({ id: m.user.id, name: m.user.name, functionName: actor!.functionName, department: m.department });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
