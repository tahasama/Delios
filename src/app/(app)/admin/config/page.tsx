import { isAdmin } from "@/lib/auth";
import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, Chip, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { addConfigValueAction, retireConfigValueAction, createConfigSetAction, updateValuePropsAction, deleteValueAction, deleteSetAction, moveConfigValueAction, updateConfigSetAction, } from "@/lib/actions/admin";
import { getSets } from "@/lib/config";
import { SET_PROP_FIELDS, parseProps, type PropField } from "@/lib/config-props";

export const dynamic = "force-dynamic";
export const metadata = { title: "Published value sets" };

export default async function AdminConfigPage({ searchParams }: { searchParams: Promise<{ set?: string }> }) {
  const { user: me, db } = await requireScope();
  if (!isAdmin(me)) return <PageHeader title="Published value sets" subtitle="Administrators only." />;
  const sp = await searchParams;
  const sets = await getSets();
  const currentKey = sp.set ?? sets[0]?.key ?? "";
  const [set, values] = await Promise.all([
    db.configSet.findFirst({ where: { key: currentKey } }),
    db.configValue.findMany({ where: { setKey: currentKey }, orderBy: [{ sort: "asc" }, { code: "asc" }] }),
  ]);
  const propFields = SET_PROP_FIELDS[currentKey];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Disciplines, types & controlled lists"
        subtitle="Define the codes and choices your organization uses. Published values remain traceable when they are later retired or replaced."
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {sets.map((s) => (
          <a key={s.key} href={`/admin/config?set=${s.key}`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${currentKey === s.key ? "bg-[#1e3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {s.title}
          </a>
        ))}
      </div>

      <details className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">+ Define a new set</summary>
        <div className="mt-3 max-w-xl">
          <ActionForm action={createConfigSetAction} submitLabel="Create set" size="sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Key" required hint="UPPER_SNAKE, used by the system">
                <input name="key" required className={inputCls} placeholder="E.g. AREAS" />
              </Field>
              <Field label="Title" required>
                <input name="title" required className={inputCls} placeholder="Areas" />
              </Field>
              <Field label="Description" className="sm:col-span-2">
                <input name="description" className={inputCls} placeholder="What the set is for" />
              </Field>
            </div>
          </ActionForm>
        </div>
      </details>

      {set ? (
        <Card title={`${set.title} — v${set.version}`} description={set.description ?? ""} actions={
          <div className="flex items-center gap-3">
            <a href={`/api/export/config-set?set=${encodeURIComponent(set.key)}`} className="text-xs font-medium text-[#315f83] hover:underline">export CSV ↓</a>
            <form action={deleteSetAction}>
              <input type="hidden" name="key" value={set.key} />
              <button className="text-xs text-slate-400 hover:text-red-600" title="Delete the whole set (only when unused and not an operational set)">delete set</button>
            </form>
          </div>
        }>
          <details className="mb-4 rounded-lg border border-slate-200 bg-slate-50/60">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">Set identity and spreadsheet tools</summary>
            <div className="grid grid-cols-1 gap-4 border-t border-slate-200 p-3 lg:grid-cols-2">
              <ActionForm action={updateConfigSetAction} submitLabel="Publish set details" size="sm" hidden={{ oldKey: set.key }}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Key" required hint="Changing the key also updates numbering and workflow references"><input name="key" required defaultValue={set.key} className={inputCls} /></Field>
                  <Field label="Title" required><input name="title" required defaultValue={set.title} className={inputCls} /></Field>
                  <Field label="Description" className="sm:col-span-2"><input name="description" defaultValue={set.description ?? ""} className={inputCls} /></Field>
                </div>
              </ActionForm>
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <p className="text-xs font-medium text-slate-700">Replacing this set from a file</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  A whole-set upload is a controlled change: you see what it would alter, and someone else approves it
                  before it takes effect. Values left out are retired, never deleted.
                </p>
                <Link href="/admin/controlled" className="mt-2 inline-block text-xs font-semibold text-[#315f83] hover:underline">
                  Open controlled changes →
                </Link>
              </div>
            </div>
          </details>
          <div className="space-y-2">
            {values.map((v, index) => {
              const props = parseProps(v.props);
              return (
                <details key={v.id} className="rounded-lg border border-slate-100">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="font-mono text-xs font-semibold">{v.code}</span>
                    <span className="text-slate-600">{v.label}</span>
                    <Chip className={v.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : "bg-slate-100 text-slate-500 ring-slate-300"}>{v.status.toLowerCase()}</Chip>
                    {Object.entries(props).filter(([, pv]) => pv === true).map(([pk]) => (
                      <Chip key={pk} className="bg-sky-100 text-sky-700 ring-sky-300">{pk}</Chip>
                    ))}
                    {typeof props.acceptancePeriodDays === "number" ? <Chip className="bg-slate-100 text-slate-600 ring-slate-300">{props.acceptancePeriodDays}d acceptance</Chip> : null}
                    {typeof props.responsePeriodDays === "number" ? <Chip className="bg-slate-100 text-slate-600 ring-slate-300">{props.responsePeriodDays}d response</Chip> : null}
                    <span className="ml-auto flex items-center gap-1">
                      <form action={moveConfigValueAction}>
                        <input type="hidden" name="valueId" value={v.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button disabled={index === 0} className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100 disabled:opacity-25" title="Move up">↑</button>
                      </form>
                      <form action={moveConfigValueAction}>
                        <input type="hidden" name="valueId" value={v.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button disabled={index === values.length - 1} className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100 disabled:opacity-25" title="Move down">↓</button>
                      </form>
                    {v.status === "ACTIVE" ? (
                      <form action={retireConfigValueAction}>
                        <input type="hidden" name="valueId" value={v.id} />
                        <button className="text-xs text-slate-400 hover:text-red-600">retire</button>
                      </form>
                    ) : (
                      <form action={retireConfigValueAction}>
                        <input type="hidden" name="valueId" value={v.id} />
                        <button className="text-xs text-slate-400 hover:text-emerald-600">reactivate</button>
                      </form>
                    )}
                    </span>
                  </summary>
                  <div className="border-t border-slate-100 p-3">
                    <ActionForm action={updateValuePropsAction} submitLabel="Save properties" size="sm" hidden={{ valueId: v.id, setKey: currentKey }}>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Code" hint="Codes already used in evidence cannot be changed">
                          <input name="code" defaultValue={v.code} className={inputCls} />
                        </Field>
                        <Field label="Label">
                          <input name="label" defaultValue={v.label} className={inputCls} />
                        </Field>
                        {propFields ? null : (
                          <Field label="Properties (JSON)" hint="free-form for custom sets" className="sm:col-span-2">
                            <textarea name="propsJson" rows={2} defaultValue={v.props ?? ""} className={inputCls} />
                          </Field>
                        )}
                        {propFields?.map((f) => (
                          <PropInput key={f.key} field={f} value={props[f.key]} />
                        ))}
                      </div>
                    </ActionForm>
                    <form action={deleteValueAction} className="mt-2 text-right">
                      <input type="hidden" name="valueId" value={v.id} />
                      <button className="text-xs text-slate-400 hover:text-red-600" title="Unused values are deleted; values already referenced by evidence are retired">Delete if unused</button>
                    </form>
                  </div>
                </details>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-400">{values.filter((v) => v.status === "ACTIVE").length} active · {values.filter((v) => v.status === "RETIRED").length} retired</p>

          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="mb-2 text-sm font-medium text-slate-700">Add a value to {set.title}</p>
            <ActionForm action={addConfigValueAction} submitLabel="Publish value" size="sm" hidden={{ setKey: currentKey }}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Code" required hint="what appears in numbers / selects">
                  <input name="code" required maxLength={24} className={inputCls} />
                </Field>
                <Field label="Label" required>
                  <input name="label" required className={inputCls} />
                </Field>
                {propFields?.map((f) => <PropInput key={f.key} field={f} value={undefined} />)}
              </div>
            </ActionForm>
          </div>
        </Card>
      ) : (
        <p className="text-sm text-slate-400">No value sets published — run the seed or define a new set above.</p>
      )}
    </div>
  );
}

function PropInput({ field, value }: { field: PropField; value: unknown }) {
  if (field.type === "bool") {
    return (
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
        <input type="checkbox" name={`prop_${field.key}`} defaultChecked={value === true} />
        <span>{field.label}{field.hint ? <span className="ml-1 text-xs text-slate-400">{field.hint}</span> : null}</span>
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <Field label={field.label} hint={field.hint}>
        <select name={`prop_${field.key}`} defaultValue={typeof value === "string" ? value : ""} className={inputCls}>
          <option value="">—</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
    );
  }
  return (
    <Field label={field.label} hint={field.hint}>
      <input name={`prop_${field.key}`} type={field.type === "int" ? "number" : "text"} defaultValue={value == null ? "" : String(value)} className={inputCls} />
    </Field>
  );
}
