import { isAdmin } from "@/lib/auth";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, Chip, DataTable, Th, Td, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { removeNumberingSchemeAction, saveSchemeRoutingAction } from "@/lib/actions/admin";
import { NumberingSchemeBuilder } from "./numbering-scheme-builder";
import { getSets, getActiveSet } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Numbering schemes" };

export default async function AdminNumberingPage() {
  const { user: me, db } = await requireScope();
  if (!isAdmin(me)) return <PageHeader title="Numbering schemes" subtitle="Administrators only." />;
  const [schemes, routing, sets, deliverables, sample] = await Promise.all([
    db.scheme.findMany({ include: { fields: { orderBy: { position: "asc" } } }, orderBy: { name: "asc" } }),
    db.schemeRouting.findMany({ orderBy: { deliverableType: "asc" } }),
    getSets(),
    getActiveSet("DELIVERABLE_TYPES"),
    // A real code from each list, so the example below is a number people recognise.
    db.configValue.findMany({ where: { status: "ACTIVE" }, orderBy: [{ setKey: "asc" }, { sort: "asc" }], select: { setKey: true, code: true } }),
  ]);
  const firstCode = (setKey: string | null) => (setKey ? sample.find((v) => v.setKey === setKey)?.code ?? setKey.slice(0, 3).toUpperCase() : "—");
  const example = (scheme: (typeof schemes)[number]) => scheme.fields.map((f) => (f.rule ? "00001" : firstCode(f.valueSetKey))).join(scheme.delimiter);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Numbering schemes"
        subtitle="How a document number is built, and which scheme each kind of document uses. The codes themselves live in Disciplines, types & sets."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {schemes.map((s) => (
          <Card key={s.id} title={s.name} description={s.notes ?? undefined}>
            <div className="scroll-thin overflow-x-auto">
              <div className="flex items-end gap-1">
                {s.fields.map((f, i) => (
                  <div key={f.id} className="flex items-end gap-1">
                    {i ? <span className="pb-6 font-mono text-lg text-slate-300">{s.delimiter}</span> : null}
                    <div className="text-center">
                      <span className="block rounded-lg bg-slate-100 px-2.5 py-1.5 font-mono text-sm font-bold text-slate-800">{f.rule ? "00001" : firstCode(f.valueSetKey)}</span>
                      <span className="mt-1 block max-w-28 text-[10px] leading-3 text-slate-500">{f.label}</span>
                      <span className="block text-[10px] text-slate-300">{f.rule ? "counted" : f.valueSetKey ? sets.find((x) => x.key === f.valueSetKey)?.title ?? f.valueSetKey : ""}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">Looks like <span className="font-mono text-slate-700">{example(s)}</span> · {s.fields.length} parts joined by “{s.delimiter}”</p>
            <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600">Edit this scheme</summary>
              <div className="border-t border-slate-200 p-3"><NumberingSchemeBuilder id={s.id} initialName={s.name} initialDelimiter={s.delimiter} initialNotes={s.notes ?? ""} initialFields={s.fields.map((field) => ({ label: field.label, valueSetKey: field.valueSetKey ?? "", rule: field.rule ?? "" }))} sets={sets.map((set) => ({ key: set.key, title: set.title }))} /><form action={removeNumberingSchemeAction} className="mt-3 border-t border-slate-200 pt-3"><input type="hidden" name="id" value={s.id} /><button className="text-xs font-semibold text-red-600">Remove if it is not routed</button></form></div>
            </details>
          </Card>
        ))}
      </div>

      <details className="rounded-2xl border border-slate-200 bg-surface px-5 py-3 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-brand-ink">+ New numbering scheme</summary>
        <div className="mt-3"><NumberingSchemeBuilder sets={sets.map((set) => ({ key: set.key, title: set.title }))} /></div>
      </details>

      <Card
        title="Which documents use which scheme"
        description="One scheme per kind of producer. The kinds themselves — internal engineering, contractor, vendor — are a list in Disciplines, types & sets."
      >
        <DataTable head={<tr><Th>Deliverable type</Th><Th>Scheme · in use</Th><Th></Th></tr>}>
          {routing.map((r) => (
            <tr key={r.id} className={r.status === "ACTIVE" ? "" : "opacity-60"}>
              <Td className="font-mono text-xs font-semibold">{r.deliverableType}<span className="block font-sans text-[11px] font-normal text-slate-400">{deliverables.find((d) => d.code === r.deliverableType)?.label}</span></Td>
              <Td colSpan={2}>
                <ActionForm action={saveSchemeRoutingAction} submitLabel="Save" size="sm" hidden={{ deliverableType: r.deliverableType, status: "1" }} className="flex flex-wrap items-center gap-3 space-y-0">
                  <select name="schemeName" defaultValue={r.schemeName} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
                    {schemes.filter((sc) => sc.active || sc.name === r.schemeName).map((sc) => <option key={sc.id} value={sc.name}>{sc.name}</option>)}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" name="active" defaultChecked={r.status === "ACTIVE"} /> In use</label>
                </ActionForm>
              </Td>
            </tr>
          ))}
        </DataTable>
        <p className="mt-2 text-[11px] text-slate-400">Switching a type off stops new numbers of that type; numbers already issued keep their scheme.</p>
        <details className="mt-4 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs font-semibold text-link">+ Give a kind of document its scheme</summary><div className="mt-3"><ActionForm action={saveSchemeRoutingAction} submitLabel="Publish routing" size="sm"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Deliverable type" required><select name="deliverableType" className={inputCls} required defaultValue=""><option value="" disabled>Select…</option>{deliverables.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.label}</option>)}</select></Field><Field label="Numbering scheme" required><select name="schemeName" className={inputCls} required defaultValue=""><option value="" disabled>Select…</option>{schemes.map((scheme) => <option key={scheme.id} value={scheme.name}>{scheme.name}</option>)}</select></Field></div></ActionForm></div></details>
      </Card>

    </div>
  );
}
