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

const COLUMNS = ["Action Code", "Activity Code", "Activity Name", "Activity Description", "Date", "Departments"];

/** What the same columns used to be called, so an older file still uploads. */
const ALIASES = { Date: ["Activity Date"], "Activity Code": ["Activity ID"] };

export function splitDepartments(raw: string): string[] {
  return [...new Set(raw.toUpperCase().split(/[\s,;|/]+/).map((s) => s.trim()).filter(Boolean))].sort();
}

const departments: Handler = {
  kind: "ACTION_DEPARTMENTS",
  title: "Departments per action",
  blurb:
    "Which departments each action concerns — the project manager's list. Download it pre-filled with every action, fill the Departments column, upload it and approve it. Departments: discipline codes, and where an action concerns several, separate them with a comma — EL, ME. Everything else on the row comes from the schedule and is there to read; it is not changed from here.",
  clause: "§14.1",
  level: "PROJECT",
  columns: COLUMNS,
  sample: ["A00001", "1010", "Pump house — MCC energisation", "MCC-2 and its feeders", "2026-10-20", "EL, ME"],
  approverHint: "the project manager who uploads it",
  ownerApproves: true,
  ownerVerb: "PLAN",

  async parse(): Promise<ParseResult> {
    // Uploading a list for a decision is not in the backend yet.
    return { ok: false, issues: [{ line: 1, message: "Uploading this list for a decision is not supported yet." }] };
  },

  async current() {
    return [];
  },

  async exportRows() {
    return [];
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

  async apply(): Promise<{ summary: string }> {
    throw new Error("Applying this list is not supported yet.");
  },
};

register(departments);
export { departments };
