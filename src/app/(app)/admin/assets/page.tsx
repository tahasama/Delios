import { isAdmin } from "@/lib/auth";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, Field, inputCls, DataTable, Th, Td } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { addAssetAction } from "@/lib/actions/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Asset breakdown" };

export default async function AdminAssetsPage() {
  const { user: me, db } = await requireScope();
  if (!isAdmin(me)) return <PageHeader title="Asset breakdown" subtitle="Administrators only." />;
  const [assets, counts] = await Promise.all([
    db.assetItem.findMany({ orderBy: { code: "asc" } }),
    db.relationship.groupBy({ by: ["toId"], _count: true, where: { kind: "DOC_ASSET" } }),
  ]);
  const countFor = (id: string) => counts.find((c) => c.toId === id)?._count ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Asset breakdown" subtitle="Equipment, systems and areas that documents are linked to." />
      <div className="space-y-4">
        <Card title={`Assets (${assets.length})`}>
          <DataTable head={<tr><Th>Code</Th><Th>Name</Th><Th>Area</Th><Th>System</Th><Th>Documents</Th></tr>}>
            {assets.map((a) => (
              <tr key={a.id}>
                <Td className="font-mono text-xs font-semibold">{a.code}</Td>
                <Td>{a.name}</Td>
                <Td className="text-xs">{a.area ?? "—"}</Td>
                <Td className="text-xs">{a.system ?? "—"}</Td>
                <Td className="tabular-nums text-xs">{countFor(a.id)}</Td>
              </tr>
            ))}
          </DataTable>
        </Card>
        <details className="rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm"><summary className="cursor-pointer text-sm font-semibold text-[#1e3a5f]">+ Add an asset</summary><div className="mt-3 max-w-2xl">
          <ActionForm action={addAssetAction} submitLabel="Add asset">
            <Field label="Tag / code" required><input name="code" required className={inputCls} placeholder="P-103" /></Field>
            <Field label="Name" required><input name="name" required className={inputCls} placeholder="Chemical dosing pump" /></Field>
            <Field label="Area"><input name="area" className={inputCls} placeholder="71" /></Field>
            <Field label="System"><input name="system" className={inputCls} placeholder="Dosing" /></Field>
          </ActionForm>
        </div></details>
      </div>
    </div>
  );
}
