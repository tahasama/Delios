import { Select } from "@/components/select";
import Link from "next/link";
import { shownFilters as keptFilters } from "@/lib/core/filter-choice";
import { FilterMenu } from "@/components/filter-menu";
import { assetsPage } from "@/lib/records/api";
import { requireScope } from "@/lib/core/scope";
import { inputCls, DataTable, Th, Td } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { Asked, Added } from "@/components/policy-fields";
import { formPolicy } from "@/lib/settings/field-policy";
import { addAssetAction } from "@/lib/settings/forms-admin";
import { Search } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assets & tags" };

/**
 * The project's physical breakdown — equipment, systems, areas — as a register, the Schedule's way: a plate, a search
 * and the filters, the table, and what is added folded under it. Each tag opens its own page, where the documents
 * describing it are chosen in the register, as for an action.
 */
/** The most tags the table draws at once. */
const ASSETS_DRAWN = 500;

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ q?: string; area?: string; system?: string }> }) {
  const ctx = await requireScope();
  const policy = await formPolicy(ctx, "ASSET");
  const keeper = ctx.can("CONTROL") || ctx.can("CONFIGURE");
  const sp = await searchParams;
  const shown = await keptFilters("assets", ["area", "system"]);
  const q = (sp.q ?? "").trim();
  // A plant runs to thousands of tags: the backend counts all of them and sends only the first ones drawn, said so.
  const found = await assetsPage(ctx, { q: q || undefined, area: sp.area || undefined, system: sp.system || undefined, take: ASSETS_DRAWN });
  const { areas, systems, linked, bare } = found;
  const drawn = found.items;
  const tags = found.total;

  return (
    <div className="space-y-4">
      <section data-dt-frame className="register register-sheet">
        <div className="border-b border-line px-5 pt-5 pb-3 sm:px-6">
          <h1 className="plate-title text-slate-950">Assets &amp; tags</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            Equipment, systems and areas, and the controlled documents that describe each one. Open a tag to choose its documents in the register.
          </p>
          <p className="mt-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-900">{tags}</span> tag{tags === 1 ? "" : "s"} · {linked} document link{linked === 1 ? "" : "s"}
            {bare ? <> · <span className="text-amber-700">{bare} describe{bare === 1 ? "s" : ""} no document yet</span></> : null}
          </p>
        </div>
        {/* Search and filters, as on the Schedule: a dropdown applies at once. */}
        <form className="asking flex flex-wrap items-end gap-3 border-b border-line px-5 py-3 sm:px-6">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Find a tag</span>
            <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input name="q" defaultValue={q} placeholder="Find a tag, name, system or area" className="plain w-full !pl-7" />
          </label>
          {shown.includes("area") || sp.area ? (
            <Select name="area" defaultValue={sp.area ?? ""} className="plain" aria-label="Area">
              <option value="">Any area</option>
              {areas.map((one) => <option key={one} value={one}>Area {one}</option>)}
            </Select>
          ) : null}
          {shown.includes("system") || sp.system ? (
            <Select name="system" defaultValue={sp.system ?? ""} className="plain" aria-label="System">
              <option value="">Any system</option>
              {systems.map((one) => <option key={one} value={one}>{one}</option>)}
            </Select>
          ) : null}
          <FilterMenu page="assets" shown={shown} filters={[{ key: "area", label: "Area", held: !!sp.area }, { key: "system", label: "System", held: !!sp.system }]} />
          <button type="submit" className="ask">Apply</button>
        </form>
        {tags ? (
          <DataTable className="rounded-none border-0 shadow-none" id="assets" exportName="assets"
            head={<tr><Th>Tag</Th><Th>Name</Th><Th>Area</Th><Th>System</Th><Th>Unit</Th><Th className="text-right">Documents</Th></tr>}>
            {drawn.map((a) => (
              <tr key={a.id}>
                <Td className={`rail ${a.documents ? "rail-released" : "rail-none"}`}><Link href={`/assets/${a.id}`} className="doc-number">{a.code}</Link></Td>
                <Td className="text-[13px] text-slate-800">{a.name}</Td>
                <Td className="text-xs text-slate-600">{a.area ?? <span className="text-slate-300">—</span>}</Td>
                <Td className="text-xs text-slate-600">{a.system ?? <span className="text-slate-300">—</span>}</Td>
                <Td className="text-xs text-slate-600">{a.unit ?? <span className="text-slate-300">—</span>}</Td>
                <Td className="text-right text-xs tabular-nums">{a.documents ? a.documents : <span className="text-amber-700">none</span>}</Td>
              </tr>
            ))}
          </DataTable>
        ) : null}
        {tags > drawn.length ? (
          <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">{`The first ${drawn.length} of ${tags} tags, by tag. Find a tag, or choose an area or a system, to narrow them.`}</p>
        ) : null}
        {tags ? null : (
          <p className="px-5 py-8 text-center text-sm text-slate-400 sm:px-6">
            {q || sp.area || sp.system ? "Nothing matches that." : keeper ? "No tags yet. Add the first one below." : "No tags yet. The control function keeps the asset list."}
          </p>
        )}
      </section>

      {keeper ? (
        <details className="register register-sheet register-sheet-open" open={!found.total && !q && !sp.area && !sp.system}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6 [&::-webkit-details-marker]:hidden">
            <span className="text-[13px] text-slate-600">A piece of equipment, a system or an area not listed yet?</span>
            <span className="ask">New tag</span>
          </summary>
          <div className="border-t border-line px-5 py-4 sm:px-6">
            <ActionForm action={addAssetAction} submitLabel="Add the tag">
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
                <Asked policy={policy} field="name" className="md:col-span-3">
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
              <p className="text-[11px] text-slate-500">The tag is numbered by itself (Settings, Numbering, “Asset tags”), as a package is, and never changes.</p>
            </ActionForm>
          </div>
        </details>
      ) : null}
    </div>
  );
}
