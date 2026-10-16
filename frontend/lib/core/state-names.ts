import { cache } from "react";
import { orgSettings } from "@/lib/settings/api";

/** The organization setting that holds a state's name: STATE_NAME:RELEASED. */
const STATE_NAME_KEY = "STATE_NAME:";
import { REV_STATE_LABEL, type RevState } from "@/lib/core/standard";

/**
 * What a revision state is called on screen.
 *
 * The states, their order and what each one does are fixed — the gate, holds,
 * the register and the audit trail all depend on them. What people read is the
 * organization's: "Released" may be "Approved" somewhere else, and nothing
 * else changes. An organization that renames nothing reads the defaults.
 *
 * Besides the revision states there are the names a released revision is read
 * under — sent with it, or simply in force — and the hold, so every word the
 * register shows for a state is here.
 */
export const STATE_NAMES = [
  { code: "IN_PREPARATION", default: REV_STATE_LABEL.IN_PREPARATION, means: "Being written; nobody may act on it." },
  { code: "IN_REVIEW", default: REV_STATE_LABEL.IN_REVIEW, means: "On its route, with its reviewers." },
  { code: "NOT_RELEASED", default: REV_STATE_LABEL.NOT_RELEASED, means: "The route is finished; waiting for the control function to publish it." },
  { code: "RETURNED", default: REV_STATE_LABEL.RETURNED, means: "The control function sent it back to a step of its route." },
  { code: "RELEASED_ISSUED", default: "Released & issued", means: "In force and sent to the people named — where releasing sends it (the default)." },
  { code: "RELEASED", default: "Released", means: "In force; people work from it — where releasing means go ahead." },
  { code: "ON_HOLD", default: "On hold", means: "Released, then held: not for use until it is lifted." },
  { code: "SUPERSEDED", default: REV_STATE_LABEL.SUPERSEDED, means: "A later revision replaced it." },
  { code: "VOID", default: REV_STATE_LABEL.VOID, means: "Treated as never valid." },
] as const;

type StateNameCode = (typeof STATE_NAMES)[number]["code"];
type StateNames = Record<StateNameCode, string>;

const DEFAULT_STATE_NAMES = Object.fromEntries(STATE_NAMES.map((one) => [one.code, one.default])) as StateNames;

export const STATE_NAME_MAX = 40;

/** This organization's names, read once a request. */
export const stateNames = cache(async (_t?: unknown): Promise<StateNames> => {
  const names = { ...DEFAULT_STATE_NAMES };
  for (const [key, label] of await orgSettings()) {
    const code = key.startsWith(STATE_NAME_KEY) ? key.slice(STATE_NAME_KEY.length) : "";
    if (code in names && label.trim()) names[code as StateNameCode] = label.trim();
  }
  return names;
});

/**
 * A revision state as it reads. A released revision reads as released and
 * issued where releasing sends it, and as released where it means go ahead;
 * on hold wins either way.
 */
export function stateName(
  names: StateNames,
  state: string,
  released?: { together: boolean; held?: boolean },
): string {
  if (state === "RELEASED") {
    if (released?.held) return names.ON_HOLD;
    return !released || released.together ? names.RELEASED_ISSUED : names.RELEASED;
  }
  return names[state as RevState as StateNameCode] ?? REV_STATE_LABEL[state as RevState] ?? state;
}

/**
 * A document asked of a supplier reads in the supplier's own set of states, not ours: sent (to the supplier),
 * received (from them), accepted (the control function's check), returned (by that check, with why), in review, released
 * & issued, returned (rejected by the review). Who holds it (who may change it) is said beside it. The backend
 * works the stage out the same way (`Register.SupplierStage`).
 */
export const SUPPLIER_STAGES = ["SENT", "RECEIVED", "ACCEPTED", "RETURNED_CHECK", "IN_REVIEW", "RELEASED", "RETURNED_REVIEW"] as const;
export type SupplierStage = (typeof SUPPLIER_STAGES)[number];

const SUPPLIER_STAGE_LABEL: Record<SupplierStage, string> = {
  SENT: "Sent",
  RECEIVED: "Received",
  ACCEPTED: "Accepted",
  RETURNED_CHECK: "Returned",
  IN_REVIEW: "In review",
  RELEASED: "Released & issued",
  RETURNED_REVIEW: "Returned",
};

/** Where a document asked of a supplier stands; null when it was not asked of one. */
export function supplierStage(
  asked: boolean,
  latest: { state: string; resentAt?: Date | string | null; returnedAt?: Date | string | null } | null,
): SupplierStage | null {
  if (!asked) return null;
  if (!latest) return "SENT";
  switch (latest.state) {
    case "RECEIVED": return "RECEIVED";
    case "IN_PREPARATION": return "ACCEPTED";
    case "CORRECTING": {
      const sent = latest.resentAt ? new Date(latest.resentAt).getTime() : null;
      const back = latest.returnedAt ? new Date(latest.returnedAt).getTime() : null;
      return sent !== null && (back === null || sent > back) ? "SENT" : "RETURNED_CHECK";
    }
    case "IN_REVIEW": return "IN_REVIEW";
    case "RELEASED": return "RELEASED";
    case "RETURNED": return "RETURNED_REVIEW";
    default: return null;
  }
}

/** The word for a supplier's stage; released reads as our released does (with the hold, and the project's policy). */
export function supplierStageName(names: StateNames, stage: SupplierStage, released?: { together: boolean; held?: boolean }): string {
  return stage === "RELEASED" ? stateName(names, "RELEASED", released) : SUPPLIER_STAGE_LABEL[stage];
}

/**
 * The stamp beside a supplier's document number, in the words of whoever reads it: we sent it, they have it to
 * transmit; they transmitted it, we received it; and so on. Null for a document not asked of a supplier (a
 * placeholder of ours reads "number reserved").
 */
const SUPPLIER_STAMP: Record<SupplierStage, { ours: string; theirs: string }> = {
  SENT: { ours: "sent to supplier", theirs: "to be transmitted" },
  RECEIVED: { ours: "received, to check", theirs: "transmitted" },
  ACCEPTED: { ours: "accepted", theirs: "accepted" },
  RETURNED_CHECK: { ours: "returned to correct", theirs: "to correct" },
  IN_REVIEW: { ours: "in review", theirs: "in review" },
  RELEASED: { ours: "released", theirs: "released" },
  RETURNED_REVIEW: { ours: "returned to revise", theirs: "to revise" },
};

/** The stamp for a stage, on our side or the supplier's; released with comments to take in reads "next revision due". */
export function supplierStamp(stage: SupplierStage, side: "ours" | "theirs", withSupplier?: boolean | null): string {
  if (stage === "RELEASED" && withSupplier) return side === "ours" ? "next revision due" : "to revise";
  return SUPPLIER_STAMP[stage][side];
}
