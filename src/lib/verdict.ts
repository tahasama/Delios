import type { Tenant } from "./tenant";
import type { SessionUser } from "./auth";
import { hasVerb } from "./auth";
import { audit, notify } from "./audit";

// The one decision on a revision in review: its binding verdict. A binding
// verdict that permits release is recorded as the release approval, under the
// approval authority rule — so a verdict and an approval can never disagree.
// Kept free of request-only imports so scripts can run the same rule.

/**
 * What a verdict code means, from the set the cycle uses. `proceed` is the
 * published property that decides whether the verdict permits release.
 */
export async function verdictMeaning(t: Pick<Tenant, "db">, setKey: string | null | undefined, code: string) {
  const row = await t.db.configValue.findFirst({ where: { setKey: setKey ?? "REVIEW_OUTCOMES", code, status: "ACTIVE" } });
  if (!row) return null;
  let props: { proceed?: boolean; resubmit?: boolean } = {};
  try { props = row.props ? JSON.parse(row.props) : {}; } catch { props = {}; }
  return { code: row.code, label: row.label, proceed: props.proceed === true, resubmit: props.resubmit === true };
}

/**
 * The one decision. A binding verdict that permits release, given on a
 * revision in review, IS the release approval: it is recorded as the approval,
 * under the same authority rule (Approve for the class in the distribution
 * matrix, or a live delegation). Nobody approves separately, so a verdict and
 * an approval can never disagree.
 */
export async function assertMayGiveBindingVerdict(t: Tenant, revisionId: string, user: SessionUser) {
  const rev = await t.db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
  if (rev.state !== "IN_REVIEW") return;
  const scoped = t as Tenant & { can?: (verb: "APPROVE", target: typeof rev.document) => boolean };
  const holds = scoped.can ? scoped.can("APPROVE", rev.document) : hasVerb(user, "APPROVE");
  if (holds) return;
  const del = await t.db.delegation.findFirst({ where: { toUserId: user.id, endDate: { gte: new Date() } } });
  if (!del) throw new Error(`Only someone who may approve ${rev.document.docNumber} can give the binding verdict that releases it — ${user.name} may not (distribution matrix).`);
}

/**
 * The version of the distribution matrix an approval was given under: 1 for
 * the matrix as first published, plus one for each approved change to it.
 */
export async function matrixVersionInForce(t: Tenant): Promise<number> {
  return 1 + (await t.db.controlledVersion.count({ where: { state: { in: ["APPROVED", "SUPERSEDED"] }, set: { kind: "DISTRIBUTION_MATRIX", orgId: t.orgId } } }));
}

export async function recordApproval(t: Tenant, revisionId: string, user: SessionUser, note?: string) {
  const { db, projectId } = t;
  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
  const label = `${rev.document.docNumber} rev ${rev.value}`;
  if (rev.state !== "IN_REVIEW") throw new Error("Approvals are recorded against a revision in review.");
  // §8.2 — authority for a class is the Approve grant in the distribution
  // matrix for that class. Without it, only a live delegation lets someone act (§8.5).
  const scoped = t as Tenant & { can?: (verb: "APPROVE", target: typeof rev.document) => boolean };
  const holds = scoped.can ? scoped.can("APPROVE", rev.document) : hasVerb(user, "APPROVE");
  let viaDelegation = false;
  if (!holds) {
    const del = await db.delegation.findFirst({ where: { toUserId: user.id, endDate: { gte: new Date() } } });
 if (!del) throw new Error(`${user.name} does not hold Approve for this class in the distribution matrix, and no delegation is in force.`);
    viaDelegation = true;
  }
  const matrixVersion = await matrixVersionInForce(t);
  const approval = await db.approval.create({
    data: { projectId,
      revisionId,
      approverId: user.id,
      approverName: user.name,
      approverRole: (user.functionName ?? user.role) + (viaDelegation ? " (by delegation)" : ""),
      matrixVersion,
      note: note ?? null,
    },
  });
  await audit({
    tenant: t,
    actor: user,
    action: "APPROVAL",
    entityType: "Revision",
    entityId: revisionId,
    entityLabel: label,
    detail: `Approved as ${user.functionName ?? user.role} under distribution matrix v${matrixVersion}${viaDelegation ? " via delegation" : ""}.`,
  });
  await notify(rev.document.createdById, "APPROVAL", `Verdict permits release: ${label}`, `${user.name} gave the binding verdict.`, `/documents/${rev.documentId}`, t);
  return approval;
}

