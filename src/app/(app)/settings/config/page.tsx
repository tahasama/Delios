import { isAdmin } from "@/lib/auth";
import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, Chip, Field, inputCls, DataTable, Th, Td, btn } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { addConfigValueAction, retireConfigValueAction, createConfigSetAction, updateValuePropsAction, deleteValueAction, deleteSetAction, moveConfigValueAction, updateConfigSetAction, bulkValuesAction, } from "@/lib/actions/admin";
import { getSets } from "@/lib/config";
import { SET_PROP_FIELDS, parseProps, type PropField } from "@/lib/config-props";
import { propFieldsFor } from "@/lib/set-props";
import type { Tenant } from "@/lib/tenant";
import { SelectAll } from "./select-all";
import { DeleteSetButton } from "./delete-set";
import { SetNav, type SetNavGroup } from "./set-nav";
import { Plus, Search, X, Pencil, Download, Trash2 } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Disciplines, types & sets" };

/** Sets grouped by what they are for. Anything not listed falls under "Other". */
const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Numbering & identity", keys: ["PROJECT_CODES", "SUBPROJECTS", "DISCIPLINES", "DOCUMENT_TYPES", "DELIVERABLE_TYPES", "SUPPLIER_CODES", "PURCHASE_ORDERS", "DELIVERABLE_TYPE_FIELDS"] },
  // The comment lists sit together, with the outcomes they feed: one classifies
  // a comment somebody wrote, the other is what an advisory step's comments
  // amount to. Both are the organization's to edit.
  { title: "Review & issue", keys: ["REVIEW_OUTCOMES", "REVIEW_ADVICE", "COMMENT_CLASSES", "STATUSES", "REASONS_FOR_ISSUE", "RETURN_REASONS", "ISSUE_CODES"] },
  { title: "Classification & keeping", keys: ["CRITICALITY", "CONFIDENTIALITY", "RETENTION_CLASSES", "PHASES"] },
  { title: "File formats", keys: ["NATIVE_FORMATS", "RENDITION_FORMATS", "PRESERVATION_FORMATS"] },
];

/** Where each set's codes are used, so the page can say how often — and which cannot be renamed. */
async function usage(t: Pick<Tenant, "db">, key: string): Promise<{ counts: Map<string, number>; unit: string; filter?: string }> {
  const docField: Record<string, { field: "discipline" | "docType" | "deliverableType" | "criticality" | "confidentiality" | "retentionClass" | "subProject" | "originator" | "contractRef"; filter?: string }> = {
    DISCIPLINES: { field: "discipline", filter: "discipline" }, DOCUMENT_TYPES: { field: "docType", filter: "docType" }, DELIVERABLE_TYPES: { field: "deliverableType" },
    CRITICALITY: { field: "criticality" }, CONFIDENTIALITY: { field: "confidentiality" }, RETENTION_CLASSES: { field: "retentionClass" },
    SUBPROJECTS: { field: "subProject" }, SUPPLIER_CODES: { field: "originator" }, PURCHASE_ORDERS: { field: "contractRef" },
  };
  const tally = (rows: { key: string | null; n: number }[]) => new Map(rows.filter((r) => r.key).map((r) => [r.key as string, r.n]));
  const d = docField[key];
  if (d) {
    const rows = await t.db.document.groupBy({ by: [d.field], _count: true });
    return { counts: tally(rows.map((r) => ({ key: (r as Record<string, unknown>)[d.field] as string | null, n: r._count }))), unit: "document", filter: d.filter };
  }
  if (key === "STATUSES" || key === "PHASES") {
    const field = key === "STATUSES" ? "statusCode" : "phase";
    const rows = await t.db.revision.groupBy({ by: [field], _count: true });
    return { counts: tally(rows.map((r) => ({ key: (r as Record<string, unknown>)[field] as string | null, n: r._count }))), unit: "revision" };
  }
  if (key === "REVIEW_OUTCOMES") {
    const rows = await t.db.reviewCycle.groupBy({ by: ["outcome"], _count: true });
    return { counts: tally(rows.map((r) => ({ key: r.outcome, n: r._count }))), unit: "review" };
  }
  if (key === "REASONS_FOR_ISSUE") {
    const rows = await t.db.transmittal.groupBy({ by: ["reasonForIssue"], _count: true });
    return { counts: tally(rows.map((r) => ({ key: r.reasonForIssue, n: r._count }))), unit: "transmittal" };
  }
  return { counts: new Map(), unit: "" };
}

/** What a value does, in the plain words of its set's questions. */
function doesText(fields: PropField[] | undefined, props: Record<string, unknown>): string {
  if (!fields) return "";
  return fields.map((f) => {
    if (f.type === "choice") return f.options.find((o) => o.value === f.read(props))?.label.split(" — ")[0] ?? "";
    if (f.type === "bool") return props[f.key] === true ? f.label.toLowerCase() : "";
    const v = props[f.key];
    if (v === undefined || v === null || v === "") return "";
    return f.type === "int" ? `${f.label.toLowerCase().replace(/ \(days\)/, "")}: ${v} days` : `${f.label.toLowerCase()}: ${String(v)}`;
  }).filter(Boolean).join(" · ");
}

type Params = { set?: string; q?: string; show?: string; edit?: string; panel?: string };

export default async function AdminConfigPage({ searchParams }: { searchParams: Promise<Params> }) {
  const ctx = await requireScope();
  const { user: me, db } = ctx;
  if (!isAdmin(me)) return <PageHeader title="Disciplines, types & sets" subtitle="Administrators only." />;
  const sp = await searchParams;
  const sets = await getSets();
  const currentKey = sp.set ?? sets[0]?.key ?? "";
  const q = (sp.q ?? "").trim();
  const show = sp.show === "RETIRED" || sp.show === "ALL" ? sp.show : "ACTIVE";
  const [set, allValues, counts, used] = await Promise.all([
    db.configSet.findFirst({ where: { key: currentKey } }),
    db.configValue.findMany({ where: { setKey: currentKey }, orderBy: [{ sort: "asc" }, { code: "asc" }] }),
    db.configValue.groupBy({ by: ["setKey"], where: { status: "ACTIVE" }, _count: true }),
    usage(ctx, currentKey),
  ]);
  const propFields = propFieldsFor(currentKey);
  const values = allValues.filter((v) =>
    (show === "ALL" || v.status === show) &&
    (!q || v.code.toLowerCase().includes(q.toLowerCase()) || v.label.toLowerCase().includes(q.toLowerCase())),
  );
  const retiredCount = allValues.filter((v) => v.status === "RETIRED").length;
  const countOf = (key: string) => counts.find((c) => c.setKey === key)?._count ?? 0;
  // Where a set files: what it says about itself first, then the built-in map
  // for the ones that shipped, then Other.
  const headingOf = (one: (typeof sets)[number]) =>
    one.group?.trim() || GROUPS.find((g) => g.keys.includes(one.key))?.title || "Other";
  // A kind is any set other lists may serve: the ones that shipped, plus
  // anything already serving as one.
  const headings = [...GROUPS.map((g) => g.title), ...sets.map(headingOf).filter((h) => !GROUPS.some((g) => g.title === h) && h !== "Other"), "Other"];
  const groups: SetNavGroup[] = [...new Set(headings)]
    .map((title) => ({
      title,
      sets: sets
        .filter((one) => headingOf(one) === title)
        .map((one) => ({ key: one.key, title: one.title, count: countOf(one.key) })),
    }))
    .filter((g) => g.sets.length);
  const here = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ set: currentKey, ...(q ? { q } : {}), ...(show !== "ACTIVE" ? { show } : {}) });
    for (const [k, v] of Object.entries(extra)) v === undefined ? p.delete(k) : p.set(k, v);
    return `/settings/config?${p}`;
  };
  const editing = sp.edit ? allValues.find((v) => v.id === sp.edit) ?? null : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Disciplines, types & sets"
        subtitle="Every code and choice this organization works from, one list each. A code already in use is retired, never deleted, so older documents stay findable."
        actions={
          <div className="flex flex-col items-end gap-2.5">
            <Link href={here({ panel: sp.panel === "new" ? undefined : "new", edit: undefined })} className={btn("primary")}><Plus className="h-4 w-4" /> New set</Link>
            <Link href="/import" className="text-xs font-medium text-slate-500 transition hover:text-link">Got a list in a spreadsheet? Import it →</Link>
          </div>
        }
      />

      <SetNav groups={groups} current={currentKey}>
        {set ? (
          <section className="min-w-0 space-y-3">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-slate-900">{set.title}</h2>
                {set.description ? <p className="mt-1 text-xs leading-5 text-slate-500">{set.description}</p> : null}
                <p className="mt-1 text-[11px] text-slate-400">{countOf(set.key)} active{retiredCount ? ` · ${retiredCount} retired` : ""} · version {set.version}</p>
              </div>
              <div className="flex shrink-0 items-center gap-5">
                <Link href={here({ panel: sp.panel === "add" ? undefined : "add", edit: undefined })} className={btn("primary", "sm")}><Plus className="h-3.5 w-3.5" /> Add value</Link>
                <div className="flex items-center gap-0.5 border-l border-line pl-4">
                  <Link href={here({ panel: sp.panel === "details" ? undefined : "details", edit: undefined })} title="Rename or describe this set" aria-label="Rename or describe this set" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></Link>
                  <a href={`/api/export/config-set?set=${encodeURIComponent(set.key)}`} title="Export this set as CSV" aria-label="Export this set as CSV" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><Download className="h-4 w-4" /></a>
                  <DeleteSetButton setKey={set.key} title={set.title} count={countOf(set.key)} />
                </div>
              </div>
            </div>

            {sp.panel === "add" ? (
              <Card title={`Add a value to ${set.title}`} actions={<Link href={here({ panel: undefined })} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></Link>}>
                <ActionForm action={addConfigValueAction} submitLabel="Publish value" size="sm" hidden={{ setKey: currentKey }} resetOnSuccess>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Code" required hint="what appears in numbers and lists"><input name="code" required maxLength={24} className={inputCls} /></Field>
                    <Field label="Label" required><input name="label" required className={inputCls} /></Field>
                    {propFields?.map((f) => <PropInput key={f.key} field={f} value={undefined} />)}
                  </div>
                </ActionForm>
              </Card>
            ) : null}
            {sp.panel === "new" ? (
              <Card title="New set" description="A list your organization needs that the starter sets do not cover — areas, systems, anything." actions={<Link href={here({ panel: undefined })} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></Link>}>
                <ActionForm action={createConfigSetAction} submitLabel="Create set" size="sm">
                  <div className="grid grid-cols-1 items-end gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Title" required><input name="title" required className={inputCls} placeholder="Areas" /></Field>
                    <Field label="Key" required hint="UPPER_SNAKE"><input name="key" required className={inputCls} placeholder="AREAS" /></Field>
                    <Field label="Category">
                      <select name="group" className={inputCls} defaultValue="">
                        <option value="">Other</option>
                        {[...new Set([...GROUPS.map((g) => g.title), ...sets.map((one) => one.group).filter((one): one is string => !!one)])].map((title) => <option key={title} value={title}>{title}</option>)}
                      </select>
                    </Field>
                    <Field label="Description"><input name="description" className={inputCls} placeholder="What the set is for" /></Field>
                  </div>
                </ActionForm>
              </Card>
            ) : null}
            {sp.panel === "details" ? (
              <Card title="Set details" actions={<Link href={here({ panel: undefined })} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></Link>}>
                <ActionForm action={updateConfigSetAction} submitLabel="Save set details" size="sm" hidden={{ oldKey: set.key }}>
                  <div className="grid grid-cols-1 items-end gap-x-4 gap-y-3 sm:grid-cols-2">
                    <Field label="Title" required><input name="title" required defaultValue={set.title} className={inputCls} /></Field>
                    <Field label="Key" required hint="changing it also updates numbering and route references"><input name="key" required defaultValue={set.key} className={inputCls} /></Field>
                    <Field label="Category">
                      <select name="group" defaultValue={set.group ?? ""} className={inputCls}>
                        <option value="">Other</option>
                        {[...new Set([...GROUPS.map((g) => g.title), ...(set.group ? [set.group] : [])])].map((title) => <option key={title} value={title}>{title}</option>)}
                      </select>
                    </Field>
                    <Field label="Description" className="sm:col-span-2"><input name="description" defaultValue={set.description ?? ""} className={inputCls} /></Field>
                  </div>
                </ActionForm>
              </Card>
            ) : null}

            {/* The register's asking row: search, one plain choice, one Apply. */}
            <section className="register register-sheet register-sheet-open">
              <form className="asking flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5" action="/settings/config">
                <input type="hidden" name="set" value={currentKey} />
                <label className="search-field relative min-w-60 flex-1">
                  <span className="sr-only">Search this set</span>
                  <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    name="q"
                    defaultValue={q}
                    placeholder={`Search ${set.title.toLowerCase()} by code or label…`}
                    className="plain w-full py-1.5! pl-6! text-[13px]!"
                  />
                </label>
                <label className="min-w-0">
                  <span className="sr-only">Which values to show</span>
                  <select name="show" defaultValue={show} data-on={show !== "ACTIVE" ? "true" : "false"} className="plain">
                    <option value="ACTIVE">Active</option>
                    <option value="RETIRED">Retired{retiredCount ? ` (${retiredCount})` : ""}</option>
                    <option value="ALL">All</option>
                  </select>
                </label>
                <button className="ask" data-on={q || show !== "ACTIVE" ? "true" : "false"}>Apply</button>
                {q || show !== "ACTIVE" ? (
                  <Link href={`/settings/config?set=${currentKey}`} className="text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">
                    Clear
                  </Link>
                ) : null}
              </form>
            </section>

            {values.length ? (
              <>
              {/* Declared outside the table: a form inside a table cell cannot
                  hold another form, so the boxes and the buttons are associated
                  with this one by id instead of by nesting. Which answers it
                  offers follows the list — only the ones that apply to what is
                  on screen. */}
              <form id="bulk-values" action={bulkValuesAction} className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-tint-soft px-4 py-2 text-[11px]">
                <SelectAll formId="bulk-values" count={values.length} />
                {show !== "RETIRED" ? (
                  <button name="op" value="RETIRE" className="font-semibold text-slate-600 hover:text-red-600">Retire</button>
                ) : null}
                {show !== "ACTIVE" ? (
                  <button name="op" value="REACTIVATE" className="font-semibold text-slate-600 hover:text-emerald-700">Activate</button>
                ) : null}
                <button name="op" value="DELETE" className="font-semibold text-slate-600 hover:text-red-700">Delete</button>
                <span className="ml-auto text-slate-400">A code the register already carries is retired, never deleted.</span>
              </form>
              <DataTable
                id={`set-values-${propFields ? currentKey : "plain"}`}
                head={<tr><Th className="w-8" /><Th>Code</Th><Th>Label</Th>{propFields ? <Th>What it does</Th> : null}<Th label="Used on" className="text-right">Used on</Th><Th>Status</Th><Th /></tr>}
              >
                {values.map((v) => {
                  const props = parseProps(v.props);
                  const n = used.counts.get(v.code) ?? 0;
                  const open = editing?.id === v.id;
                  const index = allValues.findIndex((x) => x.id === v.id);
                  return [
                    <tr key={v.id} className={open ? "[&>td]:bg-tint-soft" : v.status === "RETIRED" ? "opacity-60" : undefined}>
                      <Td className="w-8">
                        <input type="checkbox" form="bulk-values" name="valueIds" value={v.id} aria-label={`Select ${v.code}`} />
                      </Td>
                      <Td className="whitespace-nowrap font-mono text-xs font-bold text-slate-900"><Link href={here({ edit: open ? undefined : v.id, panel: undefined })} className="hover:text-link">{v.code}</Link></Td>
                      <Td className="min-w-50 text-sm"><Link href={here({ edit: open ? undefined : v.id, panel: undefined })} className="hover:text-link">{v.label}</Link></Td>
                      {propFields ? <Td className="text-xs text-slate-600">{doesText(propFields, props) || <span className="text-slate-300">—</span>}</Td> : null}
                      <Td className="whitespace-nowrap text-right text-xs tabular-nums">
                        {n ? (used.filter ? <Link href={`/documents?${used.filter}=${encodeURIComponent(v.code)}&view=all`} className="text-link hover:underline">{n} {used.unit}{n === 1 ? "" : "s"}</Link> : <span className="text-slate-600">{n} {used.unit}{n === 1 ? "" : "s"}</span>) : <span className="text-slate-300">—</span>}
                      </Td>
                      <Td className="whitespace-nowrap">{v.status === "ACTIVE" ? <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-300">active</Chip> : <Chip className="bg-slate-100 text-slate-500 ring-slate-300">retired</Chip>}</Td>
                      <Td className="whitespace-nowrap text-right"><Link href={here({ edit: open ? undefined : v.id, panel: undefined })} className="text-xs font-semibold text-link hover:underline">{open ? "Close" : "Edit"}</Link></Td>
                    </tr>,
                    open ? (
                      <tr key={`${v.id}-edit`}>
                        <Td colSpan={propFields ? 7 : 6} className="bg-tint-soft">
                          <ActionForm action={updateValuePropsAction} submitLabel="Save" size="sm" hidden={{ valueId: v.id, setKey: currentKey }}>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <Field label="Code" hint={n ? "in use — retire it and add a new code instead" : "not used yet, so it can still change"}>
                                <input name="code" defaultValue={v.code} readOnly={n > 0} className={`${inputCls} ${n ? "bg-slate-50 text-slate-500" : ""}`} />
                              </Field>
                              <Field label="Label"><input name="label" defaultValue={v.label} className={inputCls} /></Field>
                              {propFields ? null : (
                                <Field label="Properties (JSON)" hint="free-form for custom sets" className="sm:col-span-2">
                                  <textarea name="propsJson" rows={2} defaultValue={v.props ?? ""} className={inputCls} />
                                </Field>
                              )}
                              {propFields?.map((f) => <PropInput key={f.key} field={f} value={f.type === "choice" ? f.read(props) : props[f.key]} />)}
                            </div>
                          </ActionForm>
                          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs">
                            <form action={retireConfigValueAction}>
                              <input type="hidden" name="valueId" value={v.id} />
                              <button className={v.status === "ACTIVE" ? "text-slate-500 hover:text-red-600" : "text-slate-500 hover:text-emerald-700"}>{v.status === "ACTIVE" ? "Retire" : "Reactivate"}</button>
                            </form>
                            {!n ? (
                              <form action={deleteValueAction}>
                                <input type="hidden" name="valueId" value={v.id} />
                                <button className="text-slate-500 hover:text-red-600">Delete</button>
                              </form>
                            ) : null}
                            <span className="ml-auto flex items-center gap-1 text-slate-400">
                              Order
                              <form action={moveConfigValueAction}><input type="hidden" name="valueId" value={v.id} /><input type="hidden" name="direction" value="up" /><button disabled={index === 0} className="rounded px-1.5 py-0.5 hover:bg-slate-100 disabled:opacity-25" title="Move up">↑</button></form>
                              <form action={moveConfigValueAction}><input type="hidden" name="valueId" value={v.id} /><input type="hidden" name="direction" value="down" /><button disabled={index === allValues.length - 1} className="rounded px-1.5 py-0.5 hover:bg-slate-100 disabled:opacity-25" title="Move down">↓</button></form>
                            </span>
                          </div>
                        </Td>
                      </tr>
                    ) : null,
                  ];
                })}
              </DataTable>
              </>
            ) : (
              <p className="rounded-2xl border border-dashed border-line-strong px-5 py-10 text-center text-sm text-slate-500">
                {q ? `Nothing in ${set.title} matches “${q}”.` : show === "RETIRED" ? "Nothing retired in this set." : "This set has no values yet — add one."}
              </p>
            )}
          </section>
        ) : (
          <p className="text-sm text-slate-400">No sets published yet — run the seed or create one.</p>
        )}
      </SetNav>
    </div>
  );
}

function PropInput({ field, value }: { field: PropField; value: unknown }) {
  if (field.type === "choice") {
    return (
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-xs font-semibold text-slate-700">{field.label}</legend>
        <div className="space-y-1.5">
          {field.options.map((o, i) => (
            <label key={o.value} className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-sm text-slate-700 has-checked:border-brand-line has-checked:bg-tint-soft">
              <input type="radio" name={`prop_${field.key}`} value={o.value} defaultChecked={value ? value === o.value : i === 0} className="mt-0.5" />
              <span><strong className="font-semibold">{o.label.split(" — ")[0]}</strong>{o.label.includes(" — ") ? <span className="text-slate-500"> — {o.label.split(" — ").slice(1).join(" — ")}</span> : null}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
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
