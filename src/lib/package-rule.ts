/**
 * A delivery package may carry a rule (§15.1, accumulated): every document that
 * matches its filter belongs to it, including documents created later, until
 * the package is delivered or its rule is declared to have stopped admitting.
 * Documents are also added by hand, and any may be taken out; one taken out
 * stays out, even when the rule matches it.
 *
 * A filter is a set of choices, each optional; a document matches when it meets
 * every choice that was made. The backend keeps the rule and fills the package
 * by it whenever the package is read.
 */
export type PackageFilter = {
  assetIds?: string[];
  disciplines?: string[];
  docTypes?: string[];
  originators?: string[];
};

export function parseFilter(raw: string | null | undefined): PackageFilter | null {
  if (!raw) return null;
  try {
    const one = JSON.parse(raw) as PackageFilter;
    return isEmpty(one) ? null : one;
  } catch {
    return null;
  }
}

export function parseExcluded(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids.map(String) : [];
  } catch {
    return [];
  }
}

export function isEmpty(filter: PackageFilter): boolean {
  return !filter.assetIds?.length && !filter.disciplines?.length && !filter.docTypes?.length && !filter.originators?.length;
}

export function filterFromForm(formData: FormData): PackageFilter {
  const many = (key: string) => formData.getAll(key).map(String).filter(Boolean);
  return { assetIds: many("ruleAssetIds"), disciplines: many("ruleDisciplines"), docTypes: many("ruleDocTypes"), originators: many("ruleOriginators") };
}

/** The rule in words, as the package shows it. */
export async function describeFilter(filter: PackageFilter): Promise<string> {
  const parts: string[] = [];
  // Asset tags are not in the backend: a rule never names one.
  const { getActiveSet } = await import("./config");
  const named = async (key: string, codes: string[]) => {
    const values = await getActiveSet(key);
    return codes.map((code) => values.find((one) => one.code === code)?.label ?? code).join(" or ");
  };
  if (filter.disciplines?.length) parts.push(`in ${await named("DISCIPLINES", filter.disciplines)}`);
  if (filter.docTypes?.length) parts.push(`of type ${await named("DOCUMENT_TYPES", filter.docTypes)}`);
  if (filter.originators?.length) {
    const { outsideParties } = await import("./api/packages");
    const parties = (await outsideParties()).filter((one) => filter.originators!.includes(one.code));
    parts.push(`from ${parties.map((one) => one.name).join(" or ") || filter.originators.join(" or ")}`);
  }
  return `every document ${parts.join(", ")}`;
}

/** The statuses a package or member needs, from its stored list ("AB,IFC"). */
export function statusList(required: string): string[] {
  return required.split(",").map((one) => one.trim()).filter(Boolean);
}

/** A released status meets a need when it is any one of the statuses asked for. */
export function meetsStatus(statusCode: string | null | undefined, required: string): boolean {
  return !!statusCode && statusList(required).includes(statusCode);
}

/** The organizations a package goes to, oldest packages holding only one. */
export function recipientIds(pkg: { recipientPartyIds: string | null; recipientPartyId: string | null }): string[] {
  const many = parseExcluded(pkg.recipientPartyIds);
  return many.length ? many : pkg.recipientPartyId ? [pkg.recipientPartyId] : [];
}

/** Everyone who may accept the package — any one of them does. */
export function acceptorIds(pkg: { acceptanceAuthorityIds: string | null; acceptanceAuthorityId: string }): string[] {
  const many = parseExcluded(pkg.acceptanceAuthorityIds);
  return many.length ? many : [pkg.acceptanceAuthorityId].filter(Boolean);
}

/** Everyone who puts the package together. */
export function ownerIds(pkg: { compositionOwnerIds: string | null; compositionOwnerId: string }): string[] {
  const many = parseExcluded(pkg.compositionOwnerIds);
  return many.length ? many : [pkg.compositionOwnerId].filter(Boolean);
}
