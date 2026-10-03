import type { Tenant } from "./tenant";
import { parseCsv } from "./csv";
import { buildSheet, codeFor, EMPTY_CELL, MATRIX_CODES } from "./matrix-sheet";
import { loadActor, verbsFor, type Verb } from "./permissions";

/**
 * Reading a filled-in distribution matrix back.
 *
 * The file somebody edits carries one letter per cell; a rule carries a set of
 * verbs. So a letter has to mean a fixed set, or the same file would read back
 * differently depending on who wrote it. That mapping is here, once, and the
 * legend in the downloaded file quotes it.
 *
 * Nothing is written until the change list has been looked at: the importer runs
 * dry by default, exactly like the other bulk imports.
 */
export const CELL_VERBS: Record<string, Verb[]> = {
  A: ["READ", "REVIEW", "APPROVE", "RECEIVE"],
  R: ["READ", "REVIEW", "RECEIVE"],
  C: ["READ", "CONTROL", "TRANSMIT", "RECEIVE"],
  T: ["READ", "TRANSMIT", "RECEIVE"],
  I: ["READ", "RECEIVE"],
  "·": ["READ"],
};

/** Every letter a cell may carry, including the empty one. */
export const CELL_LETTERS = [...Object.keys(CELL_VERBS), EMPTY_CELL];

export type CellChange = {
  /** The line in the file, for the report. */
  line: number;
  functionCode: string;
  functionName: string;
  deliverableType: string | null;
  docType: string | null;
  discipline: string | null;
  /** The family the row answers for, where the matrix is cut that fine. */
  family: string | null;
  /** What the row says the class is, in words. */
  label: string;
  from: string;
  to: string;
};

export type ReadResult = {
  /** Cells whose letter differs from what the matrix says today. */
  changes: CellChange[];
  /** Lines that could not be read, with the reason. */
  problems: { line: number; message: string }[];
  /** How many cells were read and already agreed. */
  unchanged: number;
};

/** The class a row is about, as the rule selectors state it. */
function scopeOf(change: Pick<CellChange, "deliverableType" | "docType" | "discipline" | "family">) {
  return {
    deliverableType: change.deliverableType,
    docType: change.docType,
    discipline: change.discipline,
    family: change.family,
  };
}

/**
 * Compare a filled-in file against the matrix as it stands.
 *
 * Columns are matched by function code, not by position or name, so a reordered
 * or renamed column does not silently move a grant to the wrong function.
 */
export async function readSheet(t: Tenant, text: string): Promise<ReadResult> {
  // The comment lines are dropped but their line numbers are not: a report that
  // says "line 40" has to mean line 40 of the file the person is looking at.
  const kept = parseCsv(text)
    .map((row, index) => ({ row, line: index + 1 }))
    .filter((one) => !(one.row[0] ?? "").trimStart().startsWith("#"));
  const problems: { line: number; message: string }[] = [];
  if (!kept.length) return { changes: [], problems: [{ line: 0, message: "The file has no rows." }], unchanged: 0 };

  const headerLine = kept[0].line;
  const header = kept[0].row.map((cell) => cell.trim());
  if (header[0].toLowerCase() !== "deliverable type") {
    return {
      changes: [], unchanged: 0,
      problems: [{ line: headerLine, message: "The header row is missing. Download the matrix again and keep its header row." }],
    };
  }

  const sheet = await buildSheet(t, { allDisciplines: true });
  const known = new Map(sheet.columns.map((column) => [column.code, column] as const));
  const functions = await t.db.function.findMany({ where: { active: true }, select: { id: true, code: true, name: true } });
  const idOf = new Map(functions.map((f) => [f.code, f.id] as const));

  // Where each function sits in this file. Five leading columns describe the row.
  const columns: { index: number; code: string; name: string }[] = [];
  for (let i = 5; i < header.length; i++) {
    const code = header[i];
    if (!code) continue;
    const column = known.get(code);
    if (!column) {
      problems.push({ line: headerLine, message: `Column "${code}" is not a function in this organization — it was ignored.` });
      continue;
    }
    columns.push({ index: i, code, name: column.name });
  }
  if (!columns.length) {
    problems.push({ line: headerLine, message: "No column in the file names a function this organization publishes." });
    return { changes: [], problems, unchanged: 0 };
  }

  // What the matrix says today, one letter per function per class.
  const actors = new Map(await Promise.all(
    functions.map(async (f) => [f.code, await loadActor(t, f.id)] as const),
  ));
  const letterNow = (code: string, scope: { deliverableType: string | null; docType: string | null; discipline: string | null; family: string | null }) =>
    codeFor(verbsFor(actors.get(code) ?? null, { ...scope, confidentiality: "INTERNAL" }))?.letter ?? EMPTY_CELL;

  const changes: CellChange[] = [];
  let unchanged = 0;

  for (let r = 1; r < kept.length; r++) {
    const { row, line } = kept[r];
    const deliverableType = (row[0] ?? "").trim() || null;
    const docType = (row[1] ?? "").trim() || null;
    const discipline = (row[2] ?? "").trim() || null;
    const family = (row[3] ?? "").trim() || null;
    const label = (row[4] ?? "").trim();
    if (!deliverableType && !docType && !discipline && !family) {
      problems.push({ line, message: "The row says nothing about which documents it is for — it was skipped." });
      continue;
    }
    for (const column of columns) {
      const to = (row[column.index] ?? "").trim();
      if (!to) continue; // an empty cell says nothing; only a letter decides
      if (!CELL_LETTERS.includes(to)) {
        problems.push({ line, message: `${column.code}: "${to}" is not one of ${CELL_LETTERS.join(" ")}.` });
        continue;
      }
      const from = letterNow(column.code, { deliverableType, docType, discipline, family });
      if (from === to) { unchanged++; continue; }
      if (!idOf.has(column.code)) continue;
      changes.push({ line, functionCode: column.code, functionName: column.name, deliverableType, docType, discipline, family, label, from, to });
    }
  }

  return { changes, problems, unchanged };
}

export type ApplyReport = { line: number; ok: boolean; message: string; wrote: boolean };

/**
 * Write the changes.
 *
 * A letter writes one rule scoped to exactly the row's class, on projects of
 * this project's contract role. Taking a grant away is the one thing a cell
 * cannot always do: the matrix has no deny rule, so where the grant comes from a
 * broader row the change is refused and says where to go instead. That is honest
 * — and it is the same reason a blanket rule swamps a role's starting matrix.
 */
export async function applyChanges(t: Tenant, changes: CellChange[]): Promise<ApplyReport[]> {
  const project = await t.db.project.findFirst({ where: { id: t.projectId }, select: { role: true } });
  const projectRole = project?.role && project.role !== "GENERIC" ? project.role : null;
  const functions = await t.db.function.findMany({ where: { active: true }, select: { id: true, code: true } });
  const idOf = new Map(functions.map((f) => [f.code, f.id] as const));
  const out: ApplyReport[] = [];

  for (const change of changes) {
    const functionId = idOf.get(change.functionCode);
    if (!functionId) {
      out.push({ line: change.line, ok: false, wrote: false, message: `${change.functionCode} is no longer a published function.` });
      continue;
    }
    const where = { functionId, projectRole, ...scopeOf(change), criticality: null, confidentiality: null };
    const exact = await t.db.permissionRule.findFirst({ where });

    if (change.to === EMPTY_CELL) {
      if (!exact) {
        out.push({
          line: change.line, ok: false, wrote: false,
          message: `${change.functionCode} keeps "${change.from}" on ${change.label || "this class"}: the grant comes from a broader rule, not from this row. Narrow that rule in People & access → Functions.`,
        });
        continue;
      }
      await t.db.permissionRule.delete({ where: { id: exact.id } });
      out.push({ line: change.line, ok: true, wrote: true, message: `${change.functionCode}: ${change.from} removed from ${change.label || "this class"}.` });
      continue;
    }

    const verbs = CELL_VERBS[change.to];
    if (exact) {
      // The note moves with the change: a row that came from a starting matrix
      // and was then changed by hand must not still claim to be the former.
      await t.db.permissionRule.update({
        where: { id: exact.id },
        data: { verbs: JSON.stringify(verbs), note: "Read from a filled-in distribution matrix." },
      });
    } else {
      await t.db.permissionRule.create({
        data: {
          orgId: t.orgId,
          functionId,
          projectRole,
          ...scopeOf(change),
          verbs: JSON.stringify(verbs),
          note: "Read from a filled-in distribution matrix.",
          sort: 200,
        },
      });
    }
    out.push({
      line: change.line, ok: true, wrote: true,
      message: `${change.functionCode}: ${change.from} becomes ${change.to} on ${change.label || "this class"}.`,
    });
  }

  return out;
}

/** The letter-to-verbs convention, for the legend and the import screen. */
export function cellLegend(): string {
  return MATRIX_CODES.map((code) => `${code.letter} ${code.label.toLowerCase()}`).join(" · ");
}
