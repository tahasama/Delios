import { requireScope } from "@/lib/scope";
import { isAdmin } from "@/lib/auth";
import { PageHeader, Card, Chip, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { getActiveSet } from "@/lib/config";
import {
  createFunctionAction,
  updateFunctionAction,
  savePermissionRuleAction,
  deletePermissionRuleAction,
} from "@/lib/actions/functions";
import { VERBS, VERB_LABEL, VERB_BLURB, type Verb } from "@/lib/permissions";
import { Check, Minus } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Functions & permissions" };

function parseVerbs(json: string): Verb[] {
  try {
    const raw = JSON.parse(json) as unknown;
    return Array.isArray(raw) ? VERBS.filter((v) => raw.includes(v)) : [];
  } catch {
    return [];
  }
}

export default async function FunctionsPage() {
  const { user: me, db } = await requireScope();
  if (!isAdmin(me)) {
    return <PageHeader title="Functions & permissions" subtitle="Administrators only." />;
  }

  const [functions, disciplines, docTypes, deliverableTypes, criticalities, confidentialities] = await Promise.all([
    db.function.findMany({
      orderBy: [{ active: "desc" }, { sort: "asc" }],
      include: {
        rules: { orderBy: { sort: "asc" } },
        _count: { select: { memberships: true } },
      },
    }),
    getActiveSet("DISCIPLINES"),
    getActiveSet("DOCUMENT_TYPES"),
    getActiveSet("DELIVERABLE_TYPES"),
    getActiveSet("CRITICALITY"),
    getActiveSet("CONFIDENTIALITY"),
  ]);

  // The grid answers "what can this function do anywhere?" — the union of its
  // rules. A rule narrowed to one discipline still shows here, with its
  // selector listed underneath, so nothing is hidden by the summary.
  const grid = functions.map((f) => {
    const held = new Set<Verb>();
    for (const rule of f.rules) for (const verb of parseVerbs(rule.verbs)) held.add(verb);
    return { fn: f, held };
  });

  const selectors = [
    // Discipline first: most grants are "this job, for this discipline".
    { name: "discipline", label: "Discipline", values: disciplines },
    { name: "deliverableType", label: "Deliverable type", values: deliverableTypes },
    { name: "docType", label: "Document type", values: docTypes },
    { name: "criticality", label: "Criticality", values: criticalities },
    { name: "confidentiality", label: "Confidentiality", values: confidentialities },
  ];

  const labelOf = (code: string | null) => {
    if (!code) return null;
    for (const sel of selectors) {
      const hit = sel.values.find((v) => v.code === code);
      if (hit) return hit.label;
    }
    return code;
  };
  const scopeText = (rule: (typeof functions)[number]["rules"][number]) =>
    [rule.deliverableType, rule.docType, rule.discipline, rule.criticality, rule.confidentiality].filter(Boolean).map(labelOf).join(" · ");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Functions & permissions"
        subtitle="Functions are the jobs people hold — Construction manager, HVAC technician, Project manager. What each may do comes from its rules here and in the distribution matrix; one function can create, review and approve."
      />

      <Card title="Who may do what">
        <div className="scroll-thin overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-semibold uppercase tracking-wide text-slate-400">Function</th>
                {VERBS.map((v) => (
                  <th key={v} className="px-2 py-2 text-center font-semibold text-slate-500" title={VERB_BLURB[v]}>
                    <span className="[writing-mode:vertical-rl] [text-orientation:mixed] rotate-180 whitespace-nowrap">{VERB_LABEL[v]}</span>
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-semibold uppercase tracking-wide text-slate-400">People</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {grid.map(({ fn, held }) => {
                const narrowed = fn.rules.map(scopeText).filter(Boolean);
                return (
                  <tr key={fn.id} className={fn.active ? "" : "opacity-45"}>
                    <td className="sticky left-0 z-10 bg-white px-3 py-2">
                      <p className="font-semibold text-slate-800">{fn.name}</p>
                      {narrowed.length ? <p className="text-[10px] text-slate-500">only for {narrowed.join("; ")}</p> : null}
                    </td>
                    {VERBS.map((v) => (
                      <td key={v} className="px-2 py-2 text-center">
                        {held.has(v) ? <Check className="mx-auto h-4 w-4 text-emerald-600" aria-label={`${fn.name} may ${VERB_LABEL[v]}`} /> : <Minus className="mx-auto h-3 w-3 text-slate-200" aria-label="not held" />}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right tabular-nums text-slate-500">{fn._count.memberships}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Change a function" description="Open one to edit its rules, clearance or retire it. Rules only add permissions; nothing takes them away.">
        <ul className="divide-y divide-slate-100">
          {functions.map((fn) => (
            <li key={fn.id}>
              <details>
                <summary className="flex cursor-pointer list-none items-center gap-3 py-2.5 text-sm">
                  <span className="font-semibold text-slate-800">{fn.name}</span>
                  <span className="text-xs text-slate-400">{fn._count.memberships} {fn._count.memberships === 1 ? "person" : "people"} · sees up to level {fn.clearance}</span>
                  {fn.active ? null : <Chip className="bg-slate-100 text-slate-500 ring-slate-300">retired</Chip>}
                  {fn.rules.length === 0 ? <span className="text-xs text-amber-700">no rules — can do nothing</span> : null}
                </summary>
                <div className="space-y-4 pb-4 pl-3">
                  <ul className="space-y-1.5">
                    {fn.rules.map((rule) => (
                      <li key={rule.id} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-slate-700">{scopeText(rule) || "All documents"}</span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            {parseVerbs(rule.verbs).map((v) => <Chip key={v} className="bg-emerald-50 text-emerald-800 ring-emerald-200">{VERB_LABEL[v]}</Chip>)}
                          </span>
                        </span>
                        <ActionForm action={deletePermissionRuleAction} submitLabel="Remove" variant="danger" size="sm" hidden={{ ruleId: rule.id }} className="shrink-0 space-y-0" />
                      </li>
                    ))}
                  </ul>

                  {fn.active ? (
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-[#315f83]">+ Add a rule</summary>
                      <div className="mt-3 max-w-2xl">
                        <ActionForm action={savePermissionRuleAction} submitLabel="Add rule" size="sm" hidden={{ functionId: fn.id }}>
                          <Field label="May" required>
                            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                              {VERBS.map((v) => (
                                <label key={v} className="flex items-center gap-2 text-xs text-slate-700" title={VERB_BLURB[v]}>
                                  <input type="checkbox" name="verbs" value={v} /> {VERB_LABEL[v]}
                                </label>
                              ))}
                            </div>
                          </Field>
                          <p className="text-[11px] text-slate-500">…on these documents (leave blank for all):</p>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {selectors.map((sel) => (
                              <Field key={sel.name} label={sel.label}>
                                <select name={sel.name} className={inputCls} defaultValue="">
                                  <option value="">Any</option>
                                  {sel.values.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
                                </select>
                              </Field>
                            ))}
                          </div>
                        </ActionForm>
                      </div>
                    </details>
                  ) : null}

                  <ActionForm action={updateFunctionAction} submitLabel="Save" size="sm" hidden={{ functionId: fn.id, name: fn.name }} className="flex flex-wrap items-center gap-3 space-y-0">
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      Sees confidentiality up to level
                      <input name="clearance" type="number" min={1} max={9} defaultValue={fn.clearance} className="w-16 rounded-md border border-slate-300 px-1.5 py-1 text-xs" />
                    </label>
                    <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" name="active" defaultChecked={fn.active} /> in use</label>
                  </ActionForm>
                </div>
              </details>
            </li>
          ))}
        </ul>

        <details className="mt-3 border-t border-slate-100 pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-[#315f83]">+ New function</summary>
          <div className="mt-3 max-w-2xl">
            <ActionForm action={createFunctionAction} submitLabel="Create function" size="sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Name" required hint="as your organization names the job"><input name="name" required className={inputCls} placeholder="Construction manager, HVAC technician…" /></Field>
                <Field label="Short code" required><input name="code" required className={`${inputCls} uppercase`} placeholder="ELEC_TECH" /></Field>
                <Field label="Sees confidentiality up to level" required><input name="clearance" type="number" min={1} max={9} defaultValue={2} className={inputCls} /></Field>
              </div>
              <Field label="May">
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {VERBS.map((v) => (
                    <label key={v} className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" name="verbs" value={v} defaultChecked={v === "READ"} /> {VERB_LABEL[v]}</label>
                  ))}
                </div>
              </Field>
            </ActionForm>
          </div>
        </details>
      </Card>
    </div>
  );
}
