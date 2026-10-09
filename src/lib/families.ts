import { getActiveSet, getValue } from "./config";
import type { Tenant } from "./tenant";

/**
 * Document families, and when an outside stamp is needed.
 *
 * A project holds hundreds of document types and nobody will answer a question
 * about each one. They answer it ten times, for the families, and every type
 * inherits. The family says *when* a stamp is needed; the distribution matrix
 * says *who* gives it. Neither repeats the other.
 *
 * Two notations, one family table:
 *
 *   ours       a three-letter mnemonic    DWG   family declared on the type
 *   supplier   family letter and number   D101  family read off the letter
 *
 * The family is keyed by that letter. It once carried a digit as well, from a
 * notation our own codes no longer use.
 *
 * Our own codes stay clean because they go into the document number, where a
 * family prefix would sit in every title block and transmittal for the life of
 * the project. The family is data on the type instead. A supplier code carries
 * its letter because that notation is built that way and never enters our
 * numbering.
 *
 * An organization is free to publish its own types in its own notation — the one
 * condition is that each type names a family, or no matrix can be drawn.
 */

/** When an outside body must stamp a document of this family. */
export type StampRule = "NONE" | "BEFORE" | "AFTER";

export const STAMP_RULES: { value: StampRule; label: string; text: string }[] = [
  { value: "NONE", label: "No outside stamp", text: "Our own verdict is the approval. Nothing is asked for from outside." },
  { value: "BEFORE", label: "Stamped before release", text: "The revision is not released until the stamped copy is back. Use it where a visa is a legal precondition — a control office, a notified body, an authority." },
  { value: "AFTER", label: "Stamped after release", text: "The verdict releases it and work proceeds; the stamped copy is owed and chased until it arrives." },
];

export type Family = {
  code: string;
  label: string;
  description: string;
  stamp: StampRule;
};

function asRule(value: unknown): StampRule {
  return value === "BEFORE" || value === "AFTER" ? value : "NONE";
}

/** Every family this organization publishes. */
export async function families(_t: Tenant): Promise<Family[]> {
  const rows = await getActiveSet("DOC_FAMILIES");
  return rows.map((row) => {
    const props = row.props;
    return {
      code: row.code,
      label: row.label,
      description: typeof props.description === "string" ? props.description : "",
      stamp: asRule(props.stamp),
    };
  });
}

/**
 * Which family a document type belongs to.
 *
 * A type may name its family outright, in its `family` property — that always
 * wins, so an organization using its own codes is never forced into a notation.
 * Failing that the first character of the code is read, which is how a supplier
 * code says its own family. Anything else has no family, and is reported rather
 * than guessed.
 */
export function familyOf(
  code: string,
  props: Record<string, unknown>,
  published: Family[],
): Family | null {
  // What the type declares always wins. Only a code that declares nothing is
  // read for a family, which is how the supplier notation still works.
  const named = typeof props.family === "string" ? props.family.trim().toUpperCase() : "";
  if (named) {
    const hit = published.find((f) => f.code === named);
    if (hit) return hit;
  }
  const first = code.trim().charAt(0).toUpperCase();
  return first ? published.find((f) => f.code === first) ?? null : null;
}

export type TypeFamily = {
  code: string;
  label: string;
  family: Family | null;
};

/** Every published document type with the family it falls in. */
export async function typesByFamily(t: Tenant): Promise<TypeFamily[]> {
  const [published, types] = await Promise.all([
    families(t),
    getActiveSet("DOCUMENT_TYPES"),
  ]);
  return types.map((type) => ({
    code: type.code,
    label: type.label,
    family: familyOf(type.code, type.props, published),
  }));
}

/**
 * What a review route must ask for, for one document type.
 *
 * Read when a route starts, never stored on the template: a template written
 * last year must not keep asking for a stamp a family rule stopped requiring
 * last week.
 */
export async function stampRuleFor(t: Tenant, docType: string | null | undefined): Promise<{ rule: StampRule; family: Family | null }> {
  if (!docType) return { rule: "NONE", family: null };
  const published = await families(t);
  const type = await getValue("DOCUMENT_TYPES", docType);
  const family = familyOf(docType, type?.props ?? {}, published);
  return { rule: family?.stamp ?? "NONE", family };
}

/** One line for the route screen, in the words the person needs. */
export function stampNotice(rule: StampRule, family: Family | null): string | null {
  if (!family || rule === "NONE") return null;
  return rule === "BEFORE"
    ? `${family.label}: a stamped copy must come back before this revision can be released.`
    : `${family.label}: the verdict releases it, and a stamped copy is owed afterwards.`;
}
