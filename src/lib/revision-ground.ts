import type { Tenant } from "./tenant";
import { verdictMeaning } from "./verdict";

/**
 * Why a document may have a next revision, read from what happened to the one
 * before it.
 *
 *   FIRST  — nothing has been written yet: the first revision needs no reason
 *            beyond being the first.
 *   ASKED  — the last revision was sent back, refused, or accepted with
 *            comments to carry: the verdict is the reason, and nobody has to
 *            write it again.
 *   OWN    — the last revision was accepted as it stands: nobody asked for
 *            another, so whoever starts it says why, and the reason stays
 *            visible next to the revision it follows.
 */
export type RevisionGround =
  | { kind: "FIRST" }
  | { kind: "ASKED"; why: string; comments: number }
  | { kind: "OWN" };

export async function revisionGround(t: Pick<Tenant, "db">, documentId: string): Promise<RevisionGround> {
  const last = await t.db.revision.findFirst({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    select: { id: true, state: true, returnedReason: true, heldAt: true, heldReason: true, authorizationReason: true, authorizedAt: true, createdAt: true },
  });
  if (!last) return { kind: "FIRST" };

  // Sent back by Document Control — at the gate, or refused outside while on hold.
  if (last.state === "RETURNED") return { kind: "ASKED", why: `Sent back by Document Control: ${last.returnedReason ?? "see the record"}`, comments: 0 };
  if (last.heldAt && last.heldReason?.startsWith("Not approved outside")) return { kind: "ASKED", why: last.heldReason, comments: 0 };
  // Declined on its route: the route wrote down why, on the revision itself.
  if (last.authorizationReason?.startsWith("Declined in workflow") && last.authorizedAt && last.authorizedAt > last.createdAt) {
    return { kind: "ASKED", why: last.authorizationReason, comments: 0 };
  }

  // The binding verdict, read for what it does rather than for its code: an
  // organization names its own verdicts.
  const cycle = await t.db.reviewCycle.findFirst({
    where: { revisionId: last.id, binding: true, outcome: { not: null } },
    orderBy: [{ outcomeAt: "desc" }, { sequence: "desc" }],
    select: { outcome: true, outcomeSetKey: true, comments: { select: { id: true } } },
  });
  if (cycle?.outcome) {
    const meaning = await verdictMeaning(t, cycle.outcomeSetKey, cycle.outcome);
    if (meaning?.resubmit) {
      return { kind: "ASKED", why: `Review verdict ${meaning.code} — ${meaning.label}`, comments: cycle.comments.length };
    }
  }
  return { kind: "OWN" };
}
