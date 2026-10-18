import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { SwitchControl } from "@/components/switch";
import { inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { cn } from "@/lib/core/utils";
import { saveSchemeRoutingAction, retireNumberingSchemeAction, deleteNumberingSchemeAction } from "@/lib/settings/forms-numbering";
import { NumberingSchemeBuilder } from "./numbering-scheme-builder";

/** Everything the application numbers that is not a document, routed to a scheme as a deliverable type is. */
const RECORDS: { code: string; label: string; fallback: string }[] = [
  { code: "TRANSMITTAL", label: "Transmittals: every handover in or out", fallback: "TR-0001" },
  { code: "ACTION", label: "Actions: what somebody has been asked to do", fallback: "AC-0001" },
  { code: "REVIEW", label: "Reviews: one cycle of comments and a verdict", fallback: "RV-0001" },
  { code: "PACKAGE", label: "Packages: documents handed over together", fallback: "PK-001" },
  { code: "ASSET", label: "Asset tags: equipment, systems and areas", fallback: "TAG-0001" },
];

/** What a part prints when it reads the record itself rather than a list. */
const RULE_SAMPLE: Record<string, string> = { PROJECT: "PRJ", SUBPROJECT: "SUB", SENDER: "SNDR", RECEIVER: "RCVR", REASON: "RSN" };
/** A stand-in for a part read from a list: never a real code, so the example shows the shape alone. */
const SET_SAMPLE: Record<string, string> = {
  PROJECT_CODES: "PRJ", SUBPROJECTS: "SUB", DISCIPLINES: "DIS", DOCUMENT_TYPES: "TYP",
  DELIVERABLE_TYPES: "DLV", SUPPLIER_CODES: "SUP", PURCHASE_ORDERS: "PO", PHASES: "PHS",
};

function ruleSample(rule: string): string | null {
  const said = rule.trim().toUpperCase();
  const fixed = rule.trim().match(/^FIXED\(([^)]*)\)$/i);
  if (fixed) return fixed[1] || "…";
  if (said.startsWith("COUNTER")) return "0".repeat(Math.max(1, Number(said.match(/DIGITS\((\d+)\)/)?.[1] ?? 4)) - 1) + "1";
  return RULE_SAMPLE[said] ?? null;
}
function ruleSource(rule: string): string {
  const said = rule.trim().toUpperCase();
  if (said.startsWith("COUNTER")) return "running number";
  if (said.startsWith("FIXED")) return "always this";
  if (said === "SENDER") return "who sends it";
  if (said === "RECEIVER") return "who receives it";
  return RULE_SAMPLE[said] ? `the record's ${said.toLowerCase()}` : "";
}

export type BoardScheme = {
  id: string; name: string; delimiter: string; active: boolean; notes: string | null; used: boolean;
  fields: { id: string; label: string; valueSetKey: string | null; rule: string | null }[];
};
export type BoardRouting = { deliverableType: string; schemeName: string; status: string };

/**
 * One numbering, read or changed: what is numbered and by which scheme, then the schemes themselves. The organization's
 * page and a project's Settings draw it the same way; `editable` says whether this person may change it here, `level`
 * where the change goes. A scheme that gave numbers is renamed or retired only (the backend holds it: SCHEME_IN_USE).
 */
export function NumberingBoard({ level, editable, schemes, routing, deliverables, sets, editId, adding, here }: {
  level: "organization" | "project";
  editable: boolean;
  schemes: BoardScheme[];
  routing: BoardRouting[];
  deliverables: { code: string; label: string }[];
  sets: { key: string; title: string }[];
  editId?: string;
  adding?: boolean;
  /** The page's own path, for the links that open a row. */
  here: string;
}) {
  const firstCode = (setKey: string | null) => (setKey ? SET_SAMPLE[setKey] ?? setKey.replace(/_.*$/, "").slice(0, 3).toUpperCase() : "—");
  const shown = (field: BoardScheme["fields"][number]) => (field.rule ? ruleSample(field.rule) : null) ?? (field.rule ? "00001" : firstCode(field.valueSetKey));
  const example = (name: string) => {
    const scheme = schemes.find((s) => s.name === name);
    return scheme ? scheme.fields.map(shown).join(scheme.delimiter) : "—";
  };
  const kinds = [
    ...deliverables.map((d) => ({ code: d.code, label: d.label, fallback: "" })),
    ...RECORDS,
  ];
  const rows = kinds.map((kind) => ({ ...kind, route: routing.find((r) => r.deliverableType === kind.code) ?? null }));
  const options = schemes.filter((s) => s.active);
  const toBuilder = (s: BoardScheme) => s.fields.map((f) => ({ label: f.label, valueSetKey: f.valueSetKey ?? "", rule: f.rule ?? "" }));

  return (
    <>
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">What is numbered</span>
          <span className="text-[11px] text-slate-500">numbers already given keep the scheme they were given under, whatever is chosen here</span>
        </div>
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const on = r.route?.status === "ACTIVE";
            return (
              <li key={r.code} id={`route-${r.code}`} className={cn("grid grid-cols-1 items-center gap-x-4 gap-y-2 px-5 py-2.5 target:bg-amber-50 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:px-6", r.route && !on ? "opacity-70" : "")}>
                <div className="min-w-0">
                  <span className="font-mono text-xs font-semibold text-slate-800">{r.code}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{r.label}</span>
                </div>
                {editable ? (
                  <ActionForm action={saveSchemeRoutingAction} submitLabel="Save" size="sm" variant={r.route ? "primary" : "secondary"}
                    hidden={{ level, deliverableType: r.code, status: "1", ...(r.route ? {} : { active: "on" }) }}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 space-y-0">
                    <label>
                      <span className="sr-only">Scheme for {r.code}</span>
                      <select name="schemeName" required defaultValue={r.route?.schemeName ?? ""} className={`${inputCls} w-48`}>
                        {r.route ? null : <option value="" disabled>Choose a scheme…</option>}
                        {options.concat(r.route && !options.some((o) => o.name === r.route!.schemeName) ? schemes.filter((s) => s.name === r.route!.schemeName) : [])
                          .map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                      </select>
                    </label>
                    <span className="min-w-40 font-mono text-[12px] text-slate-500">
                      {r.route ? example(r.route.schemeName) : r.fallback ? <span className="font-sans text-[11px]">keeps the short form <span className="font-mono">{r.fallback}</span></span> : <span className="font-sans text-[11px] text-amber-700">To do · nothing of it can be numbered until it has a scheme</span>}
                    </span>
                    {r.route ? (
                      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-600"><SwitchControl name="active" defaultChecked={on} /> Numbered</label>
                    ) : null}
                  </ActionForm>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-4 text-[12.5px]">
                    <span className="w-48 font-semibold text-slate-700">{r.route?.schemeName ?? "—"}</span>
                    <span className="font-mono text-[12px] text-slate-500">{r.route ? example(r.route.schemeName) : r.fallback ? `short form ${r.fallback}` : "no scheme"}</span>
                    {r.route && !on ? <span className="text-[11px] text-slate-500">not numbered</span> : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Schemes</span>
          <span className="text-[11px] text-slate-500">a scheme that gave numbers keeps its parts: renamed or retired only</span>
          {editable && !adding ? (
            <Link href={`${here}?new=1#new-scheme`} className="ml-auto rounded p-1 text-slate-500 hover:bg-surface hover:text-slate-800" title="A new scheme" aria-label="A new scheme">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        {editable && adding ? (
          <div id="new-scheme" className="border-b border-line">
            <NumberingSchemeBuilder level={level} sets={sets} />
            <div className="flex justify-end px-5 pb-3 sm:px-6"><Link href={here} className="text-xs font-semibold text-slate-500 hover:underline">Cancel</Link></div>
          </div>
        ) : null}
        <ul className="divide-y divide-line">
          {schemes.map((s) => {
            const used = routing.filter((r) => r.schemeName === s.name && r.status === "ACTIVE");
            if (editable && editId === s.id) {
              return (
                <li key={s.id} id={`scheme-${s.id}`}>
                  <NumberingSchemeBuilder level={level} id={s.id} initialName={s.name} initialDelimiter={s.delimiter} initialNotes={s.notes ?? ""}
                    initialFields={toBuilder(s)} sets={sets} fixedParts={s.used} />
                  <div className="flex flex-wrap items-start justify-end gap-2 px-5 pb-3 sm:px-6">
                    {s.used ? (
                      <ActionForm action={retireNumberingSchemeAction} size="sm" variant="secondary" submitLabel={s.active ? "Retire it" : "Bring it back"}
                        hidden={{ level, id: s.id, active: s.active ? "0" : "1" }} className="space-y-1" />
                    ) : (
                      <ActionForm action={deleteNumberingSchemeAction} size="sm" variant="danger" submitLabel="Delete it"
                        confirmText={`Delete ${s.name}? It never gave a number.`} hidden={{ level, id: s.id }} className="space-y-1" />
                    )}
                    <Link href={here} className="self-center text-xs font-semibold text-slate-500 hover:underline">Cancel</Link>
                  </div>
                </li>
              );
            }
            return (
              <li key={s.id} id={`scheme-${s.id}`} className={cn("flex items-start gap-4 px-5 py-3 sm:px-6", s.active ? "" : "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-slate-800">
                    {s.name}
                    {s.active ? null : <span className="ml-2 text-[11px] font-semibold text-slate-500">retired</span>}
                    {s.used ? <span className="ml-2 text-[11px] font-normal text-slate-500">has given numbers</span> : null}
                  </p>
                  {s.notes ? <p className="text-[11.5px] leading-4 text-slate-500">{s.notes}</p> : null}
                  <div className="scroll-thin mt-2 overflow-x-auto">
                    <div className="flex items-end gap-1">
                      {s.fields.map((f, i) => (
                        <div key={f.id} className="flex items-end gap-1">
                          {i ? <span className="pb-6 font-mono text-lg text-slate-300">{s.delimiter}</span> : null}
                          <div className="text-center">
                            <span className="block rounded-md bg-slate-100 px-2.5 py-1.5 font-mono text-sm font-bold text-slate-800">{shown(f)}</span>
                            <span className="mt-1 block max-w-28 text-[11px] leading-3 text-slate-500">{f.label}</span>
                            <span className="block text-[11px] text-slate-400">{f.rule ? ruleSource(f.rule) : f.valueSetKey ? sets.find((x) => x.key === f.valueSetKey)?.title ?? f.valueSetKey : ""}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="mt-2 text-[11.5px] text-slate-500">
                    Looks like <span className="font-mono text-slate-700">{example(s.name)}</span> · {used.length ? `numbers ${used.map((u) => u.deliverableType).join(", ")}` : "numbers nothing"}
                  </p>
                </div>
                {editable ? (
                  <Link href={`${here}?edit=${s.id}#scheme-${s.id}`} className="rounded p-1.5 text-slate-500 hover:bg-tint-soft hover:text-slate-800" title={`Change ${s.name}`} aria-label={`Change ${s.name}`}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                ) : null}
              </li>
            );
          })}
          {schemes.length ? null : <li className="px-5 py-3 text-xs text-slate-500 sm:px-6">No scheme yet.</li>}
        </ul>
      </section>
    </>
  );
}
