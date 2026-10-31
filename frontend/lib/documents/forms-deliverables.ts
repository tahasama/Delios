"use server";

import { requireScope } from "@/lib/core/scope";
import { isReadOnly } from "@/lib/core/auth";
import { parseCsv, toObjects } from "@/lib/core/csv";
import { api, projectPath, refusal, ApiProblem } from "@/lib/client";
import { sheetRefusal } from "@/lib/documents/sheet-check";
import { fieldLabels, ownFields } from "@/lib/settings/field-policy";
import { MARK, MARK_SHEET } from "@/lib/documents/deliverable-workbook";
import { deliverableFields, type DeliverableFields } from "@/lib/documents/deliverable-fields";
import { releasedFile, type ListFrom } from "@/lib/actions/list-files";

// The deliverable list: the screens read the file into lines, the backend checks and writes them, one call each
// (`DeliverableImport`). Every rule is the backend's; the screens only show what each line would do and let the person
// leave lines out or correct them before anything is written.

/** One line as read from the file: where it is, the number when it updates a document, its values by field. */
export type ListLine = { at: string; number: string | null; values: Record<string, string> };

/** What the backend says of a line. */
export type LineView = {
  at: string; outcome: "NEW" | "UPDATE" | "SAME" | "PROBLEM"; number: string | null; documentId: string | null; title: string | null;
  changes: { field: string; was: string | null; now: string | null }[]; problems: string[]; fields: string[];
};
export type ListView = { lines: LineView[]; new: number; updates: number; same: number; problems: number; written: boolean };

/** The read file: its lines, what each would do, and the document form per deliverable type to correct a line with. */
export type ListAnswer = { error?: string; project?: string | null; lines?: ListLine[]; view?: ListView; form?: DeliverableFields[];
  /** Read from the list's register document as released (else from a file chosen). */
  from?: ListFrom | null };

/** The headings a CSV may carry, by the field they hold (a workbook says it itself, on its hidden DELIOS sheet). */
const ALIASES: Record<string, string[]> = {
  number: ["document number", "number"],
  title: ["title"],
  deliverableType: ["deliverable type", "producer"],
  docType: ["document type", "type"],
  discipline: ["discipline"],
  originator: ["supplier", "originator"],
  subproject: ["sub-project", "subproject"],
  phase: ["phase"],
  contractRef: ["contract or purchase order", "purchase order", "po", "contractref"],
  criticality: ["criticality"],
  confidentiality: ["who may see it", "confidentiality"],
  retentionClass: ["retention period", "retentionclass"],
  plannedDate: ["planned date", "planneddate"],
  project: ["project"],
};

/** A cell as text: a date as its day, rich text and formulas as what they show. */
function textOf(raw: unknown): string {
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (raw && typeof raw === "object") {
    if ("richText" in raw) return ((raw as { richText: { text: string }[] }).richText ?? []).map((r) => r.text).join("").trim();
    if ("text" in raw) return String((raw as { text: unknown }).text ?? "").trim();
    if ("result" in raw) return textOf((raw as { result: unknown }).result);
  }
  return raw == null ? "" : String(raw).trim();
}

/** The workbook made by DELIOS: its project, and each sheet's lines by the fields its columns hold. */
async function readWorkbook(file: File): Promise<{ project: string | null; lines: ListLine[] } | { error: string }> {
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await file.arrayBuffer());
  const mark = book.getWorksheet(MARK_SHEET);
  if (!mark || textOf(mark.getCell(1, 2).value) !== MARK)
    return { error: "This workbook is not a deliverable list made by DELIOS, or was made before the list changed. Download the template (or the register as it stands) again and fill that one." };
  const project = textOf(mark.getCell(1, 1).value) || null;
  const lines: ListLine[] = [];
  mark.eachRow({ includeEmpty: false }, (row, index) => {
    if (index < 2) return;
    const name = textOf(row.getCell(1).value);
    const deliverableType = textOf(row.getCell(2).value);
    const keys: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell, column) => { if (column >= 3) keys[column - 2] = textOf(cell.value); });
    const sheet = book.getWorksheet(name);
    if (!sheet) return;
    sheet.eachRow({ includeEmpty: false }, (line, at) => {
      if (at <= 2) return;
      const values: Record<string, string> = { deliverableType };
      let number: string | null = null;
      let any = false;
      line.eachCell({ includeEmpty: false }, (cell, column) => {
        const key = keys[column];
        const text = textOf(cell.value);
        if (!key || !text) return;
        if (key === "number") number = text;
        else { values[key] = text; any = true; }
      });
      if (any || number) lines.push({ at: `Sheet ${name}, row ${at}`, number, values });
    });
  });
  return { project, lines };
}

/** A CSV, its headings read as the template's (or a field of one's own by its name). */
async function readCsv(file: File, labels: Record<string, string>, own: { key: string; label: string }[]): Promise<{ project: string | null; lines: ListLine[] } | { error: string }> {
  const { headers, objects } = toObjects(parseCsv(await file.text()));
  const keyOf = new Map<string, string>();
  for (const [key, names] of Object.entries(ALIASES)) for (const name of names) keyOf.set(name, key);
  for (const [key, label] of Object.entries(labels)) keyOf.set(label.toLowerCase(), key === "subProject" ? "subproject" : key);
  for (const field of own) keyOf.set(field.label.toLowerCase(), `extra:${field.key}`);
  const unknown = headers.filter((h) => h && !keyOf.has(h.toLowerCase()));
  if (unknown.length) return { error: `The heading${unknown.length === 1 ? "" : "s"} ${unknown.map((h) => `"${h}"`).join(", ")} ${unknown.length === 1 ? "is" : "are"} not a field of the document form. Use the template's headings.` };
  const projects = new Set<string>();
  const lines: ListLine[] = [];
  objects.forEach((row, index) => {
    const values: Record<string, string> = {};
    let number: string | null = null;
    for (const [heading, raw] of Object.entries(row)) {
      const key = keyOf.get(heading.trim().toLowerCase());
      const text = raw.trim();
      if (!key || !text) continue;
      if (key === "number") number = text;
      else if (key === "project") projects.add(text);
      else values[key] = text;
    }
    if (Object.keys(values).length || number) lines.push({ at: `Row ${index + 2}`, number, values });
  });
  // A CSV says its project on every line, if at all: one project only.
  if (projects.size > 1) return { error: `This file names ${[...projects].join(", ")}: one list is one project's.` };
  return { project: [...projects][0] ?? null, lines };
}

async function backend(project: string | null, lines: ListLine[]): Promise<ListView> {
  const ctx = await requireScope();
  return api<ListView>(projectPath(ctx, "/imports/deliverables/check"), { body: { project, lines } });
}

/** Read the file chosen and check it: the lines as read, and what each would do. Writes nothing. */
export async function readDeliverableListAction(_prev: ListAnswer | undefined, formData: FormData): Promise<ListAnswer> {
  const ctx = await requireScope();
  if (isReadOnly(ctx.user)) return { error: "You can read this project, not change it, so you cannot bring a list in." };
  let file = formData.get("file") as File | null;
  let from: ListFrom | null = null;
  // Its register document's released revision (owner: a list comes from it, or from a file uploaded; the latest stands).
  if (formData.get("fromDocument") === "1") {
    const got = await releasedFile(ctx, "DELIVERABLES", /\.(xlsx|csv)$/i);
    if ("error" in got) return { error: got.error };
    file = got.file; from = got.from;
  }
  if (!file || file.size === 0) return { error: "Choose the filled-in file first." };
  if (!/\.(xlsx|csv)$/i.test(file.name)) return { error: `The deliverable list is the workbook (.xlsx) or a CSV; ${file.name} is neither.` };
  const refused = await sheetRefusal(ctx, file);
  if (refused) return { error: refused };
  const [labels, own, { types }] = await Promise.all([fieldLabels(ctx, "DOCUMENT"), ownFields(ctx, "DOCUMENT"), deliverableFields(ctx)]);
  const read = /\.xlsx$/i.test(file.name) ? await readWorkbook(file) : await readCsv(file, labels, own);
  if ("error" in read) return { error: read.error };
  if (!read.lines.length) return { error: "No filled-in lines in that file: they start under the headings." };
  try {
    return { project: read.project, lines: read.lines, view: await backend(read.project, read.lines), form: types, from };
  } catch (e) {
    return { error: refusal(e).message };
  }
}

/** Check the lines again, as the person left and corrected them. Writes nothing. */
export async function checkDeliverableLinesAction(project: string | null, lines: ListLine[]): Promise<{ error?: string; view?: ListView }> {
  if (!lines.length) return { error: "Every line is left out: nothing to check." };
  try {
    return { view: await backend(project, lines) };
  } catch (e) {
    return { error: refusal(e).message };
  }
}

/** Write the lines left in: all of them, or none if one no longer passes (each line then says why). */
export async function writeDeliverableLinesAction(project: string | null, lines: ListLine[], from: ListFrom | null = null): Promise<{ error?: string; view?: ListView }> {
  if (!lines.length) return { error: "Every line is left out: nothing to write." };
  const ctx = await requireScope();
  try {
    const view = await api<ListView>(projectPath(ctx, "/imports/deliverables/write"), { body: { project, lines } });
    // What it was brought in from, so the page and Home can say when a newer revision waits.
    await api(projectPath(ctx, "/lists/sources/DELIVERABLES/brought"), {
      body: from ? { from: "DOCUMENT", revisionId: from.revisionId, label: from.label } : { from: "UPLOAD", revisionId: null, label: null },
    }).catch(() => undefined);
    return { view };
  } catch (e) {
    // Refused whole: the backend answers with every line, as a check, and nothing is written.
    if (e instanceof ApiProblem && e.status === 409) {
      const again = await checkDeliverableLinesAction(project, lines);
      return { error: "Nothing was written: a line no longer passes (the register moved since the check). See the lines below.", view: again.view };
    }
    return { error: refusal(e).message };
  }
}
