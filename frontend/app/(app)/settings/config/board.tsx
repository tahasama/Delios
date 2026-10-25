import { ExceptionNote } from "@/lib/settings/exception";
import { Select } from "@/components/select";
import Link from "next/link";
import { api, projectPath } from "@/lib/client";
import { requireScope } from "@/lib/core/scope";
import { Field, DataTable, Th, Td, ToneChip, btn } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { addValueAction, retireValueAction, createListAction, updateValueAction, deleteValueAction, moveValueAction, updateListAction, bulkValuesAction, createSetAction, updateSetAction, switchSetAction, deleteSetAction, switchListAction } from "@/lib/settings/forms-lists";
import { Switch, SwitchControl } from "@/components/switch";
import { getSet, getSets, organizationSet, organizationSets } from "@/lib/settings/config";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { parseProps, type PropField } from "@/lib/settings/config-props";
import { propFieldsFor, isVerdictSet } from "@/lib/settings/set-props";
import { SelectAll, ValuesDock } from "./select-all";
import { DeleteSetButton } from "./delete-set";
import { SetNav, type SetNavGroup } from "./set-nav";
import { Fragment } from "react";
import { cn } from "@/lib/core/utils";
import { Plus, Search, Pencil, Download, X, Trash2, Archive, ArchiveRestore, ArrowUp, ArrowDown } from "lucide-react";

/** An act shown as its icon alone, where the icon says it (its name on hover and for screen readers). */
const ICON = "inline-flex rounded-sm p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-3 focus-visible:ring-link/25 outline-none";

/** A field as on the new-document form: grey, no box, inside a sheet's `asking` body. */
const field = "plain w-full";

/** Lists grouped by what they are for (as the backend, `ListRules`). A verdict list is in Review & issue; one of your own where it was put. */
/** The groups a list of your own may go in: it is a document field. */
const TAKES_LISTS = ["Numbering & identity", "Classification & keeping"];
const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Numbering & identity", keys: ["SUBPROJECTS", "DISCIPLINES", "DOCUMENT_TYPES", "DELIVERABLE_TYPES", "SUPPLIER_CODES", "PURCHASE_ORDERS", "DELIVERABLE_TYPE_FIELDS", "PROJECT_KINDS", "CONTRACT_ROLES", "GENERIC_TITLE_WORDS"] },
  // The comment lists sit together, with the outcomes they feed: one classifies
  // a comment somebody wrote, the other is what an advisory step's comments
  // amount to. Both are the organization's to edit.
  { title: "Review & issue", keys: ["REVIEW_OUTCOMES", "REVIEW_ADVICE", "COMMENT_CLASSES", "STATUSES", "REASONS_FOR_ISSUE", "RETURN_REASONS", "ISSUE_CODES", "CONTROL_OUTCOMES"] },
  { title: "Classification & keeping", keys: ["CRITICALITY", "CONFIDENTIALITY", "RETENTION_CLASSES", "PHASES"] },
  { title: "File formats", keys: ["NATIVE_FORMATS", "RENDITION_FORMATS", "PRESERVATION_FORMATS"] },
  { title: "Schedule", keys: ["ACTIVITY_DECISIONS"] },
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

export type Params = { set?: string; vs?: string; q?: string; show?: string; edit?: string; panel?: string };

/** A set of a list as the backend reads it (`ListRules`): the deliverable types it serves, switched on or off, its values. */
type SetAnswer = { id: string | null; name: string; isDefault: boolean; active: boolean; deliverableTypes: string[]; inUse: number; others: number };

type ListsAnswer = {
  level: "project" | "organization"; mayChange: boolean; sets: { key: string; active: number; retired: number }[];
  /**
   * Each list as the backend reads it (`ListRules`): whether the app runs on it, among the rest; on a project, whether it
   * keeps its own copy, and whether the organization leaves it free (a copy on its first change) or keeps it fixed.
   */
  lists: { key: string; app: boolean; takesSets: boolean; active: boolean; own: boolean; free: boolean; exception?: { reason: string; by: string; at: string } | null; sets: SetAnswer[] }[];
};

/**
 * Types & sets, on two levels (owner: the same card in both Settings). The organization's (its Settings, administrators)
 * are the default every project reads. On a project, each list is the organization's until its first change there, which
 * copies that list only, where the organization leaves it free; a list it keeps fixed is read only there, and says who
 * changes it. A value never used may change entirely, or be deleted; once used, only its name changes, or it is retired.
 * On a project whoever acts as the control function changes them (on a project with none, whoever opened it).
 */
export async function ListsBoard({ level, sp }: { level: "project" | "organization"; sp: Params }) {
  const organization = level === "organization";
  const ctx = organization ? null : await requireScope();
  // Whose lists: the project's code, or the organization's name; where they are read and changed.
  const whose = ctx ? ctx.project.code : (await requireOrgAdmin()).organization.name;
  const at = (path: string) => (ctx ? projectPath(ctx, path) : `/api/admin${path}`);
  const page = organization ? "/organization/settings/types" : "/settings/config";
  const read = organization ? organizationSet : getSet;
  const [sets, lists] = await Promise.all([
    organization ? organizationSets() : getSets(),
    api<ListsAnswer>(at("/lists"), { keep: { areas: [] } }).catch(() => ({ level, mayChange: false, sets: [], lists: [] } as ListsAnswer)),
  ]);
  const countOf = (key: string) => lists.sets.find((c) => c.key === key)?.active ?? 0;
  const headingOf = (one: (typeof sets)[number]) =>
    GROUPS.find((g) => g.keys.includes(one.key))?.title
    ?? (one.kind === "VERDICTS" ? "Review & issue" : TAKES_LISTS.includes(one.group?.trim() ?? "") ? one.group!.trim() : "Classification & keeping");
  const headings = GROUPS.map((g) => g.title);
  // Each group in the order its lists are listed above (Numbering & identity first), the rest by name.
  const rank = (one: (typeof sets)[number]) => { const at = GROUPS.find((g) => g.title === headingOf(one))?.keys.indexOf(one.key) ?? -1; return at < 0 ? 999 : at; };
  const groups: SetNavGroup[] = [...new Set(headings)]
    .map((title) => ({ title, sets: sets.filter((one) => one.key !== "PROJECT_CODES" && headingOf(one) === title).sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title)).map((one) => {
      const read = (lists.lists ?? []).find((l) => l.key === one.key);
      return {
        key: one.key, title: one.title, count: countOf(one.key), takesSets: read?.takesSets ?? false,
        parts: (read?.sets ?? []).map((p) => ({ id: p.id, name: p.name, active: p.active, isDefault: p.isDefault, count: p.inUse })),
      };
    }) }))
    .filter((g) => g.sets.length);
  // Nothing is chosen on arrival: the page opens on Numbering & identity's lists, and a list is shown once chosen.
  const currentKey = sp.set && sets.some((one) => one.key === sp.set) ? sp.set : "";
  const q = (sp.q ?? "").trim();
  const show = sp.show === "RETIRED" || sp.show === "ALL" ? sp.show : "ACTIVE";
  const set = sets.find((one) => one.key === currentKey) ?? null;
  // The set shown: the one chosen, else the default one (a list with one set: that one).
  const listRead = (lists.lists ?? []).find((l) => l.key === currentKey) ?? null;
  const setsOfList = listRead?.sets ?? [];
  const chosen = setsOfList.find((p) => p.id && p.id === sp.vs) ?? setsOfList.find((p) => p.isDefault) ?? setsOfList[0] ?? null;
  const inChosen = (v: { setId: string | null }) => !chosen || setsOfList.length <= 1 || v.setId === chosen.id || (chosen.isDefault && !v.setId);
  // Verdict lists are kept in Verdict lists, project codes by the app: shown here, changed there.
  const readOnlyWhy = !set ? null
    // A verdict list of before still holding a code the review outcomes had: kept as it was, for its decided reviews.
    : set.key !== "REVIEW_OUTCOMES" && isVerdictSet(set.key, set.kind) ? "verdicts"
    : set.key === "PROJECT_CODES" ? "codes"
    : null;
  // On a project, a list the organization keeps fixed is read only here.
  const fixedHere = !organization && !!listRead && !listRead.own && !listRead.free;
  const may = lists.mayChange && !readOnlyWhy && !fixedHere;
  const [allValues, used, places] = await Promise.all([
    read(currentKey).then((all) => all.map((v) => ({ ...v, id: `${currentKey}::${v.code}`, setKey: currentKey, props: Object.keys(v.props).length ? JSON.stringify(v.props) : null }))),
    ctx ? usage(ctx, currentKey) : Promise.resolve({ counts: new Map<string, number>(), unit: "document" } as Awaited<ReturnType<typeof usage>>),
    api<Record<string, string[]>>(at(`/lists/${encodeURIComponent(currentKey)}/usage`)).catch(() => ({} as Record<string, string[]>)),
  ]);
  const propFields = propFieldsFor(currentKey, set?.kind);
  // The other lists a property picks from, such as a document type's recommended criticality.
  const pick: Record<string, { code: string; label: string }[]> = Object.fromEntries(await Promise.all(
    [...new Set((propFields ?? []).flatMap((f) => (f.type === "set" || f.type === "sets" ? [f.setKey] : [])))].map(async (key) =>
      [key, (await read(key)).filter((v) => v.status === "ACTIVE").map((v) => ({ code: v.code, label: v.label }))] as const)));
  const deliverables = await read("DELIVERABLE_TYPES");
  const typeName = (code: string) => deliverables.find((d) => d.code === code)?.label ?? code;
  const values = allValues.filter((v) => inChosen(v) &&
    // A value of a set switched off is still the set's: shown with it, marked so.
    (show === "ALL" || v.status === show || (show === "ACTIVE" && v.status === "OFF")) &&
    (!q || v.code.toLowerCase().includes(q.toLowerCase()) || v.label.toLowerCase().includes(q.toLowerCase())),
  );
  const retiredCount = allValues.filter((v) => inChosen(v) && v.status === "RETIRED").length;
  const inUseCount = allValues.filter((v) => inChosen(v) && v.status !== "RETIRED").length;
  const listUsed = Object.keys(places).length > 0;
  const runsOn = !!set && (lists.lists ?? []).some((one) => one.key === set.key && one.app);
  const setUsed = !!chosen && allValues.some((v) => inChosen(v) && (places[v.code] ?? []).length > 0);
  const here = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ set: currentKey, ...(chosen?.id && sp.vs ? { vs: chosen.id } : {}), ...(q ? { q } : {}), ...(show !== "ACTIVE" ? { show } : {}) });
    for (const [k, v] of Object.entries(extra)) v === undefined ? p.delete(k) : p.set(k, v);
    return `${page}?${p}`;
  };
  const editing = sp.edit ? allValues.find((v) => v.id === sp.edit) ?? null : null;
  const categories = TAKES_LISTS;

  return (
    <div className="space-y-4">
      {/* The plate: whose lists these are, and who changes them. */}
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col gap-3 px-5 pt-6 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="plate-title text-slate-950">Types & sets</h1>
            <p className="plate-meta mt-2">
              {organization ? `${whose} · the default of every project` : `${whose} · each list the organization's until changed here`}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              Every code and choice a document is described with, one list each. A value never used{organization ? "" : ` on ${whose}`} may change
              entirely, or be deleted; once used, only its name changes, or it is retired.{" "}
              {organization ? "Each list's switch says whether projects may change it."
                : lists.mayChange ? "A list the organization leaves free changes here; one it keeps fixed is read only."
                : `Read only: whoever acts as the control function on ${whose} changes them.`}
            </p>
          </div>
          {lists.mayChange ? (
            <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
              <Link scroll={false} href={here({ panel: sp.panel === "new" ? undefined : "new", edit: undefined })} className={btn("primary")}><Plus className="h-4 w-4" /> New list</Link>
              <Link href={organization ? "/import?level=organization" : "/import"} className="text-xs font-medium text-slate-500 transition hover:text-link">Got a list in a spreadsheet? Import it →</Link>
            </div>
          ) : null}
        </div>
      </section>

      {sp.panel === "new" && lists.mayChange ? (
        <section className="register register-sheet register-sheet-open">
          <div className="border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6"><span className="stencil text-slate-500">New list</span><span className="ml-2 text-[11px] text-slate-500">a list {whose} needs that the others do not cover: areas, systems, anything</span></div>
          <ActionForm id="new-list" action={createListAction} hideSubmit hidden={{ level }} className="asking px-5 py-5 sm:px-6">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Name" required><input name="title" required className={field} placeholder="Areas" /></Field>
              <Field label="Short name" required hint="capitals, no spaces (use _); fixed once a value is used"><input name="key" required pattern="[A-Z][A-Z0-9_]*" title="Capital letters, digits and _ only, e.g. AREAS" className={field} placeholder="AREAS" /></Field>
              <Field label="Group">
                <Select name="group" className={field} defaultValue={categories[0]}>{categories.map((title) => <option key={title} value={title}>{title}</option>)}</Select>
              </Field>
              <Field label="What it is for"><input name="description" className={field} /></Field>
            </div>
          </ActionForm>
          <div className="flex items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
            <Link scroll={false} href={here({ panel: undefined })} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
            <button type="submit" form="new-list" data-on="true" className="ask">Create the list</button>
          </div>
        </section>
      ) : null}

      <SetNav page={page} groups={groups} current={currentKey} currentSet={chosen?.id ?? null} mayAddSets={may}>
        {set ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* The list: its name, what it is for, where it stands; what may be done to it, on the right. */}
            <div className="flex shrink-0 flex-col gap-2 border-b border-line px-5 py-2.5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 flex-1">
                <h2 className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="text-base font-semibold text-slate-900">{set.title}</span>
                  <span className="plate-meta">
                    {organization ? (listUsed ? "Used on a project reading it" : "Never used on a project reading it") : listUsed ? "Used on this project" : "Never used on this project"}
                    {runsOn ? " · the app runs on it" : ""}
                  </span>
                </h2>
                {set.description ? <p className="mt-0.5 max-w-2xl truncate text-xs leading-5 text-slate-500" title={set.description}>{set.description}</p> : null}
                {readOnlyWhy === "verdicts" ? (
                  <p className="mt-1 text-xs text-slate-600">Kept as it was, for the reviews decided from it: its codes were already in{" "}
                    <Link href={`${page}?set=REVIEW_OUTCOMES`} className="font-semibold text-link hover:underline">Review outcomes</Link>, where verdicts are kept now.</p>
                ) : readOnlyWhy === "codes" ? (
                  <p className="mt-1 text-xs text-slate-600">Filled by the app: each project&rsquo;s code is in it.</p>
                ) : null}
                {/* On a project, where this list stands: its own copy, the organization's it may change, or the organization's alone. */}
                {!organization && listRead && !readOnlyWhy ? (
                  <p className="mt-1 text-xs text-slate-600">
                    {listRead.own ? <>{whose} changed this list: it uses its own version. Changes made by the organization don&rsquo;t reach it.{listRead.exception ? <> <ExceptionNote project={whose} what="this list" exception={listRead.exception} /></> : null}</>
                      : listRead.free && listRead.exception ? <>This is the organization&rsquo;s list. <ExceptionNote project={whose} what="this list" exception={listRead.exception} /> A change here gives {whose} its own version.</>
                      : listRead.free ? <>This is the organization&rsquo;s list. You may change it here: {whose} then keeps its own version.</>
                      : <>This is the organization&rsquo;s list, the same on every project. Only an administrator changes it, in the organization&rsquo;s Settings.</>}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {may && listRead && !listRead.app ? (
                  <ActionForm action={switchListAction} hidden={{ level, key: set.key, title: set.title, active: listRead.active ? "0" : "1" }} hideSubmit className="mr-3 space-y-0">
                    <Switch on={listRead.active} label={listRead.active ? `Switch ${set.title} off: its values are no longer offered` : `Switch ${set.title} on again`} />
                  </ActionForm>
                ) : null}
                {may && !chosen ? <Link scroll={false} href={here({ panel: sp.panel === "add" ? undefined : "add", edit: undefined })} aria-current={sp.panel === "add" ? "true" : undefined} title="Add a value" aria-label="Add a value" className={`${ICON} aria-[current]:bg-tint aria-[current]:text-brand-ink`}><Plus className="h-4 w-4" /></Link> : null}
                {may ? <Link scroll={false} href={here({ panel: sp.panel === "details" ? undefined : "details", edit: undefined })} title="Change this list" aria-label="Change this list" className={ICON}><Pencil className="h-4 w-4" /></Link> : null}
                <a href={`/api/export/config-set?set=${encodeURIComponent(set.key)}`} title="Download this list" aria-label="Download this list" className={ICON}><Download className="h-4 w-4" /></a>
                {may && !runsOn && !listUsed ? <DeleteSetButton level={level} setKey={set.key} title={set.title} count={allValues.length} /> : null}
              </div>
            </div>

            {/* The set shown: whom it serves, switched on or off; what may be done to it. */}
            {chosen ? (
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-tint-soft px-5 py-1.5 sm:px-6">
                <span className="stencil text-slate-500">Set</span>
                <span className="text-sm font-semibold text-slate-800">{chosen.name}</span>
                {!may || !chosen.id ? (chosen.active ? <ToneChip tone="done">on</ToneChip> : <ToneChip tone="idle">off</ToneChip>) : null}
                <span className="min-w-0 text-[11px] text-slate-600">
                  {!listRead?.takesSets ? "one set: the same for every deliverable type"
                    : chosen.deliverableTypes.length ? `serves ${chosen.deliverableTypes.map(typeName).join(", ")}`
                    : chosen.isDefault ? (setsOfList.length > 1 ? "serves every deliverable type no other set names" : "serves every deliverable type")
                    : "serves no deliverable type yet: say which"}
                </span>
                {may ? (
                  <span className="ml-auto flex items-center gap-1">
                    {may ? <Link scroll={false} href={here({ panel: sp.panel === "add" ? undefined : "add", edit: undefined })} aria-current={sp.panel === "add" ? "true" : undefined} title={`Add a value to ${chosen.name}`} aria-label={`Add a value to ${chosen.name}`} className={`${ICON} aria-[current]:bg-tint aria-[current]:text-brand-ink`}><Plus className="h-4 w-4" /></Link> : null}
                    {chosen.id ? (
                      <>
                        {listRead?.takesSets ? <ActionForm action={switchSetAction} hidden={{ level, key: currentKey, setId: chosen.id, active: chosen.active ? "0" : "1" }} hideSubmit className="mr-2 space-y-0">
                          <Switch on={chosen.active} label={chosen.active ? `Switch the set ${chosen.name} off: its values are no longer offered` : `Switch the set ${chosen.name} on`} />
                        </ActionForm> : null}
                        <Link scroll={false} href={here({ panel: sp.panel === "editset" ? undefined : "editset", edit: undefined, vs: chosen.id })} title="Change this set" aria-label="Change this set" className={ICON}><Pencil className="h-4 w-4" /></Link>
                        {!setUsed && listRead?.takesSets ? (
                          <ActionForm action={deleteSetAction} hidden={{ level, key: currentKey, setId: chosen.id }} hideSubmit className="space-y-0"
                            confirmText={`Delete the set ${chosen.name} and its values? None of them was ever used on ${whose}; the log keeps it.`}>
                            <button type="submit" title="Delete this set" aria-label="Delete this set" className="inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                          </ActionForm>
                        ) : null}
                      </>
                    ) : <span className="text-[11px] text-slate-500">Add a value or a set and it becomes a set of its own.</span>}
                  </span>
                ) : null}
              </div>
            ) : null}

            {((sp.panel === "newset" && listRead?.takesSets) || (sp.panel === "editset" && chosen?.id)) && may ? (
              <div className="shrink-0 border-b border-line">
                <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
                  <span className="stencil mr-1 text-slate-500">{sp.panel === "newset" ? "A new set" : `The set ${chosen!.name}`}</span>
                  <span className="text-[11px] text-slate-500">its values are offered for the deliverable types it serves; two sets switched on never serve the same one</span>
                </div>
                <ActionForm id="set-form" action={sp.panel === "newset" ? createSetAction : updateSetAction} hideSubmit
                  hidden={{ level, key: currentKey, ...(sp.panel === "editset" ? { setId: chosen!.id!, ...(listRead?.takesSets ? { typesAsked: "1" } : {}) } : {}) }}
                  className="asking space-y-4 px-5 py-5 sm:px-6">
                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <Field label="Name" required><input name="name" required defaultValue={sp.panel === "editset" ? chosen!.name : ""} placeholder="Supplier documents" className={field} /></Field>
                  </div>
                  {listRead?.takesSets ? (
                    <fieldset>
                      <legend className="stencil mb-1.5 text-slate-500">
                        Deliverable types it serves
                        {sp.panel === "editset" && chosen!.isDefault ? <span className="ml-2 font-sans text-[11px] font-normal normal-case tracking-normal text-slate-500">none ticked: every deliverable type no other set names</span> : null}
                      </legend>
                      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                        {deliverables.filter((d) => d.status === "ACTIVE").map((d) => (
                          <label key={d.code} className="flex items-center gap-2 text-sm text-slate-700">
                            <input type="checkbox" name="deliverableTypes" value={d.code} defaultChecked={sp.panel === "editset" && chosen!.deliverableTypes.includes(d.code)} />
                            <span>{d.label} <span className="font-mono text-xs text-slate-500">{d.code}</span></span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : null}
                </ActionForm>
                <div className="flex items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
                  <Link scroll={false} href={here({ panel: undefined })} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                  <button type="submit" form="set-form" data-on="true" className="ask">{sp.panel === "newset" ? "Make the set" : "Save"}</button>
                </div>
              </div>
            ) : null}

            {/* A form opened from the list takes its place under the head: grey fields, then the strip. */}
            {sp.panel === "add" && may ? (
              <div className="shrink-0 border-b border-line">
                <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6"><span className="stencil mr-1 text-slate-500">A new value</span><span className="text-[11px] text-slate-500">in {set.title.toLowerCase()}{chosen && setsOfList.length > 1 ? `, set ${chosen.name}` : ""}</span></div>
                <ActionForm id="add-value" action={addValueAction} hideSubmit hidden={{ level, setKey: currentKey, setId: chosen?.id ?? "" }} resetOnSuccess className="asking px-5 py-5 sm:px-6">
                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <Field label="Code" required hint="what appears in numbers and lists"><input name="code" required maxLength={24} className={field} /></Field>
                    <Field label="Name" required><input name="label" required className={field} /></Field>
                    {propFields?.map((f) => <PropInput key={f.key} field={f} value={undefined} lists={pick} unset={f.type === "choice"} />)}
                  </div>
                </ActionForm>
                <div className="flex items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
                  <Link scroll={false} href={here({ panel: undefined })} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                  <button type="submit" form="add-value" data-on="true" className="ask">Add it</button>
                </div>
              </div>
            ) : null}
            {sp.panel === "details" && may ? (
              <div className="shrink-0 border-b border-line">
                <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6"><span className="stencil mr-1 text-slate-500">This list</span><span className="text-[11px] text-slate-500">{listUsed || runsOn ? "its short name stays: a value of it is used" : "never used: its short name may still change"}</span></div>
                <ActionForm id="list-details" action={updateListAction} hideSubmit hidden={{ level, key: set.key }} className="asking px-5 py-5 sm:px-6">
                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <Field label="Name" required><input name="title" required defaultValue={set.title} className={field} /></Field>
                    <Field label="Short name" hint={listUsed || runsOn ? "fixed" : "capitals, digits and _"}>
                      {listUsed || runsOn
                        ? <input defaultValue={set.key} disabled className={field} aria-label="Short name (fixed)" />
                        : <input name="newKey" defaultValue={set.key} pattern="[A-Z][A-Z0-9_]*" className={field} />}
                    </Field>
                    <Field label="Group">
                      <Select name="group" defaultValue={headingOf(set)} className={field}>{categories.map((title) => <option key={title} value={title}>{title}</option>)}</Select>
                    </Field>
                    <Field label="What it is for"><input name="description" defaultValue={set.description ?? ""} className={field} /></Field>
                  </div>
                </ActionForm>
                <div className="flex items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
                  <Link scroll={false} href={here({ panel: undefined })} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                  <button type="submit" form="list-details" data-on="true" className="ask">Save</button>
                </div>
              </div>
            ) : null}

            {/* Narrowing: words, then which values, each choice acting at once. */}
            <form className="asking flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-2 sm:px-6" action={page}>
              <input type="hidden" name="set" value={currentKey} />
              {show !== "ACTIVE" ? <input type="hidden" name="show" value={show} /> : null}
              <label className="search-field relative min-w-60 flex-1">
                <span className="sr-only">Search this list</span>
                <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input name="q" defaultValue={q} placeholder={`Search ${set.title.toLowerCase()} by code or name…`} className="plain w-full pl-6!" />
              </label>
              {/* Which values: one control of three, the app's segmented choice. */}
              <nav aria-label="Which values" className="seg w-fit">
                {([["ACTIVE", "In use", inUseCount], ["RETIRED", "Retired", retiredCount], ["ALL", "All", inUseCount + retiredCount]] as const).map(([value, label, n]) => (
                  <Link scroll={false} key={value} href={here({ show: value === "ACTIVE" ? undefined : value, edit: undefined })} aria-current={show === value ? "page" : undefined} className="segment">
                    {label}{value === "RETIRED" && n ? <span className="segment-n">{n}</span> : null}
                  </Link>
                ))}
              </nav>
              {q ? <Link scroll={false} href={here({ q: undefined, edit: undefined })} className="text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">Clear</Link> : null}
            </form>

            {values.length ? (
              <>
              {/* The ticks belong to this form by id: a form cannot sit around a table's cells. The dock submits it. */}
              {may ? <form id="bulk-values" action={bulkValuesAction} className="hidden"><input type="hidden" name="level" value={level} /></form> : null}
              <DataTable
                id={`set-values-${propFields ? currentKey : "plain"}`}
                className="min-h-40 rounded-none border-0 shadow-none"
                toolbar={false}
                fill
                stretch
                head={<tr>{may ? <Th className="w-8"><SelectAll formId="bulk-values" count={values.length} /></Th> : null}<Th>Code</Th><Th>Name</Th>{propFields ? <Th>What it does</Th> : null}<Th>Used</Th><Th>Status</Th>{may ? <Th /> : null}</tr>}
              >
                {values.map((v) => {
                  const props = parseProps(v.props);
                  const n = used.counts.get(v.code) ?? 0;
                  const where = places[v.code] ?? [];
                  const isUsed = where.length > 0;
                  const open = may && editing?.id === v.id;
                  const index = allValues.findIndex((x) => x.id === v.id);
                  const cols = (propFields ? 6 : 5) + (may ? 2 : 0);
                  return (
                    <Fragment key={v.id}>
                      <tr id={`value-${index}-line`} className={cn("scroll-mt-20 align-top", v.status === "RETIRED" && !open && "opacity-60", open && "[&>td]:border-b-0")}>
                        {may ? <Td className="w-8"><input type="checkbox" form="bulk-values" name="valueIds" value={v.id} data-status={v.status} data-used={isUsed ? "1" : "0"} aria-label={`Tick ${v.code}`} /></Td> : null}
                        <Td className="whitespace-nowrap font-mono text-xs font-bold text-slate-900">{v.code}</Td>
                        <Td className="min-w-50 text-sm">{v.label}</Td>
                        {propFields ? <Td className={propFields.some((f) => unanswered(f, props)) ? "text-xs text-amber-700" : "text-xs text-slate-600"}>{doesText(propFields, props) || <span className="text-slate-300">—</span>}</Td> : null}
                        <Td className="text-xs">
                          {isUsed ? (
                            n && used.filter
                              ? <Link href={`/documents?${used.filter}=${encodeURIComponent(v.code)}&view=all`} className="text-link hover:underline" title={where.join(" · ")}>{where.join(" · ")}</Link>
                              : <span className="text-slate-600">{where.join(" · ")}</span>
                          ) : <span className="text-slate-400">never used</span>}
                        </Td>
                        <Td className="whitespace-nowrap">{v.status === "ACTIVE" ? <ToneChip tone="done">in use</ToneChip> : v.status === "OFF" ? <ToneChip tone="idle">its set is off</ToneChip> : <ToneChip tone="idle">retired</ToneChip>}</Td>
                        {may ? (
                          <Td className="w-px whitespace-nowrap text-right">
                            <Link scroll={false} href={`${here({ edit: open ? undefined : v.id, panel: undefined })}#value-${index}-line`} className="inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title={open ? "Close" : `Change ${v.code}`}>
                              {open ? <X aria-label={`Close ${v.code}`} className="h-4 w-4" /> : <Pencil aria-label={`Change ${v.code}`} className="h-4 w-4" />}
                            </Link>
                          </Td>
                        ) : null}
                      </tr>
                      {open ? (
                        // The value's line opened under it: the row itself goes on (grey fields, then the strip), never a box inside the table.
                        <tr>
                          <td colSpan={cols} className="border-b border-line p-0">
                            <ActionForm id={`value-${index}`} action={updateValueAction} hideSubmit hidden={{ level, valueId: v.id, used: isUsed ? "1" : "0" }} className="asking px-5 py-5 sm:px-6">
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
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line bg-tint-soft px-5 py-3 text-xs sm:px-6">
                              <Link scroll={false} href={here({ edit: undefined })} className="font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                              <span className="flex items-center gap-0.5">
                                <form action={retireValueAction}><input type="hidden" name="level" value={level} />
                                  <input type="hidden" name="valueId" value={v.id} />
                                  {v.status !== "RETIRED"
                                    ? <button title="Retire: no longer offered, kept on what carries it" aria-label={`Retire ${v.code}`} className={ICON}><Archive className="h-4 w-4" /></button>
                                    : <button title="Bring it back" aria-label={`Bring ${v.code} back`} className={ICON}><ArchiveRestore className="h-4 w-4" /></button>}
                                </form>
                                {!isUsed ? (
                                  <ActionForm action={deleteValueAction} hidden={{ level, valueId: v.id }} hideSubmit className="space-y-0"
                                    confirmText={`Delete ${v.code}? It was never used on ${whose}; the log keeps it.`}>
                                    <button type="submit" title="Delete: never used" aria-label={`Delete ${v.code}`} className={`${ICON} hover:bg-red-50! hover:text-red-600!`}><Trash2 className="h-4 w-4" /></button>
                                  </ActionForm>
                                ) : null}
                                <span aria-hidden className="mx-1.5 h-4 w-px bg-line" />
                                <form action={moveValueAction}><input type="hidden" name="level" value={level} /><input type="hidden" name="valueId" value={v.id} /><input type="hidden" name="direction" value="up" /><button disabled={index === 0} title="Up the list" aria-label={`Move ${v.code} up`} className={`${ICON} disabled:opacity-25`}><ArrowUp className="h-4 w-4" /></button></form>
                                <form action={moveValueAction}><input type="hidden" name="level" value={level} /><input type="hidden" name="valueId" value={v.id} /><input type="hidden" name="direction" value="down" /><button disabled={index === allValues.length - 1} title="Down the list" aria-label={`Move ${v.code} down`} className={`${ICON} disabled:opacity-25`}><ArrowDown className="h-4 w-4" /></button></form>
                              </span>
                              <button type="submit" form={`value-${index}`} data-on="true" className="ask ml-auto">Save</button>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </DataTable>
              {may ? <div className="shrink-0"><ValuesDock formId="bulk-values" otherSets={setsOfList.filter((p) => p.id && p.id !== chosen?.id).map((p) => ({ id: p.id!, name: p.name }))} /></div> : null}
              </>
            ) : (
              <p className="px-5 py-10 text-center text-sm text-slate-500 sm:px-6">
                {q ? `Nothing in ${set.title} matches “${q}”.` : show === "RETIRED" ? `Nothing retired in this ${setsOfList.length > 1 ? "set" : "list"}.` : `This ${setsOfList.length > 1 ? "set" : "list"} has no value yet${may ? ": add the first one." : "."}`}
              </p>
            )}
          </section>
        ) : (
          // Nothing chosen yet: what the page holds, and where to start.
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <p className="text-sm font-semibold text-slate-800">Choose a list on the left</p>
            <p className="max-w-md text-xs leading-5 text-slate-500">
              Each list holds one or more sets, and each set serves the deliverable types it names: open a list with its + to see its sets.
              {lists.mayChange ? " A list of your own goes in Numbering & identity or Classification & keeping, with New list above." : ""}
            </p>
          </div>
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
        <Select name={`prop_${field.key}`} defaultValue={typeof value === "string" ? value : ""} className="plain w-full">
          <option value="">—</option>
          {(lists[field.setKey] ?? []).map((o) => <option key={o.code} value={o.code}>{o.code} — {o.label}</option>)}
        </Select>
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
        <SwitchControl name={`prop_${field.key}`} defaultChecked={value === true} />
        <span>{field.label}{field.hint ? <span className="ml-1 text-xs text-slate-500">{field.hint}</span> : null}</span>
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <Field label={field.label} hint={field.hint}>
        <Select name={`prop_${field.key}`} defaultValue={typeof value === "string" ? value : ""} className="plain w-full">
          <option value="">—</option>
          {field.options.map((o) => <option key={o} value={o}>{field.labels?.[o] ?? o}</option>)}
        </Select>
      </Field>
    );
  }
  return (
    <Field label={field.label} hint={field.hint}>
      <input name={`prop_${field.key}`} type={field.type === "int" ? "number" : "text"} defaultValue={value == null ? "" : String(value)} className="plain w-full" />
    </Field>
  );
}
