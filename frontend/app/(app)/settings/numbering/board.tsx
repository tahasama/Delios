import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { SwitchControl } from "@/components/switch";
import { Choice } from "@/components/choice";
import { inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { cn } from "@/lib/core/utils";
import { saveSchemeRoutingAction, retireNumberingSchemeAction, deleteNumberingSchemeAction } from "@/lib/settings/forms-numbering";
import { NumberingSchemeBuilder } from "./numbering-scheme-builder";

/** Everything the application numbers that is not a document, routed to a scheme as a deliverable type is. */
const RECORDS: { code: string; label: string; note: string; fallback: string }[] = [
  { code: "TRANSMITTAL", label: "Transmittals", note: "every handover in or out", fallback: "TR-0001" },
  { code: "ACTION", label: "Actions", note: "what somebody has been asked to do", fallback: "AC-0001" },
  { code: "REVIEW", label: "Reviews", note: "one cycle of comments and a verdict", fallback: "RV-0001" },
  { code: "PACKAGE", label: "Packages", note: "documents handed over together", fallback: "PK-001" },
  { code: "ASSET", label: "Asset tags", note: "equipment, systems and areas", fallback: "TAG-0001" },
];

/** The app's lists a part may read, by their names: offered even where a list is not shown on Types & sets (Project codes). */
const APP_LISTS: { key: string; title: string }[] = [
  { key: "PROJECT_CODES", title: "Project codes" }, { key: "SUBPROJECTS", title: "Subprojects" },
  { key: "SUPPLIER_CODES", title: "Supplier codes" }, { key: "PURCHASE_ORDERS", title: "Purchase orders" },
  { key: "DISCIPLINES", title: "Disciplines" }, { key: "DOCUMENT_TYPES", title: "Document types" },
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
  // Every app list a part may read is offered and named, whatever the page found; then the organization's own.
  const lists = [...APP_LISTS.map((app) => sets.find((one) => one.key === app.key) ?? app), ...sets.filter((one) => !APP_LISTS.some((app) => app.key === one.key))];
  const listName = (key: string) => lists.find((one) => one.key === key)?.title ?? key.replaceAll("_", " ").toLowerCase();
  const firstCode = (setKey: string | null) => (setKey ? SET_SAMPLE[setKey] ?? setKey.replace(/_.*$/, "").slice(0, 3).toUpperCase() : "—");
  const shown = (field: BoardScheme["fields"][number]) => (field.rule ? ruleSample(field.rule) : null) ?? (field.rule ? "00001" : firstCode(field.valueSetKey));
  const example = (name: string) => {
    const scheme = schemes.find((s) => s.name === name);
    return scheme?.fields.length ? scheme.fields.map(shown).join(scheme.delimiter) : null;
  };
  const kinds = [
    ...deliverables.map((d) => ({ code: d.code, label: d.label, note: "", fallback: "" })),
    ...RECORDS,
  ];
  const rows = kinds.map((kind) => ({ ...kind, route: routing.find((r) => r.deliverableType === kind.code) ?? null }));
  const options = schemes.filter((s) => s.active);
  const nameOf = (code: string) => kinds.find((k) => k.code === code)?.label ?? code;
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
                  <span className="text-[13px] font-semibold text-slate-800">{r.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] leading-4 text-slate-500">{r.note || <span className="font-mono">{r.code}</span>}</span>
                </div>
                {editable ? (
                  <ActionForm action={saveSchemeRoutingAction} submitLabel="Save" size="sm" variant="secondary"
                    hidden={{ level, deliverableType: r.code, status: "1", ...(r.route ? {} : { active: "on" }) }}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 space-y-0 md:grid-cols-[12rem_minmax(0,1fr)_7rem_auto]">
                    <div className="col-span-2 md:col-span-1">
                      <Choice name="schemeName" label={`Scheme for ${r.label}`} defaultValue={r.route?.schemeName ?? ""} placeholder="Choose a scheme…"
                        options={options.concat(r.route && !options.some((o) => o.name === r.route!.schemeName) ? schemes.filter((s) => s.name === r.route!.schemeName) : [])
                          .map((s) => ({ value: s.name, label: s.name, hint: example(s.name) ?? "no parts yet" }))} />
                    </div>
                    <span className="col-span-2 min-w-0 truncate font-mono text-[12px] text-slate-500 md:col-span-1" title={r.route ? example(r.route.schemeName) ?? undefined : undefined}>
                      {r.route ? example(r.route.schemeName) ?? <span className="font-sans text-[11px] text-amber-700">its scheme has no parts yet</span> : r.fallback ? <span className="font-sans text-[11px]">keeps the short form <span className="font-mono">{r.fallback}</span></span> : <span className="font-sans text-[11px] text-amber-700">To do · nothing of it can be numbered until it has a scheme</span>}
                    </span>
                    {r.route ? (
                      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-600"><SwitchControl name="active" defaultChecked={on} /> Numbered</label>
                    ) : <span className="hidden md:block" />}
                  </ActionForm>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-4 text-[12.5px]">
                    <span className="w-48 font-semibold text-slate-700">{r.route?.schemeName ?? "—"}</span>
                    <span className="font-mono text-[12px] text-slate-500">{r.route ? example(r.route.schemeName) ?? "no parts yet" : r.fallback ? `short form ${r.fallback}` : "no scheme"}</span>
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
            <NumberingSchemeBuilder level={level} sets={lists} cancelHref={here} />
          </div>
        ) : null}
        <ul className="divide-y divide-line">
          {schemes.map((s) => {
            const used = routing.filter((r) => r.schemeName === s.name && r.status === "ACTIVE");
            if (editable && editId === s.id) {
              return (
                <li key={s.id} id={`scheme-${s.id}`}>
                  <NumberingSchemeBuilder level={level} id={s.id} initialName={s.name} initialDelimiter={s.delimiter} initialNotes={s.notes ?? ""}
                    initialFields={toBuilder(s)} sets={lists} fixedParts={s.used} cancelHref={here}
                    aside={<>
                      <span className="text-[11px] text-slate-500">{s.used
                        ? s.active
                          ? used.length ? `Retire it once nothing is numbered by it: choose another scheme for ${used.map((u) => nameOf(u.deliverableType)).join(", ")} first.` : "It numbers nothing now: it may be retired; numbers it gave stay."
                          : "Retired: bring it back to use it again."
                        : used.length
                          ? `It never gave a number, but numbers ${used.map((u) => nameOf(u.deliverableType)).join(", ")}: choose another scheme for it, then it may go.`
                          : "It never gave a number: it may go."}</span>
                      {s.used ? (
                        <ActionForm action={retireNumberingSchemeAction} size="sm" variant="secondary" submitLabel={s.active ? "Retire it" : "Bring it back"}
                          hidden={{ level, id: s.id, active: s.active ? "0" : "1" }} className="flex items-center gap-2 space-y-0" />
                      ) : used.length ? null : (
                        <ActionForm action={deleteNumberingSchemeAction} size="sm" variant="danger" submitLabel="Delete it"
                          confirmText={`Delete ${s.name}? It never gave a number.`} hidden={{ level, id: s.id }} className="flex items-center gap-2 space-y-0" />
                      )}
                    </>} />
                </li>
              );
            }
            return (
              <li key={s.id} id={`scheme-${s.id}`} className={cn("flex items-start gap-4 px-5 py-3 sm:px-6", s.active ? "" : "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-slate-800">
                    {s.name}
                    {s.active ? null : <span className="ml-2 text-[11px] font-semibold text-slate-500">retired</span>}
                    {s.used ? <span className="ml-2 text-[11px] font-normal text-slate-500">has given numbers · its parts are fixed</span> : null}
                  </p>
                  {s.notes ? <p className="text-[11.5px] leading-4 text-slate-500">{s.notes}</p> : null}
                  <div className="scroll-thin mt-2 overflow-x-auto">
                    <div className="flex items-start gap-1.5">
                      {s.fields.map((f, i) => (
                        <div key={f.id} className="flex items-start gap-1.5">
                          {i ? <span className="flex h-8 items-center font-mono text-base font-bold text-slate-400" aria-hidden="true">{s.delimiter}</span> : null}
                          <div className="text-center">
                            <span className="flex h-8 items-center justify-center rounded-md bg-slate-100 px-2.5 font-mono text-sm font-bold text-slate-800">{shown(f)}</span>
                            <span className="mt-1 block max-w-28 text-[11px] leading-3 text-slate-500">{f.label}</span>
                            <span className="block text-[11px] text-slate-400">{f.rule ? ruleSource(f.rule) : f.valueSetKey ? listName(f.valueSetKey) : ""}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {s.fields.length ? null : <p className="mt-1 text-[11.5px] text-amber-700">No parts yet: it gives no number until it has some.</p>}
                  <p className="mt-2 text-[11.5px] text-slate-500">
                    {example(s.name) ? <>Looks like <span className="font-mono text-slate-700">{example(s.name)}</span> · </> : null}
                    {used.length ? `numbers ${used.map((u) => nameOf(u.deliverableType)).join(", ")}` : "numbers nothing"}
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
