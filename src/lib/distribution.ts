import { confidentialityLevel, type DocumentClass } from "./permissions";
import { holders } from "./api/settings";
import { adminUsers, orEmpty } from "./api/admin";

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

/**
 * Who should receive this class of information, derived from the matrix: the
 * backend's holders of RECEIVE for it, on the current project only —
 * distribution is a project act.
 */
export async function recipientsFor(t: { projectId: string }, target: DocumentClass): Promise<Recipient[]> {
  const [found, users] = await Promise.all([
    holders(t.projectId, "RECEIVE", target.deliverableType, target.docType, target.discipline, target.criticality, target.confidentiality),
    orEmpty(adminUsers),
  ]);
  const email = new Map(users.map((u) => [u.id, u.email] as const));
  return found
    .map((h) => ({
      userId: h.id,
      name: h.name,
      email: email.get(h.id) ?? "",
      functionName: h.functionName,
      basis: `${h.functionName} receives this classification`,
    }))
    .sort((a, b) => a.functionName.localeCompare(b.functionName) || a.name.localeCompare(b.name));
}

/**
 * Which of the chosen recipients are outside the defined distribution. §11.8:
 * "Where information is issued outside the defined distribution, the reason
 * shall be recorded."
 */
export async function offDistribution(
  t: { projectId: string },
  target: DocumentClass,
  chosenUserIds: string[],
): Promise<Recipient[]> {
  const onList = new Set((await recipientsFor(t, target)).map((r) => r.userId));
  const strangers = chosenUserIds.filter((id) => !onList.has(id));
  if (!strangers.length) return [];

  const users = (await orEmpty(adminUsers)).filter((u) => strangers.includes(u.id));
  return users.map((u) => ({
    userId: u.id,
    name: u.name,
    email: u.email,
    functionName: "—",
 basis: "Not on the defined distribution — a reason must be recorded",
  }));
}

/** Confidentiality ordering, re-exported so callers need only this module. */
export { confidentialityLevel };
