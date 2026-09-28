import { isAdmin } from "@/lib/auth";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, Chip, DataTable, Th, Td, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { removeNumberingSchemeAction, saveSchemeRoutingAction } from "@/lib/actions/admin";
import { NumberingSchemeBuilder } from "./numbering-scheme-builder";
import { getSets, getActiveSet } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Numbering schemes" };

/**
 * The records that are numbered by a scheme but are not documents. They are
 * routed the same way a deliverable type is, so an organization sets the shape
 * of a transmittal number where it sets the shape of a document number.
 */
const RECORDS: { code: string; label: string }[] = [
  { code: "TRANSMITTAL", label: "Transmittals — every handover in or out" },
  { code: "ACTION", label: "Actions — what somebody has been asked to do" },
];

/**
 * What a field prints. A document scheme's field takes its value from a
 * published list; a record scheme's field reads the record itself, so its
 * example is a specimen of that fact rather than a code from a list.
 */
const RULE_SAMPLE: Record<string, string> = {
  PROJECT: "PRJ", SUBPROJECT: "SUB", SENDER: "SNDR", RECEIVER: "RCVR", REASON: "RSN",
};

/**
 * A stand-in for a field that takes its value from a published list. It is
 * deliberately not a real code: a specimen number built from live data reads as
 * a number somebody actually issued, and the example is meant to show the shape
 * alone.
 */
const SET_SAMPLE: Record<string, string> = {
  PROJECT_CODES: "PRJ", SUBPROJECTS: "SUB", DISCIPLINES: "DIS", DOCUMENT_TYPES: "TYP",
  DELIVERABLE_TYPES: "DLV", SUPPLIER_CODES: "SUP", PURCHASE_ORDERS: "PO", PHASES: "PHS",
};
function ruleSample(rule: string): string | null {
  const said = rule.trim().toUpperCase();
  const fixed = said.match(/^FIXED\(([^)]+)\)$/);
  if (fixed) return fixed[1];
  if (said.startsWith("COUNTER")) {
    const digits = Number(said.match(/DIGITS\((\d+)\)/)?.[1] ?? 4);
    return "0".repeat(Math.max(1, digits) - 1) + "1";
  }
  return RULE_SAMPLE[said] ?? null;
}

/** What a field reads from, in words, under its example. */
function ruleSource(rule: string): string {
  const said = rule.trim().toUpperCase();
  if (said.startsWith("COUNTER")) return "counted";
  if (said.startsWith("FIXED")) return "always this";
  if (RULE_SAMPLE[said]) return `the record's ${said.toLowerCase()}`;
  return "rule";
}

export default async function AdminNumberingPage() {
  const { user: me, db } = await requireScope();
  if (!maySetup(me, SETUP_PAGES.find((p) => p.href === "/admin/numbering")!)) return <PageHeader title="Numbering schemes" subtitle="Administrators and the control function." />;
  const [schemes, routing, sets, deliverables] = await Promise.all([
    db.scheme.findMany({ include: { fields: { orderBy: { position: "asc" } } }, orderBy: { name: "asc" } }),
    db.schemeRouting.findMany({ orderBy: { deliverableType: "asc" } }),
    getSets(),
    getActiveSet("DELIVERABLE_TYPES"),
  ]);
  const firstCode = (setKey: string | null) => (setKey ? SET_SAMPLE[setKey] ?? setKey.replace(/_.*$/, "").slice(0, 3).toUpperCase() : "—");
  const shown = (field: { rule: string | null; valueSetKey: string | null }) =>
    (field.rule ? ruleSample(field.rule) : null) ?? (field.rule ? "00001" : firstCode(field.valueSetKey));
  const example = (scheme: (typeof schemes)[number]) => scheme.fields.map(shown).join(scheme.delimiter);
  const routes = routing.filter((route) => !RECORDS.some((record) => record.code === route.deliverableType));
  const recordRoutes = routing.filter((route) => RECORDS.some((record) => record.code === route.deliverableType));

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
                      <span className="block rounded-lg bg-slate-100 px-2.5 py-1.5 font-mono text-sm font-bold text-slate-800">{shown(f)}</span>
                      <span className="mt-1 block max-w-28 text-[10px] leading-3 text-slate-500">{f.label}</span>
                      <span className="block text-[10px] text-slate-300">{f.rule ? ruleSource(f.rule) : f.valueSetKey ? sets.find((x) => x.key === f.valueSetKey)?.title ?? f.valueSetKey : ""}</span>
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
          {routes.map((r) => (
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

      <Card
        title="Which records use which scheme"
        description="A transmittal and an action are numbered by a scheme too. Their fields read the record itself — who sent it, who it went to, why — rather than a list of codes. A field the record cannot answer is left out of the number."
      >
        <DataTable head={<tr><Th>Record</Th><Th>Scheme · in use</Th><Th></Th></tr>} toolbar={false}>
          {recordRoutes.map((r) => (
            <tr key={r.id} className={r.status === "ACTIVE" ? "" : "opacity-60"}>
              <Td className="font-mono text-xs font-semibold">
                {r.deliverableType}
                <span className="block max-w-56 font-sans text-[11px] font-normal text-slate-400">{RECORDS.find((record) => record.code === r.deliverableType)?.label}</span>
              </Td>
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
        <p className="mt-2 text-[11px] text-slate-400">
          With nothing routed here, transmittals keep the short form <span className="font-mono">TR-0001</span> and actions <span className="font-mono">AC-0001</span>. Numbers already raised never change.
        </p>
        <details className="mt-4 border-t border-slate-100 pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-link">+ Give a record its scheme</summary>
          <div className="mt-3">
            <ActionForm action={saveSchemeRoutingAction} submitLabel="Publish routing" size="sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Record" required>
                  <select name="deliverableType" className={inputCls} required defaultValue="">
                    <option value="" disabled>Select…</option>
                    {RECORDS.filter((record) => !recordRoutes.some((route) => route.deliverableType === record.code)).map((record) => (
                      <option key={record.code} value={record.code}>{record.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Numbering scheme" required>
                  <select name="schemeName" className={inputCls} required defaultValue="">
                    <option value="" disabled>Select…</option>
                    {schemes.map((scheme) => <option key={scheme.id} value={scheme.name}>{scheme.name}</option>)}
                  </select>
                </Field>
              </div>
            </ActionForm>
          </div>
        </details>
      </Card>

    </div>
  );
}
