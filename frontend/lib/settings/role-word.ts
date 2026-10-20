/**
 * What our verdict on what others send us is worth, under each role on a project (CONTRACT_ROLES; owner: "PMC do not
 * approve, that's in the very name"): final with us, a recommendation another decides on, or a check before we pass it
 * on to whoever decides. Read by the Control room's flows and by Help (the roles); one place.
 */
export type RoleWord = {
  ours: "final" | "recommends" | "passes"; decider?: string;
  /** What an organization in this role usually sends out, and what usually comes to it (Help, the roles). */
  sends: string; receives: string;
};

export const ROLE_WORD: Record<string, RoleWord> = {
  OWNER: { ours: "final", sends: "Its requirements and specifications, its comments, and its decisions on everything sent to it.", receives: "Everything: the design, the contractors' and suppliers' documents, for approval, then the handover records." },
  PMC: { ours: "recommends", decider: "The owner", sends: "Its review and recommendation on each document, to the owner.", receives: "The designers' and contractors' documents, to review for the owner." },
  EPCM: { ours: "final", sends: "The engineering, to the owner; its approvals of what vendors and contractors send.", receives: "Vendor data and contractors' submittals, to approve on the owner's behalf." },
  EPC: { ours: "final", sends: "Its design, procurement and construction documents, and the handover records, to the client.", receives: "Its suppliers' and subcontractors' data, to approve; the client's comments." },
  DESIGN: { ours: "final", sends: "The design (drawings, specifications, calculations), to the client for approval.", receives: "Shop drawings and submittals, checked against its design." },
  CM: { ours: "passes", decider: "The designer", sends: "The trades' submittals, checked, to the designer; site records.", receives: "The trades' submittals and site documents." },
  CONTRACTOR: { ours: "passes", decider: "The client or its engineer", sends: "Method statements, shop drawings and records, to the client or its engineer.", receives: "The design to build from; its subcontractors' and suppliers' documents, checked first." },
  SUBCONTRACTOR: { ours: "passes", decider: "The main contractor", sends: "The documents of its part of the work, to the main contractor.", receives: "The design for its part, and its own suppliers' data." },
  SUPPLIER: { ours: "final", sends: "Datasheets, drawings, manuals and certificates of what it supplies, to its customer.", receives: "Its order's requirements, and its customer's comments to take in." },
  INSPECTOR: { ours: "recommends", decider: "The client", sends: "Inspection reports and certificates for its own scope.", receives: "Inspection plans and records, to witness and comment on." },
};

/** What a role's verdict on what is sent to it is worth, in words. */
export function wordOf(code: string): string {
  const w = ROLE_WORD[code];
  if (!w) return "Final: its verdict decides.";
  if (w.ours === "final") return "Final: its verdict decides.";
  if (w.ours === "recommends") return `A recommendation: ${w.decider?.toLowerCase() ?? "another"} decides after it.`;
  return `A check before passing it on: ${w.decider?.toLowerCase() ?? "whoever approves"} decides.`;
}
