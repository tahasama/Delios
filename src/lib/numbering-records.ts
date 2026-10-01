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
 * A field's rule, as the numbering screen writes it. `FIXED(TR)` prints TR;
 * `PROJECT`, `SUBPROJECT`, `SENDER`, `RECEIVER` and `REASON` read the record;
 * `COUNTER:DIGITS(4)` is the sequence, and there is exactly one of those.
 */
function segment(rule: string | null, facts: RecordFacts): string | null {
  const said = (rule ?? "").trim().toUpperCase();
  const fixed = said.match(/^FIXED\(([^)]+)\)$/);
  if (fixed) return fixed[1];
  if (said.startsWith("COUNTER")) return null;
  if (said === "PROJECT") return facts.project;
  if (said === "SUBPROJECT") return facts.subProject ?? null;
  if (said === "SENDER") return facts.sender ?? null;
  if (said === "RECEIVER") return facts.receiver ?? null;
  if (said === "REASON") return facts.reason ?? null;
  return null;
}

function digitsOf(rule: string | null): number {
  const said = rule ?? "";
  const match = said.match(/DIGITS\((\d+)\)/i);
  return match ? Number(match[1]) : 4;
}

/**
 * The next number for a record of this kind. The counter runs per project and
 * per everything that precedes it in the number, so changing the party or the
 * reason starts a fresh sequence rather than continuing somebody else's.
 */
export async function nextRecordNumber(t: Tenant, kind: RecordKind, facts: RecordFacts, fallbackPrefix: string): Promise<string> {
  const { db, projectId } = t;
  const routing = await db.schemeRouting.findFirst({ where: { deliverableType: kind, status: "ACTIVE" } });
  const scheme = routing
    ? await db.scheme.findFirst({ where: { name: routing.schemeName, active: true }, include: { fields: { orderBy: { position: "asc" } } } })
    : null;

  if (!scheme || !scheme.fields.length) {
    // No scheme routed: the short form this record has always carried.
    // Packages are few: three digits (PK-001) read better than four.
    return `${fallbackPrefix}-${String(await bump(t, fallbackPrefix)).padStart(kind === "PACKAGE" ? 3 : 4, "0")}`;
  }

  const before: string[] = [];
  const after: string[] = [];
  let digits = 4;
  let seen = false;
  for (const field of scheme.fields) {
    if ((field.rule ?? "").trim().toUpperCase().startsWith("COUNTER")) {
      digits = digitsOf(field.rule);
      seen = true;
      continue;
    }
    const value = segment(field.rule, facts);
    // A field the record cannot answer is left out rather than printed empty:
    // a transmittal has no sub-project, and an empty slot reads as a mistake.
    if (!value) continue;
    (seen ? after : before).push(value.replace(new RegExp(`\\${scheme.delimiter}`, "g"), ""));
  }

  const prefix = [kind === "ACTION" ? "AC" : kind === "REVIEW" ? "RV" : kind === "PACKAGE" ? "PK" : "TR", ...before].join(scheme.delimiter);
  const sequence = String(await bump(t, prefix)).padStart(digits, "0");
  void projectId;
  return [...before, sequence, ...after].join(scheme.delimiter) || `${fallbackPrefix}-${sequence}`;
}

/** Take the next value of a counter, creating it the first time it is asked for. */
async function bump(t: Tenant, prefix: string): Promise<number> {
  const { db, projectId } = t;
  return db.$transaction(async (tx) => {
    const held = await tx.numberCounter.findUnique({ where: { projectId_prefix: { projectId, prefix } } });
    if (held) {
      await tx.numberCounter.update({ where: { id: held.id }, data: { next: { increment: 1 } } });
      return held.next;
    }
    await tx.numberCounter.create({ data: { projectId, prefix, next: 2 } });
    return 1;
  });
}
