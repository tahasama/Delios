import { OUTCOME_CONSEQUENCES } from "./standard";
import { getSet } from "./config";
import { api, projectPath } from "./api/client";
import type { RegisterPage } from "./api/types";

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
export async function haltingVerdicts(): Promise<string[]> {
  const rows = await getSet("REVIEW_OUTCOMES");
  const codes = new Set<string>();
  for (const [code, one] of Object.entries(OUTCOME_CONSEQUENCES)) if (!one.proceed) codes.add(code);
  for (const row of rows) {
    if (row.props?.proceed === true) codes.delete(row.code);
    else if (row.props?.proceed === false) codes.add(row.code);
  }
  return [...codes];
}

/** A released revision a binding verdict says nobody may work from. */
export type HaltedRevision = { id: string; documentId: string; value: string; document: { docNumber: string; title: string }; verdict: string; decidedBy: string | null };

/**
 * Released, and the review that decided it says the work may not proceed — a
 * recipient's review that came back "revise and resubmit" is the usual case.
 * Read from the register: documents whose current revision is their newest and
 * whose newest verdict is one of those.
 */
export async function haltedRevisions(t: { projectId: string }): Promise<HaltedRevision[]> {
  const verdicts = await haltingVerdicts();
  const pages = await Promise.all(verdicts.map((verdict) =>
    api<RegisterPage>(projectPath(t, "/register"), { query: { released: true, verdict, per: 250 } })));
  return pages.flatMap((page) => page.rows)
    .filter((row) => row.releasedRevisionId && row.releasedRevisionId === row.latestRevisionId)
    .map((row) => ({
      id: row.releasedRevisionId!, documentId: row.id, value: row.releasedRevision ?? row.revision ?? "",
      document: { docNumber: row.number, title: row.title }, verdict: row.verdict ?? "", decidedBy: row.decidedBy,
    }));
}
