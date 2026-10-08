import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, EmptyState, Card, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { Asked, Added } from "@/components/policy-fields";
import { formPolicy } from "@/lib/field-policy";
import { addAssetAction, updateAssetAction, removeAssetAction } from "@/lib/actions/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assets & tags" };

/**
 * The project's physical breakdown — equipment, systems, areas — and the
 * documents that describe each one. Document Control keeps the list here.
 */
export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireScope();
  const policy = await formPolicy(ctx, "ASSET");
  const keeper = ctx.can("CONTROL") || ctx.can("CONFIGURE");
  const q = ((await searchParams).q ?? "").trim();
  // Assets are not in the backend: there are none to list, and no documents linked to them.
  const [assets, counts] = [
    [] as { id: string; code: string; name: string; area: string | null; system: string | null; unit: string | null; description: string | null; extras: string | null }[],
    [] as { toId: string; _count: number }[],
  ];
  const countFor = (id: string) => counts.find((c) => c.toId === id)?._count ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assets & tags"
        subtitle="Equipment, systems and areas, and every controlled document that describes each one. Link a document to a tag from the document's Details."
      />

      {keeper ? (
        <details className="rounded-2xl border border-line bg-surface px-5 py-3 shadow-sm" open={!assets.length && !q}>
          <summary className="cursor-pointer text-sm font-semibold text-brand-ink">+ Add an asset</summary>
          <div className="mt-3 max-w-3xl">
            <ActionForm action={addAssetAction} submitLabel="Add asset" size="sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Asked policy={policy} field="code" hint="as on the drawings, e.g. P-101">
                  {({ required }) => <input name="code" required={required} className={`${inputCls} uppercase`} placeholder="P-101" />}
                </Asked>
                <Asked policy={policy} field="name" className="sm:col-span-2">
                  {({ required }) => <input name="name" required={required} className={inputCls} placeholder="Feed pump" />}
                </Asked>
                <Asked policy={policy} field="area">
                  {({ required }) => <input name="area" required={required} className={inputCls} placeholder="20" />}
                </Asked>
                <Asked policy={policy} field="system">
                  {({ required }) => <input name="system" required={required} className={inputCls} placeholder="Raw water feed" />}
                </Asked>
                <Asked policy={policy} field="unit">
                  {({ required }) => <input name="unit" required={required} className={inputCls} placeholder="U-100" />}
                </Asked>
                <Added fields={policy.own} />
              </div>
            </ActionForm>
          </div>
        </details>
      ) : null}

      <form className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Find a tag, name, system or area…" className={`${inputCls} max-w-sm`} />
      </form>

      {assets.length === 0 ? (
        <EmptyState title={q ? `Nothing matches “${q}”` : "No assets yet"} body={keeper ? "Add the first one above." : "Document Control keeps the asset list."} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => (
            <Card key={a.id} className="p-0">
              <Link href={`/assets/${a.id}`} className="block rounded-xl transition hover:bg-slate-50/70">
                <p className="font-mono text-sm font-bold text-brand-ink">{a.code}</p>
                <p className="mt-0.5 text-sm text-slate-700">{a.name}</p>
                <p className="mt-1 text-xs text-slate-400">{[a.area && `area ${a.area}`, a.system, a.unit].filter(Boolean).join(" · ") || "—"}</p>
                <p className="mt-2 text-xs font-medium text-slate-500">{countFor(a.id)} document{countFor(a.id) === 1 ? "" : "s"}</p>
              </Link>
              {keeper ? (
                <details className="mt-2 border-t border-line pt-2">
                  <summary className="cursor-pointer text-xs font-semibold text-link">Edit</summary>
                  <div className="mt-2 space-y-2">
                    <ActionForm action={updateAssetAction} submitLabel="Save" size="sm" hidden={{ id: a.id }}>
                      <Field label="Name" required><input name="name" required defaultValue={a.name} className={inputCls} /></Field>
                      <div className="grid grid-cols-3 gap-2">
                        <Field label="Area"><input name="area" defaultValue={a.area ?? ""} className={inputCls} /></Field>
                        <Field label="System"><input name="system" defaultValue={a.system ?? ""} className={inputCls} /></Field>
                        <Field label="Unit"><input name="unit" defaultValue={a.unit ?? ""} className={inputCls} /></Field>
                      </div>
                    </ActionForm>
                    {countFor(a.id) === 0 ? (
                      <ActionForm action={removeAssetAction} submitLabel="Remove" variant="danger" size="sm" hidden={{ id: a.id }} confirmText={`Remove ${a.code}? Nothing is linked to it.`} className="space-y-0" />
                    ) : <p className="text-[11px] text-slate-400">The tag stays fixed; it can be removed once no document is linked.</p>}
                  </div>
                </details>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
