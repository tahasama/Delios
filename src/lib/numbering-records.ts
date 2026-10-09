import type { Tenant } from "./tenant";

/**
 * Numbering for the records that are not documents — transmittals, actions and
 * reviews.
 *
 * They are numbered the same way a document is: by a scheme the organization
 * publishes, not by a rule buried in the code that raises them. A scheme is a
 * list of fields in order; each field says where its value comes from, and one
 * of them is the counter. Nothing here invents a segment: every one is a fact
 * the record already carries.
 *
 * Until an organization routes a scheme, the old short form is used, so an
 * upgrade never changes the numbers of records already raised.
 */
export type RecordKind = "TRANSMITTAL" | "ACTION" | "REVIEW" | "PACKAGE";

/** What the fields of a record's scheme may read. */
export type RecordFacts = {
  project: string;
  subProject?: string | null;
  /** The party the record leaves, as its published party code. */
  sender?: string | null;
  /** The party it is addressed to. Several recipients read as one segment. */
  receiver?: string | null;
  /** Reason for issue, for a transmittal; the kind of action, for an action. */
  reason?: string | null;
};

/**
 * The next number for a record of this kind. The backend numbers transmittals,
 * reviews and packages itself as it raises them, by the schemes routed to
 * @TRANSMITTAL, @REVIEW and @PACKAGE; nothing is numbered here.
 */
export async function nextRecordNumber(_t: Tenant, _kind: RecordKind, _facts: RecordFacts, _fallbackPrefix: string): Promise<string> {
  throw new Error("Numbering a record on its own is not supported yet: the backend numbers it as it is raised.");
}
