import type { Tenant } from "./tenant";
import { departmentsOf, DEFAULT_LEAD_DAYS } from "./schedule";
import { holders } from "./api/settings";
import { adminUsers, orEmpty } from "./api/admin";
import { legacyActions } from "./api/schedule";

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
export const REQUIREMENT_COLUMNS = [
  "Department", "Action Code", "Activity Name", "Activity Description", "Date",
  "Document", "Discipline", "Type", "Supplier", "Date of delivery",
  "Required Status", "Approved By", "Equipment or material",
  "Project Code", "Sub-project", "PO",
];

/** A sender key: a supplier's party code, or one of our departments. */
export function senderOf(entry: { submittedBy: string | null; document: { originator: string | null; discipline: string } }): string {
  const party = entry.submittedBy ?? entry.document.originator;
  return party ? party : `DEPT:${entry.document.discipline}`;
}

export function isDepartmentSender(sender: string) {
  return sender.startsWith("DEPT:");
}

/** People who answer for a department on this project. A department is a discipline. */
export async function departmentMembers(t: Tenant, department: string): Promise<string[]> {
  const people = await holders(t.projectId, "READ").catch(() => []);
  return people.filter((one) => one.department === department).map((one) => one.id);
}

/** Who receives the issued list: the supplier's people, or the department's. */
export async function senderRecipients(t: Tenant, sender: string): Promise<string[]> {
  if (isDepartmentSender(sender)) return departmentMembers(t, sender.slice(5));
  const users = await orEmpty(adminUsers);
  return users.filter((one) => one.active && one.partyCode === sender).map((one) => one.id);
}

export type CallState = "NOT_ISSUED" | "OPEN" | "OVERDUE" | "ANSWERED";

export type DepartmentRow = {
  department: string;
  actions: { code: string; name: string; scheduledDate: Date | null }[];
  /** Tagged actions no call has covered yet — the next call covers them. */
  notIssued: string[];
  call: { id: string; actionCodes: string; dueAt: Date; issuedAt: Date; reminders: number; lastRemindedAt: Date | null; answeredAt: Date | null; answerNote: string | null } | null;
  state: CallState;
  members: number;
  requirements: number;
};

/**
 * Every department the schedule concerns, and where its call stands. The
 * backend keeps no calls to departments, so none has been asked yet.
 */
export async function departmentRows(t: Tenant): Promise<DepartmentRow[]> {
  const [actions, people] = await Promise.all([legacyActions(t), holders(t.projectId, "READ").catch(() => [])]);
  const entries = actions.flatMap((a) => a.entries);
  const depts = [...new Set(actions.flatMap((a) => departmentsOf(a)))].sort();
  return depts.map((department) => {
    const mine = actions.filter((a) => departmentsOf(a).includes(department));
    return {
      department,
      actions: mine.map((a) => ({ code: a.code, name: a.name, scheduledDate: a.scheduledDate })),
      notIssued: mine.map((a) => a.code),
      call: null,
      state: "NOT_ISSUED" as CallState,
      members: people.filter((m) => m.department === department).length,
      requirements: entries.filter((e) => e.department === department).length,
    };
  });
}

export type SenderRow = {
  sender: string;
  documents: number;
  firstNeeded: Date | null;
  lastIssue: { issuedAt: Date; issuedByName: string; entryCount: number } | null;
  /** Requirements added or moved since the last issue. */
  changedSinceIssue: number;
  recipients: number;
};

/** Who sends what. The backend keeps no record of a list issued to a sender, so none has been. */
export async function senderRows(t: Tenant): Promise<SenderRow[]> {
  const entries = (await legacyActions(t)).flatMap((a) => a.entries).sort((a, b) => a.requiredBy.getTime() - b.requiredBy.getTime());
  const bySender = new Map<string, typeof entries>();
  for (const e of entries) {
    const k = senderOf(e);
    bySender.set(k, [...(bySender.get(k) ?? []), e]);
  }
  const rows: SenderRow[] = [];
  for (const [sender, list] of bySender) {
    rows.push({
      sender,
      documents: list.length,
      firstNeeded: list[0]?.requiredBy ?? null,
      lastIssue: null,
      changedSinceIssue: list.length,
      recipients: (await senderRecipients(t, sender)).length,
    });
  }
  return rows.sort((a, b) => a.sender.localeCompare(b.sender));
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
  const actions = (await legacyActions(t)).map((a) => ({
    ...a,
    entries: a.entries.filter((e) => e.department === department).sort((x, y) => x.requiredBy.getTime() - y.requiredBy.getTime()),
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
        head ? a.description ?? "" : "",
        head ? iso(a.scheduledDate) : "",
        e?.document.docNumber ?? "",
        e?.document.discipline ?? "",
        e?.document.docType ?? "",
        e?.submittedBy ?? "",
        e?.manualDate ? iso(e.requiredBy) : "",
        e?.requiredStatus ?? "",
        e?.approvedBy ?? "",
        e ? tagOf(e.documentId) : "",
        "", "", "",
      ]);
    }
  }
  return rows;
}

/** What one sender is asked to deliver, and when — the base for their baseline. */
export async function senderSheet(t: Tenant, sender: string): Promise<string[][]> {
  const entries = (await legacyActions(t))
    .flatMap((action) => action.entries.map((e) => ({ ...e, action })))
    .sort((a, b) => a.requiredBy.getTime() - b.requiredBy.getTime() || a.document.docNumber.localeCompare(b.document.docNumber));
  const rows: string[][] = [["Document Number", "Title", "Document Type", "Required Status", "Submit By", "Review Window Ends", "Approved By", "Needed For", "Activity", "Department"]];
  for (const e of entries.filter((x) => senderOf(x) === sender)) {
    rows.push([
      e.document.docNumber, e.document.title, e.document.docType, e.requiredStatus, iso(e.requiredBy),
      iso(e.action.scheduledDate), e.approvedBy ?? "", e.action.code, e.action.name, e.department ?? "",
    ]);
  }
  return rows;
}

/** An activity's departments, whether each has confirmed, and whether it may go ahead. */
export function clearance(action: { departments: string | null; confirmations: { department: string; available: boolean }[] }) {
  const depts = departmentsOf(action);
  const confirmed = depts.filter((d) => action.confirmations.some((c) => c.department === d && c.available));
  const short = depts.filter((d) => action.confirmations.some((c) => c.department === d && !c.available));
  return { depts, confirmed, short, cleared: depts.length > 0 && confirmed.length === depts.length };
}

/** Confirmation opens this many working days before the activity (the review window). */
export const CONFIRM_WINDOW_DAYS = DEFAULT_LEAD_DAYS;
