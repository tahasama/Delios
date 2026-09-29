import type { Prisma } from "@prisma/client";
import type { Tenant } from "./tenant";
import { OUTCOME_CONSEQUENCES } from "./standard";

/**
 * Verdict codes whose consequence is that the work may not proceed.
 *
 * The decider's verdict is the whole answer. An adviser may leave a comment
 * marked blocking, and the decider weighs it — but what stops work is the
 * verdict recorded against the revision, not the comment behind it.
 *
 * The four consequences of the Standard are the floor; an organization that
 * publishes its own outcome list says, per code, whether work proceeds.
 */
export async function haltingVerdicts(t: Tenant): Promise<string[]> {
  const rows = await t.db.configValue.findMany({ where: { setKey: "REVIEW_OUTCOMES" }, select: { code: true, props: true } });
  const codes = new Set<string>();
  for (const [code, one] of Object.entries(OUTCOME_CONSEQUENCES)) if (!one.proceed) codes.add(code);
  for (const row of rows) {
    let props: Record<string, unknown> = {};
    if (row.props) {
      try { props = JSON.parse(row.props) as Record<string, unknown>; } catch { /* a malformed prop is not a verdict */ }
    }
    if (props.proceed === true) codes.delete(row.code);
    else if (props.proceed === false) codes.add(row.code);
  }
  return [...codes];
}

/**
 * Released, and a binding verdict on it says the work may not proceed — a
 * recipient's review that came back "revise and resubmit" is the usual case.
 * Advice cycles are left out: their answers come from another list and bind
 * nobody.
 */
export async function haltedWhere(t: Tenant): Promise<Prisma.RevisionWhereInput> {
  return { state: "RELEASED", cycles: { some: { binding: true, outcome: { in: await haltingVerdicts(t) } } } };
}
