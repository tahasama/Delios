import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isAdmin } from "@/lib/auth";
import { PageHeader, Card, Chip, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { setFieldPolicyAction, addOwnFieldAction, removeOwnFieldAction } from "@/lib/actions/control-activities";
import {
  KINDS, KIND_LABEL, KIND_TAB, KIND_TEXT, RULE_LABEL, CONTROL_LABEL, fieldsOf, allFieldRules,
  type FieldKind, type FieldRule, type Control,
} from "@/lib/field-policy";
import { getSets } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forms & fields" };

const RULES: FieldRule[] = ["REQUIRED", "OPTIONAL", "OFF"];
/** What an organization may choose for a field of its own. */
const OWN_CONTROLS: Control[] = ["TEXT", "LONG_TEXT", "NUMBER", "DATE", "YES_NO", "CHOICE"];

/** How a rule reads at a glance, on the tab and beside the field. */
const RULE_TONE: Record<FieldRule, string> = {
  REQUIRED: "bg-tint text-brand-ink ring-brand-line",
  OPTIONAL: "bg-slate-100 text-slate-600 ring-slate-300",
  OFF: "bg-slate-100 text-slate-400 ring-slate-200",
};

/**
 * What every form asks for, one form at a time.
 *
 * Ten forms and sixty fields will not fit on a page anybody reads, so the form
 * is chosen first and its fields stand alone underneath — the same shape as the
 * register's own screens, where you pick what you are looking at before you
 * look at it.
 *
 * Three questions per field, and the page is honest about which an organization
 * may answer: what it is called (always theirs), whether it is insisted on
 * (theirs, unless the record stops being a record without it), and what kind of
 * answer it takes (the application's, wherever it computes with the value).
 * Anything it does not compute with, an organization adds itself — and then all
 * three answers are its own.
 */
export default async function FieldsPage({ searchParams }: { searchParams: Promise<{ form?: string }> }) {
  const ctx = await requireScope();
  if (!isAdmin(ctx.user)) return <PageHeader title="Forms & fields" subtitle="Administrators only." />;
  const sp = await searchParams;
  const kind: FieldKind = KINDS.includes(sp.form as FieldKind) ? (sp.form as FieldKind) : "DOCUMENT";

  const [rules, labels, own, sets] = await Promise.all([
    allFieldRules(ctx),
    ctx.db.fieldPolicy.findMany(),
    ctx.db.customField.findMany({ orderBy: [{ position: "asc" }, { addedAt: "asc" }] }),
    getSets(),
  ]);
  const labelOf = (key: string, fallback: string) =>
    labels.find((l) => l.kind === kind && l.field === key)?.label ?? fallback;

  const fields = fieldsOf(kind);
  const mine = own.filter((o) => o.kind === kind);
  const required = fields.filter((f) => rules[kind][f.key] === "REQUIRED").length;
  const off = fields.filter((f) => rules[kind][f.key] === "OFF").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Forms & fields"
        subtitle="What each form asks for, what it calls it, and what it insists on. A field switched off is not asked and not stored; one made required is refused empty on the screen and by the importer alike."
      />

      {/* The form first, as cards: each says how many fields it asks and how
          many it insists on, so the choice is made knowing what is behind it. */}
      <nav aria-label="Which form" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {KINDS.map((one) => {
          const all = fieldsOf(one);
          const must = all.filter((f) => rules[one][f.key] === "REQUIRED").length;
          const theirs = own.filter((o) => o.kind === one).length;
          const on = one === kind;
          return (
            <Link
              key={one}
              href={`/settings/fields?form=${one}`}
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={`register register-sheet px-3 py-2.5 transition ${on ? "border-brand-line ring-1 ring-brand-line/40" : "hover:border-brand-line/50"}`}
            >
              <span className={`block text-[13px] font-semibold leading-5 ${on ? "text-slate-900" : "text-slate-700"}`}>{KIND_TAB[one]}</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-slate-400">
                {all.length + theirs} fields · {must} must
                {theirs ? <span className="block text-brand-ink">{theirs} of yours</span> : null}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="max-w-5xl space-y-4">
        <Card
          title={KIND_LABEL[kind]}
          description={`${KIND_TEXT[kind]} ${fields.length} of ours${mine.length ? `, ${mine.length} of yours` : ""} · ${required} must be filled${off ? ` · ${off} not asked` : ""}`}
        >
          <ActionForm action={setFieldPolicyAction} submitLabel="Save this form" size="sm" hidden={{ kind }}>
            <ul className="divide-y divide-line">
              {fields.map((field) => {
                const rule = rules[kind][field.key];
                const set = field.setKey ? sets.find((s) => s.key === field.setKey) : null;
                return (
                  <li key={field.key} className="grid grid-cols-1 items-start gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_11rem_11rem]">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-[13px] leading-5 text-slate-800">
                        {field.label}
                        {field.fixed ? <Chip className={RULE_TONE[rule]}>always asked</Chip> : null}
                      </p>
                      <p className="mt-0.5 text-[11.5px] leading-[1.45] text-slate-500">
                        {field.text}
                        {field.fixed ? <span className="text-slate-400"> {field.fixed}</span> : null}
                      </p>
                      <p className="mt-1 text-[11px] leading-4 text-slate-400">
                        {CONTROL_LABEL[field.control]}
                        {set ? (
                          <>
                            {" — "}
                            <Link href={`/settings/config?set=${set.key}`} className="font-medium text-link hover:underline">{set.title}</Link>
                            , where its values are added and retired
                          </>
                        ) : null}
                        {field.computedBy ? <span className="block">Fixed as that: {field.computedBy}</span> : null}
                      </p>
                    </div>
                    <label className="min-w-0">
                      <span className="stencil mb-1 block text-slate-400 sm:hidden">Called</span>
                      <input
                        name={`label:${field.key}`}
                        defaultValue={labelOf(field.key, field.label)}
                        maxLength={60}
                        aria-label={`What ${field.label} is called here`}
                        className={inputCls}
                      />
                    </label>
                    {field.fixed ? (
                      <span className="pt-1.5 text-[11.5px] text-slate-400">{RULE_LABEL[rule]}</span>
                    ) : (
                      <label className="min-w-0">
                        <span className="sr-only">{field.label}</span>
                        <select name={`rule:${field.key}`} defaultValue={rule} className={inputCls}>
                          {RULES.map((one) => <option key={one} value={one}>{RULE_LABEL[one]}</option>)}
                        </select>
                      </label>
                    )}
                  </li>
                );
              })}

              {mine.map((field) => (
                <li key={field.id} className="grid grid-cols-1 items-start gap-x-4 gap-y-2 py-3 last:pb-0 sm:grid-cols-[minmax(0,1fr)_11rem_11rem]">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] leading-5 text-slate-800">
                      {field.label}
                      <Chip className="bg-tint text-brand-ink ring-brand-line">yours</Chip>
                    </p>
                    <p className="mt-0.5 text-[11.5px] leading-[1.45] text-slate-500">{field.help ?? "No note under the box."}</p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-400">
                      {CONTROL_LABEL[field.control as Control]}
                      {field.setKey ? ` — ${sets.find((s) => s.key === field.setKey)?.title ?? field.setKey}` : ""}
                      {" · added by "}{field.addedByName}
                    </p>
                    <label className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                      <input type="checkbox" name={`own-register:${field.id}`} defaultChecked={field.inRegister} /> show it in the register
                    </label>
                  </div>
                  <label className="min-w-0">
                    <span className="sr-only">What {field.label} is called</span>
                    <input name={`own-label:${field.id}`} defaultValue={field.label} maxLength={60} className={inputCls} />
                  </label>
                  <label className="min-w-0">
                    <span className="sr-only">Whether {field.label} must be filled</span>
                    <select name={`own-rule:${field.id}`} defaultValue={field.rule} className={inputCls}>
                      {RULES.map((one) => <option key={one} value={one}>{RULE_LABEL[one]}</option>)}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          </ActionForm>
        </Card>

        <Card title="A field of your own" description={`Asked on ${KIND_LABEL[kind].toLowerCase()}, kept with the record, and read back under your own name for it.`}>
          <ActionForm action={addOwnFieldAction} submitLabel="Add it" size="sm" resetOnSuccess hidden={{ kind }}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="min-w-0">
                <span className="stencil mb-1 block text-slate-500">What it is called</span>
                <input name="label" required maxLength={60} placeholder="Client reference" className={inputCls} />
              </label>
              <label className="min-w-0">
                <span className="stencil mb-1 block text-slate-500">What kind of answer</span>
                <select name="control" defaultValue="TEXT" className={inputCls}>
                  {OWN_CONTROLS.map((c) => <option key={c} value={c}>{CONTROL_LABEL[c]}</option>)}
                </select>
              </label>
              <label className="min-w-0">
                <span className="stencil mb-1 block text-slate-500">If a list, which list</span>
                <select name="setKey" defaultValue="" className={inputCls}>
                  <option value="">— not a list —</option>
                  {sets.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
                </select>
              </label>
              <label className="min-w-0">
                <span className="stencil mb-1 block text-slate-500">Must it be filled</span>
                <select name="rule" defaultValue="OPTIONAL" className={inputCls}>
                  {RULES.map((one) => <option key={one} value={one}>{RULE_LABEL[one]}</option>)}
                </select>
              </label>
              <label className="min-w-0 sm:col-span-2 lg:col-span-3">
                <span className="stencil mb-1 block text-slate-500">Note under the box</span>
                <input name="help" maxLength={140} placeholder="what to put in it, in your words" className={inputCls} />
              </label>
              <label className="inline-flex items-center gap-1.5 self-end pb-1.5 text-[11.5px] text-slate-600">
                <input type="checkbox" name="inRegister" /> a column in the register
              </label>
            </div>
            <p className="text-[11px] leading-4 text-slate-400">
              Nothing in the application computes with a field of yours — no number is built from it, no authority read from
              it, no check asks about it — which is exactly why you may shape it however you like.
            </p>
          </ActionForm>

          {mine.length ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="stencil mb-1.5 text-slate-400">Remove one</p>
              <div className="flex flex-wrap gap-2">
                {mine.map((field) => (
                  <ActionForm
                    key={field.id}
                    action={removeOwnFieldAction}
                    submitLabel={`Remove ${field.label}`}
                    size="sm"
                    variant="secondary"
                    hidden={{ id: field.id }}
                  />
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-4 text-slate-400">
                It stops being asked. Answers already given stay on the records that carry them.
              </p>
            </div>
          ) : null}
        </Card>

        <p className="max-w-prose text-[11px] leading-4 text-slate-400">
          Two things override what is set here, and both make a field stricter, never looser: a numbering scheme that draws
          on a field makes it required for whatever is routed to it, and the type-to-field matrix can insist on supplier,
          order or date received for a particular deliverable type.
        </p>
      </div>
    </div>
  );
}
