import { getActiveSet } from "@/lib/config";
import { SearchPick } from "@/components/search-pick";
import type { PackageFilter } from "@/lib/package-rule";
import { outsideParties } from "@/lib/api/packages";

/**
 * The rule a package fills itself by: any of tags, disciplines, document types
 * and suppliers. Every choice is optional; a document must meet every one that
 * is made. Left empty, the package has no rule and is filled by hand.
 */
export async function RuleFields({ initial, supplier = false }: { initial?: PackageFilter | null; /** A supplier package: the supplier is fixed already. */ supplier?: boolean }) {
  const [assets, disciplines, types, parties] = await Promise.all([
    // Asset tags are not in the backend.
    Promise.resolve([] as { id: string; code: string; name: string }[]),
    getActiveSet("DISCIPLINES"),
    getActiveSet("DOCUMENT_TYPES"),
    outsideParties(),
  ]);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <SearchPick browse compact name="ruleAssetIds" label="Tagged" placeholder="Any tag" initial={initial?.assetIds} items={assets.map((one) => ({ id: one.id, name: one.code, detail: one.name }))} />
      <SearchPick browse compact name="ruleDisciplines" label="Discipline" placeholder="Any discipline" initial={initial?.disciplines} items={disciplines.map((one) => ({ id: one.code, name: one.label, detail: one.code }))} />
      <SearchPick browse compact name="ruleDocTypes" label="Document type" placeholder="Any type" initial={initial?.docTypes} items={types.map((one) => ({ id: one.code, name: one.label, detail: one.code }))} />
      {supplier ? null : <SearchPick browse compact name="ruleOriginators" label="From supplier" placeholder="Any supplier, or ours" initial={initial?.originators} items={parties.map((one) => ({ id: one.code, name: one.name, detail: one.code }))} />}
    </div>
  );
}
