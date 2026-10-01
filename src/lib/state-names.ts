import { cache } from "react";
import type { Tenant } from "./tenant";
import { REV_STATE_LABEL, type RevState } from "./standard";

/**
 * What a revision state is called on screen.
 *
 * The states, their order and what each one does are fixed — the gate, holds,
 * the register and the audit trail all depend on them. What people read is the
 * organization's: "Released" may be "Approved" somewhere else, and nothing
 * else changes. An organization that renames nothing reads the defaults.
 *
 * Besides the revision states there are the names a released revision is read
 * under — one act or two, sent or not — and the hold, so every word the
 * register shows for a state is here.
 */
export const STATE_NAMES = [
  { code: "IN_PREPARATION", default: REV_STATE_LABEL.IN_PREPARATION, means: "Being written; nobody may act on it." },
  { code: "IN_REVIEW", default: REV_STATE_LABEL.IN_REVIEW, means: "On its route, with its reviewers." },
  { code: "NOT_RELEASED", default: REV_STATE_LABEL.NOT_RELEASED, means: "The route is finished; waiting for Document Control to publish it." },
  { code: "RETURNED", default: REV_STATE_LABEL.RETURNED, means: "Document Control sent it back to a step of its route." },
  { code: "RELEASED_ISSUED", default: "Released & issued", means: "In force and sent — the one act, when releasing and issuing go together." },
  { code: "RELEASED", default: "Released", means: "In force in the register, not sent yet — when they are two acts." },
  { code: "ISSUED", default: "Issued", means: "In force and sent — when they are two acts." },
  { code: "ON_HOLD", default: "On hold", means: "Released, then held: not for use until it is lifted." },
  { code: "SUPERSEDED", default: REV_STATE_LABEL.SUPERSEDED, means: "A later revision replaced it." },
  { code: "VOID", default: REV_STATE_LABEL.VOID, means: "Treated as never valid." },
] as const;

export type StateNameCode = (typeof STATE_NAMES)[number]["code"];
export type StateNames = Record<StateNameCode, string>;

export const DEFAULT_STATE_NAMES = Object.fromEntries(STATE_NAMES.map((one) => [one.code, one.default])) as StateNames;

export const STATE_NAME_MAX = 40;

/** This organization's names, read once a request. */
export const stateNames = cache(async (t: Pick<Tenant, "db">): Promise<StateNames> => {
  const rows = await t.db.stateName.findMany({ select: { code: true, label: true } });
  const names = { ...DEFAULT_STATE_NAMES };
  for (const row of rows) if (row.code in names && row.label.trim()) names[row.code as StateNameCode] = row.label.trim();
  return names;
});

/**
 * A revision state as it reads. A released revision reads as the one act, or —
 * in two acts — Released until it is sent and Issued after; on hold wins.
 */
export function stateName(
  names: StateNames,
  state: string,
  released?: { together: boolean; sent: boolean; held?: boolean },
): string {
  if (state === "RELEASED") {
    if (released?.held) return names.ON_HOLD;
    if (!released || released.together) return names.RELEASED_ISSUED;
    return released.sent ? names.ISSUED : names.RELEASED;
  }
  return names[state as RevState as StateNameCode] ?? REV_STATE_LABEL[state as RevState] ?? state;
}
