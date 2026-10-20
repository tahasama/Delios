import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { SwitchControl } from "@/components/switch";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { Chip, DataTable, Field, Th, Td, btn, inputCls } from "@/components/ui";
import { ActionForm, ConfirmButton } from "@/components/form";
import { getActiveSet } from "@/lib/settings/config";
import {
  createFunctionAction,
  updateFunctionAction,
  savePermissionRuleAction,
  deletePermissionRuleAction,
  toggleFunctionVerb,
} from "@/lib/settings/forms-functions";
import { VERBS, GRANTABLE, VERB_LABEL, VERB_BLURB, type Verb } from "@/lib/core/permissions";
import { CONTRACT_ROLES } from "@/lib/settings/profiles/roles";
import { Check, ChevronDown, ChevronRight, Contrast, Minus, Plus, Trash2 } from "lucide-react";
import { functionsForMatrix, projectFunctionsForMatrix } from "@/lib/settings/api-admin";
import { NoAccess } from "../no-access";
import { requireOrgAdmin } from "@/lib/core/org-scope";

/** A list longer than this is shared on the page rather than repeated in each form. */
const LONG = 30;

function parseVerbs(json: string): Verb[] {
  try {
    const raw = JSON.parse(json) as unknown;
    return Array.isArray(raw) ? VERBS.filter((v) => raw.includes(v)) : [];
  } catch {
    return [];
  }
}

/**
 * Functions & permissions, the same card in both Settings (owner): the functions themselves (name, code, clearance, in
 * use) are the organization's, created and changed in the organization's Settings by an administrator. What each may do
 * is the organization's too, unless the organization leaves it free: then a project's control function changes it for
 * that project, its first change taking the project's own copy (owner: "we should be able to change functions on a
 * project level"). Configure stays the organization's. Who holds which function on a project is changed in People & access.
 *
 * One place per function: the grid's ticks give a permission on every document; a function's name opens it under its
 * line (`?open=<id>`), with every rule it holds (every document, or certain documents only), "Add a rule" and, in the
 * organization's Settings, the function itself. The key under the grid says what each permission allows.
 */
export async function FunctionsBoard({ level, open, adding }: { level: "project" | "organization"; open?: string; adding?: boolean }) {
  let scope: { projectId: string } | null = null;
  if (level === "organization") await requireOrgAdmin();
  else {
    const ctx = await requireScope();
    if (!maySetup(ctx.user, SETUP_PAGES.find((p) => p.href === "/settings/functions")!)) {
      return <NoAccess title="Functions & permissions" who="control" />;
    }
    scope = ctx;
  }
  const here = level === "organization" ? "/organization/settings/functions" : "/settings/functions";

  const project = scope ? await projectFunctionsForMatrix(scope) : null;
  const [functions, disciplines, docTypes, deliverableTypes, criticalities, confidentialities] = await Promise.all([
    project ? Promise.resolve(project.functions) : functionsForMatrix(),
    getActiveSet("DISCIPLINES"),
    getActiveSet("DOCUMENT_TYPES"),
    getActiveSet("DELIVERABLE_TYPES"),
    getActiveSet("CRITICALITY"),
    getActiveSet("CONFIDENTIALITY"),
  ]);
  // The functions themselves are changed in the organization's Settings only; what each may do, there, or on a project
  // where the organization leaves it free, by its control function.
  const admin = level === "organization";
  const rights = admin || (!!project?.free && !!project?.mayChange);
  /** A permission a project never changes: Configure is the organization's. */
  const fixedHere = (v: Verb) => !admin && v === "CONFIGURE";
  const clearanceOf = (code: string | null) => (code ? confidentialities.find((c) => c.code === code)?.label ?? code : null);
  const withClearance = functions.some((f) => f.clearance);

  type Rule = (typeof functions)[number]["rules"][number];
  const narrow = (r: Rule) => !!(r.deliverableType || r.docType || r.discipline || r.criticality || r.confidentiality || r.projectRole);

  // The grid answers "what can this function do on every document?": the rule naming no documents. What a function
  // holds for certain documents only is marked apart (half) and listed when it is opened.
  const grid = functions.map((f) => {
    const held = new Set<Verb>();
    for (const rule of f.rules.filter((r) => !narrow(r))) for (const verb of parseVerbs(rule.verbs)) held.add(verb);
    const partly = new Set<Verb>();
    for (const rule of f.rules.filter(narrow)) for (const verb of parseVerbs(rule.verbs)) partly.add(verb);
    return { fn: f, held, partly };
  });

  const selectors = [
    // Discipline first: most grants are "this job, for this discipline".
    { name: "discipline" as const, label: "Discipline", values: disciplines },
    { name: "deliverableType" as const, label: "Deliverable type", values: deliverableTypes },
    { name: "docType" as const, label: "Document type", values: docTypes },
    { name: "criticality" as const, label: "Criticality", values: criticalities },
    { name: "confidentiality" as const, label: "Confidentiality", values: confidentialities },
    // Not a property of the document: what this organization is contracted to
    // do on the project. A row stating one applies to projects of that role and
    // to no other, which is how one matrix serves EPC and PMC work at once.
    { name: "projectRole" as const, label: "Only where our role is", values: CONTRACT_ROLES.filter((r) => r.code !== "GENERIC").map((r) => ({ code: r.code, label: r.label })) },
  ];
  /** Which documents a rule covers, each value with its field's name. */
  const scopeOf = (rule: Rule) =>
    selectors
      .filter((sel) => rule[sel.name])
      .map((sel) => ({ field: sel.label, value: sel.values.find((v) => v.code === rule[sel.name])?.label ?? rule[sel.name]! }));

  const plateLine = admin
    ? "The jobs people hold, and what each may do. Every project reads them, unless it changed what each may do for itself where that is left free."
    : project?.own
      ? "The organization's functions; what each may do here is this project's own copy, which the organization's later changes never touch. Configure stays the organization's."
      : project?.free
        ? `The organization's functions, and what each may do as the organization has it.${rights ? " Change one here and the project takes its own copy, which the organization's later changes never touch." : " The control function changes it for this project."}`
        : "The organization's functions and what each may do, the same on every project: an administrator changes them in the organization's Settings.";
  const columns = 2 + GRANTABLE.length + (withClearance ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* The long lists, once for the whole page; every rule form points here. */}
      {selectors.filter((sel) => sel.values.length > LONG).map((sel) => (
        <datalist key={sel.name} id={`list-${sel.name}`}>
          {sel.values.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
        </datalist>
      ))}

      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col gap-3 px-5 pt-5 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="plate-title text-slate-950">Functions & permissions</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              {plateLine}{" "}
              {admin ? null : <>Who holds which function here is changed in <Link href="/settings/users" className="font-semibold text-link hover:underline">People & access</Link>.</>}
            </p>
          </div>
          {admin && !adding ? (
            <Link href={`${here}?new=1`} scroll={false} className="ask inline-flex shrink-0 items-center gap-1.5"><Plus className="h-3.5 w-3.5" aria-hidden /> New function</Link>
          ) : null}
        </div>
      </section>

      {admin && adding ? (
        <section className="register register-sheet register-sheet-open">
          <div className="flex flex-wrap items-baseline gap-2 border-b border-line px-5 py-3 sm:px-6">
            <span className="text-[14px] font-semibold text-slate-900">New function</span>
            <span className="text-[11px] text-slate-500">offered on every project once added</span>
          </div>
          <ActionForm action={createFunctionAction} hideSubmit hidden={{ back: here }} className="space-y-0" footerClassName="px-5 pb-4 empty:hidden sm:px-6">
            <div className="space-y-4 px-5 py-4 sm:px-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Name" required hint="as your organization names the job"><input name="name" required className={inputCls} placeholder="Construction manager, HVAC technician…" /></Field>
                <Field label="Short code" required hint="never changes once added"><input name="code" required className={`${inputCls} uppercase`} placeholder="ELEC_TECH" /></Field>
                <Field label="Clearance" hint="the most confidential level it reads without being named on the document">
                  <select name="clearance" defaultValue="" className={inputCls}>
                    <option value="">No limit</option>
                    {confidentialities.map((c) => <option key={c.code} value={c.code}>Up to {c.label}</option>)}
                  </select>
                </Field>
              </div>
              <VerbTicks verbs={GRANTABLE} label="May, on every document" checked={["READ"]} />
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-line bg-tint-soft px-5 py-2.5 sm:px-6">
              <Link href={here} scroll={false} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
              <button type="submit" className={btn("primary", "sm")}>Add the function</button>
            </div>
          </ActionForm>
        </section>
      ) : null}

      <section className="register register-sheet register-sheet-open overflow-hidden">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Who may do what</span>
          <span className="text-[11px] text-slate-500">
            {rights
              ? "a tick gives a permission on every document, untick to take it; a function's name opens it, with what it holds for certain documents only"
              : "a tick is a permission on every document; a half one, on certain documents only (its name opens them)"}
          </span>
        </div>
        <DataTable id="functions-grid" toolbar={false} className="rounded-none border-0 shadow-none"
          head={
              <tr>
                <Th className="sticky left-0 z-4 min-w-44 bg-surface align-bottom">Function</Th>
                {GRANTABLE.map((v) => (
                  <Th key={v} label={VERB_LABEL[v]} title={VERB_BLURB[v]} className="px-1.5 text-center align-bottom normal-case tracking-normal">
                    <span className="block whitespace-nowrap text-[11px] font-semibold text-slate-600">{VERB_LABEL[v]}</span>
                  </Th>
                ))}
                {withClearance ? <Th className="align-bottom">Clearance</Th> : null}
                <Th className="text-right align-bottom">People</Th>
              </tr>
          }
        >
              {grid.map(({ fn, held, partly }) => {
                const isOpen = open === fn.id;
                const narrowCount = fn.rules.filter(narrow).length;
                return [
                  <tr key={fn.id} id={`fn-${fn.id}`} className={`scroll-mt-20 ${isOpen ? "bg-tint-soft" : ""} ${fn.active ? "" : "text-slate-400"}`}>
                    <Td className={`sticky left-0 z-1 py-2 ${isOpen ? "bg-tint-soft" : "bg-surface"}`}>
                      <Link href={isOpen ? here : `${here}?open=${fn.id}#fn-${fn.id}`} scroll={false} aria-expanded={isOpen}
                        className="group inline-flex items-center gap-1 font-semibold text-slate-800 hover:text-link">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-link" aria-hidden />}
                        {fn.name}
                      </Link>
                      {fn.active ? null : <span className="ml-1.5 text-[11px] text-slate-500">· not in use</span>}
                      {narrowCount ? <p className="ml-4.5 text-[11px] text-slate-500">and {narrowCount === 1 ? "1 rule" : `${narrowCount} rules`} for certain documents</p> : null}
                    </Td>
                    {GRANTABLE.map((v) => {
                      const on = held.has(v);
                      const half = !on && partly.has(v);
                      const mark = on ? <Check className="h-3.5 w-3.5" aria-hidden /> : half ? <Contrast className="h-3.5 w-3.5" aria-hidden /> : <Minus className="h-3 w-3" aria-hidden />;
                      return (
                        <Td key={v} className="px-1.5 py-1 text-center">
                          {rights && !fixedHere(v) && fn.active ? (
                            <form action={toggleFunctionVerb}>
                              <input type="hidden" name="level" value={level} />
                              <input type="hidden" name="functionId" value={fn.id} />
                              <input type="hidden" name="verb" value={v} />
                              <ConfirmButton
                                confirm={`${on ? "Take" : "Give"} ${VERB_LABEL[v]} ${on ? "from" : "to"} everyone who holds ${fn.name}${fn._count.memberships ? ` (${fn._count.memberships} ${fn._count.memberships === 1 ? "person" : "people"})` : ""}${on ? "" : half ? ", on every document (today only on certain documents)" : ""}?`}
                                aria-pressed={on}
                                title={`${on ? "Take" : "Give"} ${VERB_LABEL[v]} ${on ? "from" : "to"} ${fn.name} on every document${half ? "; it holds it for certain documents only today" : ""}`}
                                className={`mx-auto grid h-6 w-6 place-items-center rounded-md ring-1 transition ${on ? "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100" : half ? "bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100" : "text-slate-300 ring-transparent hover:text-slate-500 hover:ring-line-strong"}`}
                              >
                                {mark}
                              </ConfirmButton>
                            </form>
                          ) : (
                            <span title={on ? `${VERB_LABEL[v]}, on every document` : half ? `${VERB_LABEL[v]}, on certain documents only` : undefined}
                              className={`mx-auto grid h-6 w-6 place-items-center ${on ? "text-emerald-700" : half ? "text-amber-700" : "text-slate-300"}`}>
                              {mark}
                            </span>
                          )}
                        </Td>
                      );
                    })}
                    {withClearance ? <Td className="whitespace-nowrap py-2 text-slate-600">{clearanceOf(fn.clearance) ? `up to ${clearanceOf(fn.clearance)}` : <span className="text-slate-400">no limit</span>}</Td> : null}
                    <Td className="py-2 text-right tabular-nums text-slate-500">{fn._count.memberships}</Td>
                  </tr>,
                  isOpen ? (
                    <tr key={`${fn.id}-open`} className="bg-tint-soft">
                      <td colSpan={columns} className="px-5 pt-1 pb-5 sm:px-6">
                        <div className="space-y-4 rounded-md bg-surface p-4 ring-1 ring-line">
                          <FunctionRules fn={fn} rules={fn.rules} level={level} rights={rights && fn.active} fixedHere={fixedHere} scopeOf={scopeOf} selectors={selectors} />
                          {admin ? (
                            <FunctionItself fn={fn} confidentialities={confidentialities} />
                          ) : (
                            <p className="border-t border-line pt-3 text-[11px] text-slate-500">
                              Its name and clearance ({clearanceOf(fn.clearance) ? `up to ${clearanceOf(fn.clearance)}` : "no limit"}) are the organization&rsquo;s, changed in the organization&rsquo;s Settings.
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
        </DataTable>
      </section>

      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">What each permission allows</span>
          <span className="text-[11px] text-slate-500">a person may do what any rule of their function allows</span>
        </div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2.5 px-5 py-4 text-xs leading-5 sm:grid-cols-2 sm:px-6 xl:grid-cols-3">
          {GRANTABLE.map((v) => (
            <div key={v} className="min-w-0">
              <dt className="font-semibold text-slate-800">{VERB_LABEL[v]}{fixedHere(v) ? <span className="ml-1.5 font-normal text-slate-500">· the organization&rsquo;s</span> : null}</dt>
              <dd className="text-slate-600">{VERB_BLURB[v]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/** Ticks for the permissions, four to a row, each with what it allows on hover. */
function VerbTicks({ verbs, label, checked = [] }: { verbs: Verb[]; label: string; checked?: Verb[] }) {
  return (
    <fieldset className="min-w-0">
      <legend className="stencil mb-1.5 text-slate-500">{label}</legend>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        {verbs.map((v) => (
          <label key={v} className="flex items-center gap-2 text-xs text-slate-700" title={VERB_BLURB[v]}>
            <input type="checkbox" name="verbs" value={v} defaultChecked={checked.includes(v)} /> {VERB_LABEL[v]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type Selector = { name: "discipline" | "deliverableType" | "docType" | "criticality" | "confidentiality" | "projectRole"; label: string; values: { code: string; label: string }[] };
type BoardFunction = Awaited<ReturnType<typeof functionsForMatrix>>[number];

/** What a function may do, rule by rule: every document first, then each narrowed one; removed by its bin, added under. */
function FunctionRules({ fn, rules, level, rights, fixedHere, scopeOf, selectors }: {
  fn: BoardFunction; rules: BoardFunction["rules"]; level: "project" | "organization"; rights: boolean;
  fixedHere: (v: Verb) => boolean; scopeOf: (rule: BoardFunction["rules"][number]) => { field: string; value: string }[];
  selectors: Selector[];
}) {
  const ordered = [...rules].sort((a, b) => scopeOf(a).length - scopeOf(b).length);
  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="stencil text-slate-500">What it may do</span>
        <span className="text-[11px] text-slate-500">rules only add: nothing takes away what another rule gives</span>
      </p>
      {ordered.length === 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">No rule yet: whoever holds {fn.name} can do nothing.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md ring-1 ring-line">
          {ordered.map((rule) => {
            const verbs = parseVerbs(rule.verbs);
            const scope = scopeOf(rule);
            return (
              <li key={rule.id} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0 space-y-1">
                  <p className="text-xs text-slate-700">
                    {scope.length
                      ? scope.map((s, i) => <span key={s.field}>{i ? " · " : ""}<span className="text-slate-500">{s.field}</span> <span className="font-semibold">{s.value}</span></span>)
                      : <span className="font-semibold">Every document</span>}
                  </p>
                  <p className="flex flex-wrap gap-1">{verbs.map((v) => <Chip key={v} title={VERB_BLURB[v]}>{VERB_LABEL[v]}</Chip>)}</p>
                </div>
                {rights && !verbs.some(fixedHere) ? (
                  <ActionForm action={deletePermissionRuleAction} hideSubmit hidden={{ ruleId: rule.id, level }} className="shrink-0 space-y-1"
                    confirmText={`Remove this rule from ${fn.name}? ${verbs.map((v) => VERB_LABEL[v]).join(", ")}${scope.length ? ` for ${scope.map((s) => s.value).join(", ")}` : " on every document"} is then no longer given by it.`}>
                    <button type="submit" title="Remove this rule" aria-label={`Remove this rule from ${fn.name}`}
                      className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" aria-hidden /></button>
                  </ActionForm>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {rights ? (
        <details className="group">
          <summary className="ask inline-flex list-none items-center gap-1.5"><Plus className="h-3.5 w-3.5" aria-hidden /> Add a rule</summary>
          <ActionForm action={savePermissionRuleAction} submitLabel="Add the rule" size="sm" hidden={{ functionId: fn.id, level }} className="mt-3 space-y-4">
            <VerbTicks verbs={GRANTABLE.filter((v) => !fixedHere(v))} label="May" />
            <div className="space-y-1.5">
              <p className="stencil text-slate-500">On these documents <span className="font-normal normal-case tracking-normal text-slate-400">· empty: any</span></p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {selectors.map((sel) => (
                  <Field key={sel.name} label={sel.label} hint={sel.values.length > LONG ? "type part of the code or name" : undefined}>
                    {/* A long list is written once on the page and shared; repeating it in every function's form made the
                        page megabytes long. */}
                    {sel.values.length > LONG ? (
                      <input name={sel.name} list={`list-${sel.name}`} className={inputCls} placeholder="Any" autoComplete="off" />
                    ) : (
                      <select name={sel.name} className={inputCls} defaultValue="">
                        <option value="">Any</option>
                        {sel.values.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
                      </select>
                    )}
                  </Field>
                ))}
              </div>
            </div>
          </ActionForm>
        </details>
      ) : null}
    </div>
  );
}

/** The function itself, the organization's: its name, its code (fixed), its clearance, in use. */
function FunctionItself({ fn, confidentialities }: { fn: BoardFunction; confidentialities: { code: string; label: string }[] }) {
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="stencil text-slate-500">The function</span>
        <span className="text-[11px] text-slate-500">the same on every project</span>
      </p>
      <ActionForm action={updateFunctionAction} submitLabel="Save" size="sm" hidden={{ functionId: fn.id }} className="space-y-3">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_auto]">
          <Field label="Name" required><input name="name" required defaultValue={fn.name} className={inputCls} /></Field>
          <Field label="Code" hint="never changes"><span className="flex h-(--control-h) items-center font-mono text-(length:--control-text) text-slate-600">{fn.code}</span></Field>
          <Field label="Clearance" hint="the most confidential level it reads without being named on the document">
            <select name="clearance" defaultValue={fn.clearance ?? ""} className={inputCls}>
              <option value="">No limit</option>
              {confidentialities.map((c) => <option key={c.code} value={c.code}>Up to {c.label}</option>)}
            </select>
          </Field>
          <label className="flex h-(--control-h) cursor-pointer items-center gap-2 text-xs text-slate-600"><SwitchControl name="active" defaultChecked={fn.active} /> In use</label>
        </div>
      </ActionForm>
    </div>
  );
}
