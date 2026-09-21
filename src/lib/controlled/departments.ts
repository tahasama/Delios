import { register, headerIndex, cell, diffByKey, type Handler, type ParseIssue, type ParseResult } from "./registry";
import { departmentsOf } from "../schedule";

/**
 * Which departments each scheduled activity concerns. Once the schedule is in,
 * the project manager downloads this list pre-filled with every activity, fills
 * the Departments column, uploads it and approves it himself. Only then can
 * Document Control ask those departments for the documents they need.
 *
 * The file is authoritative for the activities it lists; activities left out
 * keep what they have.
 */
type DepartmentRow = { actionCode: string; departments: string[] };

const COLUMNS = ["Action Code", "Activity Name", "Activity Date", "Departments"];

export function splitDepartments(raw: string): string[] {
  return [...new Set(raw.toUpperCase().split(/[\s,;|/]+/).map((s) => s.trim()).filter(Boolean))].sort();
}

const departments: Handler = {
  kind: "ACTION_DEPARTMENTS",
  title: "Departments per activity",
  blurb:
    "Which departments each activity concerns — the project manager's list. Download it pre-filled with every activity, fill Departments with discipline codes (EL, ME…, several separated by commas), upload and approve it. Activity Name and Activity Date are there to read; they are not changed from here.",
  clause: "§14.1",
  level: "PROJECT",
  columns: COLUMNS,
  sample: ["A00001", "Pump house — MCC energisation", "2026-10-20", "EL, ME"],
  approverHint: "the project manager who uploads it",
  ownerApproves: true,
  ownerVerb: "PLAN",

  async parse(t, rows): Promise<ParseResult> {
    const { index, missing } = headerIndex(rows, ["Action Code", "Departments"]);
    if (missing.length) return { ok: false, issues: [{ line: 1, message: `Missing column(s): ${missing.join(", ")}. Download the list and keep its header row.` }] };

    const [actions, disciplines, entries] = await Promise.all([
      t.db.action.findMany({ select: { code: true } }),
      t.db.configValue.findMany({ where: { setKey: "DISCIPLINES", status: "ACTIVE" }, select: { code: true } }),
      t.db.baselineEntry.findMany({ select: { department: true, action: { select: { code: true } } } }),
    ]);
    const codes = new Set(actions.map((a) => a.code));
    const known = new Set(disciplines.map((d) => d.code));

    const issues: ParseIssue[] = [];
    const parsed: DepartmentRow[] = [];
    const seen = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.every((c) => !c.trim())) continue;
      const line = i + 1;
      const actionCode = cell(row, index, "Action Code").toUpperCase();
      const depts = splitDepartments(cell(row, index, "Departments"));
      const errors: string[] = [];
      if (!actionCode) errors.push("Action Code is missing");
      else if (!codes.has(actionCode)) errors.push(`${actionCode} is not in the schedule`);
      if (seen.has(actionCode)) errors.push(`${actionCode} is listed twice`);
      seen.add(actionCode);
      // Obligatory: an activity nobody is concerned by cannot be prepared for.
      if (!depts.length) errors.push("Every activity needs at least one department");
      const unknown = depts.filter((d) => !known.has(d));
      if (unknown.length) errors.push(`Not a department code: ${unknown.join(", ")}`);
      // A department with documents still listed cannot be dropped silently.
      const listed = [...new Set(entries.filter((e) => e.action.code === actionCode && e.department && !depts.includes(e.department)).map((e) => e.department!))];
      if (listed.length) errors.push(`${listed.join(", ")} still ${listed.length === 1 ? "has" : "have"} documents listed for ${actionCode} — take them off the requirements list first`);
      if (errors.length) issues.push({ line, message: errors.join("; ") });
      else parsed.push({ actionCode, departments: depts });
    }
    if (issues.length) return { ok: false, issues };
    if (!parsed.length) return { ok: false, issues: [{ line: 0, message: "The list contains no activities." }] };
    return { ok: true, payload: parsed, rowCount: parsed.length };
  },

  async current(t) {
    const actions = await t.db.action.findMany({ orderBy: [{ scheduledDate: "asc" }, { code: "asc" }] });
    return actions.map((a): DepartmentRow => ({ actionCode: a.code, departments: departmentsOf(a) }));
  },

  async exportRows(t) {
    const actions = await t.db.action.findMany({ orderBy: [{ scheduledDate: "asc" }, { code: "asc" }] });
    return actions.map((a) => [a.code, a.name, a.scheduledDate?.toISOString().slice(0, 10) ?? "", departmentsOf(a).join(", ")]);
  },

  diff(current, next) {
    // Only the activities the file lists are compared; the others keep theirs.
    const listed = new Set((next as DepartmentRow[]).map((r) => r.actionCode));
    return diffByKey(
      (current as DepartmentRow[]).filter((r) => listed.has(r.actionCode)),
      next as DepartmentRow[],
      (r) => r.actionCode,
      (r) => (r.departments.length ? r.departments.join(", ") : "no departments"),
    );
  },

  async apply(t, payload) {
    const rows = payload as DepartmentRow[];
    let changed = 0;
    for (const row of rows) {
      const action = await t.db.action.findFirst({ where: { code: row.actionCode } });
      if (!action) continue;
      const next = row.departments.join(",");
      if ((action.departments ?? "") !== next) {
        await t.db.action.update({ where: { id: action.id }, data: { departments: next } });
        changed++;
      }
    }
    return { summary: `${rows.length} activit${rows.length === 1 ? "y" : "ies"} tagged, ${changed} changed.` };
  },
};

register(departments);
export { departments };
