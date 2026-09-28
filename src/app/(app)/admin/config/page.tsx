import { isAdmin } from "@/lib/auth";
import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, Chip, Field, inputCls, DataTable, Th, Td, btn } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { addConfigValueAction, retireConfigValueAction, createConfigSetAction, updateValuePropsAction, deleteValueAction, deleteSetAction, moveConfigValueAction, updateConfigSetAction, } from "@/lib/actions/admin";
import { getSets } from "@/lib/config";
import { SET_PROP_FIELDS, parseProps, type PropField } from "@/lib/config-props";
import type { Tenant } from "@/lib/tenant";
import { SetUpload } from "./set-upload";
import { SetNav, type SetNavGroup } from "./set-nav";
import { Plus, Search, Upload, X } from "lucide-react";

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
  const propFields = SET_PROP_FIELDS[currentKey];
  const values = allValues.filter((v) =>
    (show === "ALL" || v.status === show) &&
    (!q || v.code.toLowerCase().includes(q.toLowerCase()) || v.label.toLowerCase().includes(q.toLowerCase())),
  );
  const retiredCount = allValues.filter((v) => v.status === "RETIRED").length;
  const countOf = (key: string) => counts.find((c) => c.setKey === key)?._count ?? 0;
  const known = new Set(GROUPS.flatMap((g) => g.keys));
  const groups: SetNavGroup[] = [
    ...GROUPS.map((g) => ({ title: g.title, sets: g.keys.map((k) => sets.find((s) => s.key === k)).filter((s): s is (typeof sets)[number] => !!s).map((s) => ({ key: s.key, title: s.title, count: countOf(s.key) })) })),
    { title: "Other", sets: sets.filter((s) => !known.has(s.key)).map((s) => ({ key: s.key, title: s.title, count: countOf(s.key) })) },
  ].filter((g) => g.sets.length);
  const here = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ set: currentKey, ...(q ? { q } : {}), ...(show !== "ACTIVE" ? { show } : {}) });
    for (const [k, v] of Object.entries(extra)) v === undefined ? p.delete(k) : p.set(k, v);
    return `/admin/config?${p}`;
  };
  const editing = sp.edit ? allValues.find((v) => v.id === sp.edit) ?? null : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Disciplines, types & sets"
        subtitle="The codes and choices your organization uses. All lists are written into the project's management plan and approved there. A code already used is retired, never deleted, so older documents keep it and stay findable."
      />

      <SetNav groups={groups} current={currentKey}>
        {set ? (
          <section className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">{set.title}</h2>
                <p className="mt-0.5 max-w-3xl text-xs leading-5 text-slate-500">{set.description ?? ""}{set.description ? " · " : ""}{countOf(set.key)} active{retiredCount ? `, ${retiredCount} retired` : ""} · version {set.version}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={here({ panel: sp.panel === "add" ? undefined : "add", edit: undefined })} className={btn("primary", "sm")}><Plus className="h-3.5 w-3.5" /> Add value</Link>
                <Link href={here({ panel: sp.panel === "upload" ? undefined : "upload", edit: undefined })} className={btn("secondary", "sm")}><Upload className="h-3.5 w-3.5" /> Replace from a spreadsheet</Link>
                <Link href={here({ panel: sp.panel === "details" ? undefined : "details", edit: undefined })} className={btn("ghost", "sm")}>Set details</Link>
                <Link href={here({ panel: sp.panel === "new" ? undefined : "new", edit: undefined })} className={btn("ghost", "sm")}>+ New set</Link>
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
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="Title" required><input name="title" required className={inputCls} placeholder="Areas" /></Field>
                    <Field label="Key" required hint="UPPER_SNAKE"><input name="key" required className={inputCls} placeholder="AREAS" /></Field>
                    <Field label="Description"><input name="description" className={inputCls} placeholder="What the set is for" /></Field>
                  </div>
                </ActionForm>
              </Card>
            ) : null}
            {sp.panel === "upload" ? (
              <Card title="Replace from a spreadsheet" actions={<Link href={here({ panel: undefined })} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></Link>}>
                <SetUpload setKey={set.key} templateHref={`/api/controlled/current/VALUE_SET?key=${encodeURIComponent(set.key)}`} />
              </Card>
            ) : null}
            {sp.panel === "details" ? (
              <Card title="Set details" actions={<Link href={here({ panel: undefined })} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></Link>}>
                <ActionForm action={updateConfigSetAction} submitLabel="Save set details" size="sm" hidden={{ oldKey: set.key }}>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Title" required><input name="title" required defaultValue={set.title} className={inputCls} /></Field>
                    <Field label="Key" required hint="changing it also updates numbering and route references"><input name="key" required defaultValue={set.key} className={inputCls} /></Field>
                    <Field label="Description" className="sm:col-span-2"><input name="description" defaultValue={set.description ?? ""} className={inputCls} /></Field>
                  </div>
                </ActionForm>
                <div className="mt-3 flex items-center gap-4 border-t border-slate-100 pt-3 text-xs">
                  <a href={`/api/export/config-set?set=${encodeURIComponent(set.key)}`} className="font-semibold text-link hover:underline">Export as CSV ↓</a>
                  <form action={deleteSetAction}>
                    <input type="hidden" name="key" value={set.key} />
                    <button className="text-slate-400 hover:text-red-600" title="Only an unused set that nothing depends on can be deleted">Delete this set</button>
                  </form>
                </div>
              </Card>
            ) : null}

            <form className="flex flex-wrap items-center gap-2" action="/admin/config">
              <input type="hidden" name="set" value={currentKey} />
              <label className="relative min-w-60 flex-1">
                <span className="sr-only">Search this set</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input name="q" defaultValue={q} placeholder={`Search ${set.title.toLowerCase()} by code or label…`} className="h-9 w-full rounded-lg border border-slate-200 bg-surface pl-8 pr-2 text-xs outline-none focus:border-brand-line" />
              </label>
              <select name="show" defaultValue={show} className="h-9 rounded-lg border border-slate-200 bg-surface px-2 text-xs text-slate-700">
                <option value="ACTIVE">Active</option>
                <option value="RETIRED">Retired{retiredCount ? ` (${retiredCount})` : ""}</option>
                <option value="ALL">All</option>
              </select>
              <button className={btn("secondary", "sm")}>Search</button>
              {q || show !== "ACTIVE" ? <Link href={`/admin/config?set=${currentKey}`} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Clear</Link> : null}
            </form>

            {values.length ? (
              <DataTable
                id={`set-values-${propFields ? currentKey : "plain"}`}
                head={<tr><Th>Code</Th><Th>Label</Th>{propFields ? <Th>What it does</Th> : null}<Th label="Used on" className="text-right">Used on</Th><Th>Status</Th><Th /></tr>}
              >
                {values.map((v) => {
                  const props = parseProps(v.props);
                  const n = used.counts.get(v.code) ?? 0;
                  const open = editing?.id === v.id;
                  const index = allValues.findIndex((x) => x.id === v.id);
                  return [
                    <tr key={v.id} className={open ? "[&>td]:bg-tint-soft" : v.status === "RETIRED" ? "opacity-60" : undefined}>
                      <Td className="whitespace-nowrap font-mono text-xs font-bold text-slate-900"><Link href={here({ edit: open ? undefined : v.id, panel: undefined })} className="hover:text-link">{v.code}</Link></Td>
                      <Td className="min-w-[200px] text-sm"><Link href={here({ edit: open ? undefined : v.id, panel: undefined })} className="hover:text-link">{v.label}</Link></Td>
                      {propFields ? <Td className="text-xs text-slate-600">{doesText(propFields, props) || <span className="text-slate-300">—</span>}</Td> : null}
                      <Td className="whitespace-nowrap text-right text-xs tabular-nums">
                        {n ? (used.filter ? <Link href={`/documents?${used.filter}=${encodeURIComponent(v.code)}&view=all`} className="text-link hover:underline">{n} {used.unit}{n === 1 ? "" : "s"}</Link> : <span className="text-slate-600">{n} {used.unit}{n === 1 ? "" : "s"}</span>) : <span className="text-slate-300">—</span>}
                      </Td>
                      <Td className="whitespace-nowrap">{v.status === "ACTIVE" ? <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-300">active</Chip> : <Chip className="bg-slate-100 text-slate-500 ring-slate-300">retired</Chip>}</Td>
                      <Td className="whitespace-nowrap text-right"><Link href={here({ edit: open ? undefined : v.id, panel: undefined })} className="text-xs font-semibold text-link hover:underline">{open ? "Close" : "Edit"}</Link></Td>
                    </tr>,
                    open ? (
                      <tr key={`${v.id}-edit`}>
                        <Td colSpan={propFields ? 6 : 5} className="bg-tint-soft">
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
                          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3 text-xs">
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
            ) : (
              <p className="rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center text-sm text-slate-500">
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
            <label key={o.value} className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 has-[:checked]:border-brand-line has-[:checked]:bg-tint-soft">
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
