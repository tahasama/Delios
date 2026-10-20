import { Select } from "@/components/select";
import { SwitchControl } from "@/components/switch";
import { DataTable, Th, Td, Field, inputCls, ToneChip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import type { RevisionSeries } from "@/lib/settings/api-admin";
import { createRevisionSchemeAction, updateRevisionSchemeAction, routeRevisionSchemeAction } from "@/lib/settings/forms-revisions";
import { Pencil, Plus } from "lucide-react";
import { SeriesRows } from "./series-rows";

/** The first values a series gives, to show what it looks like (the backend counts the real ones). */
function sample(s: RevisionSeries, count = 4): string {
  const out: string[] = [];
  if (s.kind === "NUMBERS") {
    const first = Number(s.start) || 0;
    for (let n = first; out.length < count; n++) out.push(s.prefix + String(n).padStart(s.width, "0"));
  } else {
    const excluded = new Set(s.excludedLetters.map((l) => l.toUpperCase()));
    for (let c = Math.max(0, s.start.toUpperCase().charCodeAt(0) - 65); c < 26 && out.length < count; c++) {
      const letter = String.fromCharCode(65 + c);
      if (!excluded.has(letter)) out.push(s.prefix + (s.lowercase ? letter.toLowerCase() : letter));
    }
  }
  return `${out.join(", ")}…`;
}

export type RevisionBoardScheme = { id: string; name: string; isDefault: boolean; forwardOnly: boolean; series: RevisionSeries[] };

/**
 * How revisions are named, read or changed: which deliverable type follows which scheme, then the schemes and their
 * lines. The organization's Settings and a project's draw it the same way; `editable` says whether this person may change
 * it here, `level` where the change goes. A line revisions already carry stays (backend SERIES_IN_USE).
 */
export function RevisionBoard({ level, editable, schemes, routing, deliverables, phases, lead }: {
  level: "organization" | "project";
  editable: boolean;
  schemes: RevisionBoardScheme[];
  routing: { deliverableType: string; schemeId: string }[];
  deliverables: { code: string; label: string }[];
  phases: { code: string; label: string }[];
  /** What the plate says of the level: whose naming this is. */
  lead?: React.ReactNode;
}) {
  const phaseName = (code: string | null | undefined) => (code ? phases.find((p) => p.code === code)?.label ?? code : "Any phase");
  const fallback = schemes.find((s) => s.isDefault) ?? null;
  const looks = (s: { series: RevisionSeries[] }) => s.series.map((one) => `${sample(one, 3)}${one.phase ? ` in ${phaseName(one.phase)}` : ""}`).join("; ");
  const hidden = { level };

  return (
    <>
      <section data-dt-frame className="register register-sheet">
        <div className="border-b border-line px-5 pt-5 pb-3 sm:px-6">
          <h1 className="plate-title text-slate-950">Revisions</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            How revisions are named, and which deliverable type follows which scheme. A type not chosen follows the default
            {fallback ? <> ({fallback.name}: {looks(fallback)})</> : null}. Revisions already named keep their values.
          </p>
          {lead ? <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">{lead}</p> : null}
        </div>
        <div className="flex items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Which type follows which</span>
        </div>
        {editable ? (
        <ActionForm action={routeRevisionSchemeAction} submitLabel="Save" size="sm" hidden={hidden} className="space-y-3 pb-4 [&>button]:ml-5 [&>p]:mx-5 [&>div[role=alert]]:mx-5 sm:[&>button]:ml-6">
          <DataTable className="rounded-none border-0 shadow-none" id="revision-routing"
            head={<tr><Th>Deliverable type</Th><Th>Follows</Th></tr>}>
            {deliverables.map((d) => (
              <tr key={d.code}>
                <Td>
                  <span className="font-mono text-xs font-semibold text-slate-800">{d.code}</span>
                  <span className="ml-2 text-[12px] text-slate-500">{d.label}</span>
                </Td>
                <Td>
                  <input type="hidden" name="deliverableType" value={d.code} />
                  <Select name={`scheme_${d.code}`} defaultValue={routing.find((r) => r.deliverableType === d.code)?.schemeId ?? ""} className={`${inputCls} w-72`} aria-label={`Scheme for ${d.code}`}>
                    <option value="">The default{fallback ? ` (${fallback.name})` : ""}</option>
                    {schemes.filter((s) => !s.isDefault).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Td>
              </tr>
            ))}
          </DataTable>
        </ActionForm>
        ) : (
          <DataTable className="rounded-none border-0 shadow-none" id="revision-routing" head={<tr><Th>Deliverable type</Th><Th>Follows</Th></tr>}>
            {deliverables.map((d) => (
              <tr key={d.code}>
                <Td>
                  <span className="font-mono text-xs font-semibold text-slate-800">{d.code}</span>
                  <span className="ml-2 text-[12px] text-slate-500">{d.label}</span>
                </Td>
                <Td className="text-[13px] text-slate-700">{schemes.find((s) => s.id === routing.find((r) => r.deliverableType === d.code)?.schemeId)?.name ?? `The default${fallback ? ` (${fallback.name})` : ""}`}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>

      {schemes.map((s) => (
        <section key={s.id} className="register register-sheet register-sheet-open">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 sm:px-6">
            <span className="text-[14px] font-semibold text-slate-900">{s.name}</span>
            {s.isDefault ? <ToneChip tone="done">default</ToneChip> : null}
            <span className="text-[11px] text-slate-500">
              {s.forwardOnly ? "only moves forward" : "may go back to an earlier series"}
              {" · "}{s.isDefault ? "every type not chosen" : routing.filter((r) => r.schemeId === s.id).map((r) => r.deliverableType).join(", ") || "no type follows it yet"}
            </span>
          </div>
          <DataTable className="rounded-none border-0 shadow-none" id={`scheme-${s.id}`}
            head={<tr><Th>Phase</Th><Th>Name</Th><Th>Counts in</Th><Th>Looks like</Th><Th>Letters skipped</Th></tr>}>
            {s.series.map((one) => (
              <tr key={one.code}>
                <Td className="text-[13px] text-slate-800">{phaseName(one.phase)}{one.phase ? null : <span className="ml-1.5 text-[11px] text-slate-500">the default</span>}</Td>
                <Td className="text-xs text-slate-600">{one.label}</Td>
                <Td className="text-xs text-slate-600">{one.kind === "NUMBERS" ? "numbers" : "letters"}</Td>
                <Td className="font-mono text-xs text-slate-700">{sample(one)}</Td>
                <Td className="text-xs text-slate-500">{one.excludedLetters.join(" ") || "—"}</Td>
              </tr>
            ))}
          </DataTable>
          {editable ? <details>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-t border-line px-5 py-3 sm:px-6 [&::-webkit-details-marker]:hidden">
              <span className="text-[13px] text-slate-600">Its name or its lines to change? A line revisions already carry stays, counted as it is.</span>
              <span className="ask inline-flex items-center" title="Change it" aria-label="Change it"><Pencil className="h-3.5 w-3.5" aria-hidden /></span>
            </summary>
            <div className="border-t border-line px-5 py-4 sm:px-6">
              <ActionForm action={updateRevisionSchemeAction} submitLabel="Save" size="sm" hidden={{ ...hidden, id: s.id }}>
                <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
                  <Field label="Name" required><input name="name" required defaultValue={s.name} className={inputCls} /></Field>
                  <label className="flex cursor-pointer items-center gap-2.5 self-end pb-1.5 text-[13px] text-slate-700"><SwitchControl name="forwardOnly" defaultChecked={s.forwardOnly} /> Only moves forward</label>
                  {s.isDefault ? null : <label className="flex items-center gap-2 self-end text-[13px] text-slate-700"><input type="checkbox" name="isDefault" /> Make it the default</label>}
                </div>
                <SeriesRows series={s.series} phases={phases} />
              </ActionForm>
            </div>
          </details> : null}
        </section>
      ))}

      {editable ? <details className="register register-sheet register-sheet-open" open={!schemes.length}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6 [&::-webkit-details-marker]:hidden">
          <span className="text-[13px] text-slate-600">Some documents named differently (P1, P2 for a supplier; another line per phase)?</span>
          <span className="ask inline-flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> New scheme</span>
        </summary>
        <div className="border-t border-line px-5 py-4 sm:px-6">
          <ActionForm action={createRevisionSchemeAction} submitLabel="Add the scheme" size="sm" hidden={hidden}>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
              <Field label="Name" required><input name="name" required className={inputCls} /></Field>
              <label className="flex cursor-pointer items-center gap-2.5 self-end pb-1.5 text-[13px] text-slate-700"><SwitchControl name="forwardOnly" defaultChecked /> Only moves forward</label>
            </div>
            <SeriesRows series={[]} phases={phases} />
          </ActionForm>
        </div>
      </details> : null}
    </>
  );
}
