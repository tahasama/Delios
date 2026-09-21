import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, EmptyState, ButtonLink } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assets & tags" };

export default async function AssetsPage() {
  const { db } = await requireScope();
  const [assets, counts] = await Promise.all([
    db.assetItem.findMany({ orderBy: { code: "asc" } }),
    db.relationship.groupBy({ by: ["toId"], _count: true, where: { kind: "DOC_ASSET" } }),
  ]);
  const countFor = (id: string) => counts.find((c) => c.toId === id)?._count ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assets & tags"
        subtitle="Browse equipment, systems and areas, then open one to see every controlled document associated with it."
        actions={<ButtonLink href="/reports" variant="secondary">Open reports</ButtonLink>}
      />
      {assets.length === 0 ? (
        <EmptyState title="No assets" body="Assets are managed by the administrator." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => (
            <Link key={a.id} href={`/assets/${a.id}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-[#2d5480]/40 hover:shadow">
              <p className="font-mono text-sm font-bold text-[#1e3a5f]">{a.code}</p>
              <p className="mt-0.5 text-sm text-slate-700">{a.name}</p>
              <p className="mt-1 text-xs text-slate-400">{[a.area && `area ${a.area}`, a.system, a.unit].filter(Boolean).join(" · ")}</p>
              <p className="mt-2 text-xs font-medium text-slate-500">{countFor(a.id)} associated document{countFor(a.id) === 1 ? "" : "s"}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
