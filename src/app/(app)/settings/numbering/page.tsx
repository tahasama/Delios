import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, DataTable, Th, Td, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { removeNumberingSchemeAction, saveSchemeRoutingAction } from "@/lib/actions/admin";
import { NumberingSchemeBuilder } from "./numbering-scheme-builder";
import { getSets, getActiveSet } from "@/lib/config";
import { legacyNumbering } from "@/lib/api/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Numbering" };

/**
 * Everything the application numbers that is not a document. Each is routed to
 * a scheme exactly as a deliverable type is, so the shape of a transmittal
 * number is set where the shape of a document number is set.
 *
 * Reviews and packages were missing from this list while the engine numbered
 * them all along, so two of the four could not be configured at all.
 */
const RECORDS: { code: string; label: string; fallback: string }[] = [
  { code: "TRANSMITTAL", label: "Transmittals — every handover in or out", fallback: "TR-0001" },
  { code: "ACTION", label: "Actions — what somebody has been asked to do", fallback: "AC-0001" },
  { code: "REVIEW", label: "Reviews — one cycle of comments and a verdict", fallback: "RV-0001" },
  { code: "PACKAGE", label: "Packages — documents handed over together", fallback: "PK-001" },
];

/** What a field prints when it reads the record itself rather than a list. */
const RULE_SAMPLE: Record<string, string> = {
  PROJECT: "PRJ", SUBPROJECT: "SUB", SENDER: "SNDR", RECEIVER: "RCVR", REASON: "RSN",
};

/**
 * A stand-in for a field that takes its value from a published list. It is
 * deliberately not a real code: a specimen built from live data reads as a
 * number somebody actually issued, and the example shows the shape alone.
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

export default async function NumberingPage() {
  const { user: me } = await requireScope();
  if (!maySetup(me, SETUP_PAGES.find((p) => p.href === "/settings/numbering")!)) {
    return <PageHeader title="Numbering" subtitle="Administrators and the control function." />;
  }
  const [{ schemes, routing }, sets, deliverables] = await Promise.all([
    legacyNumbering(),
    getSets(),
    getActiveSet("DELIVERABLE_TYPES"),
  ]);

  const firstCode = (setKey: string | null) => (setKey ? SET_SAMPLE[setKey] ?? setKey.replace(/_.*$/, "").slice(0, 3).toUpperCase() : "—");
  const shown = (field: { rule: string | null; valueSetKey: string | null }) =>
    (field.rule ? ruleSample(field.rule) : null) ?? (field.rule ? "00001" : firstCode(field.valueSetKey));
  const example = (name: string) => {
    const scheme = schemes.find((s) => s.name === name);
    return scheme ? scheme.fields.map(shown).join(scheme.delimiter) : "—";
  };

  /** Everything that can be routed, documents and records in one list. */
  const kinds = [
    ...deliverables.map((d) => ({ code: d.code, label: d.label, record: false, fallback: "" })),
    ...RECORDS.map((r) => ({ code: r.code, label: r.label, record: true, fallback: r.fallback })),
  ];
  const rows = kinds.map((kind) => ({ ...kind, route: routing.find((r) => r.deliverableType === kind.code) ?? null }));
  const unrouted = rows.filter((r) => !r.route);
  const options = schemes.filter((s) => s.active);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Numbering"
        subtitle="One table: everything the register numbers, and the scheme it is numbered by. A scheme is a list of parts; the codes that fill them live in Disciplines, types & sets."
      />

      <Card
        title="What uses which scheme"
        description="Choose a scheme — do not edit one that is in use. Numbers already issued keep the scheme they were issued under, whatever is chosen here."
      >
        <DataTable head={<tr><Th>What is numbered</Th><Th>Scheme</Th><Th>Looks like</Th><Th>In use</Th><Th></Th></tr>}>
          {rows.filter((r) => r.route).map((r) => (
            <tr key={r.code} className={r.route!.status === "ACTIVE" ? "" : "opacity-60"}>
              <Td>
                <span className="font-mono text-xs font-semibold text-slate-800">{r.code}</span>
                <span className="mt-0.5 block max-w-64 text-[11px] leading-4 text-slate-400">{r.label}</span>
              </Td>
              <Td colSpan={4}>
                <ActionForm
                  action={saveSchemeRoutingAction}
                  submitLabel="Save"
                  size="sm"
                  hidden={{ deliverableType: r.code, status: "1" }}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 space-y-0"
                >
                  <label className="min-w-44">
                    <span className="sr-only">Scheme for {r.code}</span>
                    <select name="schemeName" defaultValue={r.route!.schemeName} className={`${inputCls} w-44`}>
                      {options.concat(options.some((o) => o.name === r.route!.schemeName) ? [] : schemes.filter((s) => s.name === r.route!.schemeName)).map((s) => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                  <span className="min-w-48 font-mono text-[12px] text-slate-500">{example(r.route!.schemeName)}</span>
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <input type="checkbox" name="active" defaultChecked={r.route!.status === "ACTIVE"} /> In use
                  </label>
                </ActionForm>
              </Td>
            </tr>
          ))}
          {unrouted.map((r) => (
            <tr key={r.code} className="opacity-70">
              <Td>
                <span className="font-mono text-xs font-semibold text-slate-800">{r.code}</span>
                <span className="mt-0.5 block max-w-64 text-[11px] leading-4 text-slate-400">{r.label}</span>
              </Td>
              <Td colSpan={4}>
                <ActionForm
                  action={saveSchemeRoutingAction}
                  submitLabel="Route it"
                  size="sm"
                  variant="secondary"
                  hidden={{ deliverableType: r.code, status: "1", active: "on" }}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 space-y-0"
                >
                  <label className="min-w-44">
                    <span className="sr-only">Scheme for {r.code}</span>
                    <select name="schemeName" required defaultValue="" className={`${inputCls} w-44`}>
                      <option value="" disabled>Not routed…</option>
                      {options.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                  </label>
                  <span className="min-w-48 text-[11px] text-slate-400">
                    {r.fallback ? <>keeps the short form <span className="font-mono">{r.fallback}</span></> : "no number can be issued until it is routed"}
                  </span>
                </ActionForm>
              </Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <section>
        <h2 className="stencil mb-2 text-slate-400">The schemes themselves</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {schemes.map((s) => {
            const used = routing.filter((r) => r.schemeName === s.name);
            return (
              <Card key={s.id} title={s.name} description={s.notes ?? undefined}>
                <div className="scroll-thin overflow-x-auto">
                  <div className="flex items-end gap-1">
                    {s.fields.map((f, i) => (
                      <div key={f.id} className="flex items-end gap-1">
                        {i ? <span className="pb-6 font-mono text-lg text-slate-300">{s.delimiter}</span> : null}
                        <div className="text-center">
                          <span className="block rounded-lg bg-slate-100 px-2.5 py-1.5 font-mono text-sm font-bold text-slate-800">{shown(f)}</span>
                          <span className="mt-1 block max-w-28 text-[10px] leading-3 text-slate-500">{f.label}</span>
                          <span className="block text-[10px] text-slate-300">
                            {f.rule ? ruleSource(f.rule) : f.valueSetKey ? sets.find((x) => x.key === f.valueSetKey)?.title ?? f.valueSetKey : ""}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="mt-3 text-[11.5px] leading-[1.45] text-slate-500">
                  Looks like <span className="font-mono text-slate-700">{example(s.name)}</span> ·{" "}
                  {used.length ? `used by ${used.map((u) => u.deliverableType).join(", ")}` : "routed to nothing yet"}
                </p>
                <details className="mt-4 rounded-xl border border-line bg-tint-soft">
                  <summary className="cursor-pointer px-3 py-2 text-[11.5px] font-semibold text-slate-600">
                    {used.length ? "Edit — careful, it is in use" : "Edit this scheme"}
                  </summary>
                  <div className="border-t border-line p-3">
                    {used.length ? (
                      <p className="mb-3 text-[11px] leading-4 text-amber-700">
                        Numbers already issued keep their shape; editing changes only what is issued next. To number new documents differently, make a scheme and route to it instead.
                      </p>
                    ) : null}
                    <NumberingSchemeBuilder
                      id={s.id}
                      initialName={s.name}
                      initialDelimiter={s.delimiter}
                      initialNotes={s.notes ?? ""}
                      initialFields={s.fields.map((field) => ({ label: field.label, valueSetKey: field.valueSetKey ?? "", rule: field.rule ?? "" }))}
                      sets={sets.map((set) => ({ key: set.key, title: set.title }))}
                    />
                    <form action={removeNumberingSchemeAction} className="mt-3 border-t border-line pt-3">
                      <input type="hidden" name="id" value={s.id} />
                      <button className="text-[11.5px] font-semibold text-red-600">Remove if it is not routed</button>
                    </form>
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
      </section>

      <Card title="A new scheme" description="Build the shape, then route whatever should use it in the table above.">
        <NumberingSchemeBuilder sets={sets.map((set) => ({ key: set.key, title: set.title }))} />
      </Card>
    </div>
  );
}
