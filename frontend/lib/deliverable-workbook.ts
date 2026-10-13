import ExcelJS from "exceljs";
import type { Tenant } from "./tenant";
import { getActiveSet } from "./config";
import { getMe } from "./api/me";

/**
 * The deliverable list, as a workbook people can actually fill in.
 *
 * One sheet per deliverable type, because who produced a document decides which
 * columns it has: a vendor document has a purchase order and a date it arrived,
 * ours has neither. That is not a judgement made here — it is the published
 * type-to-field matrix, read as data.
 *
 * Every column drawn from a published list carries that list as a dropdown, so
 * nobody invents a discipline that does not exist. The lists live on a hidden
 * sheet because Excel refuses an inline list longer than 255 characters, and
 * this organization publishes nearly two hundred document types.
 *
 * The dropdowns are a courtesy, not a control. Pasting defeats them and some
 * spreadsheets drop them on import, so the server still checks every cell.
 */

/** A column in a sheet, and the published list it draws from. */
type Column = {
  header: string;
  /** The value set this column is chosen from, where it is a choice. */
  set?: string;
  width: number;
  note?: string;
};

/** The columns every deliverable has, whoever produced it. */
const ALWAYS: Column[] = [
  { header: "Document Number", width: 26, note: "Leave empty to register it. Give a number to correct that document instead." },
  { header: "Title", width: 44 },
  { header: "Type", set: "DOCUMENT_TYPES", width: 14 },
  { header: "Discipline", set: "DISCIPLINES", width: 14 },
  { header: "Project", set: "PROJECT_CODES", width: 12 },
  { header: "Criticality", set: "CRITICALITY", width: 14 },
  { header: "Confidentiality", set: "CONFIDENTIALITY", width: 16 },
  { header: "RetentionClass", set: "RETENTION_CLASSES", width: 18 },
  { header: "AssetCode", width: 14 },
  { header: "ContractRef", width: 16 },
  { header: "PlannedDate", width: 16, note: "When it is due. YYYY-MM-DD. Nothing fills this in for you." },
];

/** The columns the type-to-field matrix turns on or off, by its property name. */
const CONDITIONAL: { prop: string; column: Column }[] = [
  { prop: "subProject", column: { header: "SubProject", set: "SUBPROJECTS", width: 14 } },
  { prop: "originator", column: { header: "Supplier", set: "SUPPLIER_CODES", width: 14 } },
  { prop: "po", column: { header: "PO", set: "PURCHASE_ORDERS", width: 14 } },
  { prop: "receivedDate", column: { header: "ReceivedDate", width: 16, note: "YYYY-MM-DD" } },
];

const HEADER_FILL = "FF102A43";
const REQUIRED_FILL = "FFFDF3D7";

/** Excel refuses a sheet name carrying any of these. */
const sheetName = (label: string) => label.replace(/[*?:\\/\[\]]/g, " ").replace(/\s{2,}/g, " ").slice(0, 31);

export async function buildDeliverableWorkbook(t: Tenant): Promise<Buffer> {
  // The backend gives each list in its published order.
  const value = (key: string) => getActiveSet(key);

  const [deliverableTypes, fieldMatrix, project] = await Promise.all([
    value("DELIVERABLE_TYPES"),
    value("DELIVERABLE_TYPE_FIELDS"),
    getMe().then((me) => me?.projects.find((one) => one.id === t.projectId) ?? null),
  ]);
  const rules = new Map(fieldMatrix.map((row) => [row.code, row.props] as const));

  // Every list any column might draw from, fetched once.
  const needed = [...new Set([...ALWAYS, ...CONDITIONAL.map((c) => c.column)].map((c) => c.set).filter(Boolean))] as string[];
  const lists = new Map<string, { code: string; label: string }[]>();
  for (const key of needed) lists.set(key, await value(key));

  const book = new ExcelJS.Workbook();
  book.creator = "DELIOS";
  book.created = new Date();

  // The hidden sheet the dropdowns point at: one list per column, so a list of
  // two hundred values costs a reference rather than a 255-character string.
  const source = book.addWorksheet("Lists", { state: "veryHidden" });
  const rangeOf = new Map<string, string>();
  needed.forEach((key, index) => {
    const column = index + 1;
    const values = lists.get(key) ?? [];
    source.getCell(1, column).value = key;
    values.forEach((one, row) => { source.getCell(row + 2, column).value = one.code; });
    const letter = source.getColumn(column).letter;
    if (values.length) rangeOf.set(key, `Lists!$${letter}$2:$${letter}$${values.length + 1}`);
  });

  for (const type of deliverableTypes) {
    const props = rules.get(type.code) ?? {};
    const columns = [
      ...ALWAYS,
      ...CONDITIONAL.filter(({ prop }) => (props[prop] ?? "na") !== "na").map(({ column, prop }) => ({
        ...column,
        required: props[prop] === "required",
      })),
    ] as (Column & { required?: boolean })[];

    const sheet = book.addWorksheet(sheetName(`${type.code} — ${type.label}`), {
      views: [{ state: "frozen", ySplit: 2 }],
    });

    // One line saying what the sheet is, because a tab name is not an instruction.
    sheet.mergeCells(1, 1, 1, columns.length);
    const caption = sheet.getCell(1, 1);
    caption.value = `${type.label} — ${project?.code ?? ""} ${project?.name ?? ""}. One row per document. Leave Document Number empty to register it; fill it to correct that document. Shaded headings are required.`;
    caption.font = { size: 9, italic: true, color: { argb: "FF5B7183" } };
    caption.alignment = { vertical: "middle" };
    sheet.getRow(1).height = 26;

    columns.forEach((column, index) => {
      const at = index + 1;
      const cell = sheet.getCell(2, at);
      cell.value = column.header;
      cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: column.required ? REQUIRED_FILL : HEADER_FILL } };
      if (column.required) cell.font = { bold: true, size: 10, color: { argb: "FF6B4B00" } };
      cell.alignment = { vertical: "middle" };
      if (column.note) cell.note = column.note;
      sheet.getColumn(at).width = column.width;

      // The dropdown, on enough rows that nobody runs out filling a register.
      const range = column.set ? rangeOf.get(column.set) : undefined;
      if (!range) return;
      for (let row = 3; row <= 1000; row++) {
        sheet.getCell(row, at).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [range],
          showErrorMessage: true,
          errorStyle: "warning",
          errorTitle: "Not on the published list",
          error: `Choose a value from ${column.set}. Anything else is refused when the file is read.`,
        };
      }
    });

    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: columns.length } };
  }

  return Buffer.from(await book.xlsx.writeBuffer());
}
