import ExcelJS from "exceljs";
import type { Tenant } from "./tenant";
import { propFieldsFor, type PropField } from "./set-props";
import { getSet, getSets } from "./config";

/**
 * Every published list, as one workbook with a tab each.
 *
 * The same bargain as the deliverable list: one download, edit whichever tabs
 * you care about, one upload. A tab is named for its set key, so a renamed
 * title never changes what the file means when it comes back.
 *
 * What it does not do is retire. A workbook where somebody edited one tab must
 * not quietly retire everything missing from the other twenty, so a row absent
 * from the file is a row nobody mentioned — left exactly as it is. Retiring
 * stays a deliberate act on the list's own page.
 */

const HEADER_FILL = "FF102A43";
const KEY_FILL = "FFFDF3D7";
const STATUS = ["ACTIVE", "RETIRED"];

/**
 * The columns a set's properties add, after Code, Label and Status.
 *
 * A choice property is one question whose answer sets several stored values —
 * a verdict's effect sets both proceed and resubmit. It gets a column like any
 * other, holding the answer, because leaving it out once meant uploading a
 * workbook silently erased what every verdict does.
 */
function propColumns(setKey: string): PropField[] {
  return propFieldsFor(setKey) ?? [];
}

/** What goes in a property cell, as text a person can edit. */
function propText(field: PropField, props: Record<string, unknown>): string {
  if (field.type === "choice") return field.read(props);
  const value = props[field.key];
  if (value === undefined || value === null) return "";
  if (field.type === "bool") return value ? "yes" : "no";
  return String(value);
}

export async function buildSetsWorkbook(_t: Tenant): Promise<Buffer> {
  // Each list in its published order, as the backend gives it.
  const sets = [...(await getSets())].sort((a, b) => a.title.localeCompare(b.title));
  const bySet = new Map(await Promise.all(sets.map(async (set) => [set.key, await getSet(set.key)] as const)));

  const book = new ExcelJS.Workbook();
  book.creator = "DELIOS";
  book.created = new Date();

  // One hidden column of yes/no and one of the two statuses, so those cells are
  // chosen rather than typed.
  const source = book.addWorksheet("Lists", { state: "veryHidden" });
  STATUS.forEach((one, row) => { source.getCell(row + 1, 1).value = one; });
  ["yes", "no"].forEach((one, row) => { source.getCell(row + 1, 2).value = one; });
  const STATUS_RANGE = "Lists!$A$1:$A$2";
  const YES_NO_RANGE = "Lists!$B$1:$B$2";

  // The front page: twenty-six tabs is a lot to scroll through, so the file
  // opens on a list of them and every tab can get back here in one click.
  const index = book.addWorksheet("Start here", { views: [{ state: "frozen", ySplit: 3 }] });
  index.getColumn(1).width = 34;
  index.getColumn(2).width = 58;
  index.getColumn(3).width = 12;
  index.mergeCells(1, 1, 1, 3);
  const title = index.getCell(1, 1);
  title.value = "Published lists — edit whichever tabs you need, then upload this file back";
  title.font = { bold: true, size: 13, color: { argb: "FF102A43" } };
  index.getRow(1).height = 24;
  index.mergeCells(2, 1, 2, 3);
  const how = index.getCell(2, 1);
  how.value = "A code that already exists is updated. A code that does not is published. A row you delete here is left alone — retiring is done on the list's own page in DELIOS.";
  how.font = { size: 9, italic: true, color: { argb: "FF5B7183" } };
  ["List", "What it is for", "Values"].forEach((header, column) => {
    const cell = index.getCell(3, column + 1);
    cell.value = header;
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  });

  for (const set of sets) {
    const props = propColumns(set.key);
    const rows = bySet.get(set.key) ?? [];
    // The key is the tab name: a title people reword must not change what the
    // file means when it is read back.
    const sheet = book.addWorksheet(set.key.slice(0, 31), { views: [{ state: "frozen", ySplit: 2 }] });
    const headers = ["Code", "Label", "Status", ...props.map((one) => one.key)];

    // The way back, first thing on the row, so it is in the same place on
    // every tab.
    const back = sheet.getCell(1, 1);
    back.value = { text: "← All lists", hyperlink: "#'Start here'!A1" };
    back.font = { size: 9, bold: true, color: { argb: "FF1D6FA3" }, underline: true };
    sheet.mergeCells(1, 2, 1, Math.max(2, headers.length));
    const caption = sheet.getCell(1, 2);
    caption.value = `${set.title}${set.description ? ` — ${set.description}` : ""}  ·  Change a label or a property and it is updated. Add a row and it is published. A row you delete here is left alone — retire it on the list's own page.`;
    caption.font = { size: 9, italic: true, color: { argb: "FF5B7183" } };
    sheet.getRow(1).height = 26;

    headers.forEach((header, index) => {
      const at = index + 1;
      const cell = sheet.getCell(2, at);
      cell.value = header;
      const isKey = header === "Code";
      cell.font = { bold: true, size: 10, color: { argb: isKey ? "FF6B4B00" : "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isKey ? KEY_FILL : HEADER_FILL } };
      sheet.getColumn(at).width = header === "Label" ? 46 : header === "Code" ? 20 : 18;
      const field = props[index - 3];
      if (field?.hint) cell.note = field.hint;
    });
    sheet.getCell(2, 1).note = "What the code is. Changing a code here publishes a new value — it never renames one documents already carry.";

    rows.forEach((row, index) => {
      const at = index + 3;
      const parsed = row.props;
      sheet.getCell(at, 1).value = row.code;
      sheet.getCell(at, 2).value = row.label;
      sheet.getCell(at, 3).value = row.status;
      props.forEach((field, column) => {
        sheet.getCell(at, column + 4).value = propText(field, parsed);
      });
    });

    // Enough empty rows below to add to the list without leaving the sheet.
    const last = rows.length + 2 + 200;
    for (let row = 3; row <= last; row++) {
      sheet.getCell(row, 3).dataValidation = { type: "list", allowBlank: true, formulae: [STATUS_RANGE] };
      props.forEach((field, column) => {
        if (field.type === "bool") {
          sheet.getCell(row, column + 4).dataValidation = { type: "list", allowBlank: true, formulae: [YES_NO_RANGE] };
        } else if (field.type === "choice") {
          const options = `"${field.options.map((one) => one.value).join(",")}"`;
          if (options.length <= 255) {
            sheet.getCell(row, column + 4).dataValidation = { type: "list", allowBlank: true, formulae: [options] };
          }
        } else if (field.type === "select") {
          const options = `"${field.options.join(",")}"`;
          // A select's options are few and fixed, so they ride inline.
          if (options.length <= 255) {
            sheet.getCell(row, column + 4).dataValidation = { type: "list", allowBlank: true, formulae: [options] };
          }
        }
      });
    }

    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: headers.length } };

    const at = index.rowCount + 1;
    const link = index.getCell(at, 1);
    link.value = { text: set.title, hyperlink: `#'${sheet.name}'!A2` };
    link.font = { size: 10, bold: true, color: { argb: "FF1D6FA3" }, underline: true };
    index.getCell(at, 2).value = set.description ?? "";
    index.getCell(at, 2).font = { size: 9, color: { argb: "FF5B7183" } };
    index.getCell(at, 3).value = rows.length;
    index.getCell(at, 3).alignment = { horizontal: "right" };
  }

  // Opening on the front page rather than whichever tab was written last. The
  // hidden sheet is first in the book, so the index is not at zero.
  const front = book.worksheets.findIndex((one) => one.name === index.name);
  book.views = [{ activeTab: Math.max(front, 0), x: 0, y: 0, width: 20000, height: 20000, firstSheet: 0, visibility: "visible" }];

  return Buffer.from(await book.xlsx.writeBuffer());
}
