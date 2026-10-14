import Link from "next/link";
import { projectAsset } from "@/lib/records/api";
import { requireScope } from "@/lib/core/scope";
import { notFound } from "next/navigation";
import { Field, inputCls, DataTable, Th, Td, ToneChip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { DOC_STATE_LABEL, type DocState } from "@/lib/core/standard";
import { updateAssetAction, removeAssetAction } from "@/lib/settings/forms-admin";
import { ArrowLeft, Pencil, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * One tag, the action page's way: its plate, the documents that describe it (chosen in the register, as for an
 * action: ticked are linked, untick to unlink), and its details folded under them for whoever keeps the list.
 */
export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireScope();
  const { id } = await params;
  const found = await projectAsset(ctx, id);
  if (!found) notFound();
  const { asset, documents } = found;
  const keeper = ctx.can("CONTROL") || ctx.can("CONFIGURE");
  const released = documents.filter((d) => d.current).length;
  const disciplines = [...new Set(documents.map((d) => d.discipline))];

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col-reverse gap-3 px-5 pt-6 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{asset.code}</p>
            <h1 className="plate-name mt-1 min-w-0">{asset.name}</h1>
            <p className="plate-meta mt-2">
              {[asset.area && `Area ${asset.area}`, asset.system, asset.unit].filter(Boolean).join(" · ") || "No area, system or unit given"}
              {" · "}{documents.length} document{documents.length === 1 ? "" : "s"}, {released} released
              {disciplines.length ? ` · ${disciplines.join(", ")}` : ""}
            </p>
            {asset.description ? <p className="mt-1.5 max-w-3xl text-[13px] leading-5 text-slate-600">{asset.description}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/assets" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Assets &amp; tags</Link>
          </div>
        </div>
      </section>

      <section data-dt-frame className="register register-sheet">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Documents that describe it</span>
          <span className="text-[11px] text-slate-500">{documents.length ? `${released} of ${documents.length} released` : "none linked yet"}</span>
          {keeper ? (
            <Link href={`/documents?${new URLSearchParams({ pick: `asset:${asset.id}` })}`} className="ask ml-auto inline-flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add or take out</Link>
          ) : null}
        </div>
        {documents.length ? (
          <DataTable className="rounded-none border-0 shadow-none" id="asset-documents" exportName={asset.code}
            head={<tr><Th>Document</Th><Th>Type</Th><Th>Discipline</Th><Th>Released</Th><Th>State</Th></tr>}>
            {documents.map((d) => (
              <tr key={d.id}>
                <Td className={`rail ${d.current ? "rail-released" : "rail-prep"}`}>
                  <Link href={`/documents/${d.id}`} className="doc-number">{d.number}</Link>
                  <span className="block max-w-96 truncate text-xs text-slate-500">{d.title}</span>
                </Td>
                <Td className="font-mono text-xs">{d.docType}</Td>
                <Td className="font-mono text-xs">{d.discipline}</Td>
                <Td className="whitespace-nowrap text-xs">{d.current ? <>rev {d.current.value}{d.current.statusCode ? ` · ${d.current.statusCode}` : ""}</> : <span className="text-slate-400">not yet</span>}</Td>
                <Td><ToneChip tone={d.current ? "done" : "idle"}>{DOC_STATE_LABEL[d.state as DocState] ?? d.state}</ToneChip></Td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-slate-400 sm:px-6">
            {keeper ? "No document describes this tag yet. Choose them with “Add or take out”." : "No document describes this tag yet."}
          </p>
        )}
      </section>

      {keeper ? (
        <details className="register register-sheet register-sheet-open">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6 [&::-webkit-details-marker]:hidden">
            <span className="text-[13px] text-slate-600">Its name, area, system or unit changed?</span>
            <span className="ask inline-flex items-center gap-1.5"><Pencil className="h-3.5 w-3.5" /> Edit the tag</span>
          </summary>
          <div className="border-t border-line px-5 py-4 sm:px-6">
            <ActionForm action={updateAssetAction} submitLabel="Save" size="sm" hidden={{ id: asset.id }}>
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
                <Field label="Name" required className="md:col-span-3"><input name="name" required defaultValue={asset.name} className={inputCls} /></Field>
                <Field label="Area"><input name="area" defaultValue={asset.area ?? ""} className={inputCls} /></Field>
                <Field label="System"><input name="system" defaultValue={asset.system ?? ""} className={inputCls} /></Field>
                <Field label="Unit"><input name="unit" defaultValue={asset.unit ?? ""} className={inputCls} /></Field>
                <Field label="Description" hint="optional" className="md:col-span-3"><textarea name="description" rows={2} defaultValue={asset.description ?? ""} className={inputCls} /></Field>
              </div>
              <p className="text-[11px] text-slate-500">The tag itself never changes: drawings and documents cite it.</p>
            </ActionForm>
            {documents.length === 0 ? (
              <div className="mt-4 border-t border-line pt-3">
                <ActionForm action={removeAssetAction} submitLabel="Retire the tag" variant="danger" size="sm" hidden={{ id: asset.id }}
                  confirmText={`Retire ${asset.code}? Nothing is linked to it; it stays on record and is offered no more.`} className="space-y-0" />
              </div>
            ) : <p className="mt-3 text-[11px] text-slate-500">A tag that describes documents is kept; unlink them to retire it.</p>}
          </div>
        </details>
      ) : null}
    </div>
  );
}
