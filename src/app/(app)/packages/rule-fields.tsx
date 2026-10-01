import { requireScope } from "@/lib/scope";
import { getActiveSet } from "@/lib/config";
import { SearchPick } from "@/components/search-pick";
import type { PackageFilter } from "@/lib/package-rule";

/**
 * The rule a package fills itself by: any of tags, disciplines, document types
 * and suppliers. Every choice is optional; a document must meet every one that
 * is made. Left empty, the package has no rule and is filled by hand.
 */
export async function RuleFields({ initial }: { initial?: PackageFilter | null }) {
  const { db } = await requireScope();
  const [assets, disciplines, types, parties] = await Promise.all([
    db.assetItem.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    getActiveSet("DISCIPLINES"),
    getActiveSet("DOCUMENT_TYPES"),
    db.party.findMany({ where: { isInternal: false, active: true }, orderBy: { name: "asc" }, select: { code: true, name: true } }),
  ]);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <SearchPick browse compact name="ruleAssetIds" label="Tagged" placeholder="Any tag" initial={initial?.assetIds} items={assets.map((one) => ({ id: one.id, name: one.code, detail: one.name }))} />
      <SearchPick browse compact name="ruleDisciplines" label="Discipline" placeholder="Any discipline" initial={initial?.disciplines} items={disciplines.map((one) => ({ id: one.code, name: one.label, detail: one.code }))} />
      <SearchPick browse compact name="ruleDocTypes" label="Document type" placeholder="Any type" initial={initial?.docTypes} items={types.map((one) => ({ id: one.code, name: one.label, detail: one.code }))} />
      <SearchPick browse compact name="ruleOriginators" label="From supplier" placeholder="Any supplier, or ours" initial={initial?.originators} items={parties.map((one) => ({ id: one.code, name: one.name, detail: one.code }))} />
    </div>
  );
}
