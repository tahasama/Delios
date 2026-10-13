import type { Tenant } from "@/lib/core/tenant";
import { departmentsOf } from "@/lib/schedule/schedule";
import { planActions } from "@/lib/api/schedule";
/**
 * From schedule to safe activity, in the order it happens:
 *
 *   1. The schedule is in force; every activity has an A-code.
 *   2. The project manager fills the departments list, uploads and approves it.
 *   3. Document Control calls each department concerned for its documents.
 *   4. Departments fill their sheet (offline or a shared file) — documents,
 *      from whom, by when (5 working days before the activity by default).
 *   5. Late departments are reminded by Document Control.
 *   6. The filled list is uploaded and approved; the calls are answered.
 *   7. Document Control issues it to each sender, who baselines on it.
 *      Reviewers then have the working days between needed-by and the activity.
 *   8. Each department confirms its documents are available before the activity.
 *   9. The activity goes ahead when every department has confirmed.
 */

/**
 * The requirements sheet's header, said once. It is the upload template's own
 * header — a department's sheet and the controlled list are the same file.
 */
const REQUIREMENT_COLUMNS = [
  "Department", "Action Code", "Activity Name", "Activity Description", "Date",
  "Document", "Discipline", "Type", "Supplier", "Date of delivery",
  "Required Status", "Approved By", "Equipment or material",
  "Project Code", "Sub-project", "PO",
];

/** A sender key: a supplier's party code, or one of our departments. */
function senderOf(entry: { document: { originator: string | null; discipline: string } }): string {
  const party = entry.document.originator;
  return party ? party : `DEPT:${entry.document.discipline}`;
}

export function isDepartmentSender(sender: string) {
  return sender.startsWith("DEPT:");
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * A department's sheet: its part of the requirements list as it stands, plus
 * one empty line for every activity it has nothing listed for yet. The three
 * columns after PO are there to read; the upload ignores them.
 */
/** Blank document lines left under each action, so there is room to answer. */
const SHEET_BLANK_LINES = 5;

export async function departmentSheet(t: Tenant, department: string): Promise<string[][]> {
  const actions = (await planActions(t)).map((a) => ({
    ...a,
    entries: a.needs.filter((e) => e.department === department).sort((x, y) => x.neededBy.getTime() - y.neededBy.getTime()),
  }));
  // Equipment and material tags are not kept by the backend: the column comes back empty.
  const tagOf = (_documentId: string) => "";
  // The sheet is the requirements template, and the lines under each action are
  // blank on purpose: that is where the department writes what it needs.
  const rows: string[][] = [REQUIREMENT_COLUMNS];
  for (const a of actions.filter((x) => departmentsOf(x).includes(department))) {
    const lines = Math.max(a.entries.length + SHEET_BLANK_LINES, SHEET_BLANK_LINES);
    for (let i = 0; i < lines; i++) {
      const e = a.entries[i];
      const head = i === 0;
      rows.push([
        head ? department : "",
        head ? a.code : "",
        head ? a.name : "",
        "",
        head ? iso(a.start) : "",
        e?.document.number ?? "",
        e?.document.discipline ?? "",
        e?.document.docType ?? "",
        e?.document.originator ?? "",
        e?.manualDate ? iso(e.neededBy) : "",
        e?.requiredStatus ?? "",
        "",
        e ? tagOf(e.documentId) : "",
        "", "", "",
      ]);
    }
  }
  return rows;
}

/** What one sender is asked to deliver, and when — the base for their baseline. */
export async function senderSheet(t: Tenant, sender: string): Promise<string[][]> {
  const entries = (await planActions(t))
    .flatMap((action) => action.needs.map((e) => ({ ...e, action })))
    .sort((a, b) => a.neededBy.getTime() - b.neededBy.getTime() || a.document.number.localeCompare(b.document.number));
  const rows: string[][] = [["Document Number", "Title", "Document Type", "Required Status", "Submit By", "Review Window Ends", "Approved By", "Needed For", "Activity", "Department"]];
  for (const e of entries.filter((x) => senderOf(x) === sender)) {
    rows.push([
      e.document.number, e.document.title, e.document.docType, e.requiredStatus, iso(e.neededBy),
      iso(e.action.start), "", e.action.code, e.action.name, e.department ?? "",
    ]);
  }
  return rows;
}

/** An activity's departments, whether each has confirmed, and whether it may go ahead. */
export function clearance(action: {
  departments: readonly string[];
  start?: Date | null;
  confirmations: { department: string; available: boolean; revokedAt?: Date | null }[];
  needs?: { department: string | null; state: string }[];
}) {
  const depts = departmentsOf(action);
  // A confirmation taken back no longer counts; before the day, a department whose documents are all released at
  // their status is confirmed by them.
  const kept = action.confirmations.filter((c) => !c.revokedAt);
  const passed = !!action.start && action.start.getTime() < new Date().setHours(0, 0, 0, 0);
  const releasedAll = (d: string) => {
    const of = (action.needs ?? []).filter((e) => e.department === d || !e.department);
    return of.length > 0 && of.every((e) => e.state === "MET");
  };
  const confirmed = depts.filter((d) => kept.some((c) => c.department === d && c.available) || (!passed && !kept.some((c) => c.department === d) && releasedAll(d)));
  const short = depts.filter((d) => kept.some((c) => c.department === d && !c.available));
  return { depts, confirmed, short, cleared: depts.length > 0 && confirmed.length === depts.length };
}
