import type { Tenant } from "./tenant";
import { legacyNumbering } from "./api/admin";

// Document number construction & validation — Part 3, per the published scheme.
// "A number is valid when it splits into its scheme fields in order, and every field
//  carries a code published as Active." (Standard-Numbering-Config)

export type SchemeInfo = {
  id: string;
  name: string;
  delimiter: string;
  fields: { position: number; label: string; valueSetKey: string | null; rule: string | null }[];
};

/**
 * The scheme routed to a deliverable type, as Document Control keeps it. Only
 * Document Control and administrators may read the schemes; anybody else gets none.
 */
export async function getSchemeForDeliverable(_t: Tenant, deliverableType: string): Promise<{ scheme: SchemeInfo; routed: boolean } | null> {
  const numbering = await legacyNumbering().catch(() => null);
  const routing = numbering?.routing.find((r) => r.deliverableType === deliverableType);
  if (!routing || routing.status !== "ACTIVE") return null;
  const scheme = numbering?.schemes.find((sc) => sc.name === routing.schemeName);
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

export async function listSchemes(_t: Tenant) {
  const numbering = await legacyNumbering().catch(() => null);
  return [...(numbering?.schemes ?? [])].sort((a, b) => a.name.localeCompare(b.name));
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
    if (!v) throw new Error(`The number for this kind of document is built from ${field.label.toLowerCase()}, so it has to be chosen first.`);
    parts.push(v);
  }
  return { prefix: parts.join(scheme.delimiter), number: "" };
}

/**
 * Allocate the next document number for a field combination (§3.7 — system-generated).
 * The backend allocates it, and only as it registers the document: a number is
 * never handed out on its own.
 */
export async function allocateNumber(
  _t: Tenant,
  _deliverableType: string,
  _fieldValues: Record<string, string>
): Promise<{ docNumber: string; scheme: string }> {
  throw new Error("Allocating a number on its own is not supported yet: the number is given when the document is registered.");
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
