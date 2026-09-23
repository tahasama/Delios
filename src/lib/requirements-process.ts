import type { Tenant } from "./tenant";
import { businessDaysBefore, departmentsOf, DEFAULT_LEAD_BUSINESS_DAYS } from "./schedule";

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

export const REQUIREMENT_COLUMNS = [
  "Action Code", "Department", "Document Number", "Title", "Document Type", "Submitted By",
  "Approved By", "Required Status", "Needed By", "Project Code", "Sub-project", "PO",
  "Equipment or material",
];

/** A sender key: a supplier's party code, or one of our departments. */
export function senderOf(entry: { submittedBy: string | null; document: { originator: string | null; discipline: string } }): string {
  const party = entry.submittedBy ?? entry.document.originator;
  return party ? party : `DEPT:${entry.document.discipline}`;
}

export function isDepartmentSender(sender: string) {
  return sender.startsWith("DEPT:");
}

/** People who answer for a department on this project. */
export async function departmentMembers(t: Tenant, department: string): Promise<string[]> {
  const rows = await t.db.projectMembership.findMany({ where: { projectId: t.projectId, active: true, department }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** Who receives the issued list: the supplier's people, or the department's. */
export async function senderRecipients(t: Tenant, sender: string): Promise<string[]> {
  if (isDepartmentSender(sender)) return departmentMembers(t, sender.slice(5));
  const users = await t.db.user.findMany({ where: { active: true, party: { code: sender } }, select: { id: true } });
  return users.map((u) => u.id);
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

/** Every department the schedule concerns, and where its call stands. */
export async function departmentRows(t: Tenant): Promise<DepartmentRow[]> {
  const [actions, calls, members, entries] = await Promise.all([
    t.db.action.findMany({ orderBy: [{ scheduledDate: "asc" }, { code: "asc" }], select: { code: true, name: true, scheduledDate: true, departments: true } }),
    t.db.requirementCall.findMany({ orderBy: { issuedAt: "desc" } }),
    t.db.projectMembership.findMany({ where: { projectId: t.projectId, active: true, department: { not: null } }, select: { department: true } }),
    t.db.baselineEntry.findMany({ select: { department: true } }),
  ]);
  const depts = [...new Set(actions.flatMap((a) => departmentsOf(a)))].sort();
  const now = Date.now();
  return depts.map((department) => {
    const mine = actions.filter((a) => departmentsOf(a).includes(department));
    const deptCalls = calls.filter((c) => c.department === department);
    const covered = new Set(deptCalls.flatMap((c) => c.actionCodes.split(",")));
    const call = deptCalls.find((c) => !c.answeredAt) ?? deptCalls[0] ?? null;
    const state: CallState = !call ? "NOT_ISSUED" : call.answeredAt ? "ANSWERED" : call.dueAt.getTime() < now ? "OVERDUE" : "OPEN";
    return {
      department,
      actions: mine,
      notIssued: mine.filter((a) => !covered.has(a.code)).map((a) => a.code),
      call, state,
      members: members.filter((m) => m.department === department).length,
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

export async function senderRows(t: Tenant): Promise<SenderRow[]> {
  const [entries, issues] = await Promise.all([
    t.db.baselineEntry.findMany({ include: { document: { select: { originator: true, discipline: true } } }, orderBy: { requiredBy: "asc" } }),
    t.db.senderIssue.findMany({ orderBy: { issuedAt: "desc" } }),
  ]);
  const bySender = new Map<string, typeof entries>();
  for (const e of entries) {
    const k = senderOf(e);
    bySender.set(k, [...(bySender.get(k) ?? []), e]);
  }
  const rows: SenderRow[] = [];
  for (const [sender, list] of bySender) {
    const last = issues.find((i) => i.sender === sender) ?? null;
    rows.push({
      sender,
      documents: list.length,
      firstNeeded: list[0]?.requiredBy ?? null,
      lastIssue: last ? { issuedAt: last.issuedAt, issuedByName: last.issuedByName, entryCount: last.entryCount } : null,
      changedSinceIssue: last ? list.filter((e) => e.updatedAt > last.issuedAt || e.createdAt > last.issuedAt).length : list.length,
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
export async function departmentSheet(t: Tenant, department: string): Promise<string[][]> {
  const actions = await t.db.action.findMany({
    orderBy: [{ scheduledDate: "asc" }, { code: "asc" }],
    include: { entries: { where: { department }, include: { document: true }, orderBy: { requiredBy: "asc" } } },
  });
  // The equipment or material each listed document is already tied to, so the
  // sheet comes back with the column filled rather than asking for it twice.
  const docIds = actions.flatMap((a) => a.entries.map((e) => e.documentId));
  const links = docIds.length ? await t.db.relationship.findMany({ where: { kind: "DOC_ASSET", fromId: { in: docIds } }, select: { fromId: true, toId: true } }) : [];
  const assets = links.length ? await t.db.assetItem.findMany({ where: { id: { in: links.map((l) => l.toId) } }, select: { id: true, code: true } }) : [];
  const tagOf = (documentId: string) => {
    const link = links.find((l) => l.fromId === documentId);
    return link ? assets.find((a) => a.id === link.toId)?.code ?? "" : "";
  };
  const header = [...REQUIREMENT_COLUMNS, "Activity Name", "Activity Date", "Default Needed By"];
  const rows: string[][] = [header];
  for (const a of actions.filter((x) => departmentsOf(x).includes(department))) {
    const info = [a.name, iso(a.scheduledDate), a.scheduledDate ? iso(businessDaysBefore(a.scheduledDate, DEFAULT_LEAD_BUSINESS_DAYS)) : ""];
    if (!a.entries.length) rows.push([a.code, department, "", "", "", "", "", "", "", "", "", "", "", ...info]);
    for (const e of a.entries) {
      rows.push([
        a.code, department, e.document.docNumber, e.document.title, e.document.docType, e.submittedBy ?? "",
        e.approvedBy ?? "", e.requiredStatus, e.manualDate ? iso(e.requiredBy) : "", "", "", "", tagOf(e.documentId), ...info,
      ]);
    }
  }
  return rows;
}

/** What one sender is asked to deliver, and when — the base for their baseline. */
export async function senderSheet(t: Tenant, sender: string): Promise<string[][]> {
  const entries = await t.db.baselineEntry.findMany({ include: { document: true, action: true }, orderBy: [{ requiredBy: "asc" }, { document: { docNumber: "asc" } }] });
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
export const CONFIRM_WINDOW_BUSINESS_DAYS = DEFAULT_LEAD_BUSINESS_DAYS;
