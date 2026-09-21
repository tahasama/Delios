import type { Tenant } from "./tenant";
import { departmentsOf } from "./schedule";
import { clearance } from "./requirements-process";

/**
 * The reports a project team actually reads, each built once and used twice:
 * on the Reports page and as a CSV download. Every figure is counted from the
 * register at the moment it is asked.
 */
export type Figure = { label: string; value: string | number; tone?: "good" | "warn" | "bad" };
export type Report = { id: ReportId; title: string; question: string; figures: Figure[]; columns: string[]; rows: (string | number)[][]; empty: string };
export type ReportId = "register" | "deliveries" | "reviews" | "transmittals" | "readiness";

export const REPORT_IDS: ReportId[] = ["register", "deliveries", "reviews", "transmittals", "readiness"];

const DAY = 86_400_000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const days = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY;

export async function buildReport(t: Tenant, id: ReportId): Promise<Report> {
  switch (id) {
    case "register": return registerStatus(t);
    case "deliveries": return deliveries(t);
    case "reviews": return reviews(t);
    case "transmittals": return transmittals(t);
    case "readiness": return readiness(t);
  }
}

/** Where every document stands, by discipline — the master document register summary. */
async function registerStatus(t: Tenant): Promise<Report> {
  const docs = await t.db.document.findMany({
    select: { discipline: true, state: true, revisions: { select: { state: true }, orderBy: { createdAt: "desc" } } },
  });
  const STAGES = ["Planned", "In work", "In review", "Released", "Out of use"] as const;
  const stageOf = (d: (typeof docs)[number]) => {
    if (["WITHDRAWN", "CANCELLED", "ARCHIVED", "DISPOSED"].includes(d.state)) return "Out of use";
    if (d.revisions.some((r) => r.state === "RELEASED")) return "Released";
    const latest = d.revisions[0]?.state;
    if (latest === "IN_REVIEW") return "In review";
    if (latest === "IN_PREPARATION") return "In work";
    return "Planned";
  };
  const by = new Map<string, Record<string, number>>();
  for (const d of docs) {
    const row = by.get(d.discipline) ?? Object.fromEntries(STAGES.map((s) => [s, 0]));
    row[stageOf(d)]++;
    by.set(d.discipline, row);
  }
  const total = (s: string) => docs.filter((d) => stageOf(d) === s).length;
  return {
    id: "register", title: "Register status", question: "Where does every document stand, by discipline?",
    figures: [
      { label: "Documents", value: docs.length },
      { label: "Released", value: `${pct(total("Released"), docs.length)}%`, tone: "good" },
      { label: "In review", value: total("In review") },
      { label: "Not started", value: total("Planned"), tone: total("Planned") ? "warn" : undefined },
    ],
    columns: ["Discipline", ...STAGES, "Total"],
    rows: [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([disc, r]) => [disc, ...STAGES.map((s) => r[s]), STAGES.reduce((n, s) => n + r[s], 0)]),
    empty: "The register is empty.",
  };
}

/** Planned against delivered, by whoever sends the documents. */
async function deliveries(t: Tenant): Promise<Report> {
  const docs = await t.db.document.findMany({
    where: { state: { notIn: ["CANCELLED", "WITHDRAWN"] } },
    select: {
      originator: true, discipline: true,
      baselineEntries: { select: { requiredBy: true }, orderBy: { requiredBy: "asc" }, take: 1 },
      revisions: { select: { plannedSubmissionDate: true, submittedAt: true, createdAt: true, state: true, cycles: { select: { submittedAt: true, outcome: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  const parties = new Map((await t.db.party.findMany({ select: { code: true, name: true } })).map((p) => [p.code, p.name]));
  const now = Date.now();
  type Row = { planned: number; sent: number; onTime: number; late: number; overdue: number; approved: number; firstTime: number };
  const by = new Map<string, Row>();
  for (const d of docs) {
    const due = d.baselineEntries[0]?.requiredBy ?? d.revisions.find((r) => r.plannedSubmissionDate)?.plannedSubmissionDate ?? null;
    if (!due) continue;
    const sender = d.originator ? parties.get(d.originator) ?? d.originator : `Us — ${d.discipline}`;
    const row = by.get(sender) ?? { planned: 0, sent: 0, onTime: 0, late: 0, overdue: 0, approved: 0, firstTime: 0 };
    row.planned++;
    const first = d.revisions.map((r) => r.submittedAt ?? r.cycles.map((c) => c.submittedAt).sort((a, b) => +a - +b)[0] ?? (r.state !== "IN_PREPARATION" ? r.createdAt : null)).filter((x): x is Date => !!x).sort((a, b) => +a - +b)[0];
    if (first) {
      row.sent++;
      if (first.getTime() <= due.getTime()) row.onTime++; else row.late++;
    } else if (due.getTime() < now) row.overdue++;
    if (d.revisions.some((r) => r.state === "RELEASED" || r.state === "SUPERSEDED")) {
      row.approved++;
      const resubmitted = d.revisions.some((r) => r.cycles.some((c) => c.outcome && ["C3", "C4", "REVISE_AND_RESUBMIT", "REJECTED"].includes(c.outcome)));
      if (!resubmitted) row.firstTime++;
    }
    by.set(sender, row);
  }
  const all = [...by.values()].reduce((a, r) => ({ planned: a.planned + r.planned, sent: a.sent + r.sent, onTime: a.onTime + r.onTime, overdue: a.overdue + r.overdue }), { planned: 0, sent: 0, onTime: 0, overdue: 0 });
  return {
    id: "deliveries", title: "Deliveries against plan", question: "Is each sender delivering on time, and right first time?",
    figures: [
      { label: "Planned", value: all.planned },
      { label: "Delivered", value: `${pct(all.sent, all.planned)}%` },
      { label: "On time", value: `${pct(all.onTime, all.sent)}%`, tone: pct(all.onTime, all.sent) >= 80 ? "good" : "warn" },
      { label: "Overdue", value: all.overdue, tone: all.overdue ? "bad" : "good" },
    ],
    columns: ["Sender", "Planned", "Delivered", "On time", "Late", "Overdue, not delivered", "Approved", "Right first time %"],
    rows: [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([s, r]) => [s, r.planned, r.sent, r.onTime, r.late, r.overdue, r.approved, pct(r.firstTime, r.approved)]),
    empty: "No document has a planned or needed-by date yet.",
  };
}

/** How long reviews take, and who holds the open ones. */
async function reviews(t: Tenant): Promise<Report> {
  const since = new Date(Date.now() - 90 * DAY);
  const [assignments, cycles, runs] = await Promise.all([
    t.db.reviewAssignment.findMany({ include: { cycle: { select: { issuedToReviewAt: true, status: true } } } }),
    t.db.reviewCycle.findMany({ where: { returnedToOriginatorAt: { gte: since } }, select: { submittedAt: true, returnedToOriginatorAt: true } }),
    t.db.workflowRun.count({ where: { status: "ACTIVE" } }),
  ]);
  const by = new Map<string, { open: number; done: number; totalDays: number; oldest: number }>();
  for (const a of assignments) {
    const r = by.get(a.userName) ?? { open: 0, done: 0, totalDays: 0, oldest: 0 };
    const start = a.cycle.issuedToReviewAt;
    if (!a.completedAt && a.cycle.status === "OPEN" && start) { r.open++; r.oldest = Math.max(r.oldest, Math.floor(days(start, new Date()))); }
    if (a.completedAt && start && a.completedAt >= since) { r.done++; r.totalDays += days(start, a.completedAt); }
    by.set(a.userName, r);
  }
  const turnaround = cycles.length ? cycles.reduce((n, c) => n + days(c.submittedAt, c.returnedToOriginatorAt!), 0) / cycles.length : 0;
  const open = [...by.values()].reduce((n, r) => n + r.open, 0);
  return {
    id: "reviews", title: "Review performance", question: "Who holds open reviews, and how long do reviews take?",
    figures: [
      { label: "Open reviews", value: open, tone: open ? "warn" : "good" },
      { label: "Routes running", value: runs },
      { label: "Returned (90 days)", value: cycles.length },
      { label: "Average turnaround", value: `${turnaround.toFixed(1)} days` },
    ],
    columns: ["Reviewer", "Open now", "Oldest open (days)", "Completed (90 days)", "Average days to respond"],
    rows: [...by.entries()].filter(([, r]) => r.open || r.done).sort((a, b) => b[1].open - a[1].open || a[0].localeCompare(b[0]))
      .map(([name, r]) => [name, r.open, r.oldest, r.done, r.done ? (r.totalDays / r.done).toFixed(1) : "—"]),
    empty: "No review has been assigned yet.",
  };
}

/** What went out and came in, and what is still waiting on someone. */
async function transmittals(t: Tenant): Promise<Report> {
  const since = new Date(Date.now() - 90 * DAY);
  const now = new Date();
  const list = await t.db.transmittal.findMany({
    where: { OR: [{ dateOfIssue: { gte: since } }, { status: { in: ["ISSUED"] } }, { responseRequired: true, status: { notIn: ["CLOSED"] } }] },
    include: { recipients: { select: { name: true, acknowledgedAt: true, openedAt: true } }, items: { select: { id: true } } },
    orderBy: { dateOfIssue: "desc" },
  });
  const out = list.filter((x) => x.direction === "OUTGOING" && x.dateOfIssue >= since).length;
  const inc = list.filter((x) => x.direction === "INCOMING" && x.dateOfIssue >= since).length;
  const toCheck = list.filter((x) => x.direction === "INCOMING" && x.status === "ISSUED");
  const overdue = list.filter((x) => x.responseRequired && x.responseDueDate && x.responseDueDate < now && x.status !== "CLOSED");
  const waiting = list.filter((x) => (x.direction === "INCOMING" && x.status === "ISSUED") || (x.responseRequired && x.status !== "CLOSED"));
  const stateOf = (x: (typeof list)[number]) =>
    x.status === "REJECTED" ? "Rejected — awaiting resubmission"
      : x.direction === "INCOMING" && x.status === "ISSUED" ? "To check and accept"
      : x.responseRequired && x.responseDueDate && x.responseDueDate < now && x.status !== "CLOSED" ? `Response overdue since ${iso(x.responseDueDate)}`
        : x.responseRequired && x.status !== "CLOSED" ? `Response due ${iso(x.responseDueDate)}` : x.status.toLowerCase();
  return {
    id: "transmittals", title: "Transmittals", question: "What went out and came in, and what is still waiting?",
    figures: [
      { label: "Issued (90 days)", value: out },
      { label: "Received (90 days)", value: inc },
      { label: "To check", value: toCheck.length, tone: toCheck.length ? "warn" : "good" },
      { label: "Responses overdue", value: overdue.length, tone: overdue.length ? "bad" : "good" },
    ],
    columns: ["Transmittal", "Direction", "Date", "From / to", "Documents", "Acknowledged", "Waiting on"],
    rows: waiting.map((x) => [
      x.number, x.direction === "INCOMING" ? "In" : "Out", iso(x.dateOfIssue),
      x.direction === "INCOMING" ? x.issuingParty : x.recipients.map((r) => r.name).filter(Boolean).join(", "),
      x.items.length, `${x.recipients.filter((r) => r.acknowledgedAt).length}/${x.recipients.length}`, stateOf(x),
    ]),
    empty: "Nothing is waiting on anyone.",
  };
}

/** The next 30 days of scheduled activities and whether their documents are in place. */
async function readiness(t: Tenant): Promise<Report> {
  const horizon = new Date(Date.now() + 30 * DAY);
  const actions = await t.db.action.findMany({
    where: { scheduledDate: { lte: horizon } },
    orderBy: { scheduledDate: "asc" },
    include: { confirmations: true, entries: { include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } } } },
  });
  const rows = actions.map((a) => {
    const ready = a.entries.filter((e) => e.document.revisions[0]?.statusCode === e.requiredStatus).length;
    const c = clearance(a);
    const state = c.cleared ? "Cleared" : c.short.length ? `Short: ${c.short.join(", ")}` : a.entries.length && ready === a.entries.length ? "Documents ready" : a.scheduledDate && a.scheduledDate < new Date() ? "Past, not cleared" : "At risk";
    return { a, ready, c, state };
  });
  return {
    id: "readiness", title: "Activity readiness", question: "Are the next 30 days of activities covered by their documents?",
    figures: [
      { label: "Activities", value: rows.length },
      { label: "Cleared", value: rows.filter((r) => r.c.cleared).length, tone: "good" },
      { label: "At risk", value: rows.filter((r) => r.state === "At risk" || r.state.startsWith("Short")).length, tone: "warn" },
      { label: "Past, not cleared", value: rows.filter((r) => r.state === "Past, not cleared").length, tone: rows.some((r) => r.state === "Past, not cleared") ? "bad" : "good" },
    ],
    columns: ["Activity", "Name", "Date", "Departments", "Documents ready", "Confirmed", "State"],
    rows: rows.map(({ a, ready, c, state }) => [a.code, a.name, iso(a.scheduledDate), departmentsOf(a).join(", "), `${ready}/${a.entries.length}`, `${c.confirmed.length}/${c.depts.length}`, state]),
    empty: "No activity in the next 30 days.",
  };
}
