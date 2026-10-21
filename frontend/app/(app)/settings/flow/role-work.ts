import { ROLE_WORD } from "@/lib/settings/role-word";

/** A word's first letter in capital. */
export const cap = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/**
 * What our role on the project (This project, "our role", CONTRACT_ROLES) makes of the flows, as such projects run:
 * what comes first, in whose words, who approves what we produce, and what our verdict on what others send is worth.
 *  - `ours`: our verdict on what others send us is final ("final"), a recommendation another decides on
 *    ("recommends"), or a check before we pass it on to whoever approves ("passes").
 *  - `decider`: who decides after us when our verdict is not final; `approver`: who approves what we produce, when
 *    someone outside always does (else only when the decider asks for one); `client`: who asks documents of us.
 */
export type RoleWork = {
  order: string[];
  titles?: Record<string, string>;
  /** The short names on the tabs, where the role words them otherwise. */
  tabs?: Record<string, string>;
  ours: "final" | "recommends" | "passes";
  decider?: string;
  approver?: string;
  client?: string;
};
export const ROLE_WORK: Record<string, RoleWork> = {
  // Everything comes to the owner, who decides.
  OWNER: { order: ["receive", "supplier", "produce"], ...ROLE_WORD.OWNER,
    titles: { receive: "Documents we approve", supplier: "Documents owed to us", produce: "Documents we issue" },
    tabs: { receive: "We approve", supplier: "Owed to us", produce: "We issue" } },
  // A project management consultant manages for the owner: it reviews and recommends, the owner decides.
  PMC: { order: ["receive", "produce", "supplier"], ...ROLE_WORD.PMC,
    titles: { receive: "Documents we review for the owner", produce: "Documents we issue", supplier: "Documents owed to the project" },
    tabs: { receive: "We review", produce: "We issue", supplier: "Owed to the project" } },
  // EPCM manages engineering, vendors and contractors on the owner's behalf, and approves for it.
  EPCM: { order: ["produce", "receive", "supplier"], ...ROLE_WORD.EPCM, approver: "The owner",
    titles: { produce: "Engineering we produce for the owner", receive: "Documents we approve on the owner's behalf", supplier: "Documents vendors owe the project" },
    tabs: { produce: "We engineer", receive: "We approve", supplier: "Vendors owe" } },
  // EPC approves its own engineering and its suppliers' data; the client may ask to approve.
  EPC: { order: ["produce", "supplier", "receive"], ...ROLE_WORD.EPC,
    titles: { supplier: "Documents our suppliers owe us" } },
  // The designer (architect, engineer of record) produces the design the client approves, and approves shop
  // drawings and submittals for conformance with it.
  DESIGN: { order: ["produce", "receive", "client"], ...ROLE_WORD.DESIGN, approver: "The client", client: "the client",
    titles: { produce: "Design we produce for the client", receive: "Shop drawings and submittals we approve" },
    tabs: { produce: "We design", receive: "We approve" } },
  // A construction manager checks the trades' submittals first and passes them to the designer, who approves.
  CM: { order: ["receive", "produce", "supplier"], ...ROLE_WORD.CM,
    titles: { receive: "Submittals we check and pass on", produce: "Documents we issue", supplier: "Documents the trades owe us" },
    tabs: { receive: "We check", produce: "We issue", supplier: "Trades owe us" } },
  // A contractor produces for the client or its engineer, and checks its subcontractors' and suppliers' first.
  CONTRACTOR: { order: ["produce", "client", "receive", "supplier"], ...ROLE_WORD.CONTRACTOR, approver: "The client or its engineer", client: "the client",
    titles: { produce: "Documents we produce for the client", receive: "Submittals we check and pass on", supplier: "Documents our suppliers owe us" },
    tabs: { receive: "We check" } },
  SUBCONTRACTOR: { order: ["produce", "client", "supplier", "receive"], ...ROLE_WORD.SUBCONTRACTOR, approver: "The main contractor", client: "the main contractor",
    titles: { produce: "Documents we produce for the main contractor", supplier: "Documents our suppliers owe us" } },
  SUPPLIER: { order: ["produce", "client", "supplier", "receive"], ...ROLE_WORD.SUPPLIER, approver: "Our customer", client: "our customer",
    titles: { produce: "Documents we produce for our customer", supplier: "Documents our own suppliers owe us" } },
  // A third-party inspector certifies its own scope and comments on the rest; it never approves design.
  INSPECTOR: { order: ["produce", "receive"], ...ROLE_WORD.INSPECTOR, approver: "The client",
    titles: { produce: "Reports and certificates we issue", receive: "Documents we review and comment on" },
    tabs: { produce: "We certify", receive: "We comment" } },
};
export const GENERIC_WORK: RoleWork = { order: ["produce", "receive", "supplier"], ours: "final" };

/** Each flow's name, title and ends, in our role's words where it has them: read by the console and the Settings hub. */
export function flowWords(work: RoleWork) {
  return {
    produce: { key: "produce", tab: "We produce", title: "Documents we produce", from: "We write it", to: "in force, and sent to whoever needs it" },
    receive: { key: "receive", tab: "We receive", title: "Documents we receive", from: "Another organization sends it", to: "accepted here and passed on, or back to them" },
    supplier: { key: "supplier", tab: "Suppliers owe us", title: "Documents a supplier owes us", from: "We ask the supplier for it", to: "in force with us, or back with them for the next revision" },
    client: { key: "client", tab: `${cap(work.client ?? "our client")} asks`, title: `Documents ${work.client ?? "our client"} asks of us`, from: `${cap(work.client ?? "our client")} asks for it`, to: `accepted by ${work.client ?? "our client"}, or back with us for the next revision` },
    deliver: { key: "deliver", tab: "Packages", title: "Packages we deliver", from: "We gather what someone needs", to: "delivered, and accepted by them" },
    action: { key: "action", tab: "Actions", title: "An action on the schedule", from: "The schedule needs documents", to: "the action goes ahead, or is postponed" },
    join: { key: "join", tab: "People joining", title: "Someone joins the project", from: "Someone is needed on the project", to: "on it, and told" },
    keep: { key: "keep", tab: "Keeping & ending", title: "A document kept, and ended", from: "In the register", to: "kept as long as it must be, or ended with why" },
  };
}
