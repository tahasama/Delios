import { register, headerIndex, cell, parseDate, diffByKey, type Handler, type ParseIssue, type ParseResult } from "./registry";
import { DEFAULT_LEAD_DAYS, departmentsOf } from "../schedule";
import { api, projectPath } from "../api/client";
import { legacyActions } from "../api/schedule";
import { registerByNumber } from "../api/register";
import { adminFunctions, orEmpty } from "../api/admin";
import { requirementCalls } from "../api/records";
import { getActiveSet } from "../config";

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

  async parse(t, rows): Promise<ParseResult> {
    const required = ["Action Code", "Department", "Document"];
    const { index, missing } = headerIndex(rows, required, ALIASES);
    if (missing.length) return { ok: false, issues: [{ line: 1, message: `Missing column(s): ${missing.join(", ")}. Download the template and keep its header row.` }] };

    const [actions, docs, functions, types, statuses, disciplines, subprojects, pos, parties] = await Promise.all([
      legacyActions(t), registerByNumber(t), orEmpty(adminFunctions), getActiveSet("DOCUMENT_TYPES"), getActiveSet("STATUSES"),
      getActiveSet("DISCIPLINES"), getActiveSet("SUBPROJECTS"), getActiveSet("PURCHASE_ORDERS"),
      api<{ code: string }[]>("/api/parties").catch(() => [] as { code: string }[]),
    ]);
    const actionByCode = new Map(actions.map((a) => [a.code, a]));
    // Document types that describe a piece of equipment, from the published list.
    const describesAsset = new Set(types.filter((v) => v.props.describesAsset === true).map((v) => v.code));
    const fnCodes = new Set(functions.filter((f) => f.active).map((f) => f.code));
    // A requirement is about being able to build from the document, so the
    // status it defaults to is the first one that permits execution.
    const defaultStatus = (statuses.find((v) => v.props.executionFlag === true || v.props.executes === true) ?? statuses[0])?.code ?? "";
    const has = (list: { code: string }[], code: string) => list.some((v) => v.code === code);

    const issues: ParseIssue[] = [];
    const parsed: RequirementRow[] = [];
    const seen = new Set<string>();

    // A group of lines shares its action and department: they are written on the
    // first line, and the lines under it inherit them, the way anybody filling in
    // a sheet by hand would expect.
    let lastAction = "";
    let lastDepartment = "";
    for (let i = 1; i < rows.length; i++) {
      const line = i + 1;
      const row = rows[i];
      if (row.every((c) => !c.trim())) continue;
      const actionCode = cell(row, index, "Action Code").toUpperCase() || lastAction;
      const department = (cell(row, index, "Department").toUpperCase() || lastDepartment).split(",")[0].trim();
      if (actionCode) lastAction = actionCode;
      if (department) lastDepartment = department;
      const named = cell(row, index, "Document");
      // An existing document is named by its number; anything else is the name of
      // a document that does not exist yet.
      const docNumber = named && docs.has(named) ? named : null;
      const title = docNumber ? null : named || null;
      const discipline = cell(row, index, "Discipline").toUpperCase() || null;
      const docType = cell(row, index, "Type").toUpperCase() || null;
      const submitted = cell(row, index, "Supplier").toUpperCase();
      const approvedBy = cell(row, index, "Approved By").toUpperCase();
      const requiredStatus = cell(row, index, "Required Status").toUpperCase() || defaultStatus;
      const neededRaw = cell(row, index, "Date of delivery");
      const projectCode = cell(row, index, "Project Code") || null;
      const subProject = cell(row, index, "Sub-project") || null;
      const po = cell(row, index, "PO") || null;
      // What the document is about: the tag of the equipment, or the material.
      const assetCode = cell(row, index, "Equipment or material").toUpperCase() || null;
      // A pre-filled sheet arrives with blank lines under every action; a line
      // with no document on it means nothing more is needed there.
      if (!named) continue;
      const errors: string[] = [];

      const action = actionByCode.get(actionCode);
      if (!actionCode) errors.push("Action Code is missing");
      else if (!action) errors.push(`Action ${actionCode} is not in the schedule`);
      else if (!departmentsOf(action).length) errors.push(`Action ${actionCode} has no departments yet — the project manager tags them first`);
      else if (!departmentsOf(action).includes(department)) errors.push(`${department || "(no department)"} is not a department of ${actionCode} (${departmentsOf(action).join(", ")})`);

      const external = !OURS.includes(submitted);
      if (external && !has(parties, submitted)) errors.push(`Supplier "${submitted}" is not an organization on this project — leave it empty for our own engineering`);
      if (approvedBy && fnCodes.size && !fnCodes.has(approvedBy)) errors.push(`Approved By "${approvedBy}" is not a function`);
      if (!requiredStatus) errors.push("No status is published, so there is nothing a document can be required at");
      else if (!has(statuses, requiredStatus)) errors.push(`Required Status "${requiredStatus}" is not a published status`);
      if (neededRaw && !parseDate(neededRaw)) errors.push("Date of delivery must be YYYY-MM-DD");
      if (discipline && !has(disciplines, discipline)) errors.push(`Discipline "${discipline}" is not a published discipline`);

      // A drawing or datasheet of a thing must say which thing.
      const typeForAsset = docType ?? (docNumber ? docs.get(docNumber)?.docType ?? null : null);
      if (!assetCode && typeForAsset && describesAsset.has(typeForAsset)) {
        errors.push(`A ${typeForAsset} describes equipment — give its tag or material under "Equipment or material"`);
      }

      if (!docNumber) {
        // A name nobody can turn into a number is not a requirement yet. The
        // project code is the project's own.
        if (!docType || !has(types, docType)) errors.push(`"${named}" is not in the register, so it is created — give its Type`);
        if (!discipline) errors.push(`"${named}" is created, so give its Discipline`);
        if (!subProject || !has(subprojects, subProject)) errors.push(`"${named}" is created and needs a Sub-project for its number`);
        if (external && (!po || !has(pos, po))) errors.push(`"${named}" comes from a supplier, so it needs its PO for its number`);
      }

      const key = `${actionCode}|${docNumber ?? title}`;
      if (seen.has(key)) errors.push("This document is listed twice for the same action");
      seen.add(key);

      if (errors.length) { issues.push({ line, message: errors.join("; ") }); continue; }
      parsed.push({
        assetCode,
        actionCode, department, discipline, docNumber, title, docType,
        submittedBy: external ? submitted : null, approvedBy, requiredStatus,
        neededBy: neededRaw ? parseDate(neededRaw)!.toISOString().slice(0, 10) : null, projectCode, subProject, po,
      });
    }
    if (issues.length) return { ok: false, issues };
    if (!parsed.length) return { ok: false, issues: [{ line: 0, message: "The list contains no rows." }] };
    const created = parsed.filter((r) => !r.docNumber).length;
    return { ok: true, payload: parsed, rowCount: parsed.length, notes: created ? [`${created} new placeholder${created === 1 ? "" : "s"} will be created and numbered on approval.`] : undefined };
  },

  async current(t) {
    const actions = await legacyActions(t);
    return actions.flatMap((a) => a.entries.map((e): RequirementRow => ({
      actionCode: a.code,
      department: e.department ?? e.document.discipline,
      discipline: e.document.discipline,
      docNumber: e.document.docNumber,
      title: e.document.title,
      // What is already in force says nothing about equipment; a sheet that
      // adds one links it when it is applied.
      assetCode: null,
      docType: e.document.docType,
      submittedBy: e.submittedBy ?? e.document.originator,
      approvedBy: e.approvedBy ?? "",
      requiredStatus: e.requiredStatus,
      neededBy: e.manualDate ? e.requiredBy.toISOString().slice(0, 10) : null,
      projectCode: null, subProject: null, po: null,
    })));
  },

  async exportRows(t) {
    const actions = await legacyActions(t);
    const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
    const rows: string[][] = [];
    for (const action of actions) {
      const departments = departmentsOf(action);
      for (const department of departments) {
        const mine = action.entries.filter((e) => (e.department ?? e.document.discipline) === department);
        // What is already required, then blank lines to write more on: a sheet
        // with no room to write is a sheet nobody can answer.
        const lines = mine.length + BLANK_LINES;
        for (let i = 0; i < lines; i++) {
          const entry = mine[i];
          const head = i === 0;
          rows.push([
            head ? department : "", head ? action.code : "", head ? action.name : "", head ? action.description ?? "" : "",
            head ? iso(action.scheduledDate) : "", entry?.document.docNumber ?? "", entry?.document.discipline ?? "", entry?.document.docType ?? "",
            entry?.submittedBy ?? entry?.document.originator ?? "", entry?.manualDate ? iso(entry.requiredBy) : "", entry?.requiredStatus ?? "",
            entry?.approvedBy ?? "", "", "", "", "",
          ]);
        }
      }
    }
    return rows;
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

  async apply(t, payload, _key, versionLabel) {
    const rows = payload as RequirementRow[];
    const [actions, docs, reasons, deliverables] = await Promise.all([
      legacyActions(t), registerByNumber(t), getActiveSet("REASONS_FOR_ISSUE"), getActiveSet("DELIVERABLE_TYPES"),
    ]);
    const actionByCode = new Map(actions.map((a) => [a.code, a]));
    // What the document is needed for: the reason that builds from it.
    const purpose = (reasons.find((r) => r.code === "EXECUTION") ?? reasons.find((r) => r.code === "CONSTRUCTION") ?? reasons[0])?.code ?? "EXECUTION";
    // A supplier's document is numbered as supplier data; ours as engineering.
    const askOriginator = (v: { props: Record<string, unknown> }) => Array.isArray(v.props.required) && (v.props.required as string[]).includes("originator");
    const supplied = deliverables.find(askOriginator)?.code ?? "SUP";
    const ours = deliverables.find((v) => !askOriginator(v))?.code ?? "ENG";
    let created = 0;
    let upserted = 0;
    let dropped = 0;
    const keep = new Map<string, { actionId: string; department: string; docIds: Set<string> }>();

    for (const row of rows) {
      const action = actionByCode.get(row.actionCode);
      if (!action) throw new Error(`Action ${row.actionCode} is no longer in the schedule.`);
      let docId = row.docNumber ? docs.get(row.docNumber)?.id ?? null : null;
      if (!docId) {
        // The document's own discipline, which is not always the department's.
        const doc = await api<{ id: string; number: string }>(projectPath(t, "/documents"), {
          body: {
            title: row.title ?? row.docNumber ?? "Required document", deliverableType: row.submittedBy ? supplied : ours, docType: row.docType,
            discipline: row.discipline ?? row.department, subproject: row.subProject, originator: row.submittedBy, contractRef: row.po,
          },
        });
        docId = doc.id;
        created++;
      }

      // Tie the document to the thing it describes. An unknown tag is registered.
      if (row.assetCode) {
        await api(projectPath(t, "/assets"), { body: { code: row.assetCode, name: row.assetCode } }).catch(() => null);
        await api(projectPath(t, `/documents/${docId}/assets`), { body: { assetCode: row.assetCode } }).catch(() => null);
      }

      const existing = action.entries.find((e) => e.documentId === docId);
      const fixed = row.neededBy;
      const same = existing && existing.department === row.department && existing.requiredStatus === row.requiredStatus
        && (existing.manualDate ? existing.requiredBy.toISOString().slice(0, 10) : null) === fixed;
      if (!same) {
        if (existing) await api(projectPath(t, `/activities/${action.id}/needs/${existing.id}`), { method: "DELETE" });
        await api(projectPath(t, `/activities/${action.id}/needs`), {
          body: {
            documentId: docId, purpose, requiredStatuses: [row.requiredStatus], anchor: "START",
            offsetDays: fixed ? null : -DEFAULT_LEAD_DAYS, fixedDate: fixed, department: row.department,
          },
        });
      }
      upserted++;
      const k = `${action.id}|${row.department}`;
      if (!keep.has(k)) keep.set(k, { actionId: action.id, department: row.department, docIds: new Set() });
      keep.get(k)!.docIds.add(docId);
    }

    // What an (action, department) no longer lists is no longer required.
    for (const { actionId, department, docIds } of keep.values()) {
      const action = actions.find((a) => a.id === actionId)!;
      for (const stale of action.entries.filter((e) => e.department === department && !docIds.has(e.documentId))) {
        await api(projectPath(t, `/activities/${actionId}/needs/${stale.id}`), { method: "DELETE" });
        dropped++;
      }
    }

    // The departments whose part this list carries have answered their call.
    const departments = new Set(rows.map((r) => r.department));
    const open = (await requirementCalls(t)).filter((c) => !c.answeredAt && departments.has(c.department));
    for (const call of open) {
      await api(projectPath(t, `/requirement-calls/${call.id}/answer`), { body: { note: `Listed in ${versionLabel}` } });
    }

    return { summary: `${upserted} requirement(s) in force${open.length ? `, ${open.length} department call(s) answered` : ""}${created ? `, ${created} placeholder(s) created` : ""}${dropped ? `, ${dropped} no longer required` : ""}.` };
  },
};

register(requirements);
export { requirements };
