import type { PackageView } from "@/lib/types";

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
  const { getActiveSet } = await import("@/lib/settings/config");
  const named = async (key: string, codes: string[]) => {
    const values = await getActiveSet(key);
    return codes.map((code) => values.find((one) => one.code === code)?.label ?? code).join(" or ");
  };
  if (filter.assetIds?.length) {
    const { projectAssets } = await import("@/lib/records/api");
    const { requireScope } = await import("@/lib/core/scope");
    const tags = (await projectAssets(await requireScope())).filter((one) => filter.assetIds!.includes(one.id)).map((one) => one.code);
    parts.push(`tagged ${tags.join(" or ") || "with an asset no longer listed"}`);
  }
  if (filter.disciplines?.length) parts.push(`in ${await named("DISCIPLINES", filter.disciplines)}`);
  if (filter.docTypes?.length) parts.push(`of type ${await named("DOCUMENT_TYPES", filter.docTypes)}`);
  if (filter.originators?.length) {
    const { outsideParties } = await import("@/lib/packages/api");
    const parties = (await outsideParties()).filter((one) => filter.originators!.includes(one.code));
    parts.push(`from ${parties.map((one) => one.name).join(" or ") || filter.originators.join(" or ")}`);
  }
  return `every document ${parts.join(", ")}`;
}

/** The statuses a package or member needs, from its stored list ("AB,IFC"). */
export function statusList(required: string): string[] {
  return required.split(",").map((one) => one.trim()).filter(Boolean);
}

/** What narrows a package's rule, or null when nothing does (a supplier's package always names its supplier: that is not narrowing). */
export function ruleFilter(pkg: PackageView): PackageFilter | null {
  const filter: PackageFilter = {
    disciplines: pkg.rule?.disciplines ?? [], docTypes: pkg.rule?.docTypes ?? [],
    originators: pkg.kind === "SUPPLY" ? [] : pkg.rule?.originators ?? [], assetIds: pkg.rule?.assetIds ?? [],
  };
  return isEmpty(filter) ? null : filter;
}

/** The rule in words, or null when it has none; a delivery package's rule that narrows nothing takes every document. */
export async function ruleWords(pkg: PackageView): Promise<string | null> {
  const filter = ruleFilter(pkg);
  const words = filter ? await describeFilter(filter) : null;
  return pkg.kind === "SUPPLY" ? words : pkg.rule ? words ?? "every document" : null;
}

/** The reasons a package goes out for, the first being its main one. */
export const reasonsOf = (pkg: PackageView): string[] => (pkg.reasons?.length ? pkg.reasons : [pkg.reason]);

/** What is still missing, once readiness was checked; null when nothing is or it was not checked. */
export const shortfallOf = (pkg: PackageView) => (pkg.assessedAt && pkg.shortfall.length ? pkg.shortfall : null);
