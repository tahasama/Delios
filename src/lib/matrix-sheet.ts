import type { Tenant } from "./tenant";
import { loadActor, verbsFor, type Actor, type Verb } from "./permissions";

import { families, typesByFamily } from "./families";
import { matrixDetail } from "./control-activities";

/**
 * The distribution matrix as a sheet: one row per class of document, one column
 * per function, a code in each cell.
 *
 * It exists once, here, because three things must agree about it — the page
 * people read, the file they download and fill in, and the reader that takes
 * that file back. A second definition of the codes is a matrix that disagrees
 * with itself.
 */
export const MATRIX_CODES: { verb: Verb; letter: string; label: string; tone: string }[] = [
  { verb: "APPROVE", letter: "A", label: "Approves", tone: "bg-brand text-white" },
  { verb: "REVIEW", letter: "R", label: "Reviews", tone: "bg-[#3d6b99] text-white" },
  { verb: "CONTROL", letter: "C", label: "Controls (custody, release)", tone: "bg-violet-600 text-white" },
  { verb: "TRANSMIT", letter: "T", label: "Issues to other parties", tone: "bg-amber-500 text-white" },
  { verb: "RECEIVE", letter: "I", label: "Receives for information", tone: "bg-emerald-100 text-emerald-900" },
  { verb: "READ", letter: "·", label: "May read if they go looking", tone: "bg-slate-100 text-slate-500" },
];

/** The strongest code a function holds for a class — one letter, as a matrix does. */
export function codeFor(verbs: Verb[]): (typeof MATRIX_CODES)[number] | null {
  for (const code of MATRIX_CODES) if (verbs.includes(code.verb)) return code;
  return null;
}

/**
 * What an empty cell carries. A hyphen, not the middle dot the page uses for
 * "may read": in a spreadsheet those two are indistinguishable, and this file
 * is hand-edited.
 */
export const EMPTY_CELL = "-";

/** One line of the sheet: what the row is about, and a letter per function. */
export type SheetRow = {
  deliverableType: string;
  docType: string;
  discipline: string;
  /** The document family this row answers for, where the matrix is cut that fine. */
  family: string;
  /** What the row is, in words, for whoever reads the file. */
  label: string;
  cells: string[];
};

export type Sheet = {
  /** Function codes, in column order. */
  columns: { code: string; name: string }[];
  rows: SheetRow[];
};

/**
 * Build the sheet for this project.
 *
 * One kind of row: a discipline, in its group band. Who produced it and which
 * document type it is are views on the same grid, not extra rows — crossing
 * them made four hundred rows that nobody could read, and mixed two different
 * kinds of row in one table.
 *
 * Quality documents need no row of their own: QA is a discipline, so "we
 * approve the inspection records whoever holds the design" is the QA row.
 */
export async function buildSheet(
  t: Tenant,
  options: { allDisciplines?: boolean; deliverableType?: string | null; docType?: string | null } = {},
): Promise<Sheet> {
  // The published lists are read straight from the tenant, not through the
  // request-cached helper: this same builder has to run from a script, both to
  // be verified and to read a filled-in sheet back.
  const [functions, disciplines, rules, inRegister, published, detail] = await Promise.all([
    t.db.function.findMany({ where: { active: true }, orderBy: { sort: "asc" } }),
    t.db.configValue.findMany({
      where: { setKey: "DISCIPLINES", status: "ACTIVE" },
      orderBy: [{ sort: "asc" }, { code: "asc" }],
      select: { code: true, label: true },
    }),
    t.db.permissionRule.findMany({ select: { discipline: true, family: true } }),
    t.db.document.groupBy({ by: ["discipline", "docType"] }),
    families(t),
    matrixDetail(t),
  ]);
  const typeFamilies = await typesByFamily(t);
  const familyOfType = new Map(typeFamilies.map((one) => [one.code, one.family?.code ?? ""] as const));
  // One row per discipline, or one per discipline and document family where the
  // organization has said its contracts distribute them differently.
  const perFamily = detail === "FAMILY";

  // An organization may publish a hundred disciplines. The sheet carries the
  // ones this project actually works in — anything in the register, and anything
  // a rule names — because a wall of empty rows is not a matrix anybody fills.
  const inUse = new Set<string>(inRegister.map((row) => row.discipline));
  for (const rule of rules) if (rule.discipline) inUse.add(rule.discipline);

  // Which families a discipline actually holds. Ten families do not repeat in
  // every discipline — project management has reports and plans, and no
  // material certificates — so a discipline carries the families its documents
  // and its rules put there.
  const familiesIn = new Map<string, Set<string>>();
  const note = (discipline: string, family: string) => {
    if (!discipline || !family) return;
    familiesIn.set(discipline, (familiesIn.get(discipline) ?? new Set()).add(family));
  };
  for (const row of inRegister) note(row.discipline, familyOfType.get(row.docType) ?? "");
  for (const rule of rules) if (rule.discipline && rule.family) note(rule.discipline, rule.family);

  const actors: (Actor | null)[] = await Promise.all(functions.map((f) => loadActor(t, f.id)));
  const columns = functions.map((f) => ({ code: f.code, name: f.name }));

  // The view the sheet is taken at. A row carries it, so a file filled in for
  // vendor documents cannot be read back as though it were about ours.
  const deliverableType = options.deliverableType ?? "";
  const docType = options.docType ?? "";

  const rows: SheetRow[] = [];
  for (const discipline of disciplines) {
      if (!options.allDisciplines && !inUse.has(discipline.code)) continue;
      // A discipline carries the families it actually holds. No discipline uses
      // all ten — project management has no material certificates, civil has no
      // packing lists — so showing ten rows each is a grid nobody fills in. A
      // discipline holding nothing yet falls back to all of them, so a matrix
      // can still be agreed before the first document exists.
      const occurring = familiesIn.get(discipline.code);
      const cut = perFamily
        ? (occurring?.size ? published.filter((f) => occurring.has(f.code)) : published)
        : [null];
      for (const family of cut) {
        rows.push({
          deliverableType,
          docType,
          discipline: discipline.code,
          family: family?.code ?? "",
          label: family ? `${discipline.label} — ${family.label.toLowerCase()}` : discipline.label,
          cells: actors.map((actor) =>
            codeFor(verbsFor(actor, {
              discipline: discipline.code,
              deliverableType: deliverableType || null,
              docType: docType || null,
              family: family?.code ?? null,
              confidentiality: "INTERNAL",
            }))?.letter ?? EMPTY_CELL,
          ),
        });
      }
  }

  return { columns, rows };
}

/**
 * The sheet as rows of text, ready for CSV. The three leading columns are the
 * class; everything after them is a function, named by code so a renamed
 * function does not break a file somebody filled in last week.
 *
 * Lines beginning with "#" carry what a person needs and the reader ignores.
 */
export function sheetToRows(
  sheet: Sheet,
  about: { projectCode: string; projectName: string; roleLabel: string; generatedAt: Date },
): string[][] {
  const legend = MATRIX_CODES.map((c) => `${c.letter} = ${c.label.toLowerCase()}`).join(" | ");
  const rows: string[][] = [
    [`# Distribution matrix — ${about.projectCode} ${about.projectName}`],
    [`# Our role on this project: ${about.roleLabel}`],
    [`# Generated ${about.generatedAt.toISOString().slice(0, 16).replace("T", " ")}. Filled in, this file is the proposed next revision.`],
    [`# Codes: ${legend} | ${EMPTY_CELL} = not distributed`],
    [`# Keep the header row and the first five columns. Change the letters only.`],
    ...sheet.columns.map((c) => [`# Column ${c.code} = ${c.name}`]),
    ["Deliverable type", "Document type", "Discipline", "Family", "What the row is", ...sheet.columns.map((c) => c.code)],
  ];
  for (const row of sheet.rows) {
    rows.push([row.deliverableType, row.docType, row.discipline, row.family, row.label, ...row.cells]);
  }
  return rows;
}
