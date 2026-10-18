import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { requireScope } from "@/lib/core/scope";
import { inputCls, Field } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { Switch, SwitchControl } from "@/components/switch";
import { setFieldRuleAction, renameFieldAction, addOwnFieldAction, removeOwnFieldAction, ownInRegisterAction } from "@/lib/settings/forms-fields";
import {
  KINDS, KIND_LABEL, KIND_TAB, KIND_TEXT, RULE_LABEL, CONTROL_LABEL, ORGANIZATION_KINDS, fieldsOf, projectForms,
  type FieldKind, type FieldRule, type Control,
} from "@/lib/settings/field-policy";
import { getSets } from "@/lib/settings/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forms & fields" };

const RULES: FieldRule[] = ["REQUIRED", "OPTIONAL", "OFF"];
/** What a field of one's own may take. */
const OWN_CONTROLS: Control[] = ["TEXT", "LONG_TEXT", "NUMBER", "DATE", "YES_NO", "CHOICE"];
const ICON = "inline-flex rounded-sm p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-3 focus-visible:ring-link/25 outline-none";
const SHORT: Record<FieldRule, string> = { REQUIRED: "Must", OPTIONAL: "Asked", OFF: "Not asked" };

type Row = {
  key: string; label: string; text: string; control: Control; setKey?: string | null; of: "app" | "list" | "own";
  rule: FieldRule; fixed?: string; computedBy?: string; help?: string | null; inRegister?: boolean;
};

/**
 * Forms & fields, Types & sets' way (owner): the forms in a menu on the left, the chosen form's fields as rows on the
 * right. Each row: what it is, what it is called here, and how it stands, the segmented choice (must · asked · not
 * asked) acting at once; a pencil renames it, a bin takes a field of one's own away. On the document form, every list of
 * one's own (Types & sets) is a field by itself. A project's forms are the project's (`FormRules`): the control function
 * changes them, everyone of ours reads them; opening a project and adding an organization are the organization's.
 */
export default async function FieldsPage({ searchParams }: { searchParams: Promise<{ form?: string; edit?: string; panel?: string }> }) {
  const ctx = await requireScope();
  const sp = await searchParams;
  const kind: FieldKind = KINDS.includes(sp.form as FieldKind) ? (sp.form as FieldKind) : "DOCUMENT";
  const [answer, sets] = await Promise.all([projectForms(ctx.projectId), getSets()]);
  const view = answer?.forms.find((f) => f.form === kind);
  const organization = ORGANIZATION_KINDS.includes(kind);
  const may = organization ? !!answer?.mayChangeOrganization : !!answer?.mayChange;
  const titleOf = (key: string | null | undefined) => (key ? sets.find((s) => s.key === key)?.title ?? key : null);
  const here = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ form: kind });
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) p.set(k, v);
    return `/settings/fields?${p}`;
  };

  const rows: Row[] = [
    ...fieldsOf(kind).map((f) => ({
      key: f.key, label: view?.labels[f.key] ?? f.label, text: f.text, control: f.control, setKey: f.setKey, of: "app" as const,
      rule: (f.fixed ? f.fallback : view?.rules[f.key] ?? f.fallback) as FieldRule, fixed: f.fixed, computedBy: f.computedBy,
    })),
    ...(view?.lists ?? []).map((l) => ({
      key: l.key, label: l.title, text: "A list of your own, asked by itself: the values of the set serving the document's deliverable type.",
      control: "CHOICE" as Control, setKey: l.key, of: "list" as const, rule: l.rule,
    })),
    ...(view?.own ?? []).map((o) => ({
      key: o.key, label: o.label, text: o.help ?? "", control: o.control, setKey: o.setKey, of: "own" as const, rule: o.rule,
      help: o.help, inRegister: o.inRegister,
    })),
  ];

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-6 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Forms & fields</h1>
          <p className="plate-meta mt-1.5 max-w-3xl font-normal">
            What each form asks, and what it insists on. This project&rsquo;s forms are its own: {answer?.own ? "changed here, the organization's later changes never touch them" : "until the first change it reads the organization's"}.
            The app refuses an empty field the form insists on, whichever way it arrives (a form, an import).
            {answer?.mayChange ? "" : " Whoever acts as the control function changes them; everyone of ours reads them."}
          </p>
        </div>
      </section>

      <div className="register register-sheet register-sheet-open grid grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label="Forms" className="border-b border-line p-2 lg:border-b-0 lg:border-r">
          <ul className="space-y-px">
            {KINDS.map((one) => (
              <li key={one}>
                <Link
                  href={`/settings/fields?form=${one}`}
                  scroll={false}
                  aria-current={one === kind ? "page" : undefined}
                  className={`flex items-center justify-between gap-2 rounded-sm py-2 pl-2.5 pr-2 text-[13px] ${one === kind ? "bg-tint font-semibold text-brand-ink" : "text-slate-600 hover:bg-tint-soft hover:text-slate-900"}`}
                >
                  <span className="truncate">{KIND_TAB[one]}</span>
                  {ORGANIZATION_KINDS.includes(one) ? <span className="shrink-0 text-[11px] font-normal text-slate-500">organization&rsquo;s</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <section className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-2.5 sm:px-6">
            <h2 className="text-base font-semibold text-slate-900">{KIND_LABEL[kind]}</h2>
            <span className="plate-meta min-w-0 flex-1">{KIND_TEXT[kind]}{organization ? " An administrator decides it, for every project." : ""}</span>
            {may ? (
              <Link scroll={false} href={sp.panel === "new" ? here({}) : here({ panel: "new" })} title="Add a field" aria-label="Add a field"
                aria-current={sp.panel === "new" ? "true" : undefined} className={`${ICON} aria-[current]:bg-tint aria-[current]:text-brand-ink`}>
                <Plus className="h-4 w-4" />
              </Link>
            ) : null}
          </div>

          {sp.panel === "new" && may ? (
            <div className="border-b border-line">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
                <span className="stencil mr-1 text-slate-500">A field of your own</span>
                <span className="text-[11px] text-slate-500">asked on this form, kept with the record, read back under its name; the app computes nothing with it</span>
              </div>
              <ActionForm id="new-field" action={addOwnFieldAction} hideSubmit resetOnSuccess hidden={{ kind }} className="asking px-5 py-5 sm:px-6">
                <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="What it is called" required><input name="label" required maxLength={60} placeholder="Client reference" className={inputCls} /></Field>
                  <Field label="What kind of answer">
                    <select name="control" defaultValue="TEXT" className={inputCls}>{OWN_CONTROLS.map((c) => <option key={c} value={c}>{CONTROL_LABEL[c]}</option>)}</select>
                  </Field>
                  <Field label="If a list, which list">
                    <select name="setKey" defaultValue="" className={inputCls}>
                      <option value="">Not a list</option>
                      {sets.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
                    </select>
                  </Field>
                  <Field label="Must it be filled">
                    <select name="rule" defaultValue="OPTIONAL" className={inputCls}>{RULES.map((one) => <option key={one} value={one}>{RULE_LABEL[one]}</option>)}</select>
                  </Field>
                  <div className="sm:col-span-2 lg:col-span-3"><Field label="Note under the box"><input name="help" maxLength={140} placeholder="What to put in it, in your words" className={inputCls} /></Field></div>
                  {kind === "DOCUMENT" ? (
                    <label className="inline-flex cursor-pointer items-center gap-2 self-end pb-1.5 text-xs text-slate-700"><SwitchControl name="inRegister" /> a column of the register</label>
                  ) : null}
                </div>
              </ActionForm>
              <div className="flex items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
                <Link scroll={false} href={here({})} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                <button type="submit" form="new-field" data-on="true" className="ask">Add it</button>
              </div>
            </div>
          ) : null}

          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line bg-tint-soft">
                <th className="stencil px-5 py-2 text-slate-500 sm:px-6">Field</th>
                <th className="stencil hidden px-3 py-2 text-slate-500 md:table-cell">Answer</th>
                <th className="stencil px-3 py-2 text-slate-500">On the form</th>
                <th className="w-20 px-3 py-2"><span className="sr-only">Acts</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => {
                const editing = may && sp.edit === `${row.of}:${row.key}`;
                const list = titleOf(row.setKey);
                return editing ? (
                  <tr key={`${row.of}:${row.key}`} className="bg-tint-soft/60">
                    <td colSpan={4} className="p-0">
                      <ActionForm id="rename-field" action={renameFieldAction} hideSubmit hidden={{ kind, key: row.key, of: row.of }} className="asking grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2 sm:px-6">
                        <Field label={`What ${row.of === "app" ? fieldsOf(kind).find((f) => f.key === row.key)?.label ?? row.label : "it"} is called here`}>
                          <input name="label" defaultValue={row.label} maxLength={60} className={inputCls} />
                        </Field>
                        {row.of === "own" ? <Field label="Note under the box"><input name="help" defaultValue={row.help ?? ""} maxLength={140} className={inputCls} /></Field> : null}
                      </ActionForm>
                      <div className="flex items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
                        <Link scroll={false} href={here({})} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                        <button type="submit" form="rename-field" data-on="true" className="ask">Save</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={`${row.of}:${row.key}`} className="align-top">
                    <td className="px-5 py-3 sm:px-6">
                      <p className="text-[13px] font-medium leading-5 text-slate-900">
                        {row.label}
                        {row.of === "own" ? <span className="ml-2 text-[11px] font-normal text-brand-ink">yours</span> : null}
                        {row.of === "list" ? <span className="ml-2 text-[11px] font-normal text-brand-ink">your list</span> : null}
                      </p>
                      {row.text ? <p className="mt-0.5 max-w-xl text-[11.5px] leading-[1.45] text-slate-500">{row.text}</p> : null}
                      {row.fixed ? <p className="mt-0.5 max-w-xl text-[11px] leading-4 text-slate-500">Always asked: {row.fixed}</p> : null}
                      {row.of === "own" && kind === "DOCUMENT" ? (
                        <form action={ownInRegisterAction} className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                          <input type="hidden" name="kind" value={kind} /><input type="hidden" name="key" value={row.key} />
                          <Switch on={!!row.inRegister} disabled={!may} label={row.inRegister ? "Take it out of the register's columns" : "Make it a column of the register"} />
                          a column of the register
                        </form>
                      ) : null}
                    </td>
                    <td className="hidden px-3 py-3 text-[11.5px] leading-[1.45] text-slate-600 md:table-cell">
                      {CONTROL_LABEL[row.control]}
                      {list ? <> · <Link href={`/settings/config?set=${row.setKey}`} className="text-link hover:underline">{list}</Link></> : null}
                      {row.computedBy ? <span className="mt-0.5 block text-[11px] text-slate-500">{row.computedBy}</span> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      {row.fixed ? (
                        <span className="inline-block py-1.5 text-[12px] font-medium text-slate-500">Always asked</span>
                      ) : (
                        <form action={setFieldRuleAction} className="seg w-fit">
                          <input type="hidden" name="kind" value={kind} /><input type="hidden" name="key" value={row.key} /><input type="hidden" name="of" value={row.of} />
                          {RULES.map((one) => (
                            <button key={one} type="submit" name="rule" value={one} disabled={!may || row.rule === one} aria-current={row.rule === one ? "page" : undefined}
                              title={RULE_LABEL[one]} className="segment disabled:cursor-default">
                              {SHORT[one]}
                            </button>
                          ))}
                        </form>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {may ? (
                        <span className="inline-flex items-center gap-1">
                          {row.of !== "list" ? (
                            <Link scroll={false} href={here({ edit: `${row.of}:${row.key}` })} title="Change what it is called" aria-label="Change what it is called" className={ICON}><Pencil className="h-4 w-4" /></Link>
                          ) : null}
                          {row.of === "own" ? (
                            <form action={removeOwnFieldAction}>
                              <input type="hidden" name="kind" value={kind} /><input type="hidden" name="key" value={row.key} />
                              <button type="submit" title="Take it off the form (answers already given stay)" aria-label="Take it off the form" className="inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                            </form>
                          ) : null}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!rows.length ? <tr><td colSpan={4} className="px-5 py-8 text-center text-[13px] text-slate-500 sm:px-6">This form asks nothing more than the route and its people.</td></tr> : null}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
