import ExcelJS from "exceljs";
import type { Tenant } from "@/lib/core/tenant";
import { registerRows } from "@/lib/documents/api-register";
import { deliverableFields } from "@/lib/documents/deliverable-fields";

/**
 * The deliverable list, as a workbook people can actually fill in, made as the app works now.
 *
 * One sheet per deliverable type: who produces a document decides what it is asked (the type-to-field list), and
 * every list offers only the values of the set serving that type (forms follow the sets). The columns are the
 * document form's (Forms & fields): what the form leaves out is left out, what it insists on is shaded, the
 * organization's own words head them, and the fields of one's own follow. A new document has no number (numbering is
 * never manual); "the register as it stands" carries each document's number, its first column, to update it.
 *
 * A veryHidden sheet, DELIOS, says which project the file was made for (A1) and which field each column holds, so the
 * file is read by what it is, never by guessing headings: a file of another project is refused before a line is read.
 * The dropdowns are a courtesy, not a control (pasting defeats them): the backend checks every cell.
 */

/** A column of a sheet: the field it holds (as the backend names it), its heading, and the list it draws from. */
type Column = { key: string; header: string; width: number; values?: { code: string }[]; required?: boolean; note?: string };

const HEADER_FILL = "FF102A43";
const REQUIRED_FILL = "FFFDF3D7";
const NUMBER_FILL = "FFE2E7EE";
/** The hidden sheet's name, and the mark in its first cell saying what the file is. */
export const MARK_SHEET = "DELIOS";
export const MARK = "deliverable-list";

/** Excel refuses a sheet name carrying any of these. */
const sheetName = (label: string) => label.replace(/[*?:\\/\[\]]/g, " ").replace(/\s{2,}/g, " ").slice(0, 31);

/** How wide each field's column is drawn. */
const WIDTH: Record<string, number> = { title: 44, docType: 14, discipline: 14, originator: 14, subproject: 14, phase: 12, contractRef: 16,
  criticality: 14, confidentiality: 16, retentionClass: 18, plannedDate: 16 };

/**
 * The workbook, empty to start from, or (`filled`) with the register as it stands: each document on its deliverable
 * type's sheet, with its number, so a row changed and brought back updates that document.
 */
export async function buildDeliverableWorkbook(t: Tenant, options: { filled?: boolean } = {}): Promise<Buffer> {
  const [{ project, types }, register] = await Promise.all([
    deliverableFields(t),
    options.filled ? registerRows(t) : Promise.resolve([]),
  ]);

  const book = new ExcelJS.Workbook();
  book.creator = "DELIOS";
  book.created = new Date();

  // What the file is: its project, then which field each column of each sheet holds.
  const mark = book.addWorksheet(MARK_SHEET, { state: "veryHidden" });
  mark.getCell(1, 1).value = project?.code ?? "";
  mark.getCell(1, 2).value = MARK;
  let markRow = 2;

  // The lists the dropdowns point at, one column per distinct list of values (a type's own values often repeat).
  const source = book.addWorksheet("Lists", { state: "veryHidden" });
  const ranges = new Map<string, string>();
  const rangeOf = (values: { code: string }[]) => {
    if (!values.length) return undefined;
    const id = values.map((v) => v.code).join("\u0001");
    if (!ranges.has(id)) {
      const column = ranges.size + 1;
      values.forEach((one, row) => { source.getCell(row + 1, column).value = one.code; });
      const letter = source.getColumn(column).letter;
      ranges.set(id, `Lists!$${letter}$1:$${letter}$${values.length}`);
    }
    return ranges.get(id);
  };

  for (const type of types) {
    const columns: Column[] = [
      ...(options.filled ? [{ key: "number", header: "Document Number", width: 26, note: "Its number, given when it was registered: keep it to update this document. A new document has none." }] : []),
      ...type.fields.map((field) => ({
        key: field.key, header: field.label, width: WIDTH[field.key] ?? 18, values: field.values, required: field.required,
        note: field.kind === "date" ? `YYYY-MM-DD.${field.note ? ` ${field.note}` : ""}` : field.note,
      })),
    ];

    const name = sheetName(`${type.code} — ${type.label}`);
    const sheet = book.addWorksheet(name, { views: [{ state: "frozen", ySplit: 2 }] });
    mark.getCell(markRow, 1).value = name;
    mark.getCell(markRow, 2).value = type.code;
    columns.forEach((column, index) => { mark.getCell(markRow, index + 3).value = column.key; });
    markRow++;

    // One line saying what the sheet is, because a tab name is not an instruction.
    sheet.mergeCells(1, 1, 1, columns.length);
    const caption = sheet.getCell(1, 1);
    caption.value = `${type.label} — ${project?.code ?? ""} ${project?.name ?? ""}. ${options.filled
      ? "The register as it stands: change a line to update that document, or add a line with no number to register one."
      : "One line per document: each is given its number when it is registered."} Shaded headings must be filled. This file is for ${project?.code ?? "this project"} only.`;
    caption.font = { size: 9, italic: true, color: { argb: "FF5B7183" } };
    caption.alignment = { vertical: "middle" };
    sheet.getRow(1).height = 26;

    columns.forEach((column, index) => {
      const at = index + 1;
      const cell = sheet.getCell(2, at);
      cell.value = column.header;
      cell.font = column.key === "number" ? { bold: true, size: 10, color: { argb: "FF334E68" } }
        : column.required ? { bold: true, size: 10, color: { argb: "FF6B4B00" } } : { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: column.key === "number" ? NUMBER_FILL : column.required ? REQUIRED_FILL : HEADER_FILL } };
      cell.alignment = { vertical: "middle" };
      if (column.note) cell.note = column.note;
      sheet.getColumn(at).width = column.width;

      // The dropdown, on enough rows that nobody runs out filling a register.
      const range = column.values ? rangeOf(column.values) : undefined;
      if (!range) return;
      for (let row = 3; row <= 1000 + register.length; row++) {
        sheet.getCell(row, at).dataValidation = {
          type: "list", allowBlank: true, formulae: [range], showErrorMessage: true, errorStyle: "warning",
          errorTitle: "Not offered for this type", error: `Choose one of the values offered for ${type.label}. Anything else is refused when the file is read.`,
        };
      }
    });

    // The register as it stands, under the headings: what each column holds for each document of this type.
    const valueOf = (d: (typeof register)[number], key: string): string => {
      if (key.startsWith("extra:")) return d.extras?.[key.slice(6)] ?? "";
      const read: Record<string, string | null | undefined> = {
        number: d.number, title: d.title, docType: d.docType, discipline: d.discipline, originator: d.originator, subproject: d.subproject,
        phase: d.phase, contractRef: d.contractRef, criticality: d.criticality, confidentiality: d.confidentiality,
        retentionClass: d.retentionClass, plannedDate: d.plannedDate?.slice(0, 10),
      };
      return read[key] ?? "";
    };
    register.filter((d) => d.deliverableType === type.code).forEach((d, index) => {
      columns.forEach((column, at) => { sheet.getCell(index + 3, at + 1).value = valueOf(d, column.key); });
    });

    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: columns.length } };
  }

  return Buffer.from(await book.xlsx.writeBuffer());
}
