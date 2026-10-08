import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { notFound } from "next/navigation";
import { PageHeader, Card, DataTable, Th, Td, Chip, EmptyState } from "@/components/ui";
import { DOC_STATE_LABEL, type DocState } from "@/lib/standard";

export const dynamic = "force-dynamic";

// §16.4 Q2 — all information for an asset in one query (B.3.6).
export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireScope();
  await params;
  // Assets are not in the backend: no asset is found.
  const asset = null as { id: string; code: string; name: string; area: string | null; system: string | null; unit: string | null } | null;
  if (!asset) notFound();
  const docs = [] as { id: string; docNumber: string; title: string; docType: string; discipline: string; state: string; revisions: { value: string; statusCode: string | null }[] }[];

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${asset.code} — ${asset.name}`}
        subtitle={[asset.area && `Area ${asset.area}`, asset.system, asset.unit].filter(Boolean).join(" · ")}
      />
      <Card title={`All controlled information for ${asset.code}`} description="Five types, three disciplines, two vendors — one query">
        {docs.length === 0 ? (
          <EmptyState title="No documents associated" body="Associate documents from the document page." />
        ) : (
          <DataTable head={<tr><Th>Document</Th><Th>Title</Th><Th>Type</Th><Th>Discipline</Th><Th>Current rev</Th><Th>State</Th></tr>}>
            {docs.map((d) => {
              const cur = d.revisions[0];
              return (
                <tr key={d.id}>
                  <Td><Link href={`/documents/${d.id}`} className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">{d.docNumber}</Link></Td>
                  <Td className="max-w-72"><span className="line-clamp-1">{d.title}</span></Td>
                  <Td className="font-mono text-xs">{d.docType}</Td>
                  <Td className="font-mono text-xs">{d.discipline}</Td>
                  <Td className="whitespace-nowrap text-xs">{cur ? `rev ${cur.value} · ${cur.statusCode ?? ""}` : "—"}</Td>
                  <Td><Chip>{DOC_STATE_LABEL[d.state as DocState] ?? d.state}</Chip></Td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>
    </div>
  );
}
