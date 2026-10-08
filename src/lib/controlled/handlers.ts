import { nextActionCode, redateRequirements } from "../schedule";
import { VERBS, type Verb } from "../permissions";
import {
  register,
  headerIndex,
  cell,
  parseDate,
  diffByKey,
  type Handler,
  type ParseIssue,
  type ParseResult,
} from "./registry";

// ── Distribution matrix (§11.8, §1.4) ────────────────────────────────────────
// Requirement: the matrix per function is updatable by upload and approval.
// One row per rule: a function, the classification it applies to, and the verbs
// it grants. This is the same table that decides approval authority, so a
// change here is a change to who may act as well as who receives.

type MatrixRow = {
  functionCode: string;
  deliverableType: string | null;
  docType: string | null;
  discipline: string | null;
  criticality: string | null;
  confidentiality: string | null;
  verbs: Verb[];
  note: string | null;
};

const MATRIX_COLUMNS = [
  "Function",
  "Deliverable type",
  "Document type",
  "Discipline",
  "Criticality",
  "Confidentiality",
  "Verbs",
  "Note",
];

function ruleKey(r: MatrixRow): string {
  const selector = [r.deliverableType, r.docType, r.discipline, r.criticality, r.confidentiality]
    .map((v) => v ?? "*")
    .join("/");
  return `${r.functionCode} · ${selector}`;
}

const distributionMatrix: Handler = {
  kind: "DISTRIBUTION_MATRIX",
  title: "Distribution & permission matrix",
  blurb:
    "Who may act on which information, and who receives it when it is issued. One row per function per classification.",
  clause: "§11.8 · §1.4",
  level: "ORG",
  columns: MATRIX_COLUMNS,
  // A matrix upload replaces the whole matrix, so the blank template has to be
  // a complete, valid one — not a single example row that the lockout guard
  // then rejects. Start from "In force" for a real change.
  sample: ["ADMIN", "", "", "", "", "", "READ|CREATE|REVISE|REVIEW|APPROVE|TRANSMIT|RECEIVE|ACCEPT|CONTROL|CONFIGURE", "Keeps someone able to configure"],
  extraSamples: [
    ["CONTROLLER", "", "", "", "", "", "READ|CREATE|REVISE|TRANSMIT|RECEIVE|ACCEPT|CONTROL", "The control function"],
    ["VIEWER", "", "DWG", "EL", "", "", "READ|RECEIVE", "Example of narrowing a function to one discipline and type"],
  ],
  approverHint: "Administrator",

  async parse(): Promise<ParseResult> {
    // Uploading a list for a decision is not in the backend yet.
    return { ok: false, issues: [{ line: 1, message: "Uploading this list for a decision is not supported yet." }] };
  },

  async current() {
    return [];
  },

  diff(current, next) {
    return diffByKey(current as MatrixRow[], next as MatrixRow[], ruleKey, (r) => r.verbs.join(", "));
  },

  async apply(): Promise<{ summary: string }> {
    throw new Error("Applying this list is not supported yet.");
  },
};

// ── Schedule (§14.2, §14.6) ──────────────────────────────────────────────────
// "Where an action date changes, the change shall be issued formally by the
// party responsible for the schedule." Before this, a schedule import could be
// published by whoever uploaded it. Now it is a version that someone else
// approves, and approving it moves the live action dates.

type ActivityRow = {
  externalId: string;
  /** The code the system issued, or empty — it then assigns A00001, A00002… */
  actionCode: string;
  name: string;
  description: string | null;
  date: string | null;
  responsibleParty: string | null;
};

/**
 * What a schedule has to say: which activity, what it is, and when it happens.
 * Nothing about the planning tool: every tool exports these four things.
 */
const SCHEDULE_COLUMNS = [
  "Activity Code",
  "Action Code",
  "Activity Name",
  "Activity Description",
  "Date",
  "Responsible Party",
];

/** What the same columns used to be called, so an older file still uploads. */
const SCHEDULE_ALIASES = {
  "Activity Code": ["Activity ID"],
  Date: ["Forecast Date", "Baseline Date", "Activity Date"],
};

const schedule: Handler = {
  kind: "SCHEDULE",
  title: "Project schedule",
  blurb:
    "The activities the project must be ready for. Activity Code: your own code from whatever tool you plan in. Action Code: leave it empty for a new activity — the system assigns the next code (A00001, A00002…) and keeps it for that activity; after approval, download what is in force and put the codes back into your programme. Activity Description is optional. Date is the day the activity happens, as YYYY-MM-DD. Departments are not given here — the project manager tags them in the departments list. A new version moves the activity dates, and every needed-by date follows.",
  clause: "§14.2 · §14.6",
  level: "PROJECT",
  columns: SCHEDULE_COLUMNS,
  sample: ["1010", "", "Foundation concrete pour — clarifier", "Clarifier TK-201, area 71", "2026-09-21", "Civil contractor"],
  approverHint: "Document Control",

  async parse(): Promise<ParseResult> {
    // Uploading a list for a decision is not in the backend yet.
    return { ok: false, issues: [{ line: 1, message: "Uploading this list for a decision is not supported yet." }] };
  },

  async current() {
    return [];
  },

  diff(current, next) {
    // Activities are matched by the scheduler's Activity ID: a new version
    // without codes still lines up with the actions it already produced.
    return diffByKey(
      current as ActivityRow[],
      next as ActivityRow[],
      (a) => a.externalId,
      (a) => `${a.name} · ${a.date ?? "no date"}`,
    );
  },

  async apply(): Promise<{ summary: string }> {
    throw new Error("Applying this list is not supported yet.");
  },
};

// ── Value set (§4.7) ─────────────────────────────────────────────────────────
// "In-use values are retired, never deleted." The upload therefore cannot
// remove a value; it adds, relabels and retires.

type ValueRow = { code: string; label: string; status: string; sort: number; props: string | null };

const VALUE_COLUMNS = ["Code", "Label", "Status", "Sort", "Properties"];

const valueSet: Handler = {
  kind: "VALUE_SET",
  title: "Value set",
  blurb: "A published list of permitted values — disciplines, document types, statuses. New values are added; values in use are retired, never deleted.",
  clause: "§4.7",
  level: "ORG",
  columns: VALUE_COLUMNS,
  sample: ["EL", "Electrical", "ACTIVE", "1", ""],
  approverHint: "Administrator",
  direct: true,

  async parse(): Promise<ParseResult> {
    // Uploading a list for a decision is not in the backend yet.
    return { ok: false, issues: [{ line: 1, message: "Uploading this list for a decision is not supported yet." }] };
  },

  async current() {
    return [];
  },

  diff(current, next) {
    const lines = diffByKey(
      current as ValueRow[],
      next as ValueRow[],
      (v) => v.code,
      (v) => `${v.label}${v.status === "RETIRED" ? " (retired)" : ""}`,
    );
    // §4.7 — a value left out of the upload is not deleted, it is retired.
    return lines.map((l) =>
      l.change === "REMOVED"
 ? {...l, change: "CHANGED" as const, detail: `${l.detail} → retired` }
        : l,
    );
  },

  async apply(): Promise<{ summary: string }> {
    throw new Error("Applying this list is not supported yet.");
  },
};

register(distributionMatrix);
register(schedule);
register(valueSet);

export { distributionMatrix, schedule, valueSet };

// Registered alongside the others so every entry point that loads handlers sees it.
import "./departments";
import "./requirements";
