import type { Tenant } from "./tenant";

// Document number construction & validation — Part 3, per the published scheme.
// "A number is valid when it splits into its scheme fields in order, and every field
//  carries a code published as Active." (Standard-Numbering-Config)

export type SchemeInfo = {
  id: string;
  name: string;
  delimiter: string;
  fields: { position: number; label: string; valueSetKey: string | null; rule: string | null }[];
};

export async function getSchemeForDeliverable(t: Tenant, deliverableType: string): Promise<{ scheme: SchemeInfo; routed: boolean } | null> {
  const { db } = t;
  const routing = await db.schemeRouting.findFirst({ where: { deliverableType } });
  if (!routing || routing.status !== "ACTIVE") return null;
  const scheme = await db.scheme.findFirst({ where: { name: routing.schemeName }, include: { fields: { orderBy: { position: "asc" } } } });
  if (!scheme) return null;
  return {
    scheme: {
      id: scheme.id,
      name: scheme.name,
      delimiter: scheme.delimiter,
      fields: scheme.fields.map((f) => ({ position: f.position, label: f.label, valueSetKey: f.valueSetKey, rule: f.rule })),
    },
    routed: true,
  };
}

export async function listSchemes(t: Tenant) {
  return t.db.scheme.findMany({ include: { fields: { orderBy: { position: "asc" } } }, orderBy: { name: "asc" } });
}

export type NumberIssue =
  | { ok: false; error: string }
  | { ok: true };

/** Validate a document number against the routed scheme (used by DEF-ID checks too). */
export async function validateNumber(
  t: Tenant,
  deliverableType: string,
  docNumber: string,
  activeValues: (setKey: string) => Promise<Set<string>>
): Promise<NumberIssue> {
  const routed = await getSchemeForDeliverable(t, deliverableType);
  if (!routed) return { ok: false, error: `No numbering scheme is routed for deliverable type "${deliverableType}".` };
  const { scheme } = routed;
  const parts = docNumber.split(scheme.delimiter);
  if (parts.length !== scheme.fields.length) {
    return { ok: false, error: `Number has ${parts.length} fields; the "${scheme.name}" scheme defines ${scheme.fields.length}.` };
  }
  for (let i = 0; i < scheme.fields.length; i++) {
    const field = scheme.fields[i];
    const value = parts[i];
    if (field.rule?.startsWith("COUNTER")) {
      const m = field.rule.match(/DIGITS\((\d+)\)/);
      const digits = m ? Number(m[1]) : 5;
      if (!new RegExp(`^\\d{${digits}}$`).test(value)) {
        return { ok: false, error: `Sequence "${value}" must be ${digits} digits.` };
      }
      continue;
    }
    if (!field.valueSetKey) continue;
    const active = await activeValues(field.valueSetKey);
    if (!active.has(value)) {
      return { ok: false, error: `Field "${field.label}" value "${value}" is not in the published active set.` };
    }
  }
  return { ok: true };
}

/** Prefix = the number without its sequence field — the counter scope. */
export function counterPrefix(scheme: SchemeInfo, fieldValues: Record<string, string>): { prefix: string; number: string } {
  const parts: string[] = [];
  for (const field of scheme.fields) {
    if (field.rule?.startsWith("COUNTER")) continue;
    const v = fieldValues[field.label];
    if (!v) throw new Error(`Missing value for numbering field "${field.label}"`);
    parts.push(v);
  }
  return { prefix: parts.join(scheme.delimiter), number: "" };
}

/** Allocate the next document number for a field combination (§3.7 — system-generated). */
export async function allocateNumber(
  t: Tenant,
  deliverableType: string,
  fieldValues: Record<string, string>
): Promise<{ docNumber: string; scheme: string }> {
  const routed = await getSchemeForDeliverable(t, deliverableType);
  if (!routed) throw new Error(`No numbering scheme is routed for deliverable type "${deliverableType}".`);
  const { scheme } = routed;
  const seqField = scheme.fields.find((f) => f.rule?.startsWith("COUNTER"));
  const digits = seqField ? Number(seqField.rule?.match(/DIGITS\((\d+)\)/)?.[1] ?? 5) : 5;
  const { prefix } = counterPrefix(scheme, fieldValues);
  const { db, projectId } = t;
  const seq = await db.$transaction(async (tx) => {
    // §3.7 / B.1.7 — a range issued to a named party is drawn down first
    const openRanges = await tx.numberRange.findMany({ where: { projectId, prefix, status: "OPEN" } });
    const range = openRanges.find((r) => Math.max(r.lastIssued + 1, r.from) <= r.to);
    if (range) {
      const next = Math.max(range.lastIssued + 1, range.from);
      const exhausted = next >= range.to;
      await tx.numberRange.update({ where: { id: range.id }, data: { lastIssued: next, status: exhausted ? "EXHAUSTED" : "OPEN" } });
      return next;
    }
    const existing = await tx.numberCounter.findUnique({ where: { projectId_prefix: { projectId, prefix } } });
    if (existing) {
      await tx.numberCounter.update({ where: { id: existing.id }, data: { next: { increment: 1 } } });
      return existing.next;
    }
    await tx.numberCounter.create({ data: { projectId, prefix, next: 2 } });
    return 1;
  });
  return { docNumber: `${prefix}${scheme.delimiter}${String(seq).padStart(digits, "0")}`, scheme: scheme.name };
}

/** Next revision value in the applicable series (§6.2/§6.3), excluding I O Q S X Z. */
export function nextRevisionValue(series: "DESIGN" | "EXECUTION", existing: string[], executionStart = 0): string {
  const excluded = new Set(["I", "O", "Q", "S", "X", "Z"]);
  if (series === "EXECUTION") {
    // A fresh numeric series begins at the release for execution (§6.2) — it
    // never continues the design series' letters. Starting value published (C.5.2).
    const used = new Set(existing.filter((v) => /^\d+$/.test(v)).map((v) => parseInt(v, 10)));
    let n = executionStart;
    while (used.has(n)) n++;
    return String(n);
  }
  {
    // Alphabetic series starting at A
    let n = existing.length;
    const used = new Set(existing.map((v) => v.toUpperCase()));
    for (;;) {
      const candidate = numToLetters(n);
      n++;
      if (excluded.has(candidate)) continue;
      if (!used.has(candidate)) return candidate;
    }
  }
}

function numToLetters(n: number): string {
  // 0->A, 1->B ... 25->AA? Keep simple bijective A..Z, AA..AZ (skipping excluded handled by caller loop)
  let s = "";
  n = n + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
