"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { isAdmin, isReadOnly } from "@/lib/core/auth";
import { parseCsv, toObjects } from "@/lib/core/csv";
import { api, apiFetch, problemOf, projectPath, refusal } from "@/lib/client";
import { sheetRefusal } from "@/lib/documents/sheet-check";
import { getSet, getSets, organizationSet, organizationSets } from "@/lib/settings/config";
import { propFieldsFor } from "@/lib/settings/set-props";
import { adminFunctions, adminParties, adminUsers } from "@/lib/settings/api-admin";
import { matrixRows, planChanges, readRows } from "@/lib/settings/matrix-read";
import type { ListSourceKind } from "@/lib/actions/list-sources";
import { releasedFile } from "@/lib/actions/list-files";

/**
 * The team list, the distribution matrix and the Settings lists, brought in on two pages (owner: "not just
 * deliverables, all of imports"): the file is read into lines, every line says what it would do (new, an update with
 * each change "was → now", no change, or a problem with why), a line is corrected in place or taken off the list, and
 * one act writes the whole of it, or nothing (the backend writes every line in one transaction:
 * `/admin/projects/{id}/members/many`, `/admin/functions/rules/many`, `/lists/values/many`). The check goes through the
 * very same endpoints, undone (`dry`), so a line passes exactly when writing it would.
 */

/** "org-sets": the organization's own lists, the default of every project (its Types & sets card, an administrator's). */
export type LinesKind = "people" | "matrix" | "sets" | "org-sets";
export type LineField = {
  key: string; label: string; kind: "text" | "choice"; values?: { code: string; label: string }[]; required?: boolean;
  /** What identifies the line: shown, never changed. */
  locked?: boolean;
  /** Asked only on lines of this list (the Settings lists: each list's own properties). */
  forSet?: string;
  note?: string;
};
export type Line = { at: string; values: Record<string, string> };
export type LineCheck = {
  at: string; outcome: "NEW" | "UPDATE" | "SAME" | "PROBLEM"; title: string;
  changes: { field: string; was: string | null; now: string | null }[]; problems: string[];
  /** Written: a link for the person to choose their password, to pass on (email being off). */
  pass?: string | null;
};
export type LinesAnswer = {
  error?: string; kind?: LinesKind; lines?: Line[]; fields?: LineField[]; checks?: LineCheck[];
  /** Written whole (or, refused, nothing). */
  written?: boolean; summary?: string;
  /** Read from the list's register document: which revision, to be recorded once written. */
  from?: { kind: ListSourceKind; revisionId: string; label: string } | null;
};

type Ctx = Awaited<ReturnType<typeof requireScope>>;
type Batch = { lines: { at: string; ok: boolean; problem: string | null; value: Record<string, unknown> | null }[]; written: boolean };

const FORMATS: Record<LinesKind, RegExp> = { people: /\.csv$/i, matrix: /\.csv$/i, sets: /\.xlsx$/i, "org-sets": /\.xlsx$/i };
const FORMAT_WORDS: Record<LinesKind, string> = { people: "a CSV, as the template", matrix: "the matrix as downloaded (.csv)", sets: "the workbook (.xlsx) as downloaded", "org-sets": "the workbook (.xlsx) as downloaded" };
const SOURCE_OF: Record<LinesKind, ListSourceKind | null> = { people: "TEAM", matrix: "MATRIX", sets: "LISTS", "org-sets": null };
const orgLevel = (kind: LinesKind) => kind === "org-sets";
/** The lists and their values at the level imported: the project's, or the organization's. */
const setsAt = (kind: LinesKind) => (orgLevel(kind) ? organizationSets() : getSets());
const valuesAt = (kind: LinesKind, set: string) => (orgLevel(kind) ? organizationSet(set) : getSet(set));
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const clean = (v: string | undefined | null) => (v ?? "").trim();

/** Who brings each in: as by hand. */
function refusedFor(ctx: Ctx, kind: LinesKind): string | null {
  if (isReadOnly(ctx.user)) return "You can read this project, not change it, so you cannot import.";
  if (kind === "people" && !ctx.can("CONFIGURE") && !ctx.can("CONTROL")) return "Adding people is the control function's, or an administrator's. Ask one of them.";
  if (kind === "matrix" && !isAdmin(ctx.user)) return "Only an administrator changes the distribution matrix. Ask one of them.";
  if (kind === "org-sets" && !isAdmin(ctx.user)) return "An administrator changes the organization's lists.";
  return null;
}

/** A batch through the backend: its lines, or the lines it refused (409, nothing written). */
async function batch(path: string, body: Record<string, unknown>): Promise<Batch> {
  const response = await apiFetch(path, { method: "POST", body });
  if (response.ok || response.status === 409) {
    return (await response.json()) as Batch;
  }
  throw await problemOf(response);
}

// ---------------------------------------------------------------- reading the file into lines

async function linesOf(kind: LinesKind, file: File): Promise<{ lines: Line[] } | { error: string }> {
  if (kind === "people") {
    const { objects } = toObjects(parseCsv(await file.text()));
    const lines = objects.map((o, i) => ({
      at: `Row ${i + 2}`,
      values: { name: clean(o.Name), email: clean(o.Email).toLowerCase(), company: clean(o.Company), function: clean(o.Function), department: clean(o.Department) },
    })).filter((l) => Object.values(l.values).some(Boolean));
    return lines.length ? { lines } : { error: "The file has no rows under its headings." };
  }
  if (kind === "matrix") {
    const rows = matrixRows(await file.text());
    if (!rows.length) return { error: "The file has no rows." };
    const header = rows[0].row.map((c) => c.trim());
    if ((header[0] ?? "").toLowerCase() !== "deliverable type") return { error: "The header row is missing. Download the matrix again and keep its header row." };
    const codes = header.slice(5);
    const lines = rows.slice(1).map(({ row, line }) => ({
      at: `Row ${line}`,
      values: {
        deliverableType: clean(row[0]), docType: clean(row[1]), discipline: clean(row[2]), family: clean(row[3]), label: clean(row[4]),
        ...Object.fromEntries(codes.map((code, i) => [`fn:${code}`, clean(row[i + 5])]).filter(([code]) => code !== "fn:")),
      },
    })).filter((l) => Object.values(l.values).some(Boolean));
    return lines.length ? { lines } : { error: "The file has no rows under its header." };
  }
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await file.arrayBuffer());
  const sets = new Set((await setsAt(kind)).map((one) => one.key));
  const lines: Line[] = [];
  for (const sheet of book.worksheets) {
    const set = sheet.name.trim();
    if (!sets.has(set)) continue;
    const fields = propFieldsFor(set) ?? [];
    sheet.eachRow({ includeEmpty: false }, (row, index) => {
      if (index <= 2) return;
      const text = (column: number) => {
        const raw = row.getCell(column).value;
        return raw == null ? "" : String(typeof raw === "object" && "text" in raw ? (raw as { text: unknown }).text : raw).trim();
      };
      const values: Record<string, string> = { set, code: text(1), label: text(2), status: text(3).toUpperCase() === "RETIRED" ? "RETIRED" : "ACTIVE" };
      fields.forEach((field, offset) => { const given = text(offset + 4); if (given) values[`p:${field.key}`] = given; });
      if (values.code || values.label) lines.push({ at: `Sheet ${set}, row ${index}`, values });
    });
  }
  return lines.length ? { lines } : { error: "The workbook has no values on a sheet named as a list. Download it again and fill that one." };
}

/** What each line is asked, for correcting it in place: the form's fields, each list offering what applies. */
async function fieldsOf(kind: LinesKind): Promise<LineField[]> {
  if (kind === "people") {
    const [functions, parties] = await Promise.all([adminFunctions().then((all) => all.filter((f) => f.active)), adminParties()]);
    return [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "email", label: "Email", kind: "text", required: true },
      { key: "company", label: "Company", kind: "choice", values: parties.map((p) => ({ code: p.code, label: p.name })), note: "none: ours" },
      { key: "function", label: "Function", kind: "choice", values: functions.map((f) => ({ code: f.name, label: f.name })), required: true },
      { key: "department", label: "Department", kind: "text" },
    ];
  }
  if (kind === "matrix") {
    const functions = (await adminFunctions()).filter((f) => f.active);
    const letters = ["A", "R", "C", "T", "I", "·", "-"].map((code) => ({ code, label: code }));
    return [
      { key: "deliverableType", label: "Deliverable type", kind: "text", locked: true },
      { key: "docType", label: "Document type", kind: "text", locked: true },
      { key: "discipline", label: "Discipline", kind: "text", locked: true },
      { key: "family", label: "Family", kind: "text", locked: true },
      ...functions.map((f) => ({ key: `fn:${f.code}`, label: f.code, kind: "choice" as const, values: letters, note: f.name })),
    ];
  }
  const sets = await setsAt(kind);
  const fields: LineField[] = [
    { key: "set", label: "List", kind: "text", locked: true },
    { key: "code", label: "Code", kind: "text", required: true },
    { key: "label", label: "Label", kind: "text", required: true },
    { key: "status", label: "Status", kind: "choice", values: [{ code: "ACTIVE", label: "In use" }, { code: "RETIRED", label: "Retired" }] },
  ];
  for (const set of sets) {
    for (const field of propFieldsFor(set.key) ?? []) {
      const values = field.type === "select" ? field.options.map((o) => ({ code: o, label: field.labels?.[o] ?? o }))
        : field.type === "choice" ? field.options.map((o) => ({ code: o.value, label: o.label }))
        : field.type === "bool" ? [{ code: "yes", label: "Yes" }, { code: "no", label: "No" }] : undefined;
      fields.push({ key: `p:${field.key}`, label: field.label, kind: values ? "choice" : "text", values, forSet: set.key, note: field.hint });
    }
  }
  return fields;
}

// ---------------------------------------------------------------- checking and writing

/** The team: each line against who has an account and is on the project, then through the backend's own adding. */
async function people(ctx: Ctx, lines: Line[], write: boolean): Promise<{ checks: LineCheck[]; written: boolean }> {
  const [functions, parties, users] = await Promise.all([adminFunctions().then((all) => all.filter((f) => f.active)), adminParties(), adminUsers()]);
  const seen = new Map<string, number>();
  for (const l of lines) seen.set(l.values.email ?? "", (seen.get(l.values.email ?? "") ?? 0) + 1);
  const sent: { at: string; name: string; email: string; partyId: string | null; functionId: string | null; department: string | null }[] = [];
  const checks = lines.map((l): LineCheck => {
    const v = l.values;
    const title = `${v.name || "No name"}${v.email ? ` · ${v.email}` : ""}`;
    const problems: string[] = [];
    if (!v.name) problems.push("No name.");
    if (!v.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) problems.push("The email is not a valid address.");
    if ((seen.get(v.email ?? "") ?? 0) > 1) problems.push("The same email is on the list twice.");
    const fn = functions.find((f) => f.name.toLowerCase() === (v.function ?? "").toLowerCase() || f.code.toLowerCase() === (v.function ?? "").toLowerCase());
    if (!fn) problems.push(v.function ? `No function called "${v.function}" (Settings → Functions & permissions).` : "No function.");
    const party = v.company ? parties.find((p) => p.code.toLowerCase() === v.company!.toLowerCase() || p.name.toLowerCase() === v.company!.toLowerCase()) : null;
    if (v.company && !party) problems.push(`No organization called "${v.company}" (Settings → Organizations).`);
    if (problems.length) return { at: l.at, outcome: "PROBLEM", title, changes: [], problems };
    const known = users.find((u) => u.email.toLowerCase() === v.email);
    const here = known?.memberships.find((m) => m.projectId === ctx.projectId && m.active);
    const department = v.department || null;
    if (here && here.functionId === fn!.id && (here.department ?? null) === department) return { at: l.at, outcome: "SAME", title, changes: [], problems: [] };
    sent.push({ at: l.at, name: v.name!, email: v.email!, partyId: party?.id ?? null, functionId: fn!.id, department });
    if (!known) return { at: l.at, outcome: "NEW", title, changes: [], problems: [] };
    const changes = here
      ? [
          ...(here.functionId !== fn!.id ? [{ field: "Function", was: here.functionName, now: fn!.name }] : []),
          ...((here.department ?? null) !== department ? [{ field: "Department", was: here.department, now: department }] : []),
        ]
      : [{ field: "On the project", was: "no", now: `yes, as ${fn!.name}` }];
    return { at: l.at, outcome: "UPDATE", title: `${title}${known.name !== v.name ? ` (their account reads ${known.name})` : ""}`, changes, problems: [] };
  });
  if (!sent.length) return { checks, written: false };
  const answer = await batch(`/api/admin/projects/${ctx.projectId}/members/many`, { people: sent, dry: !write });
  for (const one of answer.lines) {
    const check = checks.find((c) => c.at === one.at)!;
    if (!one.ok) { check.outcome = "PROBLEM"; check.problems = [one.problem ?? "Refused."]; }
    else if (write && one.value && one.value.invited === false && typeof one.value.link === "string") check.pass = one.value.link;
  }
  return { checks, written: answer.written };
}

/** The matrix: each row's letters against what the functions grant today, then every function written as one. */
async function matrix(ctx: Ctx, lines: Line[], write: boolean): Promise<{ checks: LineCheck[]; written: boolean }> {
  const codes = [...new Set(lines.flatMap((l) => Object.keys(l.values).filter((k) => k.startsWith("fn:")).map((k) => k.slice(3))))];
  const lineNo = (at: string) => Number(at.replace(/^\D+/, "")) || 0;
  const header = ["Deliverable type", "Document type", "Discipline", "Family", "Label", ...codes];
  const rows = [{ row: header, line: 0 }, ...lines.map((l) => ({
    line: lineNo(l.at),
    row: [l.values.deliverableType ?? "", l.values.docType ?? "", l.values.discipline ?? "", l.values.family ?? "", l.values.label ?? "", ...codes.map((c) => l.values[`fn:${c}`] ?? "")],
  }))];
  const { changes, problems } = await readRows(ctx, rows);
  const { out, writes } = await planChanges(ctx, changes);
  const checks = lines.map((l): LineCheck => {
    const n = lineNo(l.at);
    const title = l.values.label || [l.values.deliverableType, l.values.docType, l.values.discipline, l.values.family].filter(Boolean).join(" · ") || "This row";
    const wrong = [...problems.filter((p) => p.line === n).map((p) => p.message), ...out.filter((o) => o.line === n && !o.ok).map((o) => o.message)];
    const mine = changes.filter((c) => c.line === n);
    if (wrong.length) return { at: l.at, outcome: "PROBLEM", title, changes: [], problems: wrong };
    return mine.length
      ? { at: l.at, outcome: "UPDATE", title, changes: mine.map((c) => ({ field: `${c.functionName} (${c.functionCode})`, was: c.from, now: c.to })), problems: [] }
      : { at: l.at, outcome: "SAME", title, changes: [], problems: [] };
  });
  // A problem of the header (a column naming no function) is said on the first line.
  const general = problems.filter((p) => p.line <= 0 || !lines.some((l) => lineNo(l.at) === p.line));
  if (general.length && checks[0]) { checks[0].outcome = "PROBLEM"; checks[0].problems.push(...general.map((p) => p.message)); }
  if (!writes.length || (write && checks.some((c) => c.outcome === "PROBLEM"))) return { checks, written: false };
  const answer = await batch("/api/admin/functions/rules/many", { functions: writes.map((w) => ({ at: w.code, functionId: w.functionId, rules: w.rules })), dry: !write });
  for (const one of answer.lines.filter((l) => !l.ok)) {
    const w = writes.find((x) => x.code === one.at);
    for (const index of w?.reports ?? []) {
      const check = checks.find((c) => lineNo(c.at) === out[index].line);
      if (check) { check.outcome = "PROBLEM"; check.problems.push(`${one.at}: ${one.problem ?? "refused"}`); }
    }
  }
  return { checks, written: answer.written };
}

/** The Settings lists: each value against the project's list as it reads now, then every value written as one. */
async function sets(ctx: Ctx, lines: Line[], write: boolean, kind: LinesKind = "sets"): Promise<{ checks: LineCheck[]; written: boolean }> {
  type Standing = { key: string; own: boolean; free: boolean };
  // The organization's own lists are never fixed for it: only a project reads a list the organization keeps.
  const standing = orgLevel(kind) ? { mayChange: true, lists: [] as Standing[] } : await api<{ mayChange: boolean; lists: Standing[] }>(projectPath(ctx, "/lists"));
  const titles = new Map((await setsAt(kind)).map((one) => [one.key, one.title] as const));
  const fixed = new Set(standing.lists.filter((one) => !one.own && !one.free).map((one) => one.key));
  const existing = new Map<string, Map<string, { label: string; status: string; props: Record<string, unknown> }>>();
  for (const set of new Set(lines.map((l) => l.values.set ?? ""))) {
    if (!titles.has(set)) continue;
    existing.set(set, new Map((await valuesAt(kind, set)).map((one) => [one.code, { label: one.label, status: one.status, props: one.props }] as const)));
  }
  const seen = new Map<string, number>();
  for (const l of lines) { const k = `${l.values.set}:${l.values.code}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
  const sent: { at: string; set: string; value: { code: string; label: string; status: string; props?: Record<string, unknown> } }[] = [];
  const shown = (v: unknown) => v == null || v === "" ? null : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  const checks = lines.map((l): LineCheck => {
    const v = l.values;
    const set = v.set ?? "";
    const list = titles.get(set) ?? set;
    const title = `${list}: ${v.code || "no code"}${v.label ? ` — ${v.label}` : ""}`;
    const problems: string[] = [];
    if (!titles.has(set)) problems.push(`No list called ${set}.`);
    if (fixed.has(set)) problems.push(`${list} is the organization's, the same on every project: an administrator changes it in the organization's Settings.`);
    if (!v.code) problems.push("A label with no code.");
    if (!v.label) problems.push("No label.");
    if ((seen.get(`${set}:${v.code}`) ?? 0) > 1) problems.push("The same code is on the list twice.");
    if (problems.length) return { at: l.at, outcome: "PROBLEM", title, changes: [], problems };
    const was = existing.get(set)?.get(v.code!);
    // Start from what the value holds: a workbook that does not mention a property never erases it.
    const props: Record<string, unknown> = { ...(was?.props ?? {}) };
    for (const field of propFieldsFor(set) ?? []) {
      const given = clean(v[`p:${field.key}`]);
      if (!given) continue;
      if (field.type === "choice") { const picked = field.options.find((one) => one.value === given); if (picked) Object.assign(props, picked.sets); continue; }
      props[field.key] = field.type === "bool" ? /^(yes|true|1)$/i.test(given) : field.type === "int" ? Number(given)
        : field.type === "sets" ? given.split(/[,;]/).map((one) => one.trim()).filter(Boolean) : given;
    }
    const status = v.status === "RETIRED" ? "RETIRED" : "ACTIVE";
    const value = { code: v.code!, label: v.label!, status, props: Object.keys(props).length ? props : undefined };
    if (!was) { sent.push({ at: l.at, set, value }); return { at: l.at, outcome: "NEW", title, changes: status === "RETIRED" ? [{ field: "Status", was: null, now: "retired" }] : [], problems: [] }; }
    const changes = [
      ...(was.label !== value.label ? [{ field: "Label", was: was.label, now: value.label }] : []),
      ...(was.status !== status ? [{ field: "Status", was: was.status.toLowerCase(), now: status.toLowerCase() }] : []),
      ...[...new Set([...Object.keys(was.props), ...Object.keys(props)])]
        .filter((k) => JSON.stringify(was.props[k] ?? null) !== JSON.stringify(props[k] ?? null))
        .map((k) => ({ field: (propFieldsFor(set) ?? []).find((f) => f.key === k)?.label ?? k, was: shown(was.props[k]), now: shown(props[k]) })),
    ];
    if (!changes.length) return { at: l.at, outcome: "SAME", title, changes: [], problems: [] };
    sent.push({ at: l.at, set, value });
    return { at: l.at, outcome: "UPDATE", title, changes, problems: [] };
  });
  if (!sent.length || (write && checks.some((c) => c.outcome === "PROBLEM"))) return { checks, written: false };
  const answer = await batch(orgLevel(kind) ? "/api/admin/lists/values/many" : projectPath(ctx, "/lists/values/many"), { values: sent, dry: !write });
  for (const one of answer.lines.filter((l) => !l.ok)) {
    const check = checks.find((c) => c.at === one.at)!;
    check.outcome = "PROBLEM"; check.problems = [one.problem ?? "Refused."];
  }
  return { checks, written: answer.written };
}

async function run(ctx: Ctx, kind: LinesKind, lines: Line[], write: boolean) {
  return kind === "people" ? people(ctx, lines, write) : kind === "matrix" ? matrix(ctx, lines, write) : sets(ctx, lines, write, kind);
}

/** The file read into lines and checked; nothing written. From a file chosen, or (`fromDocument`) its register document's released revision. */
export async function readLinesAction(_prev: LinesAnswer | undefined, formData: FormData): Promise<LinesAnswer> {
  const ctx = await requireScope();
  const kind = String(formData.get("kind") ?? "") as LinesKind;
  if (!FORMATS[kind]) return { error: "Choose what you are importing." };
  const refused = refusedFor(ctx, kind);
  if (refused) return { error: refused };
  let file = formData.get("file") as File | null;
  let from: LinesAnswer["from"] = null;
  if (formData.get("fromDocument") === "1") {
    const source = SOURCE_OF[kind];
    if (!source) return { error: "The organization's lists come from a workbook only." };
    const got = await releasedFile(ctx, source, FORMATS[kind]);
    if ("error" in got) return { error: got.error };
    file = got.file; from = got.from;
  }
  if (!file || file.size === 0) return { error: "Choose the filled-in file first." };
  if (!FORMATS[kind].test(file.name)) return { error: `This import takes ${FORMAT_WORDS[kind]}; ${file.name} is not one.` };
  // What it really is, its size unpacked, macros and viruses: checked before anything reads it.
  const sheet = await sheetRefusal(ctx, file);
  if (sheet) return { error: sheet };
  const read = await linesOf(kind, file);
  if ("error" in read) return { error: read.error };
  try {
    const [fields, { checks }] = await Promise.all([fieldsOf(kind), run(ctx, kind, read.lines, false)]);
    return { kind, lines: read.lines, fields, checks, from };
  } catch (e) {
    return { error: refusal(e).message };
  }
}

/** The lines as they now stand, checked again; nothing written. */
export async function checkLinesAction(kind: LinesKind, lines: Line[]): Promise<LinesAnswer> {
  const ctx = await requireScope();
  const refused = refusedFor(ctx, kind);
  if (refused) return { error: refused };
  try {
    return { checks: (await run(ctx, kind, lines, false)).checks };
  } catch (e) {
    return { error: refusal(e).message };
  }
}

/** Every line written as one, or nothing: checked again first, refused whole if a line has a problem. */
export async function writeLinesAction(kind: LinesKind, lines: Line[], from: LinesAnswer["from"]): Promise<LinesAnswer> {
  const ctx = await requireScope();
  const refused = refusedFor(ctx, kind);
  if (refused) return { error: refused };
  try {
    const first = await run(ctx, kind, lines, false);
    if (first.checks.some((c) => c.outcome === "PROBLEM")) return { checks: first.checks, written: false, error: "Nothing was written: some lines have problems. Correct them or take them off the list." };
    const { checks, written } = await run(ctx, kind, lines, true);
    if (!written) return { checks, written: false, error: "Nothing was written: a line was refused while writing. See it below." };
    if (SOURCE_OF[kind]) await api(projectPath(ctx, `/lists/sources/${SOURCE_OF[kind]}/brought`), {
      body: from ? { from: "DOCUMENT", revisionId: from.revisionId, label: from.label } : { from: "UPLOAD", revisionId: null, label: null },
    }).catch(() => undefined);
    revalidatePath("/", "layout");
    const changed = checks.filter((c) => c.outcome === "NEW" || c.outcome === "UPDATE").length;
    return { checks, written: true, summary: `${plural(changed, "line")} written.` };
  } catch (e) {
    return { error: refusal(e).message };
  }
}
