import type { Tenant } from "./tenant";
import { can, confidentialityLevel, type DocumentClass, type Rule, type Verb } from "./permissions";
import { VERBS } from "./permissions";

/**
 * §11.8 — "The organization shall define, before issue, who receives which
 * information and for what reason. Distribution shall be defined by
 * classification and recipient role, not decided per transmittal."
 *
 * So distribution is not a second list to maintain: it is the permission matrix
 * read through the RECEIVE verb. Everyone whose function grants RECEIVE for a
 * document's classification — and whose clearance reaches it — is on the
 * distribution for it. Issuing outside that set is still possible, but §11.8
 * requires the reason to be recorded, which is what `offDistribution` marks.
 */

export type Recipient = {
  userId: string;
  name: string;
  email: string;
  functionName: string;
  /** Why they are on the list, in one phrase. */
  basis: string;
};

function parseVerbs(json: string): Verb[] {
  try {
    const raw = JSON.parse(json) as unknown;
    return Array.isArray(raw) ? VERBS.filter((v) => raw.includes(v)) : [];
  } catch {
    return [];
  }
}

/**
 * Who should receive this class of information, derived from the matrix.
 * Members of the current project only — distribution is a project act.
 */
export async function recipientsFor(t: Tenant, target: DocumentClass): Promise<Recipient[]> {
  const [memberships, confidentialityValues] = await Promise.all([
    t.db.projectMembership.findMany({
      where: { projectId: t.projectId, active: true, user: { active: true }, function: { active: true } },
      include: { user: { select: { id: true, name: true, email: true } }, function: { include: { rules: true } } },
    }),
    t.db.configValue.findMany({ where: { setKey: "CONFIDENTIALITY" }, select: { code: true, props: true } }),
  ]);

  const levels = new Map<string, number>();
  for (const value of confidentialityValues) {
    if (!value.props) continue;
    try {
      const level = (JSON.parse(value.props) as { level?: unknown }).level;
      if (typeof level === "number") levels.set(value.code, level);
    } catch {
      /* not a declared level */
    }
  }

  const out: Recipient[] = [];
  for (const m of memberships) {
    const rules: Rule[] = m.function.rules.map((r) => ({
      deliverableType: r.deliverableType,
      docType: r.docType,
      discipline: r.discipline,
      criticality: r.criticality,
      confidentiality: r.confidentiality,
      verbs: parseVerbs(r.verbs),
    }));
    const actor = {
      functionId: m.functionId,
      functionCode: m.function.code,
      functionName: m.function.name,
      clearance: m.function.clearance,
      legacyRole: m.function.legacyRole,
      levels,
      rules,
    };
    if (!can(actor, "RECEIVE", target)) continue;
    out.push({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      functionName: m.function.name,
      basis: `${m.function.name} receives this classification (§11.8)`,
    });
  }

  return out.sort((a, b) => a.functionName.localeCompare(b.functionName) || a.name.localeCompare(b.name));
}

/**
 * Which of the chosen recipients are outside the defined distribution. §11.8:
 * "Where information is issued outside the defined distribution, the reason
 * shall be recorded."
 */
export async function offDistribution(
  t: Tenant,
  target: DocumentClass,
  chosenUserIds: string[],
): Promise<Recipient[]> {
  const onList = new Set((await recipientsFor(t, target)).map((r) => r.userId));
  const strangers = chosenUserIds.filter((id) => !onList.has(id));
  if (!strangers.length) return [];

  const users = await t.db.user.findMany({
    where: { id: { in: strangers } },
    select: { id: true, name: true, email: true },
  });
  return users.map((u) => ({
    userId: u.id,
    name: u.name,
    email: u.email,
    functionName: "—",
    basis: "Not on the defined distribution — a reason must be recorded (§11.8)",
  }));
}

/** Confidentiality ordering, re-exported so callers need only this module. */
export { confidentialityLevel };
