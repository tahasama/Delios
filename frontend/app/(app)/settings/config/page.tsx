import Link from "next/link";
import { api, projectPath } from "@/lib/client";
import { requireScope } from "@/lib/core/scope";
import { Field, DataTable, Th, Td, ToneChip, btn } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { addValueAction, retireValueAction, createListAction, updateValueAction, deleteValueAction, moveValueAction, updateListAction, bulkValuesAction } from "@/lib/settings/forms-lists";
import { getSet, getSets } from "@/lib/settings/config";
import { parseProps, type PropField } from "@/lib/settings/config-props";
import { propFieldsFor, isVerdictSet } from "@/lib/settings/set-props";
import { SelectAll } from "./select-all";
import { DeleteSetButton } from "./delete-set";
import { SetNav, type SetNavGroup } from "./set-nav";
import { Plus, Search, Pencil, Download } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Types & sets" };

/** A field as on the new-document form: grey, no box, inside a sheet's `asking` body. */
const field = "plain w-full";

/** Sets grouped by what they are for. Anything not listed falls under "Other". */
const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Numbering & identity", keys: ["PROJECT_CODES", "SUBPROJECTS", "DISCIPLINES", "DOCUMENT_TYPES", "DELIVERABLE_TYPES", "SUPPLIER_CODES", "PURCHASE_ORDERS", "DELIVERABLE_TYPE_FIELDS", "PROJECT_KINDS"] },
  // The comment lists sit together, with the outcomes they feed: one classifies
  // a comment somebody wrote, the other is what an advisory step's comments
  // amount to. Both are the organization's to edit.
  { title: "Review & issue", keys: ["REVIEW_OUTCOMES", "REVIEW_ADVICE", "COMMENT_CLASSES", "STATUSES", "REASONS_FOR_ISSUE", "RETURN_REASONS", "ISSUE_CODES"] },
  { title: "Classification & keeping", keys: ["CRITICALITY", "CONFIDENTIALITY", "RETENTION_CLASSES", "PHASES"] },
  { title: "File formats", keys: ["NATIVE_FORMATS", "RENDITION_FORMATS", "PRESERVATION_FORMATS"] },
];

/**
 * How many of the project's documents carry each value of a list, counted by the backend (`GET /register/usage`), and
 * the register filter that opens them. A list documents do not carry counts nothing.
 */
async function usage(t: { projectId: string }, key: string): Promise<{ counts: Map<string, number>; unit: string; filter?: string }> {
  const read = await api<{ filter: string | null; counts: Record<string, number> }>(projectPath(t, `/register/usage?set=${encodeURIComponent(key)}`))
    .catch(() => ({ filter: null, counts: {} as Record<string, number> }));
  return { counts: new Map(Object.entries(read.counts)), unit: "document", filter: read.filter ?? undefined };
}

/** A plain question nobody answered yet: none of what its answers set is stored (a value made before its list asked it). */
function unanswered(f: PropField, props: Record<string, unknown>): boolean {
  return f.type === "choice" && !f.options.some((o) => Object.keys(o.sets).some((key) => key in props));
}

/** What a value does, in the plain words of its set's questions. */
function doesText(fields: PropField[] | undefined, props: Record<string, unknown>): string {
  if (!fields) return "";
  return fields.map((f) => {
    if (f.type === "choice") return unanswered(f, props) ? `${f.label.toLowerCase()}: not chosen yet` : f.options.find((o) => o.value === f.read(props))?.label.split(" — ")[0] ?? "";
    if (f.type === "bool") return props[f.key] === true ? f.label.toLowerCase() : "";
    const v = props[f.key];
    if (v === undefined || v === null || v === "") return "";
    return f.type === "int" ? `${f.label.toLowerCase().replace(/ \(days\)/, "")}: ${v} days` : `${f.label.toLowerCase()}: ${String(v)}`;
  }).filter(Boolean).join(" · ");
}

type Params = { set?: string; q?: string; show?: string; edit?: string; panel?: string };

type ListsAnswer = { own: boolean; mayChange: boolean; sets: { key: string; active: number; retired: number }[]; runsOn: string[] };

/**
 * Types & sets: the project's lists. Until the project changes one it reads the organization's (the default); its first
 * change gives it its own copy, which the organization's later changes never touch. A value never used on the project
 * may change entirely, or be deleted; once used, only its name changes, or it is retired. Whoever acts as the control
 * function changes them (on a project with none, whoever opened it); everyone of ours reads them.
 */
export default async function ListsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const ctx = await requireScope();
  const sp = await searchParams;
  const [sets, lists] = await Promise.all([
    getSets(),
    api<ListsAnswer>(projectPath(ctx, "/lists")).catch(() => ({ own: false, mayChange: false, sets: [], runsOn: [] } as ListsAnswer)),
  ]);
  const currentKey = sp.set ?? sets[0]?.key ?? "";
  const q = (sp.q ?? "").trim();
  const show = sp.show === "RETIRED" || sp.show === "ALL" ? sp.show : "ACTIVE";
  const set = sets.find((one) => one.key === currentKey) ?? null;
  // Verdict lists are kept in Verdict lists, project codes by the app: shown here, changed there.
  const readOnlyWhy = !set ? null
    : isVerdictSet(set.key, set.kind) ? "verdicts"
    : set.key === "PROJECT_CODES" ? "codes"
    : null;
  const may = lists.mayChange && !readOnlyWhy;
  const [allValues, used, places] = await Promise.all([
    getSet(currentKey).then((all) => all.map((v) => ({ ...v, id: `${currentKey}::${v.code}`, setKey: currentKey, props: Object.keys(v.props).length ? JSON.stringify(v.props) : null }))),
    usage(ctx, currentKey),
    api<Record<string, string[]>>(projectPath(ctx, `/lists/${encodeURIComponent(currentKey)}/usage`)).catch(() => ({} as Record<string, string[]>)),
  ]);
  const propFields = propFieldsFor(currentKey, set?.kind);
  // The other lists a property picks from, such as a document type's recommended criticality.
  const pick: Record<string, { code: string; label: string }[]> = Object.fromEntries(await Promise.all(
    [...new Set((propFields ?? []).flatMap((f) => (f.type === "set" || f.type === "sets" ? [f.setKey] : [])))].map(async (key) =>
      [key, (await getSet(key)).filter((v) => v.status === "ACTIVE").map((v) => ({ code: v.code, label: v.label }))] as const)));
  const values = allValues.filter((v) =>
    (show === "ALL" || v.status === show) &&
    (!q || v.code.toLowerCase().includes(q.toLowerCase()) || v.label.toLowerCase().includes(q.toLowerCase())),
  );
  const retiredCount = allValues.filter((v) => v.status === "RETIRED").length;
  const countOf = (key: string) => lists.sets.find((c) => c.key === key)?.active ?? 0;
  const listUsed = Object.keys(places).length > 0;
  const runsOn = !!set && lists.runsOn.includes(set.key);
  const headingOf = (one: (typeof sets)[number]) =>
    one.group?.trim() || GROUPS.find((g) => g.keys.includes(one.key))?.title || "Other";
  const headings = [...GROUPS.map((g) => g.title), ...sets.map(headingOf).filter((h) => !GROUPS.some((g) => g.title === h) && h !== "Other"), "Other"];
  const groups: SetNavGroup[] = [...new Set(headings)]
    .map((title) => ({ title, sets: sets.filter((one) => headingOf(one) === title).map((one) => ({ key: one.key, title: one.title, count: countOf(one.key) })) }))
    .filter((g) => g.sets.length);
  const here = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ set: currentKey, ...(q ? { q } : {}), ...(show !== "ACTIVE" ? { show } : {}) });
    for (const [k, v] of Object.entries(extra)) v === undefined ? p.delete(k) : p.set(k, v);
    return `/settings/config?${p}`;
  };
  const editing = sp.edit ? allValues.find((v) => v.id === sp.edit) ?? null : null;
  const categories = [...new Set([...GROUPS.map((g) => g.title), ...sets.map((one) => one.group).filter((one): one is string => !!one)])];

  return (
    <div className="space-y-4">
      {/* The plate: whose lists these are, and who changes them. */}
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col gap-3 px-5 pt-6 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="plate-title text-slate-950">Types & sets</h1>
            <p className="plate-meta mt-2">
              {ctx.project.code} · {sets.length} lists · {lists.own ? `${ctx.project.code}'s own` : "the organization's, until a first change here"}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              Every code and choice a document is described with, one list each. A value never used on {ctx.project.code} may change
              entirely, or be deleted; once used, only its name changes, or it is retired.{" "}
              {lists.mayChange ? "You change them here." : `Read only: whoever acts as the control function on ${ctx.project.code} changes them.`}
            </p>
          </div>
          {lists.mayChange ? (
            <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
              <Link href={here({ panel: sp.panel === "new" ? undefined : "new", edit: undefined })} className={btn("primary")}><Plus className="h-4 w-4" /> New list</Link>
              <Link href="/import" className="text-xs font-medium text-slate-500 transition hover:text-link">Got a list in a spreadsheet? Import it →</Link>
            </div>
          ) : null}
        </div>
      </section>

      {sp.panel === "new" && lists.mayChange ? (
        <section className="register register-sheet register-sheet-open">
          <div className="border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6"><span className="stencil text-slate-500">New list</span><span className="ml-2 text-[11px] text-slate-500">a list {ctx.project.code} needs that the others do not cover: areas, systems, anything</span></div>
          <ActionForm id="new-list" action={createListAction} hideSubmit className="asking px-5 py-5 sm:px-6">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Name" required><input name="title" required className={field} placeholder="Areas" /></Field>
              <Field label="Short name" required hint="capitals, no spaces (use _); fixed once a value is used"><input name="key" required pattern="[A-Z][A-Z0-9_]*" title="Capital letters, digits and _ only, e.g. AREAS" className={field} placeholder="AREAS" /></Field>
              <Field label="Group">
                <select name="group" className={field} defaultValue=""><option value="">Other</option>{categories.map((title) => <option key={title} value={title}>{title}</option>)}</select>
              </Field>
              <Field label="What it is for"><input name="description" className={field} /></Field>
            </div>
          </ActionForm>
          <div className="flex items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
            <Link href={here({ panel: undefined })} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
            <button type="submit" form="new-list" data-on="true" className="ask">Create the list</button>
          </div>
        </section>
      ) : null}

      <SetNav groups={groups} current={currentKey}>
        {set ? (
          <section className="min-w-0 space-y-3">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-slate-900">{set.title}</h2>
                {set.description ? <p className="mt-1 text-xs leading-5 text-slate-500">{set.description}</p> : null}
                {readOnlyWhy === "verdicts" ? (
                  <p className="mt-1 text-xs text-slate-600">A verdict list: its verdicts and what each means are kept in{" "}
                    <Link href="/settings/verdicts" className="font-semibold text-link hover:underline">Verdict lists</Link>.</p>
                ) : readOnlyWhy === "codes" ? (
                  <p className="mt-1 text-xs text-slate-600">Filled by the app: each project&rsquo;s code is in it.</p>
                ) : null}
                <p className="mt-1 text-[11px] text-slate-500">
                  {countOf(set.key)} in use{retiredCount ? ` · ${retiredCount} retired` : ""} · {listUsed ? "used on this project" : "never used on this project"}
                  {runsOn ? " · the app runs on this list" : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-5">
                {may ? <Link href={here({ panel: sp.panel === "add" ? undefined : "add", edit: undefined })} className={btn("primary", "sm")}><Plus className="h-3.5 w-3.5" /> Add a value</Link> : null}
                <div className="flex items-center gap-0.5 border-l border-line pl-4">
                  {may ? <Link href={here({ panel: sp.panel === "details" ? undefined : "details", edit: undefined })} title="Rename this list" aria-label="Rename this list" className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></Link> : null}
                  <a href={`/api/export/config-set?set=${encodeURIComponent(set.key)}`} title="Download this list" aria-label="Download this list" className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"><Download className="h-4 w-4" /></a>
                  {may && !runsOn && !listUsed ? <DeleteSetButton setKey={set.key} title={set.title} count={allValues.length} /> : null}
                </div>
              </div>
            </div>

            {sp.panel === "add" && may ? (
              <section className="register register-sheet register-sheet-open">
                <div className="border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6"><span className="stencil text-slate-500">A new value</span><span className="ml-2 text-[11px] text-slate-500">in {set.title.toLowerCase()}</span></div>
                <ActionForm id="add-value" action={addValueAction} hideSubmit hidden={{ setKey: currentKey }} resetOnSuccess className="asking px-5 py-5 sm:px-6">
                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <Field label="Code" required hint="what appears in numbers and lists"><input name="code" required maxLength={24} className={field} /></Field>
                    <Field label="Name" required><input name="label" required className={field} /></Field>
                    {propFields?.map((f) => <PropInput key={f.key} field={f} value={undefined} lists={pick} unset={f.type === "choice"} />)}
                  </div>
                </ActionForm>
                <div className="flex items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
                  <Link href={here({ panel: undefined })} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                  <button type="submit" form="add-value" data-on="true" className="ask">Add it</button>
                </div>
              </section>
            ) : null}
            {sp.panel === "details" && may ? (
              <section className="register register-sheet register-sheet-open">
                <div className="border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6"><span className="stencil text-slate-500">This list</span><span className="ml-2 text-[11px] text-slate-500">{listUsed || runsOn ? "its short name stays: a value of it is used" : "never used: its short name may still change"}</span></div>
                <ActionForm id="list-details" action={updateListAction} hideSubmit hidden={{ key: set.key }} className="asking px-5 py-5 sm:px-6">
                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Name" required><input name="title" required defaultValue={set.title} className={field} /></Field>
                    <Field label="Short name" hint={listUsed || runsOn ? "fixed" : "capitals, digits and _"}>
                      {listUsed || runsOn
                        ? <input defaultValue={set.key} disabled className={field} aria-label="Short name (fixed)" />
                        : <input name="newKey" defaultValue={set.key} pattern="[A-Z][A-Z0-9_]*" className={field} />}
                    </Field>
                    <Field label="Group">
                      <select name="group" defaultValue={set.group ?? ""} className={field}><option value="">Other</option>{categories.map((title) => <option key={title} value={title}>{title}</option>)}</select>
                    </Field>
                    <Field label="What it is for"><input name="description" defaultValue={set.description ?? ""} className={field} /></Field>
                  </div>
                </ActionForm>
                <div className="flex items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
                  <Link href={here({ panel: undefined })} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                  <button type="submit" form="list-details" data-on="true" className="ask">Save</button>
                </div>
              </section>
            ) : null}

            {/* The register's asking row: search, one plain choice, one Apply. */}
            <section className="register register-sheet register-sheet-open">
              <form className="asking flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5" action="/settings/config">
                <input type="hidden" name="set" value={currentKey} />
                <label className="search-field relative min-w-60 flex-1">
                  <span className="sr-only">Search this list</span>
                  <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input name="q" defaultValue={q} placeholder={`Search ${set.title.toLowerCase()} by code or name…`} className="plain w-full pl-6!" />
                </label>
                <label className="min-w-0">
                  <span className="sr-only">Which values to show</span>
                  <select name="show" defaultValue={show} data-on={show !== "ACTIVE" ? "true" : "false"} className="plain">
                    <option value="ACTIVE">In use</option>
                    <option value="RETIRED">Retired{retiredCount ? ` (${retiredCount})` : ""}</option>
                    <option value="ALL">All</option>
                  </select>
                </label>
                <button className="ask" data-on={q || show !== "ACTIVE" ? "true" : "false"}>Apply</button>
                {q || show !== "ACTIVE" ? (
                  <Link href={`/settings/config?set=${currentKey}`} className="text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">Clear</Link>
                ) : null}
              </form>
            </section>

            {values.length ? (
              <>
              {may ? (
                // Declared outside the table: a form inside a table cell cannot hold another form, so the boxes are tied to it by id.
                <form id="bulk-values" action={bulkValuesAction} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-tint-soft px-4 py-2 text-[11px] ring-1 ring-line">
                  <SelectAll formId="bulk-values" count={values.length} />
                  {show !== "RETIRED" ? <button name="op" value="RETIRE" className="font-semibold text-slate-600 hover:text-red-600">Retire</button> : null}
                  {show !== "ACTIVE" ? <button name="op" value="REACTIVATE" className="font-semibold text-slate-600 hover:text-emerald-700">Bring back</button> : null}
                  <span className="ml-auto text-slate-500">A value used is retired, never deleted: no longer offered, back with Bring back.</span>
                </form>
              ) : null}
              <DataTable
                id={`set-values-${propFields ? currentKey : "plain"}`}
                head={<tr>{may ? <Th className="w-8" /> : null}<Th>Code</Th><Th>Name</Th>{propFields ? <Th>What it does</Th> : null}<Th>Used</Th><Th>Status</Th>{may ? <Th /> : null}</tr>}
              >
                {values.map((v) => {
                  const props = parseProps(v.props);
                  const n = used.counts.get(v.code) ?? 0;
                  const where = places[v.code] ?? [];
                  const isUsed = where.length > 0;
                  const open = may && editing?.id === v.id;
                  const index = allValues.findIndex((x) => x.id === v.id);
                  return [
                    <tr key={v.id} className={open ? "[&>td]:bg-tint-soft" : v.status === "RETIRED" ? "opacity-60" : undefined}>
                      {may ? <Td className="w-8"><input type="checkbox" form="bulk-values" name="valueIds" value={v.id} aria-label={`Select ${v.code}`} /></Td> : null}
                      <Td className="whitespace-nowrap font-mono text-xs font-bold text-slate-900">{may ? <Link href={here({ edit: open ? undefined : v.id, panel: undefined })} className="hover:text-link">{v.code}</Link> : v.code}</Td>
                      <Td className="min-w-50 text-sm">{may ? <Link href={here({ edit: open ? undefined : v.id, panel: undefined })} className="hover:text-link">{v.label}</Link> : v.label}</Td>
                      {propFields ? <Td className={propFields.some((f) => unanswered(f, props)) ? "text-xs text-amber-700" : "text-xs text-slate-600"}>{doesText(propFields, props) || <span className="text-slate-300">—</span>}</Td> : null}
                      <Td className="text-xs">
                        {isUsed ? (
                          n && used.filter
                            ? <Link href={`/documents?${used.filter}=${encodeURIComponent(v.code)}&view=all`} className="text-link hover:underline" title={where.join(" · ")}>{where.join(" · ")}</Link>
                            : <span className="text-slate-600">{where.join(" · ")}</span>
                        ) : <span className="text-slate-400">never used</span>}
                      </Td>
                      <Td className="whitespace-nowrap">{v.status === "ACTIVE" ? <ToneChip tone="done">in use</ToneChip> : <ToneChip tone="idle">retired</ToneChip>}</Td>
                      {may ? <Td className="whitespace-nowrap text-right"><Link href={here({ edit: open ? undefined : v.id, panel: undefined })} className="text-xs font-semibold text-link hover:underline">{open ? "Close" : "Change"}</Link></Td> : null}
                    </tr>,
                    open ? (
                      <tr key={`${v.id}-edit`}>
                        <Td colSpan={propFields ? 7 : 6} className="bg-tint-soft">
                          <ActionForm id={`value-${index}`} action={updateValueAction} hideSubmit hidden={{ valueId: v.id, used: isUsed ? "1" : "0" }} className="asking">
                            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                              <Field label="Code" hint={isUsed ? "used: it stays. Add a new value for another code" : "never used: it may still change"}>
                                {isUsed ? <input defaultValue={v.code} disabled className={field} aria-label="Code (fixed)" /> : <input name="code" defaultValue={v.code} className={field} />}
                              </Field>
                              <Field label="Name"><input name="label" defaultValue={v.label} className={field} /></Field>
                              {isUsed
                                ? (propFields ? <p className="text-xs leading-5 text-slate-500 sm:col-span-2">What it does stays as it is while it is used: {doesText(propFields, props) || "nothing set"}. Add a new value to change it.</p> : null)
                                : propFields?.map((f) => <PropInput key={f.key} field={f} value={f.type === "choice" ? (unanswered(f, props) ? undefined : f.read(props)) : props[f.key]} lists={pick} unset={unanswered(f, props)} />)}
                            </div>
                          </ActionForm>
                          <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line pt-3 text-xs">
                            <Link href={here({ edit: undefined })} className="font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                            <form action={retireValueAction}>
                              <input type="hidden" name="valueId" value={v.id} />
                              <button className={v.status === "ACTIVE" ? "text-slate-500 hover:text-red-600" : "text-slate-500 hover:text-emerald-700"}>{v.status === "ACTIVE" ? "Retire" : "Bring back"}</button>
                            </form>
                            {!isUsed ? (
                              <ActionForm action={deleteValueAction} hidden={{ valueId: v.id }} submitLabel="Delete" size="sm" className="space-y-0" />
                            ) : null}
                            <span className="flex items-center gap-1 text-slate-500">
                              Order
                              <form action={moveValueAction}><input type="hidden" name="valueId" value={v.id} /><input type="hidden" name="direction" value="up" /><button disabled={index === 0} className="rounded px-1.5 py-0.5 hover:bg-slate-100 disabled:opacity-25" title="Move up">↑</button></form>
                              <form action={moveValueAction}><input type="hidden" name="valueId" value={v.id} /><input type="hidden" name="direction" value="down" /><button disabled={index === allValues.length - 1} className="rounded px-1.5 py-0.5 hover:bg-slate-100 disabled:opacity-25" title="Move down">↓</button></form>
                            </span>
                            <button type="submit" form={`value-${index}`} data-on="true" className="ask ml-auto">Save</button>
                          </div>
                        </Td>
                      </tr>
                    ) : null,
                  ];
                })}
              </DataTable>
              </>
            ) : (
              <p className="rounded-md border border-dashed border-line-strong px-5 py-10 text-center text-sm text-slate-500">
                {q ? `Nothing in ${set.title} matches “${q}”.` : show === "RETIRED" ? "Nothing retired in this list." : may ? "This list has no value yet: add the first one." : "This list has no value yet."}
              </p>
            )}
          </section>
        ) : (
          <p className="text-sm text-slate-500">No list yet{lists.mayChange ? ": create the first one." : "."}</p>
        )}
      </SetNav>
    </div>
  );
}

function PropInput({ field, value, lists, unset = false }: {
  field: PropField; value: unknown; lists: Record<string, { code: string; label: string }[]>;
  /** A plain question not answered yet: nothing is chosen for the person, who has to choose. */
  unset?: boolean;
}) {
  if (field.type === "sets") {
    const ticked = Array.isArray(value) ? value.map(String) : [];
    return (
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-xs font-semibold text-slate-700">{field.label}{field.hint ? <span className="ml-1 font-normal text-slate-500">{field.hint}</span> : null}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {(lists[field.setKey] ?? []).map((o) => (
            <label key={o.code} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name={`prop_${field.key}`} value={o.code} defaultChecked={ticked.includes(o.code)} />
              <span>{o.label} <span className="font-mono text-xs text-slate-500">{o.code}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (field.type === "set") {
    return (
      <Field label={field.label} hint={field.hint}>
        <select name={`prop_${field.key}`} defaultValue={typeof value === "string" ? value : ""} className="plain w-full">
          <option value="">—</option>
          {(lists[field.setKey] ?? []).map((o) => <option key={o.code} value={o.code}>{o.code} — {o.label}</option>)}
        </select>
      </Field>
    );
  }
  if (field.type === "choice") {
    return (
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-xs font-semibold text-slate-700">{field.label}{unset ? <span className="ml-1 text-red-500">*</span> : null}{unset ? <span className="ml-2 font-normal text-amber-700">not chosen yet: choose one</span> : null}</legend>
        <div className="space-y-1.5">
          {field.options.map((o, i) => (
            <label key={o.value} className="flex items-start gap-2 rounded-md border border-line px-3 py-2 text-sm text-slate-700 has-checked:border-brand-line has-checked:bg-tint-soft">
              <input type="radio" name={`prop_${field.key}`} value={o.value} required={unset} defaultChecked={unset ? false : value ? value === o.value : i === 0} className="mt-0.5" />
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
        <span>{field.label}{field.hint ? <span className="ml-1 text-xs text-slate-500">{field.hint}</span> : null}</span>
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <Field label={field.label} hint={field.hint}>
        <select name={`prop_${field.key}`} defaultValue={typeof value === "string" ? value : ""} className="plain w-full">
          <option value="">—</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
    );
  }
  return (
    <Field label={field.label} hint={field.hint}>
      <input name={`prop_${field.key}`} type={field.type === "int" ? "number" : "text"} defaultValue={value == null ? "" : String(value)} className="plain w-full" />
    </Field>
  );
}
