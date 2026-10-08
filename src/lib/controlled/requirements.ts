import { register, headerIndex, cell, parseDate, diffByKey, type Handler, type ParseIssue, type ParseResult } from "./registry";
import { allocateNumber } from "../numbering";
import { daysBefore, DEFAULT_LEAD_DAYS, departmentsOf } from "../schedule";
import { retentionFor } from "../retention";

/**
 * The document requirements list — what each department needs for each
 * scheduled activity, who delivers it, who approves it and by when. It is an
 * approved list: department representatives prepare it, it is uploaded,
 * compared and approved like any controlled change. Once approved it is the
 * baseline the providers work to: a supplier sees its documents and their
 * needed-by dates in its package.
 *
 * For every (action, department) the file mentions, the file is the whole
 * truth: documents no longer listed there stop being required.
 */
type RequirementRow = {
  actionCode: string;
  department: string;
  /** The discipline of the document itself, which need not be the department's. */
  discipline: string | null;
  docNumber: string | null;   // existing document, or null to create a placeholder
  title: string | null;
  docType: string | null;
  submittedBy: string | null; // supplier code, or null = our organization
  approvedBy: string;         // function code
  requiredStatus: string;
  neededBy: string | null;    // a fixed date; empty = rule (5 business days before)
  projectCode: string | null; // only for a new placeholder's number
  subProject: string | null;
  po: string | null;
  /** The equipment tag or material the document is about. */
  assetCode: string | null;
};

/**
 * The sheet a department fills in: its own name, the action, what the action is,
 * and then one line per document it needs. The action's name, description and
 * date are there to read — they come from the schedule.
 *
 * The first ten columns are the whole job. The four after them are only needed
 * for a document that does not exist yet, to build its number.
 */
const COLUMNS = [
  "Department",
  "Action Code",
  "Activity Name",
  "Activity Description",
  "Date",
  "Document",
  "Discipline",
  "Type",
  "Supplier",
  "Date of delivery",
  "Required Status",
  "Approved By",
  "Equipment or material",
  "Project Code",
  "Sub-project",
  "PO",
];

/** What the same columns used to be called, so an older file still uploads. */
const ALIASES: Record<string, string[]> = {
  Department: ["Departments"],
  "Action Code": ["Activity Code", "Activity ID"],
  Document: ["Document Number", "Documents", "Title"],
  Type: ["Document Type"],
  Supplier: ["Submitted By"],
  "Date of delivery": ["Needed By"],
  Date: ["Activity Date"],
};

/** How many empty document lines a pre-filled sheet leaves under each action. */
const BLANK_LINES = 5;

const OURS = ["", "OURS", "US", "INTERNAL", "INTERNAL ENGINEERING", "OUR ENGINEERING", "ENG"];

const requirements: Handler = {
  kind: "DOCUMENT_REQUIREMENTS",
  title: "Document requirements",
  blurb:
    "What each department needs for each action. Download it pre-filled: every action tagged with a department comes with blank lines under it, ready for the documents. Department and Action Code are only written on the first line of a group — the lines under it inherit them. Document: an existing document number, or a name for one that does not exist yet, which is created as a placeholder (then Type, Discipline, Project Code and Sub-project — plus PO for a supplier's document — build its number). Supplier: the supplier code, or leave it empty for our own engineering. Date of delivery: leave it empty for seven days before the action, or give a date.",
  clause: "§14.1 · §14.3",
  level: "PROJECT",
  columns: COLUMNS,
  sample: ["EL", "A00001", "Pump house — MCC energisation", "MCC-2 and its feeders", "2026-10-20", "P1001-50-EL-DSW-09102", "EL", "DSW", "", "", "", "", "BL-301", "", "", ""],
  approverHint: "Document Control",

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
    // A file replaces only the (action, department) pairs it mentions, so only
    // those are compared; everything else stays as it is and is not "removed".
    const covered = new Set((next as RequirementRow[]).map((r) => `${r.actionCode}|${r.department}`));
    return diffByKey(
      (current as RequirementRow[]).filter((r) => covered.has(`${r.actionCode}|${r.department}`)),
      next as RequirementRow[],
      (r) => `${r.actionCode} · ${r.docNumber ?? `new: ${r.title}`}`,
      (r) => `${r.department} · from ${r.submittedBy ?? "us"} · approved by ${r.approvedBy} · at ${r.requiredStatus} · ${r.neededBy ?? `${DEFAULT_LEAD_DAYS} days before`}`,
    );
  },

  async apply(): Promise<{ summary: string }> {
    throw new Error("Applying this list is not supported yet.");
  },
};

register(requirements);
export { requirements };
