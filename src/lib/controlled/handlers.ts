import { VERBS, type Verb } from "../permissions";
import { api } from "../api/client";
import { adminFunctions } from "../api/admin";
import { legacyActions } from "../api/schedule";
import { getSet } from "../config";
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

  async parse(_t, rows): Promise<ParseResult> {
    const { index, missing } = headerIndex(rows, MATRIX_COLUMNS.slice(0, 7));
    if (missing.length) {
      return { ok: false, issues: [{ line: 1, message: `Missing column(s): ${missing.join(", ")}. Keep the template's header row.` }] };
    }
    const known = new Map((await adminFunctions()).map((f) => [f.code, f.active]));
    const issues: ParseIssue[] = [];
    const parsed: MatrixRow[] = [];
    const seen = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const line = i + 1;
      const row = rows[i];
      if (row.every((c) => !c.trim())) continue;
      const functionCode = cell(row, index, "Function").toUpperCase();
      if (!functionCode) { issues.push({ line, message: "Function is missing." }); continue; }
      if (!known.has(functionCode)) { issues.push({ line, message: `No function with code ${functionCode} is published. Publish it first, or correct the code.` }); continue; }
      if (known.get(functionCode) === false) { issues.push({ line, message: `${functionCode} is retired — a retired function cannot be granted anything.` }); continue; }
      const rawVerbs = cell(row, index, "Verbs").split(/[|,;]/).map((v) => v.trim().toUpperCase()).filter(Boolean);
      if (!rawVerbs.length) { issues.push({ line, message: "Verbs is empty. A rule that grants nothing should be left out." }); continue; }
      const bad = rawVerbs.filter((v) => !(VERBS as readonly string[]).includes(v));
      if (bad.length) { issues.push({ line, message: `Unknown verb(s): ${bad.join(", ")}. Use ${VERBS.join(", ")}.` }); continue; }
      const entry: MatrixRow = {
        functionCode,
        deliverableType: cell(row, index, "Deliverable type") || null,
        docType: cell(row, index, "Document type") || null,
        discipline: cell(row, index, "Discipline") || null,
        criticality: cell(row, index, "Criticality") || null,
        confidentiality: cell(row, index, "Confidentiality") || null,
        verbs: VERBS.filter((v) => rawVerbs.includes(v)),
        note: cell(row, index, "Note") || null,
      };
      const key = ruleKey(entry);
      if (seen.has(key)) { issues.push({ line, message: `Duplicate rule for ${key}. Combine the verbs onto one row.` }); continue; }
      seen.add(key);
      parsed.push(entry);
    }
    if (issues.length) return { ok: false, issues };
    // A matrix with nobody able to configure anything locks the organization out of its own settings.
    if (!parsed.some((r) => r.verbs.includes("CONFIGURE"))) {
      return { ok: false, issues: [{ line: 0, message: "This file replaces the whole matrix, and no row in it grants Configure — approving it would lock everyone out of settings. Add a row giving one function CONFIGURE, or start from the “In force” download and edit that." }] };
    }
    return { ok: true, payload: parsed, rowCount: parsed.length };
  },

  async current() {
    const functions = await adminFunctions();
    return functions.flatMap((f) => f.rules.map((r): MatrixRow => ({
      functionCode: f.code, deliverableType: r.deliverableType, docType: r.docType, discipline: r.discipline, criticality: r.criticality,
      confidentiality: r.confidentiality, verbs: VERBS.filter((v) => r.verbs.includes(v)), note: null,
    })));
  },

  diff(current, next) {
    return diffByKey(current as MatrixRow[], next as MatrixRow[], ruleKey, (r) => r.verbs.join(", "));
  },

  async apply(_t, payload) {
    const rows = payload as MatrixRow[];
    // The whole matrix is replaced: each function gets exactly the rules the file gives it, none where it gives none.
    for (const fn of await adminFunctions()) {
      const mine = rows.filter((r) => r.functionCode === fn.code).map((r) => ({
        verbs: r.verbs, deliverableType: r.deliverableType, docType: r.docType, discipline: r.discipline, criticality: r.criticality,
        confidentiality: r.confidentiality,
      }));
      await api(`/api/admin/functions/${fn.id}`, { method: "PUT", body: { rules: mine } });
    }
    return { summary: `${rows.length} rule(s) in force.` };
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
    // The schedule is a controlled document: its export is read when a revision of it is released.
    return { ok: false, issues: [{ line: 1, message: "The schedule is read from the schedule document: attach the export to a new revision of it and send that for review. Releasing it is the approval, and moves every activity date." }] };
  },

  async current(t) {
    return (await legacyActions(t)).map((a): ActivityRow => ({
      externalId: a.scheduleRef ?? a.code, actionCode: a.code, name: a.name, description: a.description,
      date: a.scheduledDate ? a.scheduledDate.toISOString().slice(0, 10) : null, responsibleParty: a.ownerName,
    }));
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
    throw new Error("The schedule is applied by releasing the schedule document's revision.");
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

  async parse(_t, rows): Promise<ParseResult> {
    const { index, missing } = headerIndex(rows, ["Code", "Label"]);
    if (missing.length) return { ok: false, issues: [{ line: 1, message: `Missing column(s): ${missing.join(", ")}.` }] };
    const issues: ParseIssue[] = [];
    const parsed: ValueRow[] = [];
    const seen = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const line = i + 1;
      const row = rows[i];
      if (row.every((c) => !c.trim())) continue;
      const code = cell(row, index, "Code");
      const label = cell(row, index, "Label");
      const status = (cell(row, index, "Status") || "ACTIVE").toUpperCase();
      const sortRaw = cell(row, index, "Sort");
      const props = cell(row, index, "Properties") || null;
      if (!code) { issues.push({ line, message: "Code is missing." }); continue; }
      if (!label) { issues.push({ line, message: `${code} has no label.` }); continue; }
      if (seen.has(code)) { issues.push({ line, message: `${code} appears twice.` }); continue; }
      if (status !== "ACTIVE" && status !== "RETIRED") { issues.push({ line, message: `${code}: status must be ACTIVE or RETIRED.` }); continue; }
      if (props) {
        try { JSON.parse(props); } catch { issues.push({ line, message: `${code}: Properties is not valid JSON.` }); continue; }
      }
      seen.add(code);
      parsed.push({ code, label, status, sort: sortRaw ? Number(sortRaw) : parsed.length, props });
    }
    if (issues.length) return { ok: false, issues };
    return { ok: true, payload: parsed, rowCount: parsed.length };
  },

  async current(_t, key) {
    return (await getSet(key)).map((v, i): ValueRow => ({
      code: v.code, label: v.label, status: v.status, sort: i, props: Object.keys(v.props).length ? JSON.stringify(v.props) : null,
    }));
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

  async apply(_t, payload, key) {
    const rows = payload as ValueRow[];
    const existing = await getSet(key);
    const incoming = new Set(rows.map((r) => r.code));
    for (const row of rows) {
      await api("/api/admin/values", {
        method: "PUT",
        body: { setKey: key, code: row.code, label: row.label, status: row.status, sort: row.sort, props: row.props ? JSON.parse(row.props) : undefined },
      });
    }
    // In-use values are retired, never deleted.
    let retired = 0;
    for (const value of existing.filter((v) => !incoming.has(v.code) && v.status !== "RETIRED")) {
      await api("/api/admin/values", { method: "PUT", body: { setKey: key, code: value.code, status: "RETIRED" } });
      retired++;
    }
    return { summary: `${rows.length} value(s) published${retired ? `, ${retired} retired` : ""}.` };
  },
};

register(distributionMatrix);
register(schedule);
register(valueSet);

export { distributionMatrix, schedule, valueSet };

// Registered alongside the others so every entry point that loads handlers sees it.
import "./departments";
import "./requirements";
