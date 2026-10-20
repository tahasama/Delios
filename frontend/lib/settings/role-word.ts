/**
 * What our verdict on what others send us is worth, under each role on a project (CONTRACT_ROLES; owner: "PMC do not
 * approve, that's in the very name"): final with us, a recommendation another decides on, or a check before we pass it
 * on to whoever decides. Read by the Control room's flows and by Help (the roles); one place.
 */
export type RoleWord = { ours: "final" | "recommends" | "passes"; decider?: string };

export const ROLE_WORD: Record<string, RoleWord> = {
  OWNER: { ours: "final" },
  PMC: { ours: "recommends", decider: "The owner" },
  EPCM: { ours: "final" },
  EPC: { ours: "final" },
  DESIGN: { ours: "final" },
  CM: { ours: "passes", decider: "The designer" },
  CONTRACTOR: { ours: "passes", decider: "The client or its engineer" },
  SUBCONTRACTOR: { ours: "passes", decider: "The main contractor" },
  SUPPLIER: { ours: "final" },
  INSPECTOR: { ours: "recommends", decider: "The client" },
};

/** What a role's verdict on what is sent to it is worth, in words. */
export function wordOf(code: string): string {
  const w = ROLE_WORD[code];
  if (!w) return "Final: its verdict decides.";
  if (w.ours === "final") return "Final: its verdict decides.";
  if (w.ours === "recommends") return `A recommendation: ${w.decider?.toLowerCase() ?? "another"} decides after it.`;
  return `A check before passing it on: ${w.decider?.toLowerCase() ?? "whoever approves"} decides.`;
}
