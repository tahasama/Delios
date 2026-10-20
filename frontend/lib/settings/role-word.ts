/**
 * What our verdict on what others send us is worth, under each role on a project (CONTRACT_ROLES; owner: "PMC do not
 * approve, that's in the very name"): final with us, a recommendation another decides on, or a check before we pass it
 * on to whoever decides. Read by the Control room's flows and by Help ("Who approves"); one place.
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

/** The three answers, in the order Help shows them. */
export const WORD_GROUPS: { key: RoleWord["ours"]; title: string; said: string }[] = [
  { key: "final", title: "Final with us", said: "our verdict decides" },
  { key: "recommends", title: "We recommend", said: "another decides after us" },
  { key: "passes", title: "We check and pass on", said: "whoever approves decides" },
];
