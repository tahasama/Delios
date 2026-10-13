import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isAdmin } from "@/lib/auth";
import { PageHeader, Card, DataTable, Th, Td, Chip } from "@/components/ui";
import { families, typesByFamily, STAMP_RULES, type StampRule } from "@/lib/families";

export const dynamic = "force-dynamic";
export const metadata = { title: "Document families" };

const TONE: Record<StampRule, string> = {
  NONE: "bg-slate-100 text-slate-600 ring-slate-300",
  BEFORE: "bg-amber-100 text-amber-900 ring-amber-300",
  AFTER: "bg-emerald-100 text-emerald-900 ring-emerald-300",
};

/**
 * The stamp matrix: ten families, one answer each. Drawn from whatever families
 * the organization publishes, so an organization using its own document codes
 * sees its own matrix — the one condition being that every type names a family.
 */
export default async function FamiliesPage() {
  const ctx = await requireScope();
  if (!ctx.can("READ")) return <PageHeader title="Document families" subtitle={ctx.why("READ")} />;
  const mayEdit = isAdmin(ctx.user);

  const [published, types] = await Promise.all([families(ctx), typesByFamily(ctx)]);
  const counted = new Map<string, number>();
  for (const type of types) {
    if (!type.family) continue;
    counted.set(type.family.code, (counted.get(type.family.code) ?? 0) + 1);
  }
  const orphans = types.filter((type) => !type.family);
  const labelOf = (rule: StampRule) => STAMP_RULES.find((one) => one.value === rule)!;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Document families"
        subtitle="When an outside stamp is needed, answered once per family instead of once per document type. Who gives the stamp is the distribution matrix's business."
      />

      <p className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        Our own types keep a plain mnemonic (DWG) and name their family as data, because the code goes into the document number. A supplier code carries its family letter already (D101 is family D).
        <Link href="/distribution" className="font-semibold text-link hover:underline">Who gives the stamp →</Link>
        {mayEdit ? <Link href="/settings/config?set=DOC_FAMILIES" className="font-semibold text-link hover:underline">Change a family's answer →</Link> : null}
      </p>

      <Card title="The stamp matrix" description={`${published.length} families · ${types.length} published document types`}>
        <div className="mb-3 flex flex-wrap gap-3">
          {STAMP_RULES.map((rule) => (
            <span key={rule.value} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
              <Chip className={TONE[rule.value]}>{rule.label}</Chip>
            </span>
          ))}
        </div>

        <DataTable
          id="document-families"
          head={
            <tr>
              <Th className="w-20">Code</Th>
              <Th>Family</Th>
              <Th>Types</Th>
              <Th>Outside stamp</Th>
              <Th>What that means</Th>
            </tr>
          }
        >
          {published.map((family) => {
            const rule = labelOf(family.stamp);
            return (
              <tr key={family.code}>
                <Td className="font-mono text-xs font-semibold text-slate-700">{family.code}</Td>
                <Td>
                  <span className="block text-sm font-medium text-slate-800">{family.label}</span>
                  <span className="block text-xs text-slate-500">{family.description}</span>
                </Td>
                <Td className="tabular-nums text-xs text-slate-500">{counted.get(family.code) ?? 0}</Td>
                <Td><Chip className={TONE[family.stamp]}>{rule.label}</Chip></Td>
                <Td className="max-w-md text-xs text-slate-500">{rule.text}</Td>
              </tr>
            );
          })}
        </DataTable>

        {published.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No family is published yet, so no matrix can be drawn and no route can know what to ask for.
          </p>
        ) : null}
      </Card>

      {orphans.length ? (
        <Card
          title="Types with no family"
          description="These fall in no family, so a route cannot tell whether they need a stamped copy. Give each one a family — in its own code, or in its family property."
        >
          <p className="mb-2 text-xs text-amber-800">{orphans.length} of {types.length} published types.</p>
          <div className="flex flex-wrap gap-1.5">
            {orphans.slice(0, 120).map((type) => (
              <span key={type.code} className="rounded-md bg-amber-50 px-2 py-1 font-mono text-[11px] text-amber-900" title={type.label}>
                {type.code}
              </span>
            ))}
            {orphans.length > 120 ? <span className="px-2 py-1 text-[11px] text-slate-500">and {orphans.length - 120} more</span> : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
