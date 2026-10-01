import type { Tenant } from "./tenant";

/**
 * A delivery package may carry a rule (§15.1, accumulated): every document that
 * matches its filter belongs to it, including documents created later, until
 * the package is delivered or its rule is declared to have stopped admitting.
 * Documents are also added by hand, and any may be taken out; one taken out
 * stays out, even when the rule matches it.
 *
 * A filter is a set of choices, each optional; a document matches when it meets
 * every choice that was made. Asset tags match through the document's links.
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
export async function describeFilter(t: Tenant, filter: PackageFilter): Promise<string> {
  const parts: string[] = [];
  if (filter.assetIds?.length) {
    const assets = await t.db.assetItem.findMany({ where: { id: { in: filter.assetIds } }, select: { code: true } });
    parts.push(`tagged ${assets.map((one) => one.code).join(" or ")}`);
  }
  const { getActiveSet } = await import("./config");
  const named = async (key: string, codes: string[]) => {
    const values = await getActiveSet(key);
    return codes.map((code) => values.find((one) => one.code === code)?.label ?? code).join(" or ");
  };
  if (filter.disciplines?.length) parts.push(`in ${await named("DISCIPLINES", filter.disciplines)}`);
  if (filter.docTypes?.length) parts.push(`of type ${await named("DOCUMENT_TYPES", filter.docTypes)}`);
  if (filter.originators?.length) {
    const parties = await t.db.party.findMany({ where: { code: { in: filter.originators } }, select: { name: true } });
    parts.push(`from ${parties.map((one) => one.name).join(" or ") || filter.originators.join(" or ")}`);
  }
  return `every document ${parts.join(", ")}`;
}

/** Ids of the active documents the filter admits. */
export async function matchingDocuments(t: Tenant, filter: PackageFilter): Promise<string[]> {
  let tagged: string[] | null = null;
  if (filter.assetIds?.length) {
    const links = await t.db.relationship.findMany({ where: { kind: "DOC_ASSET", toId: { in: filter.assetIds } }, select: { fromId: true } });
    tagged = [...new Set(links.map((one) => one.fromId))];
  }
  const docs = await t.db.document.findMany({
    where: {
      state: { in: ["PLANNED", "ACTIVE"] },
      ...(tagged ? { id: { in: tagged } } : {}),
      ...(filter.disciplines?.length ? { discipline: { in: filter.disciplines } } : {}),
      ...(filter.docTypes?.length ? { docType: { in: filter.docTypes } } : {}),
      ...(filter.originators?.length ? { originator: { in: filter.originators } } : {}),
    },
    select: { id: true },
  });
  return docs.map((one) => one.id);
}

/**
 * Bring a rule package up to date: every matching document not yet in it, and
 * not taken out by hand, joins at the package's status. A document that stops
 * matching stays — it was promised; only a person takes one out. Nothing joins once the package is delivered
 * or the rule has stopped admitting. Returns how many joined.
 */
export async function syncPackage(t: Tenant, packageId: string): Promise<number> {
  const pkg = await t.db.package.findFirst({
    where: { id: packageId },
    select: { id: true, closedAt: true, ruleCeasedAt: true, membershipFilter: true, membershipExcluded: true, requiredStatus: true, members: { select: { documentId: true } } },
  });
  if (!pkg || pkg.closedAt || pkg.ruleCeasedAt) return 0;
  const filter = parseFilter(pkg.membershipFilter);
  if (!filter) return 0;
  const have = new Set([...pkg.members.map((one) => one.documentId), ...parseExcluded(pkg.membershipExcluded)]);
  const fresh = (await matchingDocuments(t, filter)).filter((id) => !have.has(id));
  if (!fresh.length) return 0;
  await t.db.packageMember.createMany({ data: fresh.map((documentId) => ({ projectId: t.projectId, packageId: pkg.id, documentId, requiredStatus: pkg.requiredStatus })) });
  return fresh.length;
}
