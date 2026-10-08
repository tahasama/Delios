"use client";

import { SearchPick } from "@/components/search-pick";
import type { PackageRule } from "@/lib/api/types";

export type Pick = { code: string; label: string };
export type RuleLists = { deliverableTypes: Pick[]; disciplines: Pick[]; docTypes: Pick[]; originators: Pick[] };

/**
 * The rule a package fills itself by: deliverable types, disciplines,
 * document types and suppliers. Every choice is optional; a document must
 * meet every one that is made. Left empty, the package is filled by hand.
 */
export function RuleFields({ lists, initial, supply = false }: {
  lists: RuleLists; initial?: PackageRule | null;
  /** A supply package: the supplier is fixed already. */
  supply?: boolean;
}) {
  const items = (list: Pick[]) => list.map((one) => ({ id: one.code, name: one.label, detail: one.code }));
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <SearchPick browse compact name="ruleDeliverableTypes" label="Deliverable type" placeholder="Any deliverable" initial={initial?.deliverableTypes} items={items(lists.deliverableTypes)} />
      <SearchPick browse compact name="ruleDisciplines" label="Discipline" placeholder="Any discipline" initial={initial?.disciplines} items={items(lists.disciplines)} />
      <SearchPick browse compact name="ruleDocTypes" label="Document type" placeholder="Any type" initial={initial?.docTypes} items={items(lists.docTypes)} />
      {supply ? null : <SearchPick browse compact name="ruleOriginators" label="From supplier" placeholder="Any supplier, or ours" initial={initial?.originators} items={items(lists.originators)} />}
    </div>
  );
}
