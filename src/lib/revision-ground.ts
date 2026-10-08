import type { Tenant } from "./tenant";
import { verdictMeaning } from "./verdict";
import { legacyDocument } from "./api/legacy";

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

export async function revisionGround(t: Tenant, documentId: string): Promise<RevisionGround> {
  const doc = await legacyDocument(t, documentId);
  const last = doc?.revisions[0];
  if (!last) return { kind: "FIRST" };

  // Sent back by Document Control, at the gate or on arrival.
  if (last.backend.state === "CORRECTING" || (last.state === "RETURNED" && last.backend.controlOutcome && !last.cycles.some((c) => c.outcome))) {
    return { kind: "ASKED", why: `Sent back by Document Control: ${last.returnedReason ?? "see the record"}`, comments: 0 };
  }

  // The binding verdict, read for what it does rather than for its code: an
  // organization names its own verdicts.
  const cycle = [...last.cycles].reverse().find((c) => c.binding && c.outcome);
  if (cycle?.outcome) {
    const meaning = await verdictMeaning(t, "REVIEW_OUTCOMES", cycle.outcome);
    if (meaning?.resubmit) {
      return { kind: "ASKED", why: `Review verdict ${meaning.code} — ${meaning.label}`, comments: cycle.comments.length };
    }
  }
  if (last.state === "RETURNED") return { kind: "ASKED", why: `Sent back: ${last.returnedReason ?? "see the record"}`, comments: 0 };
  return { kind: "OWN" };
}
