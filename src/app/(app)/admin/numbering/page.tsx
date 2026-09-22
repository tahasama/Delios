import { isAdmin } from "@/lib/auth";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, Chip, DataTable, Th, Td, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { issueNumberRangeAction, removeNumberingSchemeAction, saveSchemeRoutingAction } from "@/lib/actions/admin";
import { NumberingSchemeBuilder } from "./numbering-scheme-builder";
import { getSets, getActiveSet } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Numbering schemes" };

export default async function AdminNumberingPage() {
  const { user: me, db } = await requireScope();
  if (!isAdmin(me)) return <PageHeader title="Numbering schemes" subtitle="Administrators only." />;
  const [schemes, routing, counters, ranges, sets, deliverables] = await Promise.all([
    db.scheme.findMany({ include: { fields: { orderBy: { position: "asc" } } }, orderBy: { name: "asc" } }),
    db.schemeRouting.findMany({ orderBy: { deliverableType: "asc" } }),
    db.numberCounter.findMany({ orderBy: { prefix: "asc" }, take: 50 }),
    db.numberRange.findMany({ orderBy: { createdAt: "desc" } }),
    getSets(),
    getActiveSet("DELIVERABLE_TYPES"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Numbering schemes"
        subtitle="How document numbers are built, and which scheme each kind of document uses."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {schemes.map((s) => (
          <Card key={s.id} title={s.name} description={s.notes ?? undefined}>
            <ol className="space-y-1.5">
              {s.fields.map((f) => (
                <li key={f.id} className="flex items-center gap-2 text-sm">
                  <span className="grid h-5 w-5 place-items-center rounded bg-slate-100 font-mono text-[10px] font-bold text-slate-500">{f.position}</span>
                  <span className="font-medium text-slate-700">{f.label}</span>
                  {f.valueSetKey ? <Chip className="bg-sky-100 text-sky-700 ring-sky-300">{f.valueSetKey}</Chip> : null}
                  {f.rule ? <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-300">{f.rule}</Chip> : null}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-slate-400">Delimiter “{s.delimiter}” · example: {s.fields.map((f) => (f.rule ? "00001" : f.valueSetKey?.slice(0, 4).toUpperCase() ?? "—")).join(s.delimiter)}</p>
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

      <Card title="Which scheme each deliverable type uses">
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
        <details className="mt-4 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs font-semibold text-link">+ Route a deliverable type</summary><div className="mt-3"><ActionForm action={saveSchemeRoutingAction} submitLabel="Publish routing" size="sm"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Deliverable type" required><select name="deliverableType" className={inputCls} required defaultValue=""><option value="" disabled>Select…</option>{deliverables.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.label}</option>)}</select></Field><Field label="Numbering scheme" required><select name="schemeName" className={inputCls} required defaultValue=""><option value="" disabled>Select…</option>{schemes.map((scheme) => <option key={scheme.id} value={scheme.name}>{scheme.name}</option>)}</select></Field></div></ActionForm></div></details>
      </Card>

      <Card title="Number ranges given to other parties" description="Used first for that party; everything else comes from the system counter.">
        <DataTable head={<tr><Th>Prefix</Th><Th>Range</Th><Th>Issued to</Th><Th>Last issued</Th><Th>Status</Th></tr>}>
          {ranges.map((r) => (
            <tr key={r.id}>
              <Td className="font-mono text-xs">{r.prefix}</Td>
              <Td className="font-mono text-xs">{String(r.from).padStart(5, "0")}–{String(r.to).padStart(5, "0")}</Td>
              <Td>{r.issuedTo}</Td>
              <Td className="font-mono text-xs">{r.lastIssued >= r.from ? String(r.lastIssued).padStart(5, "0") : "—"}</Td>
              <Td><Chip className={r.status === "OPEN" ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : "bg-slate-100 text-slate-500 ring-slate-300"}>{r.status.toLowerCase()}</Chip></Td>
            </tr>
          ))}
          {ranges.length === 0 ? <tr><Td colSpan={5}><span className="text-xs text-slate-400">No ranges issued — the system counter allocates everything.</span></Td></tr> : null}
        </DataTable>
        <details className="mt-4 border-t border-slate-100 pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-link">+ Give a range</summary>
          <div className="mt-3">
          <ActionForm action={issueNumberRangeAction} submitLabel="Issue range" size="sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="Prefix" required><input name="prefix" required className={inputCls} placeholder="Q6637021-74-MAD-JESA593P22-ME" /></Field>
              <Field label="From" required><input type="number" name="from" required min={1} className={inputCls} /></Field>
              <Field label="To" required><input type="number" name="to" required min={1} className={inputCls} /></Field>
              <Field label="Issued to" required><input name="issuedTo" required className={inputCls} placeholder="MADASUD" /></Field>
            </div>
          </ActionForm>
          </div>
        </details>
      </Card>

      <Card title="Next numbers" description="The next sequence number per prefix. Set by the system.">
        <DataTable head={<tr><Th>Prefix</Th><Th>Next sequence</Th></tr>}>
          {counters.map((c) => (
            <tr key={c.id}>
              <Td className="font-mono text-xs">{c.prefix}</Td>
              <Td className="font-mono text-xs">{String(c.next).padStart(5, "0")}</Td>
            </tr>
          ))}
          {counters.length === 0 ? <tr><Td colSpan={2}><span className="text-xs text-slate-400">No numbers allocated yet.</span></Td></tr> : null}
        </DataTable>
      </Card>
    </div>
  );
}
