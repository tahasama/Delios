"use server";

import { requireScope } from "@/lib/core/scope";
import { parseCsv, toCsv, toObjects } from "@/lib/core/csv";
import { getSet, getSets } from "@/lib/settings/config";
import { isReadOnly } from "@/lib/core/auth";
import { isAdmin } from "@/lib/core/auth";
import { revalidatePath } from "next/cache";
import { readSheet, applyChanges } from "@/lib/settings/matrix-read";
import { propFieldsFor } from "@/lib/settings/set-props";
import { sheetRefusal } from "@/lib/documents/sheet-check";
import { api, projectPath, refusal } from "@/lib/client";
import { adminFunctions, adminParties, adminUsers } from "@/lib/settings/api-admin";

// Bulk in/out — document controllers live in spreadsheets. A file is always
// checked first; the check says what writing it would do, and only then is it
// written, with the rows that have problems left out (said before, and after).

/** One row of the report: where it is in the file, as the person sees it there, and what it does. */
export type ImportRow = {
  /** Its order in the report. */
  line: number;
  /** "Sheet DS — Datasheets, row 12", or "Row 5" in a CSV. */
  at: string;
  ok: boolean;
  message: string;
  /** After writing: false when it was checked but nothing needed writing. */
  wrote?: boolean;
  /** A document registered or corrected: its page. */
  link?: string;
  /** A link for the person to choose their password, to pass on (email being off). */
  pass?: string;
};

export type ImportResult = {
  error?: string;
  /** One sentence on the whole file. */
  summary?: string;
  rows?: ImportRow[];
  /** A check (nothing written yet), or the writing. */
  checked?: boolean;
  ready?: number;
  problems?: number;
  done?: number;
  /** The act the button names after a check, with its count ("Register 41 documents"). */
  act?: string;
  /** The rows with problems as they came in, for the person to fix and send again (CSV). */
  problemCsv?: string;
  /** The register showing what was just written. */
  registerLink?: string;
  /** The report holds something to pass on (a link to choose a password, email being off): leaving the page loses it. */
  handOver?: boolean;
};

/** A row read from the upload, with where it is in the file. */
type Read = { data: Record<string, string>; at: string };

/** What each kind of import reads: the file formats it takes. */
const FORMATS: Record<string, RegExp> = { people: /\.csv$/i, matrix: /\.csv$/i, sets: /\.xlsx$/i };
const FORMAT_WORDS: Record<string, string> = {
  people: "a CSV, as the template",
  matrix: "the matrix as downloaded (.csv)",
  sets: "the workbook (.xlsx) as downloaded",
};

/**
 * Read the uploaded CSV (the team list). Each row keeps where it is, so a problem points at the row the person sees;
 * empty rows are no rows. The deliverable list has its own reader (`forms-deliverables.ts`).
 */
async function readUpload(file: File): Promise<Read[] | { error: string }> {
  const { objects } = toObjects(parseCsv(await file.text()));
  // Row 1 holds the headings, so the first data row is row 2 of the file.
  const read = objects.map((data, index) => ({ data, at: `Row ${index + 2}` })).filter((one) => Object.values(one.data).some((v) => v.trim()));
  if (!read.length) return { error: "The file has no rows under its headings." };
  return read;
}

const GET = (o: Record<string, string>, k: string) => (o[k] ?? "").trim();

/** The rows with problems, as they came in, so they can be fixed and sent again. */
function problemFile(read: Read[], rows: ImportRow[]): string | undefined {
  const bad = new Set(rows.filter((r) => !r.ok).map((r) => r.at));
  const kept = read.filter((one) => bad.has(one.at));
  if (!kept.length) return undefined;
  const headers = [...new Set(kept.flatMap((one) => Object.keys(one.data)))];
  return toCsv([headers, ...kept.map((one) => headers.map((h) => one.data[h] ?? ""))]);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Check a file, or write it. "check" writes nothing and says what writing would do, row by row. "write" checks again
 * (the file is the same one, but the register may have moved) and writes the rows that pass; the others are left out,
 * as the check said.
 */
export async function importBulkAction(_prev: ImportResult | undefined, formData: FormData): Promise<ImportResult> {
  const ctx = await requireScope();
  const { user, projectId } = ctx;
  if (isReadOnly(user)) return { error: "You can read this project, not change it, so you cannot import." };
  const kind = String(formData.get("kind") ?? "");
  const checking = formData.get("mode") !== "write";

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose the filled-in file first." };
  if (FORMATS[kind] && !FORMATS[kind].test(file.name)) return { error: `This import takes ${FORMAT_WORDS[kind]}; ${file.name} is not one.` };
  // What it really is, its size unpacked, macros and viruses: checked before anything reads it.
  const refused = await sheetRefusal(ctx, file);
  if (refused) return { error: refused };

  // The matrix is a grid, not a list of records: its own reader, and only an
  // administrator may apply it, because it says who approves what.
  if (kind === "matrix") return importMatrix(ctx, file, checking);
  if (kind === "sets") return importSets(ctx, file, checking);

  const read = await readUpload(file);
  if ("error" in read) return { error: read.error };

  const rows: ImportRow[] = [];
  let registering = 0;

  if (kind === "people") {
    // A whole team arrives at once, in a spreadsheet, like everything else here.
    if (!ctx.can("CONFIGURE") && !ctx.can("CONTROL")) return { error: "Adding people is the control function's, or an administrator's. Ask one of them." };
    let functions: { id: string; name: string }[], parties: { id: string; code: string; name: string }[], existing: { email: string }[];
    try {
      [functions, parties, existing] = await Promise.all([
        adminFunctions().then((all) => all.filter((f) => f.active)),
        adminParties(),
        adminUsers(),
      ]);
    } catch (e) {
      return { error: refusal(e).message };
    }
    const emails = new Set(existing.map((u) => u.email.toLowerCase()));
    const seen = new Set<string>();
    read.forEach(({ data: o, at }, i) => {
      const line = i + 1;
      const name = GET(o, "Name");
      const email = GET(o, "Email").toLowerCase();
      const company = GET(o, "Company");
      const fnName = GET(o, "Function");
      const problems: string[] = [];
      if (!name) problems.push("no name");
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push("the email is not a valid address");
      if (emails.has(email)) problems.push("someone already signs in with that email (add them on People & access instead)");
      if (seen.has(email)) problems.push("the same email is in this file twice");
      if (!functions.some((f) => f.name.toLowerCase() === fnName.toLowerCase())) problems.push(fnName ? `no function called "${fnName}" (Settings → Functions & permissions)` : "no function");
      if (company && !parties.some((x) => x.code.toLowerCase() === company.toLowerCase() || x.name.toLowerCase() === company.toLowerCase())) {
        problems.push(`no organization called "${company}" (Settings → Organizations)`);
      }
      seen.add(email);
      if (problems.length) rows.push({ line, at, ok: false, message: problems.join("; ") });
      else { registering++; rows.push({ line, at, ok: true, message: `Will add ${name} (${email}) as ${fnName}${company ? `, of ${company}` : ""}; they are emailed a link to choose their password` }); }
    });
  } else {
    return { error: "Choose what you are importing." };
  }

  const problems = rows.filter((r) => !r.ok).length;
  const ready = rows.length - problems;
  const act = kind === "people" ? `Add ${plural(ready, "person", "people")}`
    : "";
  if (checking) {
    return {
      checked: true, rows, ready, problems, act, problemCsv: problemFile(read, rows),
      summary: (!ready && !problems ? "Nothing to write in that file."
        : !ready ? `Nothing can be written: ${plural(problems, "row")} with problems.`
        : problems ? `${plural(ready, "row")} ready, ${plural(problems, "row")} with problems. Nothing is written yet.`
        : `All ${plural(ready, "row")} ready. Nothing is written yet.`)
        ,
    };
  }

  let done = 0, failed = 0;
  let handOver = false;
  for (let i = 0; i < read.length; i++) {
    const o = read[i].data;
    const report = rows.find((r) => r.line === i + 1);
    if (!report || !report.ok) continue;
    try {
      if (kind === "people") {
        const fn = (await adminFunctions()).find((f) => f.active && f.name.toLowerCase() === GET(o, "Function").toLowerCase());
        if (!fn) throw new Error(`no function called "${GET(o, "Function")}"`);
        const company = GET(o, "Company").toLowerCase();
        const party = company
          ? (await adminParties()).find((x) => x.code.toLowerCase() === company || x.name.toLowerCase() === company) ?? null
          : null;
        // Nobody but the person ever knows their password: they are invited to choose it.
        let created: { id: string; invited?: boolean; link?: string | null };
        try {
          created = await api<{ id: string; invited?: boolean; link?: string | null }>("/api/admin/users", {
            body: { name: GET(o, "Name"), email: GET(o, "Email").toLowerCase(), partyId: party?.id ?? null, invite: true },
          });
          await api(`/api/admin/projects/${projectId}/members`, {
            method: "PUT", body: { userId: created.id, functionId: fn.id, department: GET(o, "Department") || null, active: true },
          });
        } catch (e) {
          throw new Error(refusal(e).message);
        }
        // Joining may wait for whoever holds Manage (People to confirm), as anyone added on People & access.
        const added = (await api<AdminUserLite[]>("/api/admin/users")).find((u) => u.id === created.id);
        const pending = added?.memberships.find((m) => m.projectId === projectId)?.pendingSince;
        if (!created.invited) handOver = true;
        report.message = [
          `Added ${GET(o, "Name")} as ${fn.name}${pending ? ", waiting to be confirmed (People to confirm)" : ""}.`,
          created.invited ? `An email asks them to choose their password.`
            : `Email is off on this installation: give them the link below to choose their password (it works once, for 7 days).`,
        ].join(" ");
        if (!created.invited && created.link) report.pass = created.link;
        done++;
      }
    } catch (e) {
      failed++;
      report.ok = false;
      report.message = `Not written: ${e instanceof Error ? e.message : "refused"}`;
    }
  }
  return {
    checked: false, rows, done, problems: problems + failed, problemCsv: problemFile(read, rows), handOver,
    summary: `${kind === "people" ? `${plural(done, "person", "people")} added` : `${plural(done, "document")} written`}.`
      + (problems ? ` ${plural(problems, "row")} with problems left out, as the check said.` : "")
      + (failed ? ` ${plural(failed, "row")} refused while writing: see the report.` : ""),
  };
}

type AdminUserLite = { id: string; memberships: { projectId: string; pendingSince?: string | null }[] };

/**
 * Every published list, from one workbook.
 *
 * A tab is a set, named by its key. A row whose code exists is updated; a code
 * that does not exist is published. A row that is simply absent is left alone —
 * a workbook where somebody edited one tab must not retire everything missing
 * from the other twenty, and retiring stays a deliberate act on the list's page.
 */
async function importSets(ctx: Awaited<ReturnType<typeof requireScope>>, file: File, checking: boolean): Promise<ImportResult> {
  // The project's lists (owner): each is the organization's until the project changes it, by hand or here; the first
  // change of a list the organization leaves free makes this project's own copy of that list, and a list it keeps the
  // same on every project is refused. Whoever acts as the control function changes them (the backend says so).
  type Standing = { key: string; own: boolean; free: boolean };
  let standing: { mayChange: boolean; lists: Standing[] };
  try {
    standing = await api<{ mayChange: boolean; lists: Standing[] }>(projectPath(ctx, "/lists"));
  } catch (e) {
    return { error: refusal(e).message };
  }
  if (!standing.mayChange) return { error: "Whoever acts as the control function on this project changes its lists. Ask them." };
  const fixed = new Set(standing.lists.filter((one) => !one.own && !one.free).map((one) => one.key));

  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await file.arrayBuffer());

  const sets = new Map((await getSets()).map((one) => [one.key, one.title] as const));
  const rows: ImportRow[] = [];
  const work: { setKey: string; code: string; label: string; status: string; props: string | null; existingId?: string; line: number }[] = [];
  let line = 0;

  for (const sheet of book.worksheets) {
    const setKey = sheet.name.trim();
    if (!sets.has(setKey)) continue;
    if (fixed.has(setKey)) {
      // Said once for the sheet, only when it would change something: a list read as it stands is no news.
      rows.push({ line: ++line, at: `Sheet ${setKey}`, ok: false, message: `${sets.get(setKey)} is the organization's, the same on every project: an administrator changes it in the organization's Settings. This sheet is left as it is.` });
      continue;
    }
    const fields = propFieldsFor(setKey) ?? [];
    const headers: string[] = [];
    sheet.getRow(2).eachCell({ includeEmpty: true }, (cell, column) => { headers[column] = String(cell.value ?? "").trim(); });
    if (headers[1] !== "Code") { rows.push({ line: ++line, at: `Sheet ${setKey}, row 2`, ok: false, message: `The headings are missing on this sheet: download the workbook again and fill that one.` }); continue; }

    // A value is named by its list and code; props as the old rows kept them, a JSON text or nothing.
    const existing = new Map(
      (await getSet(setKey)).map((one) => [one.code, {
        id: `${setKey}:${one.code}`, code: one.code, label: one.label, status: one.status,
        props: Object.keys(one.props).length ? JSON.stringify(one.props) : null,
      }] as const),
    );

    sheet.eachRow({ includeEmpty: false }, (row, index) => {
      if (index <= 2) return;
      const text = (column: number) => {
        const raw = row.getCell(column).value;
        return raw == null ? "" : String(typeof raw === "object" && "text" in raw ? (raw as { text: unknown }).text : raw).trim();
      };
      const code = text(1);
      const label = text(2);
      if (!code && !label) return;
      line++;
      const at = `Sheet ${setKey}, row ${index}`;
      if (!code) { rows.push({ line, at, ok: false, message: `${sets.get(setKey)}: a label with no code` }); return; }
      if (!label) { rows.push({ line, at, ok: false, message: `${sets.get(setKey)} ${code}: no label` }); return; }

      const status = text(3).toUpperCase() === "RETIRED" ? "RETIRED" : "ACTIVE";
      const was = existing.get(code);
      // Start from what the value already holds. A workbook that does not
      // mention a property must not erase it — that is how an upload once wiped
      // what every review verdict does.
      const props: Record<string, unknown> = was?.props ? (() => {
        try { return JSON.parse(was.props) as Record<string, unknown>; } catch { return {}; }
      })() : {};
      fields.forEach((field, offset) => {
        const given = text(offset + 4);
        if (!given) return;
        if (field.type === "choice") {
          // One answer, several stored values — the effect of a verdict sets
          // both whether it proceeds and whether it is resubmitted.
          const picked = field.options.find((one) => one.value === given);
          if (picked) Object.assign(props, picked.sets);
          return;
        }
        props[field.key] =
          field.type === "bool" ? /^(yes|true|1)$/i.test(given)
          : field.type === "int" ? Number(given)
          : field.type === "sets" ? given.split(/[,;]/).map((one) => one.trim()).filter(Boolean)
          : given;
      });
      const asJson = Object.keys(props).length ? JSON.stringify(props) : null;

      if (!was) {
        work.push({ setKey, code, label, status, props: asJson, line });
        // Saying the status matters: a value published as retired is in the
        // list but hidden behind the Active filter, which reads as nothing
        // having happened at all.
        rows.push({ line, at, ok: true, message: `${sets.get(setKey)}: new value ${code} — ${label}${status === "RETIRED" ? ", as retired, so it stays hidden behind the Active filter" : ""}` });
        return;
      }
      const changed = [
        was.label !== label ? "label" : "",
        was.status !== status ? "status" : "",
        (was.props ?? null) !== asJson ? "properties" : "",
      ].filter(Boolean);
      if (!changed.length) return; // unchanged rows are not news
      work.push({ setKey, code, label, status, props: asJson, existingId: was.id, line });
      rows.push({ line, at, ok: true, message: `${sets.get(setKey)}: ${code} — ${changed.join(", ")} changed${was.status !== status ? ` (now ${status.toLowerCase()})` : ""}` });
    });
  }

  if (!rows.length) return { checked: checking, summary: "Nothing in that workbook differs from the Settings lists.", rows: [], ready: 0, problems: 0, done: 0 };
  const problems = rows.filter((r) => !r.ok).length;
  const listCount = new Set(work.map((w) => w.setKey)).size;
  if (checking) {
    return {
      checked: true, rows, ready: work.length, problems,
      act: `Publish or change ${plural(work.length, "value")}`,
      summary: `${plural(work.length, "value")} would be published or changed, in ${plural(listCount, "list")}${problems ? `; ${plural(problems, "row")} with problems` : ""}. Nothing else in those lists is touched, and nothing is written yet.`,
    };
  }

  // The backend publishes a value or changes it with the same call, and audits each.
  let published = 0;
  try {
    for (const one of work) {
      await api(projectPath(ctx, `/lists/${encodeURIComponent(one.setKey)}/values`), {
        method: "PUT",
        body: { code: one.code, label: one.label, status: one.status, props: one.props ? JSON.parse(one.props) : undefined },
      });
      published++;
    }
  } catch (e) {
    return { error: `${refusal(e).message} ${plural(published, "value")} were written before that.`, rows, done: published, problems, checked: false };
  }
  revalidatePath("/", "layout");
  return { checked: false, rows, done: published, problems, summary: `${plural(published, "value")} published or changed.${problems ? ` ${plural(problems, "row")} with problems left out.` : ""}` };
}

/**
 * A filled-in distribution matrix. Dry by default: the report is the change
 * list, one line per cell that differs from what the matrix says today.
 */
async function importMatrix(ctx: Awaited<ReturnType<typeof requireScope>>, file: File, checking: boolean): Promise<ImportResult> {
  const { user } = ctx;
  if (!isAdmin(user)) return { error: "Only an administrator changes the distribution matrix. Ask one of them." };
  const { changes, problems, unchanged } = await readSheet(ctx, await file.text());
  // The matrix reader counts the file's own lines, comment lines included, so a line is the one the person sees.
  const at = (line: number) => (line > 0 ? `Row ${line}` : "The file");

  const rows: ImportRow[] = problems.map((p) => ({ line: p.line, at: at(p.line), ok: false, message: p.message }));

  if (checking) {
    for (const change of changes) {
      rows.push({
        line: change.line, at: at(change.line), ok: true,
        message: `${change.functionName} (${change.functionCode}): ${change.from} becomes ${change.to} on ${change.label || "this class"}`,
      });
    }
    rows.sort((a, b) => a.line - b.line);
    const lead = changes.length ? `${plural(changes.length, "cell")} would change; ${unchanged} already agree.` : `Nothing would change: the ${unchanged} cells read agree with the matrix.`;
    return {
      checked: true, rows, ready: changes.length, problems: problems.length, act: `Change ${plural(changes.length, "cell")}`,
      summary: `${lead}${problems.length ? ` ${plural(problems.length, "row")} with problems.` : ""} Nothing is written yet.`,
    };
  }

  const applied = await applyChanges(ctx, changes);
  rows.push(...applied.map((one) => ({ line: one.line, at: at(one.line), ok: one.ok, message: one.message, wrote: one.wrote })));
  rows.sort((a, b) => a.line - b.line);
  const wrote = applied.filter((one) => one.wrote).length;
  const refused = applied.filter((one) => !one.ok).length;

  // The backend audits every change to a function's rules.
  // The matrix decides what every screen offers, so nothing cached survives it.
  revalidatePath("/", "layout");
  return {
    checked: false, rows, done: wrote, problems: refused + problems.length,
    summary: `${plural(wrote, "cell")} changed.${refused ? ` ${plural(refused, "cell")} could not be changed here: see the report.` : ""}${problems.length ? ` ${plural(problems.length, "row")} with problems left out.` : ""}`,
  };
}
