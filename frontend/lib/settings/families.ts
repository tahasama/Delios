import { getActiveSet } from "@/lib/settings/config";
import type { Tenant } from "@/lib/core/tenant";

/**
 * Document families: they organise document types and help with recommendations (owner). A family is a value of the
 * set DOC_FAMILIES, kept in Types & sets like any other, coded as the organization likes; there is nothing in them to
 * regulate, so they are read on Help, never a Settings page. A type names its family (`family` on the type), or a code
 * whose first letter is a family's code falls in it (the supplier notation, D101 in D).
 */

export type Family = {
  code: string;
  label: string;
  description: string;
};

/** Every family this organization publishes. */
export async function families(_t: Tenant): Promise<Family[]> {
  const rows = await getActiveSet("DOC_FAMILIES");
  return rows.map((row) => {
    const props = row.props;
    return {
      code: row.code,
      label: row.label,
      description: typeof props.description === "string" ? props.description : "",
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

type TypeFamily = {
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
